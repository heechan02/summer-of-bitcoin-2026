import { describe, it, expect } from "vitest";
import { detectCoinJoin } from "../../src/heuristics/coinjoin.js";
import {
  mockCoinJoinTx,
  mockSimpleTx,
  mockCoinbaseTx,
  mockBlockContext,
} from "../helpers/mock-tx.js";

const ctx = mockBlockContext();

describe("detectCoinJoin", () => {
  it("returns detected:false for coinbase", () => {
    const result = detectCoinJoin(mockCoinbaseTx(), ctx);
    expect(result.detected).toBe(false);
  });

  it("returns detected:false for <3 inputs", () => {
    // 2 inputs, 3 equal outputs — but inputs < 3, so no detection
    const tx = mockSimpleTx(2, 3, { outputValues: [50_000, 50_000, 50_000] });
    const result = detectCoinJoin(tx, ctx);
    expect(result.detected).toBe(false);
  });

  it("returns detected:false for normal 2-output tx", () => {
    const tx = mockSimpleTx(3, 2);
    const result = detectCoinJoin(tx, ctx);
    expect(result.detected).toBe(false);
  });

  it("returns detected:false when only 2 equal outputs among many", () => {
    // 4 outputs: 2 equal + 2 different
    const tx = mockSimpleTx(3, 4, {
      outputValues: [50_000, 50_000, 30_000, 20_000],
    });
    const result = detectCoinJoin(tx, ctx);
    expect(result.detected).toBe(false);
  });

  it("detects medium confidence with 3 equal + 1 different output", () => {
    const tx = mockSimpleTx(3, 4, {
      outputValues: [50_000, 50_000, 50_000, 10_000],
    });
    const result = detectCoinJoin(tx, ctx);
    expect(result.detected).toBe(true);
    if (result.detected) {
      expect(result.equal_output_count).toBe(3);
      expect(result.denomination_sats).toBe(50_000);
      expect(result.confidence).toBe("medium");
    }
  });

  it("detects high confidence with 5 equal outputs and 5 inputs (Whirlpool)", () => {
    const tx = mockCoinJoinTx(5, 50_000);
    const result = detectCoinJoin(tx, ctx);
    expect(result.detected).toBe(true);
    if (result.detected) {
      expect(result.equal_output_count).toBe(5);
      expect(result.denomination_sats).toBe(50_000);
      expect(result.confidence).toBe("high");
    }
  });

  it("detects high confidence with ≥5 equal outputs and ≥5 inputs", () => {
    const tx = mockCoinJoinTx(7, 100_000);
    const result = detectCoinJoin(tx, ctx);
    expect(result.detected).toBe(true);
    if (result.detected) {
      expect(result.equal_output_count).toBe(7);
      expect(result.denomination_sats).toBe(100_000);
      expect(result.confidence).toBe("high");
    }
  });

  it("ignores op_return outputs when grouping values", () => {
    // 3 equal real outputs + 1 op_return with same value → op_return excluded
    const tx = mockSimpleTx(3, 4, {
      outputValues: [50_000, 50_000, 50_000, 0],
      outputTypes: ["p2wpkh", "p2wpkh", "p2wpkh", "op_return"],
    });
    const result = detectCoinJoin(tx, ctx);
    expect(result.detected).toBe(true);
    if (result.detected) {
      expect(result.equal_output_count).toBe(3);
      expect(result.confidence).toBe("medium");
    }
  });

  it("Whirlpool signature: exactly 5 in, 5 out, all equal → high", () => {
    // Explicit Whirlpool scenario
    const tx = mockCoinJoinTx(5, 1_000_000);
    const result = detectCoinJoin(tx, ctx);
    expect(result.detected).toBe(true);
    if (result.detected) {
      expect(result.confidence).toBe("high");
    }
  });
});
