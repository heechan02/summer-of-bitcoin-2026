/**
 * Unit tests for the OP_RETURN heuristic.
 */

import { describe, it, expect } from "vitest";
import { detectOpReturn } from "../../src/heuristics/op-return.js";
import {
  mockSimpleTx,
  mockOpReturnTx,
  mockBlockContext,
  mockOutput,
} from "../helpers/mock-tx.js";

/**
 * Builds a script_pubkey_hex for OP_RETURN with the given payload hex.
 * Uses OP_PUSHDATA1 (0x4c) for payloads longer than 75 bytes.
 */
function opReturnScript(payloadHex: string): string {
  const len = payloadHex.length / 2;
  if (len <= 0x4b) {
    return `6a${len.toString(16).padStart(2, "0")}${payloadHex}`;
  }
  // OP_PUSHDATA1: 6a 4c <len-byte> <data>
  return `6a4c${len.toString(16).padStart(2, "0")}${payloadHex}`;
}

describe("detectOpReturn", () => {
  const ctx = mockBlockContext();

  it("returns detected:false when no OP_RETURN output exists", () => {
    const tx = mockSimpleTx(1, 2);
    const result = detectOpReturn(tx, ctx);
    expect(result.detected).toBe(false);
  });

  it("detects OP_RETURN with Omni protocol prefix", () => {
    const payload = "6f6d6e69" + "00000001" + "0000000002faf080";
    const tx = mockSimpleTx(1, 2, {
      outputTypes: ["p2wpkh", "op_return"],
      outputValues: [80_000, 0],
    });
    // Override the second output with correct Omni script
    tx.outputs[1] = mockOutput(1, {
      value_sats: 0,
      script_type: "op_return",
      address: null,
      script_pubkey_hex: opReturnScript(payload),
    });

    const result = detectOpReturn(tx, ctx);
    expect(result.detected).toBe(true);
    if (result.detected) {
      expect(result.protocol).toBe("omni");
      expect(result.op_return_count).toBe(1);
    }
  });

  it("detects OP_RETURN with OpenTimestamps prefix", () => {
    const payload = "0109f91102" + "deadbeef";
    const tx = mockSimpleTx(1, 2, {
      outputTypes: ["p2wpkh", "op_return"],
      outputValues: [80_000, 0],
    });
    tx.outputs[1] = mockOutput(1, {
      value_sats: 0,
      script_type: "op_return",
      address: null,
      script_pubkey_hex: opReturnScript(payload),
    });

    const result = detectOpReturn(tx, ctx);
    expect(result.detected).toBe(true);
    if (result.detected) {
      expect(result.protocol).toBe("opentimestamps");
    }
  });

  it("detects OP_RETURN with Runes prefix (OP_13 = 0x52)", () => {
    const payload = "52" + "aabbcc";
    const tx = mockSimpleTx(1, 2, {
      outputTypes: ["p2wpkh", "op_return"],
      outputValues: [80_000, 0],
    });
    tx.outputs[1] = mockOutput(1, {
      value_sats: 0,
      script_type: "op_return",
      address: null,
      script_pubkey_hex: opReturnScript(payload),
    });

    const result = detectOpReturn(tx, ctx);
    expect(result.detected).toBe(true);
    if (result.detected) {
      expect(result.protocol).toBe("runes");
    }
  });

  it("detects OP_RETURN with 80-byte payload as VeriBlock", () => {
    const payload = "aa".repeat(80); // 80 bytes
    const tx = mockSimpleTx(1, 2, {
      outputTypes: ["p2wpkh", "op_return"],
      outputValues: [80_000, 0],
    });
    tx.outputs[1] = mockOutput(1, {
      value_sats: 0,
      script_type: "op_return",
      address: null,
      script_pubkey_hex: opReturnScript(payload),
    });

    const result = detectOpReturn(tx, ctx);
    expect(result.detected).toBe(true);
    if (result.detected) {
      expect(result.protocol).toBe("veriblock");
      expect(result.op_return_count).toBe(1);
    }
  });

  it("classifies unrecognised payload as unknown protocol", () => {
    const tx = mockOpReturnTx("unknown");
    // mockOpReturnTx sets op_return_protocol on the output but detectOpReturn
    // re-derives the protocol from the raw script bytes — use a script with
    // a 4-byte payload that matches none of the known prefixes.
    tx.outputs[1] = mockOutput(1, {
      value_sats: 0,
      script_type: "op_return",
      address: null,
      script_pubkey_hex: opReturnScript("deadbeef"),
    });

    const result = detectOpReturn(tx, ctx);
    expect(result.detected).toBe(true);
    if (result.detected) {
      expect(result.protocol).toBe("unknown");
    }
  });

  it("counts multiple OP_RETURN outputs correctly", () => {
    const tx = mockSimpleTx(1, 3, {
      outputTypes: ["p2wpkh", "op_return", "op_return"],
      outputValues: [80_000, 0, 0],
    });
    const omniPayload = "6f6d6e69deadbeef";
    tx.outputs[1] = mockOutput(1, {
      value_sats: 0,
      script_type: "op_return",
      address: null,
      script_pubkey_hex: opReturnScript(omniPayload),
    });
    tx.outputs[2] = mockOutput(2, {
      value_sats: 0,
      script_type: "op_return",
      address: null,
      script_pubkey_hex: opReturnScript("cafebabe"),
    });

    const result = detectOpReturn(tx, ctx);
    expect(result.detected).toBe(true);
    if (result.detected) {
      expect(result.op_return_count).toBe(2);
      expect(result.protocol).toBe("omni");
    }
  });
});
