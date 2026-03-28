/**
 * chain-analyzer.ts — data pipeline: blk/rev/xor raw files → AnalyzedBlock[]
 *
 * Pipeline:
 *   1. Read xor.dat key, XOR-decode blk and rev buffers
 *   2. parseBlocks(decodedBlk) → ParsedBlock[]
 *   3. parseUndoFile(decodedRev) → UndoBlock[]
 *   4. Sequential greedy matching: pair each block with its undo record
 *      (skip orphan blocks that have no matching undo entry)
 *   5. For each matched pair: build AnalyzableTx[] from parsed tx + UndoPrevout data
 *   6. Build BlockContext (address sets + spending maps) for heuristics
 *   7. Memory discipline: txs[] kept for all blocks; cli.ts drops them for blocks[1+]
 *      after per-block stats are computed
 * @module chain-analyzer
 */

import * as fs from 'fs';
import { xorDecode, parseBlocks } from './parser/block-parser.js';
import { parseUndoFile } from './parser/undo-parser.js';
import { classifyOutputScript } from './script/classify-output.js';
import { addressFromScript } from './script/address.js';
import { extractOpReturnData } from './script/disassemble.js';
import type { ParsedBlock } from './parser/block-parser.js';
import type { UndoBlock, UndoPrevout } from './parser/undo-parser.js';
import type {
  AnalyzableTx,
  AnalyzableInput,
  AnalyzableOutput,
  BlockContext,
} from './heuristics/types.js';

// ---------------------------------------------------------------------------
// Local interfaces matching C1 parser output shapes
// (src/analyzer/types.ts does not exist as a file; parsers import it type-only
//  which tsx erases at runtime. We define the shapes we need here.)
// ---------------------------------------------------------------------------

/** Shape of a parsed transaction input as returned by block-parser / tx-parser. */
interface RawInput {
  /** Txid in display byte order (hex, reversed). */
  txid: string;
  /** Raw txid bytes (not reversed). */
  txidRaw: Buffer;
  /** Output index being spent. */
  vout: number;
  /** ScriptSig bytes. */
  scriptSig: Buffer;
  /** Input sequence number. */
  sequence: number;
  /** Witness stack items (empty array for non-SegWit). */
  witness: Buffer[];
}

/** Shape of a parsed transaction output as returned by block-parser / tx-parser. */
interface RawOutput {
  /** Output value in satoshis as a BigInt (from readUInt64LE). */
  value: bigint;
  /** ScriptPubKey bytes. */
  scriptPubKey: Buffer;
}

