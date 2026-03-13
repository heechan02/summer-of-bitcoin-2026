import { describe, it, expect } from "vitest";
import { detectRoundNumberPayment } from "../../src/heuristics/round-number.js";
import {
  mockBlockContext,
  mockCoinbaseTx,
  mockSimpleTx,
} from "../helpers/mock-tx.js";

const ctx = mockBlockContext();

describe("detectRoundNumberPayment", () => {
  it("returns detected:false for coinbase", () => {
    const result = detectRoundNumberPayment(mockCoinbaseTx(), ctx);
    expect(result.detected).toBe(false);
  });

  it("detects 1 BTC output with high confidence", () => {
    const tx = mockSimpleTx(1, 2, {
      inputValues: [110_000_000],
      outputValues: [100_000_000, 9_990_000],
    });
    const result = detectRoundNumberPayment(tx, ctx);
    expect(result.detected).toBe(true);
    if (result.detected) {
      expect(result.confidence).toBe("high");
      expect(result.round_outputs).toHaveLength(1);
      expect(result.round_outputs[0]!.index).toBe(0);
      expect(result.round_outputs[0]!.value_sats).toBe(100_000_000);
    }
  });

  it("detects 0.1 BTC output with high confidence", () => {
    const tx = mockSimpleTx(1, 2, {
      inputValues: [21_000_000],
      outputValues: [10_000_000, 10_990_000],
    });
    const result = detectRoundNumberPayment(tx, ctx);
    expect(result.detected).toBe(true);
    if (result.detected) {
      expect(result.confidence).toBe("high");
    }
  });

  it("detects 0.01 BTC output with medium confidence", () => {
    const tx = mockSimpleTx(1, 2, {
      inputValues: [2_100_000],
      outputValues: [1_000_000, 1_090_000],
    });
    const result = detectRoundNumberPayment(tx, ctx);
    expect(result.detected).toBe(true);
    if (result.detected) {
      expect(result.confidence).toBe("medium");
    }
  });

  it("detects 0.001 BTC output with low confidence", () => {
    const tx = mockSimpleTx(1, 2, {
      inputValues: [210_000],
      outputValues: [100_000, 109_000],
    });
    const result = detectRoundNumberPayment(tx, ctx);
    expect(result.detected).toBe(true);
    if (result.detected) {
      expect(result.confidence).toBe("low");
    }
  });

  it("returns detected:false for non-round amount (12345678 sats)", () => {
    const tx = mockSimpleTx(1, 1, {
      inputValues: [13_000_000],
      outputValues: [12_345_678],
    });
    const result = detectRoundNumberPayment(tx, ctx);
    expect(result.detected).toBe(false);
  });

  it("excludes OP_RETURN outputs from round-number check", () => {
    const tx = mockSimpleTx(1, 2, {
      inputValues: [110_000_000],
      outputValues: [100_000_000, 0],
      outputTypes: ["p2wpkh", "op_return"],
    });
    // Only the p2wpkh output (index 0) should be considered
    const result = detectRoundNumberPayment(tx, ctx);
    expect(result.detected).toBe(true);
    if (result.detected) {
      expect(result.round_outputs.every((r) => r.index === 0)).toBe(true);
    }
  });

  it("excludes zero-value outputs", () => {
    const tx = mockSimpleTx(1, 2, {
      inputValues: [100_000],
      outputValues: [0, 99_000],
    });
    // 0 is excluded; 99_000 is not round
    const result = detectRoundNumberPayment(tx, ctx);
    expect(result.detected).toBe(false);
  });

  it("detects multiple round outputs and lists them all", () => {
    const tx = mockSimpleTx(1, 3, {
      inputValues: [210_000_000],
      outputValues: [100_000_000, 10_000_000, 99_990_000],
    });
    const result = detectRoundNumberPayment(tx, ctx);
    expect(result.detected).toBe(true);
    if (result.detected) {
      expect(result.round_outputs).toHaveLength(2);
      expect(result.confidence).toBe("high");
    }
  });

  it("overall confidence is highest among all round outputs", () => {
    // One medium (0.01 BTC) + one low (0.001 BTC) → overall high? No — should be medium
    const tx = mockSimpleTx(1, 3, {
      inputValues: [2_200_000],
      outputValues: [1_000_000, 100_000, 1_090_000],
    });
    const result = detectRoundNumberPayment(tx, ctx);
    expect(result.detected).toBe(true);
    if (result.detected) {
      expect(result.confidence).toBe("medium");
    }
  });
});
