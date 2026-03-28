/**
 * Unit tests for src/chain-analyzer.ts
 *
 * Tests cover:
 *  - analyzeBlockFile: smoke test on real fixture
 *  - Block count, txCount, coinbase shape
 *  - BIP34 height decoding
 *  - Fee calculation for standard txs
 *  - OP_RETURN output detection
 *  - buildBlockContext: address sets, maps, utxoSpentByMap
 */

import { describe, it, expect } from 'vitest';
import { analyzeBlockFile, buildBlockContext } from '../src/chain-analyzer.js';
import type { AnalyzableTx, AnalyzableInput, AnalyzableOutput } from '../src/heuristics/types.js';

// ---------------------------------------------------------------------------
// Fixture paths
// ---------------------------------------------------------------------------

const BLK = 'fixtures/blk04330.dat';
const REV = 'fixtures/rev04330.dat';
const XOR = 'fixtures/xor.dat';

// ---------------------------------------------------------------------------
// analyzeBlockFile — fixture-based tests
// ---------------------------------------------------------------------------

describe('analyzeBlockFile (fixture)', () => {
  // Parse once and reuse across all tests in this suite
  const blocks = analyzeBlockFile(BLK, REV, XOR);

  it('returns at least one block', () => {
    expect(blocks.length).toBeGreaterThanOrEqual(1);
  });

  it('every AnalyzedBlock has required fields', () => {
    for (const b of blocks) {
      expect(typeof b.blockHash).toBe('string');
      expect(b.blockHash).toHaveLength(64);
      expect(typeof b.blockHeight).toBe('number');
      expect(b.blockHeight).toBeGreaterThan(0);
      expect(typeof b.timestamp).toBe('number');
      expect(b.timestamp).toBeGreaterThan(0);
      expect(typeof b.txCount).toBe('number');
      expect(b.txCount).toBeGreaterThan(0);
      expect(Array.isArray(b.txs)).toBe(true);
      expect(b.txs).toHaveLength(b.txCount);
    }
  });

  it('first tx in each block is the coinbase', () => {
    for (const b of blocks) {
      const coinbase = b.txs[0];
      expect(coinbase).toBeDefined();
      expect(coinbase!.isCoinbase).toBe(true);
      expect(coinbase!.fee_sats).toBe(0);
      expect(coinbase!.fee_rate_sat_vb).toBe(0);
    }
  });

  it('coinbase inputs have zero prevout value and null address', () => {
    const coinbase = blocks[0]!.txs[0]!;
    for (const inp of coinbase.inputs) {
      expect(inp.prevout_value_sats).toBe(0);
      expect(inp.prevout_address).toBeNull();
    }
  });

  it('BIP34 height is a sensible block height (> 800000 for modern blocks)', () => {
    // blk04330.dat contains mainnet blocks around height 847k
    const b = blocks[0]!;
    expect(b.blockHeight).toBeGreaterThan(800_000);
  });

  it('standard txs have positive fee and non-negative fee rate', () => {
    const b = blocks[0]!;
    // Skip coinbase (index 0), check first few standard txs
    const standardTxs = b.txs.slice(1, 6);
    for (const tx of standardTxs) {
      expect(tx.isCoinbase).toBe(false);
      expect(tx.fee_sats).toBeGreaterThanOrEqual(0);
      expect(tx.fee_rate_sat_vb).toBeGreaterThanOrEqual(0);
    }
  });

  it('fee_rate_sat_vb = fee_sats / vbytes for standard txs', () => {
    const b = blocks[0]!;
    const standardTxs = b.txs.slice(1, 10);
    for (const tx of standardTxs) {
      const expected = tx.vbytes > 0 ? tx.fee_sats / tx.vbytes : 0;
      expect(tx.fee_rate_sat_vb).toBeCloseTo(expected, 6);
    }
  });

  it('all outputs have a valid script_type', () => {
    const validTypes = new Set(['p2pkh', 'p2sh', 'p2wpkh', 'p2wsh', 'p2tr', 'op_return', 'unknown']);
    const b = blocks[0]!;
    for (const tx of b.txs.slice(0, 20)) {
      for (const out of tx.outputs) {
        expect(validTypes.has(out.script_type)).toBe(true);
      }
    }
  });

  it('op_return outputs have op_return_data_hex and op_return_protocol set', () => {
    const b = blocks[0]!;
    const opReturnOutputs = b.txs
      .flatMap((tx) => tx.outputs)
      .filter((out) => out.script_type === 'op_return');

    // The fixture is likely to have some OP_RETURN outputs
    if (opReturnOutputs.length > 0) {
      for (const out of opReturnOutputs) {
        expect(typeof out.op_return_data_hex).toBe('string');
        expect(typeof out.op_return_protocol).toBe('string');
      }
    }
  });

  it('non-op_return outputs do NOT have op_return fields', () => {
    const b = blocks[0]!;
    const normalOutputs = b.txs
      .flatMap((tx) => tx.outputs)
      .filter((out) => out.script_type !== 'op_return')
      .slice(0, 20);

    for (const out of normalOutputs) {
      expect(out.op_return_data_hex).toBeUndefined();
      expect(out.op_return_protocol).toBeUndefined();
    }
  });

  it('txid strings are 64-char lowercase hex', () => {
    const b = blocks[0]!;
    for (const tx of b.txs.slice(0, 10)) {
      expect(tx.txid).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('block hash is 64-char lowercase hex', () => {
    for (const b of blocks) {
      expect(b.blockHash).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});

// ---------------------------------------------------------------------------
// buildBlockContext — unit tests with mock data
// ---------------------------------------------------------------------------

/** Helper to build a minimal AnalyzableTx for context tests. */
function makeTx(
  txid: string,
  isCoinbase: boolean,
  inputs: Partial<AnalyzableInput>[],
  outputs: Partial<AnalyzableOutput>[],
): AnalyzableTx {
  const fullInputs: AnalyzableInput[] = inputs.map((inp) => ({
    txid: inp.txid ?? '0000000000000000000000000000000000000000000000000000000000000000',
    vout: inp.vout ?? 0,
    sequence: inp.sequence ?? 0xffffffff,
    scriptSig: inp.scriptSig ?? Buffer.alloc(0),
    witness: inp.witness ?? [],
    prevout_value_sats: inp.prevout_value_sats ?? 0,
    prevout_script_type: inp.prevout_script_type ?? 'unknown',
    prevout_address: inp.prevout_address ?? null,
  }));

  const fullOutputs: AnalyzableOutput[] = outputs.map((out, i) => ({
    index: out.index ?? i,
    value_sats: out.value_sats ?? 0,
    script_type: out.script_type ?? 'p2wpkh',
    address: out.address ?? null,
    script_pubkey_hex: out.script_pubkey_hex ?? '',
  }));

  return {
    txid,
    isCoinbase,
    inputs: fullInputs,
    outputs: fullOutputs,
    weight: 400,
    vbytes: 100,
    fee_sats: 0,
    fee_rate_sat_vb: 0,
  };
}

describe('buildBlockContext', () => {
  it('collects output addresses into allTxAddresses', () => {
    const tx = makeTx('aaaa', false, [{ prevout_address: 'addr_in' }], [
      { address: 'addr_out', script_type: 'p2wpkh' },
    ]);
    const ctx = buildBlockContext([tx], 800_000);
    expect(ctx.allTxAddresses.has('addr_out')).toBe(true);
    expect(ctx.allTxAddresses.has('addr_in')).toBe(true);
  });

  it('excludes op_return outputs from allTxAddresses', () => {
    const tx = makeTx('bbbb', false, [], [
      { address: 'addr_op', script_type: 'op_return' },
    ]);
    const ctx = buildBlockContext([tx], 800_000);
    expect(ctx.allTxAddresses.has('addr_op')).toBe(false);
  });

  it('excludes null addresses from allTxAddresses', () => {
    const tx = makeTx('cccc', false, [{ prevout_address: null }], [
      { address: null, script_type: 'p2wpkh' },
    ]);
    const ctx = buildBlockContext([tx], 800_000);
    expect(ctx.allTxAddresses.size).toBe(0);
  });

  it('populates txOutputMap and txInputMap keyed by txid', () => {
    const tx = makeTx('dddd', false, [{ prevout_address: 'in1' }], [
      { address: 'out1', script_type: 'p2wpkh' },
    ]);
    const ctx = buildBlockContext([tx], 800_000);
    expect(ctx.txOutputMap.has('dddd')).toBe(true);
    expect(ctx.txInputMap.has('dddd')).toBe(true);
    expect(ctx.txOutputMap.get('dddd')).toHaveLength(1);
    expect(ctx.txInputMap.get('dddd')).toHaveLength(1);
  });

  it('builds utxoSpentByMap for non-coinbase inputs', () => {
    const tx = makeTx('eeee', false, [{ txid: 'prevtx', vout: 0, prevout_address: 'x' }], []);
    const ctx = buildBlockContext([tx], 800_000);
    expect(ctx.utxoSpentByMap.get('prevtx:0')).toBe('eeee');
  });

  it('does NOT add coinbase inputs to utxoSpentByMap', () => {
    const cb = makeTx('ffff', true, [{ txid: '0000', vout: 0xffffffff, prevout_address: null }], []);
    const ctx = buildBlockContext([cb], 800_000);
    // coinbase dummy input should not appear in the spending map
    expect(ctx.utxoSpentByMap.size).toBe(0);
  });

  it('blockHeight is stored correctly', () => {
    const ctx = buildBlockContext([], 847_493);
    expect(ctx.blockHeight).toBe(847_493);
  });

  it('multiple txs accumulate all addresses', () => {
    const tx1 = makeTx('tx1', false, [{ prevout_address: 'addr_a' }], [{ address: 'addr_b' }]);
    const tx2 = makeTx('tx2', false, [{ prevout_address: 'addr_c' }], [{ address: 'addr_d' }]);
    const ctx = buildBlockContext([tx1, tx2], 800_000);
    expect(ctx.allTxAddresses.has('addr_a')).toBe(true);
    expect(ctx.allTxAddresses.has('addr_b')).toBe(true);
    expect(ctx.allTxAddresses.has('addr_c')).toBe(true);
    expect(ctx.allTxAddresses.has('addr_d')).toBe(true);
  });

  it('utxoSpentByMap handles multiple inputs in one tx', () => {
    const tx = makeTx('spending', false, [
      { txid: 'prev1', vout: 0, prevout_address: 'a' },
      { txid: 'prev2', vout: 1, prevout_address: 'b' },
    ], []);
    const ctx = buildBlockContext([tx], 800_000);
    expect(ctx.utxoSpentByMap.get('prev1:0')).toBe('spending');
    expect(ctx.utxoSpentByMap.get('prev2:1')).toBe('spending');
  });
});
