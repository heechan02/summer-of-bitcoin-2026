import { describe, expect, it } from "vitest";
import { detectSelfTransfer } from "../../src/heuristics/self-transfer.js";
import {
  mockBlockContext,
  mockCoinbaseTx,
  mockSelfTransferTx,
  mockSimpleTx,
} from "../helpers/mock-tx.js";

describe("detectSelfTransfer", () => {
  const ctx = mockBlockContext();

  it("returns detected:false for coinbase tx", () => {
    const result = detectSelfTransfer(mockCoinbaseTx(), ctx);
    expect(result.detected).toBe(false);
  });

  it("returns detected:true with high confidence when all outputs match input type and no round amounts", () => {
    // 2 inputs p2wpkh, 2 outputs p2wpkh, non-round values
    const tx = mockSimpleTx(2, 2, {
      inputType: "p2wpkh",
      outputTypes: ["p2wpkh", "p2wpkh"],
      outputValues: [87_777, 7_333],
    });
    const result = detectSelfTransfer(tx, ctx);
    expect(result.detected).toBe(true);
    if (result.detected) {
      expect(result.confidence).toBe("high");
    }
  });

  it("returns detected:true with medium confidence when all outputs match but a round amount is present", () => {
    const tx = mockSimpleTx(2, 2, {
      inputType: "p2wpkh",
      outputTypes: ["p2wpkh", "p2wpkh"],
      outputValues: [100_000, 87_500], // 100_000 is divisible by ROUND_THRESHOLD_SATS
    });
    const result = detectSelfTransfer(tx, ctx);
    expect(result.detected).toBe(true);
    if (result.detected) {
      expect(result.confidence).toBe("medium");
    }
  });

  it("returns detected:true for 1-in 1-out sweep (same type)", () => {
    const tx = mockSelfTransferTx("p2wpkh");
    const result = detectSelfTransfer(tx, ctx);
    expect(result.detected).toBe(true);
  });

  it("returns detected:false when output types are mixed", () => {
    const tx = mockSimpleTx(2, 2, {
      inputType: "p2wpkh",
      outputTypes: ["p2wpkh", "p2tr"],
      outputValues: [87_777, 7_333],
    });
    const result = detectSelfTransfer(tx, ctx);
    expect(result.detected).toBe(false);
  });

  it("returns detected:false when outputs do not match input type", () => {
    const tx = mockSimpleTx(2, 2, {
      inputType: "p2wpkh",
      outputTypes: ["p2pkh", "p2pkh"],
      outputValues: [87_777, 7_333],
    });
    const result = detectSelfTransfer(tx, ctx);
    expect(result.detected).toBe(false);
  });

  it("ignores op_return outputs when checking type match", () => {
    // 1 input p2wpkh, 1 real output p2wpkh, 1 op_return → should still detect
    const tx = mockSimpleTx(1, 2, {
      inputType: "p2wpkh",
      outputTypes: ["p2wpkh", "op_return"],
      outputValues: [80_000, 0],
    });
    const result = detectSelfTransfer(tx, ctx);
    expect(result.detected).toBe(true);
  });

  it("returns detected:false when all outputs are op_return", () => {
    const tx = mockSimpleTx(1, 1, {
      inputType: "p2wpkh",
      outputTypes: ["op_return"],
      outputValues: [0],
    });
    const result = detectSelfTransfer(tx, ctx);
    expect(result.detected).toBe(false);
  });

  it("uses dominant input type when inputs have mixed types", () => {
    // 3 p2wpkh inputs + 1 p2pkh input, all outputs p2wpkh → dominant is p2wpkh → detected
    const tx = mockSimpleTx(4, 1, {
      outputTypes: ["p2wpkh"],
      outputValues: [350_000],
      inputValues: [100_000, 100_000, 100_000, 100_000],
    });
    // Override input types manually: first 3 p2wpkh, last p2pkh
    tx.inputs[0]!.prevout_script_type = "p2wpkh";
    tx.inputs[1]!.prevout_script_type = "p2wpkh";
    tx.inputs[2]!.prevout_script_type = "p2wpkh";
    tx.inputs[3]!.prevout_script_type = "p2pkh";
    const result = detectSelfTransfer(tx, ctx);
    expect(result.detected).toBe(true);
  });
});
