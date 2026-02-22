import fs from 'fs';
import { xorDecode, parseBlocks, computeMerkleRoot } from '../parser/block-parser.js';
import { parseUndoFile } from '../parser/undo-parser.js';
import { analyzeTx } from './tx-analyzer.js';
import { classifyOutputScript } from '../script/classify-output.js';
import { disassemble } from '../script/disassemble.js';
import { addressFromScript } from '../script/address.js';
import type { FixtureInput, TxAnalysisResult, ErrorResult } from './types.js';

export type BlockResult = BlockSuccess | ErrorResult;

interface BlockSuccess {
  ok: true;
  mode: 'block';
  block_header: {
    version: number;
    prev_block_hash: string;
    merkle_root: string;
    merkle_root_valid: boolean;
    timestamp: number;
    bits: string;
    nonce: number;
    block_hash: string;
  };
  tx_count: number;
  coinbase: {
    bip34_height: number | null;
    coinbase_script_hex: string;
    total_output_sats: number;
  };
  transactions: TxAnalysisResult[];
  block_stats: {
    total_fees_sats: number;
    total_weight: number;
    avg_fee_rate_sat_vb: number;
    script_type_summary: Record<string, number>;
  };
}

export async function analyzeBlock(blkPath: string, revPath: string, xorPath: string): Promise<BlockResult[]> {
  const xorKey = fs.readFileSync(xorPath);
  const rawBlk = xorDecode(fs.readFileSync(blkPath), xorKey);
  const rawRev = xorDecode(fs.readFileSync(revPath), xorKey);

  const blocks = parseBlocks(rawBlk);
  const undoBlocks = parseUndoFile(rawRev);

  const results: BlockResult[] = [];

  // Match undo blocks to blk blocks by non-coinbase tx count (sequential greedy match).
  // Blocks in blk*.dat may include orphans; only main-chain blocks have undo data.
  let undoIdx = 0;
  for (let bi = 0; bi < blocks.length; bi++) {
    const block = blocks[bi];
    const nonCoinbaseCount = block.transactions.length - 1;
    const undo = undoBlocks[undoIdx];

    if (!undo || undo.txPrevouts.length !== nonCoinbaseCount) {
      // No matching undo — orphan block, skip output
      continue;
    }

    undoIdx++;
    try {
      const result = analyzeOneBlock(block, undo);
      results.push(result);
    } catch (e: any) {
      results.push({
        ok: false,
        error: { code: 'BLOCK_PARSE_ERROR', message: e?.message ?? 'Unknown error' },
      });
    }
  }

  return results;
}