/** Shape of a parsed transaction as returned by block-parser. */
interface RawTx {
  /** Transaction ID (hex, display byte order). */
  txid: string;
  /** Witness txid (or null for legacy). */
  wtxid: string | null;
  /** Parsed inputs. */
  inputs: RawInput[];
  /** Parsed outputs. */
  outputs: RawOutput[];
  /** Transaction weight in weight units. */
  weight: number;
  /** Virtual bytes (ceil(weight / 4)). */
  vbytes: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Known OP_RETURN protocol prefix — Omni Layer. */
const OMNI_PREFIX_HEX = '6f6d6e69';
/** Known OP_RETURN protocol prefix — OpenTimestamps. */
const OTS_PREFIX_HEX = '0109f91102';
/** Known OP_RETURN protocol prefix — Runes (OP_13). */
const RUNES_PREFIX_HEX = '52';
/** VeriBlock OP_RETURN payload length in bytes. */
const VERIBLOCK_PAYLOAD_LENGTH = 80;

// ---------------------------------------------------------------------------
// Public output type
// ---------------------------------------------------------------------------

/**
 * A parsed and enriched block ready for heuristic analysis and JSON/MD output.
 */
export interface AnalyzedBlock {
  /** Block hash hex (display byte order, 64 chars). */
  blockHash: string;
  /** Block height decoded from BIP34 coinbase scriptSig. */
  blockHeight: number;
  /** Unix timestamp (seconds) from block header. */
  timestamp: number;
  /** Total number of transactions including coinbase. */
  txCount: number;
  /**
   * Full AnalyzableTx array for all blocks.
   * cli.ts is responsible for dropping txs[] (setting to []) for blocks[1+]
   * after per-block stats have been computed, to prevent OOM.
   */
  txs: AnalyzableTx[];
  /** Cross-tx context used by heuristics (address sets, spending maps). */
  context: BlockContext;
}

// ---------------------------------------------------------------------------
// Main exported function
// ---------------------------------------------------------------------------

/**
 * Read raw blk/rev/xor files and produce one AnalyzedBlock per matched block.
 * Orphan blocks (no matching undo record) are skipped silently.
 *
 * @param blkPath - Path to blk*.dat file.
 * @param revPath - Path to rev*.dat file.
 * @param xorPath - Path to xor.dat file.
 * @returns Array of AnalyzedBlock in block order (orphans excluded).
 */
export function analyzeBlockFile(
  blkPath: string,
  revPath: string,
  xorPath: string,
): AnalyzedBlock[] {
  // STEP 1: Read raw files from disk
  const xorKey = fs.readFileSync(xorPath);
  const blkRaw = fs.readFileSync(blkPath);
  const revRaw = fs.readFileSync(revPath);

  // STEP 2: XOR-decode blk and rev using the repeating xor key
  const blkDecoded = xorDecode(blkRaw, xorKey);
  const revDecoded = xorDecode(revRaw, xorKey);

  // STEP 3: Parse decoded buffers into structured types
  const parsedBlocks = parseBlocks(blkDecoded) as unknown as Array<ParsedBlock & { transactions: RawTx[] }>;
  const undoBlocks = parseUndoFile(revDecoded);

  // STEP 4: Sequential greedy matching
  // Walk both arrays with separate indices.
  // A block matches the current undo record when:
  //   undoBlock.txPrevouts.length === block.transactions.length - 1 (non-coinbase count)
  // If mismatch, the block is an orphan → skip it (advance blockIdx only, not undoIdx).
  const analyzedBlocks: AnalyzedBlock[] = [];
  let undoIdx = 0;

  for (let blockIdx = 0; blockIdx < parsedBlocks.length; blockIdx++) {
    // parsedBlocks[blockIdx] is always defined because blockIdx < parsedBlocks.length
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const block = parsedBlocks[blockIdx]!;
    const nonCbCount = block.transactions.length - 1;

    const currentUndo = undoBlocks[undoIdx];
    if (undoIdx >= undoBlocks.length || currentUndo === undefined || currentUndo.txPrevouts.length !== nonCbCount) {
      // Orphan block — skip silently
      console.error(
        `[chain-analyzer] Skipping orphan block at index ${blockIdx} (nonCbCount=${nonCbCount}, undoIdx=${undoIdx})`,
      );
      continue;
    }

    const undoBlock = currentUndo;
    undoIdx++;

    // STEP 5: Build AnalyzableTx[] for this block
    const txs = buildAnalyzableTxs(block.transactions, undoBlock);

    // STEP 6: Decode BIP34 height + build BlockContext for heuristics
    const blockHeight = decodeBip34Height(block.transactions[0]);
    const context = buildBlockContext(txs, blockHeight);

    analyzedBlocks.push({
      blockHash: block.header.block_hash,
      blockHeight,
      timestamp: block.header.timestamp,
      txCount: txs.length,
      txs,
      context,
    });
  }

  return analyzedBlocks;
}

// ---------------------------------------------------------------------------
// Build AnalyzableTx[]
// ---------------------------------------------------------------------------

/**
 * Convert all raw transactions in a block into enriched AnalyzableTx objects.
 * Coinbase is always index 0; standard txs use undo prevout data.
 *
 * @param rawTxs - Raw parsed transactions from block-parser.
 * @param undoBlock - Matching undo record providing prevout values and scripts.
 * @returns Array of AnalyzableTx with coinbase at index 0.
 */
function buildAnalyzableTxs(rawTxs: RawTx[], undoBlock: UndoBlock): AnalyzableTx[] {
  return rawTxs.map((rawTx, txIndex) => {
    if (txIndex === 0) {
      // First tx is always the coinbase
      return buildCoinbaseTx(rawTx);
    }
    // Standard tx: undoBlock.txPrevouts is indexed starting from tx index 1
    // txIndex >= 1 here, so txIndex - 1 is always a valid index (matched by greedy algorithm)
    const prevouts = undoBlock.txPrevouts[txIndex - 1] ?? [];
    return buildStandardTx(rawTx, prevouts);
  });
}

/**
 * Build an AnalyzableTx for the coinbase transaction.
 * Inputs get zero prevout value and null address; fee is 0.
 *
 * @param rawTx - Parsed coinbase transaction.
 * @returns Coinbase AnalyzableTx.
 */
function buildCoinbaseTx(rawTx: RawTx): AnalyzableTx {
  // Coinbase inputs carry no real prevout data
  const inputs: AnalyzableInput[] = rawTx.inputs.map((inp) => ({
    txid: inp.txid,
    vout: inp.vout,
    sequence: inp.sequence,
    scriptSig: inp.scriptSig,
    witness: inp.witness,
    prevout_value_sats: 0,
    prevout_script_type: 'unknown',
    prevout_address: null,
  }));

  const outputs = rawTx.outputs.map((out, index) => buildOutput(out, index));

  return {
    txid: rawTx.txid,
    isCoinbase: true,
    inputs,
    outputs,
    weight: rawTx.weight,
    vbytes: rawTx.vbytes,
    fee_sats: 0,
    fee_rate_sat_vb: 0,
  };
}

/**
 * Build an AnalyzableTx for a standard (non-coinbase) transaction.
 * Each input is enriched with prevout value, script type, and address from undo data.
 *
 * @param rawTx - Parsed transaction.
 * @param prevouts - UndoPrevout array for this tx's inputs (from undo file).
 * @returns Enriched AnalyzableTx.
 */
function buildStandardTx(rawTx: RawTx, prevouts: UndoPrevout[]): AnalyzableTx {
  const inputs: AnalyzableInput[] = rawTx.inputs.map((inp, i) => {
    // prevouts is aligned 1:1 with inputs by the undo file format
    const prevout = prevouts[i] ?? { value_sats: 0, script_pubkey_hex: '' };
    const prevoutScriptBuf = Buffer.from(prevout.script_pubkey_hex, 'hex');
    const prevout_script_type = prevoutScriptBuf.length > 0 ? classifyOutputScript(prevoutScriptBuf) : 'unknown';
    const prevout_address = prevoutScriptBuf.length > 0 ? addressFromScript(prevoutScriptBuf) : null;

    return {
      txid: inp.txid,
      vout: inp.vout,
      sequence: inp.sequence,
      scriptSig: inp.scriptSig,
      witness: inp.witness,
      prevout_value_sats: prevout.value_sats,
      prevout_script_type,
      prevout_address,
    };
  });

  const outputs = rawTx.outputs.map((out, index) => buildOutput(out, index));

  // fee = sum(input prevout values) − sum(output values); max guard against negatives
  const totalIn = inputs.reduce((acc, inp) => acc + inp.prevout_value_sats, 0);
  const totalOut = outputs.reduce((acc, out) => acc + out.value_sats, 0);
  const fee_sats = Math.max(0, totalIn - totalOut);
  const fee_rate_sat_vb = rawTx.vbytes > 0 ? fee_sats / rawTx.vbytes : 0;

  return {
    txid: rawTx.txid,
    isCoinbase: false,
    inputs,
    outputs,
    weight: rawTx.weight,
    vbytes: rawTx.vbytes,
    fee_sats,
    fee_rate_sat_vb,
  };
}

/**
 * Build an AnalyzableOutput from a raw parsed output at the given index.
 * Classifies script type, derives address, and extracts OP_RETURN data if present.
 *
 * @param out - Raw parsed output (value is BigInt from readUInt64LE).
 * @param index - Zero-based output index.
 * @returns Enriched AnalyzableOutput.
 */
function buildOutput(out: RawOutput, index: number): AnalyzableOutput {
  const script_type = classifyOutputScript(out.scriptPubKey);
  const address = addressFromScript(out.scriptPubKey);
  const script_pubkey_hex = out.scriptPubKey.toString('hex');
  // Convert BigInt satoshi value to Number (safe: max BTC supply ~2.1e15 sats < Number.MAX_SAFE_INTEGER)
  const value_sats = Number(out.value);

  const base: AnalyzableOutput = {
    index,
    value_sats,
    script_type,
    address,
    script_pubkey_hex,
  };

  // Extract OP_RETURN payload and attempt protocol classification
  if (script_type === 'op_return') {
    const data = extractOpReturnData(out.scriptPubKey);
    base.op_return_data_hex = data.toString('hex');
    base.op_return_protocol = classifyOpReturnProtocol(data);
  }

  return base;
}

// ---------------------------------------------------------------------------
// OP_RETURN protocol classification
// ---------------------------------------------------------------------------

/**
 * Classify the protocol of an OP_RETURN payload by length and known prefixes.
 *
 * @param data - Raw OP_RETURN payload bytes (after the opcode).
 * @returns Protocol name: 'omni' | 'opentimestamps' | 'runes' | 'veriblock' | 'unknown'.
 */
function classifyOpReturnProtocol(data: Buffer): string {
  // VeriBlock: exactly 80-byte payloads (check length first to avoid prefix collisions)
  if (data.length === VERIBLOCK_PAYLOAD_LENGTH) return 'veriblock';

  const hex = data.toString('hex');
  if (hex.startsWith(OMNI_PREFIX_HEX)) return 'omni';
  if (hex.startsWith(OTS_PREFIX_HEX)) return 'opentimestamps';
  if (hex.startsWith(RUNES_PREFIX_HEX)) return 'runes';
  return 'unknown';
}

// ---------------------------------------------------------------------------
// BIP34 height decoding
// ---------------------------------------------------------------------------

/**
 * Decode the block height from a coinbase transaction's scriptSig using BIP34.
 * Format: scriptSig[0] = byte count N; scriptSig[1..N] = height as LE integer.
 * Falls back to 0 if the scriptSig is missing or malformed.
 *
 * @param coinbaseTx - The coinbase transaction (index 0 in the block).
 * @returns Non-negative block height integer.
 */
function decodeBip34Height(coinbaseTx: RawTx | undefined): number {
  if (!coinbaseTx || coinbaseTx.inputs.length === 0) return 0;

  // inputs[0] is guaranteed to exist because length > 0
  const firstInput = coinbaseTx.inputs[0];
  if (firstInput === undefined) return 0;

  const scriptSig = firstInput.scriptSig;
  if (!scriptSig || scriptSig.length < 2) return 0;

  // First byte = number of bytes encoding the height
  const lengthByte: number = scriptSig[0] ?? 0;
  if (lengthByte === 0 || scriptSig.length < 1 + lengthByte) return 0;

  // Read height as little-endian integer from the next lengthByte bytes
  let height = 0;
  for (let i = 0; i < lengthByte; i++) {
    height += (scriptSig[1 + i] ?? 0) * Math.pow(256, i);
  }
  return height;
}

// ---------------------------------------------------------------------------
// BlockContext builder
// ---------------------------------------------------------------------------

/**
 * Build a BlockContext from all AnalyzableTx in a block.
 * Collects all addresses and builds spending/output maps for cross-tx heuristics.
 *
 * @param txs - All AnalyzableTx in the block (including coinbase at index 0).
 * @param blockHeight - Decoded block height.
 * @returns BlockContext ready for heuristic runners.
 */
export function buildBlockContext(txs: AnalyzableTx[], blockHeight: number): BlockContext {
  const allTxAddresses = new Set<string>();
  const txOutputMap = new Map<string, AnalyzableOutput[]>();
  const txInputMap = new Map<string, AnalyzableInput[]>();
  const utxoSpentByMap = new Map<string, string>();

  for (const tx of txs) {
    // Collect non-null output addresses (skip op_return outputs)
    for (const out of tx.outputs) {
      if (out.address !== null && out.script_type !== 'op_return') {
        allTxAddresses.add(out.address);
      }
    }

    // Collect non-null input prevout addresses; build utxoSpentByMap for non-coinbase txs
    if (!tx.isCoinbase) {
      for (const inp of tx.inputs) {
        if (inp.prevout_address !== null) {
          allTxAddresses.add(inp.prevout_address);
        }
        // Maps "prevTxid:prevVout" → spending txid for peeling chain detection
        utxoSpentByMap.set(`${inp.txid}:${inp.vout}`, tx.txid);
      }
    }

    txOutputMap.set(tx.txid, tx.outputs);
    txInputMap.set(tx.txid, tx.inputs);
  }

  return { blockHeight, allTxAddresses, txOutputMap, txInputMap, utxoSpentByMap };
}
