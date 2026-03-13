import { describe, it, expect } from "vitest";
import { detectPeelingChain } from "../../src/heuristics/peeling-chain.js";
import {
  mockBlockContext,
  mockCoinbaseTx,
  mockPeelingTx,
  mockSimpleTx,
} from "../helpers/mock-tx.js";
import type { AnalyzableTx } from "../../src/heuristics/types.js";

/** Build a 2-hop chain: tx1 (large→tx2), tx2 (also skewed). */
function buildTwoHopChain(): { tx1: AnalyzableTx; tx2: AnalyzableTx } {
  // tx1: output[0]=900_000 (large), output[1]=50_000 (small, <10%)
  const tx1 = mockSimpleTx(1, 2, {
    txid: "aa".repeat(32),
    inputValues: [1_000_000],
    outputValues: [900_000, 50_000],
  });

  // tx2 spends tx1 output[0]: tx2 output[0]=810_000, output[1]=45_000
  const tx2 = mockSimpleTx(1, 2, {
    txid: "bb".repeat(32),
    inputValues: [900_000],
    outputValues: [810_000, 45_000],
  });
  // Override tx2's input to reference tx1's large output
  tx2.inputs[0]!.txid = tx1.txid;
  tx2.inputs[0]!.vout = 0; // index 0 is the large output in tx1

  return { tx1, tx2 };
}

/** Build a 3-hop chain: tx1→tx2→tx3. */
function buildThreeHopChain(): { tx1: AnalyzableTx; tx2: AnalyzableTx; tx3: AnalyzableTx } {
  const tx1 = mockSimpleTx(1, 2, {
    txid: "aa".repeat(32),
    inputValues: [1_000_000],
    outputValues: [900_000, 50_000],
  });

  const tx2 = mockSimpleTx(1, 2, {
    txid: "bb".repeat(32),
    inputValues: [900_000],
    outputValues: [810_000, 45_000],
  });
  tx2.inputs[0]!.txid = tx1.txid;
  tx2.inputs[0]!.vout = 0;

  const tx3 = mockSimpleTx(1, 2, {
    txid: "cc".repeat(32),
    inputValues: [810_000],
    outputValues: [729_000, 40_000],
  });
  tx3.inputs[0]!.txid = tx2.txid;
  tx3.inputs[0]!.vout = 0;

  return { tx1, tx2, tx3 };
}

describe("detectPeelingChain", () => {
  it("returns detected:false for coinbase", () => {
    const ctx = mockBlockContext();
    const result = detectPeelingChain(mockCoinbaseTx(), ctx);
    expect(result.detected).toBe(false);
  });

  it("returns detected:false when outputs are 50/50 split", () => {
    const tx = mockSimpleTx(1, 2, {
      inputValues: [200_000],
      outputValues: [100_000, 100_000],
    });
    const ctx = mockBlockContext([tx]);
    const result = detectPeelingChain(tx, ctx);
    expect(result.detected).toBe(false);
  });

  it("returns detected:false when tx has 3+ outputs", () => {
    const tx = mockSimpleTx(1, 3, {
      inputValues: [300_000],
      outputValues: [200_000, 50_000, 30_000],
    });
    const ctx = mockBlockContext([tx]);
    const result = detectPeelingChain(tx, ctx);
    expect(result.detected).toBe(false);
  });

  it("returns detected:false when skewed but no chain (large output unspent in block)", () => {
    const tx = mockPeelingTx(900_000, 50_000);
    // No spending tx in context
    const ctx = mockBlockContext([tx]);
    const result = detectPeelingChain(tx, ctx);
    expect(result.detected).toBe(false);
  });

  it("detects 2-hop chain with medium confidence", () => {
    const { tx1, tx2 } = buildTwoHopChain();
    const ctx = mockBlockContext([tx1, tx2]);
    const result = detectPeelingChain(tx1, ctx);
    expect(result.detected).toBe(true);
    if (result.detected) {
      expect(result.chain_length).toBe(2);
      expect(result.confidence).toBe("medium");
    }
  });

  it("detects 3-hop chain with high confidence", () => {
    const { tx1, tx2, tx3 } = buildThreeHopChain();
    const ctx = mockBlockContext([tx1, tx2, tx3]);
    const result = detectPeelingChain(tx1, ctx);
    expect(result.detected).toBe(true);
    if (result.detected) {
      expect(result.chain_length).toBe(3);
      expect(result.confidence).toBe("high");
    }
  });

  it("returns detected:false for skewed outputs where ratio is exactly 10%", () => {
    // 10% is NOT below threshold — must be strictly less than 10%
    const tx = mockSimpleTx(1, 2, {
      txid: "ee".repeat(32),
      inputValues: [110_000],
      outputValues: [100_000, 10_000],
    });
    const ctx = mockBlockContext([tx]);
    const result = detectPeelingChain(tx, ctx);
    // ratio = 10_000/100_000 = 0.1, which is NOT < 0.1, so not detected
    expect(result.detected).toBe(false);
  });

  it("detects when small output ratio is just below 10%", () => {
    // ratio = 9_999/100_000 = 0.09999 < 0.1
    const tx1 = mockSimpleTx(1, 2, {
      txid: "ff".repeat(32),
      inputValues: [115_000],
      outputValues: [100_000, 9_999],
    });
    const tx2 = mockSimpleTx(1, 2, {
      txid: "11".repeat(32),
      inputValues: [100_000],
      outputValues: [90_000, 8_999],
    });
    tx2.inputs[0]!.txid = tx1.txid;
    tx2.inputs[0]!.vout = 0;

    const ctx = mockBlockContext([tx1, tx2]);
    const result = detectPeelingChain(tx1, ctx);
    expect(result.detected).toBe(true);
    if (result.detected) {
      expect(result.chain_length).toBe(2);
    }
  });
});