function analyzeOneBlock(block: any, undo: any): BlockResult {
  const { header, transactions } = block;

  // Verify Merkle root
  const txids = transactions.map((tx: any) => tx.txid as string);
  const computedMerkle = computeMerkleRoot(txids);
  const merkleValid = computedMerkle === header.merkle_root;

  if (!merkleValid) {
    return {
      ok: false,
      error: {
        code: 'INVALID_MERKLE_ROOT',
        message: `Computed merkle root ${computedMerkle} does not match header ${header.merkle_root}`,
      },
    };
  }

  // Coinbase transaction (first tx)
  const coinbaseTx = transactions[0] as any;
  if (!coinbaseTx) {
    return { ok: false, error: { code: 'INVALID_BLOCK', message: 'No transactions in block' } };
  }

  // Validate coinbase input: txid must be all zeros, vout must be 0xFFFFFFFF
  const coinbaseInput = coinbaseTx.inputs[0];
  const allZero = coinbaseInput.txidRaw.every((b: number) => b === 0);
  if (!allZero || coinbaseInput.vout !== 0xffffffff) {
    return { ok: false, error: { code: 'INVALID_COINBASE', message: 'First tx is not a valid coinbase' } };
  }

  // Decode BIP34 block height from scriptSig
  let bip34Height: number | null = null;
  try {
    bip34Height = decodeBip34Height(coinbaseInput.scriptSig);
  } catch { /* ignore */ }

  const coinbaseTotalOutput = coinbaseTx.outputs.reduce(
    (sum: number, o: any) => sum + Number(o.value), 0
  );

  // Analyze transactions
  const analyzedTxs: TxAnalysisResult[] = [];

  // Coinbase tx (no prevouts)
  const coinbaseResult = analyzeCoinbaseTx(coinbaseTx);
  analyzedTxs.push(coinbaseResult);

  // Non-coinbase transactions using undo prevouts
  let undoTxIdx = 0;
  for (let ti = 1; ti < transactions.length; ti++) {
    const tx = transactions[ti] as any;
    const undoInputs = undo?.txPrevouts[undoTxIdx] ?? [];
    undoTxIdx++;

    const prevouts = tx.inputs.map((inp: any, ii: number) => {
      const up = undoInputs[ii];
      if (!up) throw new Error(`Missing undo prevout for tx ${tx.txid} input ${ii}`);
      return {
        txid: inp.txid,
        vout: inp.vout,
        value_sats: up.value_sats,
        script_pubkey_hex: up.script_pubkey_hex,
      };
    });

    const fixture: FixtureInput = {
      network: 'mainnet',
      raw_tx: tx.fullSerialization.toString('hex'),
      prevouts,
    };
    const txResult = analyzeTx(fixture);
    analyzedTxs.push(txResult as TxAnalysisResult);
  }

  // Block stats
  const nonCoinbaseTxs = analyzedTxs.slice(1);
  const totalFees = nonCoinbaseTxs.reduce((s, tx) => {
    if (tx.ok) return s + (tx as any).fee_sats;
    return s;
  }, 0);
  const totalWeight = analyzedTxs.reduce((s, tx) => {
    if (tx.ok) return s + (tx as any).weight;
    return s;
  }, 0);
  const totalVbytes = analyzedTxs.reduce((s, tx) => {
    if (tx.ok) return s + (tx as any).vbytes;
    return s;
  }, 0);
  const avgFeeRate = totalVbytes > 0 ? Math.round((totalFees / totalVbytes) * 100) / 100 : 0;

  const scriptTypeSummary: Record<string, number> = {};
  for (const tx of analyzedTxs) {
    if (!tx.ok) continue;
    for (const vout of (tx as any).vout) {
      const t = vout.script_type;
      scriptTypeSummary[t] = (scriptTypeSummary[t] ?? 0) + 1;
    }
  }

  return {
    ok: true,
    mode: 'block',
    block_header: {
      version: header.version,
      prev_block_hash: header.prev_block_hash,
      merkle_root: header.merkle_root,
      merkle_root_valid: merkleValid,
      timestamp: header.timestamp,
      bits: header.bits,
      nonce: header.nonce,
      block_hash: header.block_hash,
    },
    tx_count: transactions.length,
    coinbase: {
      bip34_height: bip34Height,
      coinbase_script_hex: coinbaseInput.scriptSig.toString('hex'),
      total_output_sats: coinbaseTotalOutput,
    },
    transactions: analyzedTxs,
    block_stats: {
      total_fees_sats: totalFees,
      total_weight: totalWeight,
      avg_fee_rate_sat_vb: avgFeeRate,
      script_type_summary: scriptTypeSummary,
    },
  };
}

function decodeBip34Height(scriptSig: Buffer): number | null {
  if (scriptSig.length === 0) return null;
  const pushLen = scriptSig[0];
  if (pushLen < 1 || pushLen > 5) return null;
  if (scriptSig.length < 1 + pushLen) return null;
  let height = 0;
  for (let i = 0; i < pushLen; i++) {
    height |= scriptSig[1 + i] << (8 * i);
  }
  return height;
}

function analyzeCoinbaseTx(tx: any): TxAnalysisResult {
  const vout = tx.outputs.map((out: any, n: number) => {
    const script = out.scriptPubKey as Buffer;
    const scriptType = classifyOutputScript(script);
    const address = addressFromScript(script);
    return {
      n,
      value_sats: Number(out.value),
      script_pubkey_hex: script.toString('hex'),
      script_asm: disassemble(script),
      script_type: scriptType,
      address,
    };
  });

  return {
    ok: true,
    network: 'mainnet',
    segwit: tx.isSegwit,
    txid: tx.txid,
    wtxid: tx.wtxid ?? null,
    version: tx.version,
    locktime: tx.locktime,
    size_bytes: tx.sizeBytes,
    weight: tx.weight,
    vbytes: tx.vbytes,
    total_input_sats: 0,
    total_output_sats: tx.outputs.reduce((s: number, o: any) => s + Number(o.value), 0),
    fee_sats: 0,
    fee_rate_sat_vb: 0,
    rbf_signaling: false,
    locktime_type: 'none',
    locktime_value: tx.locktime,
    segwit_savings: null,
    vin: tx.inputs.map((inp: any) => ({
      txid: inp.txid,
      vout: inp.vout,
      sequence: inp.sequence,
      script_sig_hex: inp.scriptSig.toString('hex'),
      script_asm: disassemble(inp.scriptSig),
      witness: inp.witness.map((w: Buffer) => w.toString('hex')),
      script_type: 'unknown',
      address: null,
      prevout: { value_sats: 0, script_pubkey_hex: '' },
      relative_timelock: { enabled: false },
    })),
    vout,
    warnings: [],
  } as any;
}
