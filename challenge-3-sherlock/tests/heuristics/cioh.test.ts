/**
 * Unit tests for src/heuristics/cioh.ts
 */

import { describe, it, expect } from "vitest";
import { detectCioh } from "../../src/heuristics/cioh.js";
import {
  mockCoinbaseTx,
  mockSimpleTx,
  mockBlockContext,
} from "../helpers/mock-tx.js";

const ctx = mockBlockContext();

describe("detectCioh", () => {
  it("returns detected:false for coinbase tx", () => {
    const result = detectCioh(mockCoinbaseTx(), ctx);
    expect(result.detected).toBe(false);
  });

  it("returns detected:false for tx with 1 input", () => {
    const result = detectCioh(mockSimpleTx(1, 2), ctx);
    expect(result.detected).toBe(false);
  });

  it("returns detected:true with high confidence for 2 inputs of same type", () => {
    const tx = mockSimpleTx(2, 2, { inputType: "p2wpkh" });
    const result = detectCioh(tx, ctx);
    expect(result.detected).toBe(true);
    if (result.detected) {
      expect(result.num_inputs).toBe(2);
      expect(result.confidence).toBe("high");
    }
  });

  it("returns detected:true with high confidence for 5 inputs of same type", () => {
    const tx = mockSimpleTx(5, 2, { inputType: "p2tr" });
    const result = detectCioh(tx, ctx);
    expect(result.detected).toBe(true);
    if (result.detected) {
      expect(result.num_inputs).toBe(5);
      expect(result.confidence).toBe("high");
    }
  });

  it("returns detected:true with medium confidence for 2–5 inputs of mixed types", () => {
    const tx = mockSimpleTx(3, 2);
    // Override to mixed types manually
    tx.inputs[0]!.prevout_script_type = "p2wpkh";
    tx.inputs[1]!.prevout_script_type = "p2pkh";
    tx.inputs[2]!.prevout_script_type = "p2wpkh";
    const result = detectCioh(tx, ctx);
    expect(result.detected).toBe(true);
    if (result.detected) {
      expect(result.confidence).toBe("medium");
    }
  });

  it("returns detected:true with medium confidence for 6+ inputs (same type)", () => {
    const tx = mockSimpleTx(6, 2, { inputType: "p2wpkh" });
    const result = detectCioh(tx, ctx);
    expect(result.detected).toBe(true);
    if (result.detected) {
      expect(result.num_inputs).toBe(6);
      expect(result.confidence).toBe("medium");
    }
  });

  it("returns detected:true with medium confidence for 6+ inputs (mixed types)", () => {
    const tx = mockSimpleTx(7, 2);
    tx.inputs[0]!.prevout_script_type = "p2pkh";
    tx.inputs[1]!.prevout_script_type = "p2wpkh";
    const result = detectCioh(tx, ctx);
    expect(result.detected).toBe(true);
    if (result.detected) {
      expect(result.confidence).toBe("medium");
    }
  });
});
