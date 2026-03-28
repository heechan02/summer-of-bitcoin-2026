/**
 * Unit tests for src/heuristics/consolidation.ts
 */

import { describe, it, expect } from "vitest";
import { detectConsolidation } from "../../src/heuristics/consolidation.js";
import {
  mockCoinbaseTx,
  mockSimpleTx,
  mockConsolidationTx,
  mockBlockContext,
} from "../helpers/mock-tx.js";

const ctx = mockBlockContext();

describe("detectConsolidation", () => {
  it("returns detected:false for coinbase tx", () => {
    const result = detectConsolidation(mockCoinbaseTx(), ctx);
    expect(result.detected).toBe(false);
  });

  it("returns detected:false for 2 inputs → 1 output (below MIN_INPUTS)", () => {
    const result = detectConsolidation(mockSimpleTx(2, 1), ctx);
    expect(result.detected).toBe(false);
  });

  it("returns detected:false for 3 inputs → 3 outputs (too many outputs)", () => {
    const result = detectConsolidation(mockSimpleTx(3, 3), ctx);
    expect(result.detected).toBe(false);
  });

  it("returns detected:true with medium confidence for 3 inputs → 2 outputs", () => {
    const result = detectConsolidation(mockSimpleTx(3, 2, { inputType: "p2wpkh" }), ctx);
    expect(result.detected).toBe(true);
    if (result.detected) {
      expect(result.num_inputs).toBe(3);
      expect(result.num_outputs).toBe(2);
      expect(result.confidence).toBe("medium");
    }
  });

  it("returns detected:true with medium confidence for 3 inputs → 1 output (ratio=3, same type)", () => {
    // ratio=3 < HIGH_RATIO_THRESHOLD=5, so medium even with same type
    const result = detectConsolidation(mockSimpleTx(3, 1, { inputType: "p2wpkh" }), ctx);
    expect(result.detected).toBe(true);
    if (result.detected) {
      expect(result.confidence).toBe("medium");
    }
  });

  it("returns detected:true with high confidence for 5 inputs → 1 output same type", () => {
    const result = detectConsolidation(mockConsolidationTx(5), ctx);
    expect(result.detected).toBe(true);
    if (result.detected) {
      expect(result.num_inputs).toBe(5);
      expect(result.num_outputs).toBe(1);
      expect(result.confidence).toBe("high");
    }
  });

  it("returns detected:true with medium confidence for 5 inputs mixed types → 1 output", () => {
    const tx = mockSimpleTx(5, 1);
    tx.inputs[0]!.prevout_script_type = "p2wpkh";
    tx.inputs[1]!.prevout_script_type = "p2pkh";
    tx.inputs[2]!.prevout_script_type = "p2wpkh";
    tx.inputs[3]!.prevout_script_type = "p2wpkh";
    tx.inputs[4]!.prevout_script_type = "p2wpkh";
    const result = detectConsolidation(tx, ctx);
    expect(result.detected).toBe(true);
    if (result.detected) {
      expect(result.confidence).toBe("medium");
    }
  });

  it("returns detected:true with high confidence for 10 inputs → 1 output same type", () => {
    const result = detectConsolidation(mockConsolidationTx(10), ctx);
    expect(result.detected).toBe(true);
    if (result.detected) {
      expect(result.num_inputs).toBe(10);
      expect(result.confidence).toBe("high");
    }
  });
});
