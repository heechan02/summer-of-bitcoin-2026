/**
 * Unit tests for the Change Detection heuristic.
 */

import { describe, it, expect } from "vitest";
import { detectChangeOutput } from "../../src/heuristics/change-detection.js";
import {
  mockCoinbaseTx,
  mockSimpleTx,
  mockBlockContext,
} from "../helpers/mock-tx.js";

const ctx = mockBlockContext();

describe("detectChangeOutput", () => {
  it("returns detected:false for coinbase tx", () => {
    const result = detectChangeOutput(mockCoinbaseTx(), ctx);
    expect(result.detected).toBe(false);
  });

  it("returns detected:false for single spendable output", () => {
    const tx = mockSimpleTx(1, 1);
    const result = detectChangeOutput(tx, ctx);
    expect(result.detected).toBe(false);
  });

  it("returns detected:false when only output is op_return + 1 spendable", () => {
    const tx = mockSimpleTx(1, 2, {
      outputTypes: ["p2wpkh", "op_return"],
    });
    const result = detectChangeOutput(tx, ctx);
    // Only 1 spendable output → detected: false
    expect(result.detected).toBe(false);
  });

  it("detects address reuse with high confidence", () => {
    // Input prevout_address matches output[1]'s address
    const tx = mockSimpleTx(1, 2, {
      inputAddresses: ["bc1q_reused"],
      outputAddresses: ["bc1q_other", "bc1q_reused"],
      outputTypes: ["p2wpkh", "p2wpkh"],
    });
    const result = detectChangeOutput(tx, ctx);
    expect(result.detected).toBe(true);
    if (!result.detected) return;
    expect(result.method).toBe("address_reuse");
    expect(result.confidence).toBe("high");
    expect(result.likely_change_index).toBe(1);
  });

  it("detects script type match with high confidence", () => {
    // 2 inputs: p2wpkh. Outputs: p2wpkh (change), p2pkh (payment)
    const tx = mockSimpleTx(2, 2, {
      inputType: "p2wpkh",
      outputTypes: ["p2wpkh", "p2pkh"],
    });
    const result = detectChangeOutput(tx, ctx);
    expect(result.detected).toBe(true);
    if (!result.detected) return;
    expect(result.method).toBe("script_type_match");
    expect(result.confidence).toBe("high");
    expect(result.likely_change_index).toBe(0); // p2wpkh is index 0
  });

  it("script type match: does NOT fire when both outputs match input type", () => {
    const tx = mockSimpleTx(2, 2, {
      inputType: "p2wpkh",
      outputTypes: ["p2wpkh", "p2wpkh"],
    });
    const result = detectChangeOutput(tx, ctx);
    // Script type match requires exactly 1 matching output
    // Falls through to round number or value heuristic
    if (result.detected) {
      expect(["round_number", "value_heuristic"]).toContain(result.method);
    }
  });

  it("detects round number: non-round output is change", () => {
    // Output 0: 5_000_000 (round, divisible by 1_000_000) — payment
    // Output 1: 4_999_123 (non-round) — change
    const tx = mockSimpleTx(1, 2, {
      inputType: "p2pkh",
      outputTypes: ["p2pkh", "p2pkh"],
      outputValues: [5_000_000, 4_999_123],
      inputValues: [10_100_000],
    });
    const result = detectChangeOutput(tx, ctx);
    expect(result.detected).toBe(true);
    if (!result.detected) return;
    expect(result.method).toBe("round_number");
    expect(result.confidence).toBe("medium");
    expect(result.likely_change_index).toBe(1); // non-round is change
  });

  it("falls back to value heuristic for 2 same-type outputs with no round amounts", () => {
    // Both outputs same script type as input — script type match fires (1 match) unless both match
    // Use different type from input so neither match fires, and no round amounts
    const tx = mockSimpleTx(1, 2, {
      inputType: "p2tr",
      outputTypes: ["p2pkh", "p2pkh"],
      outputValues: [123_456, 234_567],
      inputValues: [400_000],
    });
    const result = detectChangeOutput(tx, ctx);
    expect(result.detected).toBe(true);
    if (!result.detected) return;
    expect(result.method).toBe("value_heuristic");
    expect(result.confidence).toBe("low");
    // Larger value (234_567 at index 1) is change
    expect(result.likely_change_index).toBe(1);
  });

  it("address reuse takes priority over script type match", () => {
    // Input type: p2wpkh. Output 0: p2wpkh, Output 1: p2pkh with reused address
    const tx = mockSimpleTx(2, 2, {
      inputType: "p2wpkh",
      outputTypes: ["p2wpkh", "p2pkh"],
      inputAddresses: ["bc1q_reused", "bc1q_other"],
      outputAddresses: ["bc1q_something", "bc1q_reused"],
    });
    const result = detectChangeOutput(tx, ctx);
    expect(result.detected).toBe(true);
    if (!result.detected) return;
    expect(result.method).toBe("address_reuse");
    expect(result.likely_change_index).toBe(1);
  });

  it("op_return outputs are excluded from change detection", () => {
    // 3 outputs: p2wpkh(0), op_return(1), p2pkh(2) — only 2 spendable
    // Input type: p2wpkh → script type match fires (output 0 is p2wpkh, output 2 is p2pkh)
    const tx = mockSimpleTx(1, 3, {
      inputType: "p2wpkh",
      outputTypes: ["p2wpkh", "op_return", "p2pkh"],
      outputValues: [80_000, 0, 60_000],
      inputValues: [150_000],
    });
    const result = detectChangeOutput(tx, ctx);
    expect(result.detected).toBe(true);
    if (!result.detected) return;
    expect(result.method).toBe("script_type_match");
    expect(result.likely_change_index).toBe(0); // p2wpkh matches input type
  });
});
