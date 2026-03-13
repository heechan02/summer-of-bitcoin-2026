/**
 * Unit tests for src/heuristics/address-reuse.ts
 */

import { describe, it, expect } from "vitest";
import { detectAddressReuse } from "../../src/heuristics/address-reuse.js";
import {
  mockCoinbaseTx,
  mockSimpleTx,
  mockBlockContext,
} from "../helpers/mock-tx.js";

describe("detectAddressReuse", () => {
  it("returns detected:false for coinbase tx", () => {
    const tx = mockCoinbaseTx();
    const ctx = mockBlockContext();
    const result = detectAddressReuse(tx, ctx);
    expect(result.detected).toBe(false);
  });

  it("returns detected:false when all addresses are unique", () => {
    const tx = mockSimpleTx(1, 2, {
      inputAddresses: ["bc1q_input_0"],
      outputAddresses: ["bc1q_output_0", "bc1q_output_1"],
    });
    const ctx = mockBlockContext();
    const result = detectAddressReuse(tx, ctx);
    expect(result.detected).toBe(false);
  });

  it("detects within_tx when output address matches an input address", () => {
    const reusedAddr = "bc1q_reused";
    const tx = mockSimpleTx(1, 2, {
      inputAddresses: [reusedAddr],
      outputAddresses: [reusedAddr, "bc1q_other"],
    });
    const ctx = mockBlockContext();
    const result = detectAddressReuse(tx, ctx);
    expect(result.detected).toBe(true);
    if (result.detected) {
      expect(result.method).toBe("within_tx");
      expect(result.reused_addresses).toContain(reusedAddr);
    }
  });

  it("detects within_block when output address was seen in a prior tx", () => {
    const priorAddr = "bc1q_prior";
    const priorTx = mockSimpleTx(1, 1, {
      outputAddresses: [priorAddr],
      txid: "aabbcc" + "00".repeat(29),
    });
    const ctx = mockBlockContext([priorTx]);

    const tx = mockSimpleTx(1, 1, {
      inputAddresses: ["bc1q_unique_input"],
      outputAddresses: [priorAddr],
      txid: "ddeeff" + "00".repeat(29),
    });
    const result = detectAddressReuse(tx, ctx);
    expect(result.detected).toBe(true);
    if (result.detected) {
      expect(result.method).toBe("within_block");
      expect(result.reused_addresses).toContain(priorAddr);
    }
  });

  it("within_tx takes precedence over within_block", () => {
    const reusedAddr = "bc1q_both";
    const priorTx = mockSimpleTx(1, 1, {
      outputAddresses: [reusedAddr],
      txid: "aabbcc" + "00".repeat(29),
    });
    const ctx = mockBlockContext([priorTx]);

    // reusedAddr appears in both input and output → within_tx
    const tx = mockSimpleTx(1, 2, {
      inputAddresses: [reusedAddr],
      outputAddresses: [reusedAddr, "bc1q_other"],
      txid: "ddeeff" + "00".repeat(29),
    });
    const result = detectAddressReuse(tx, ctx);
    expect(result.detected).toBe(true);
    if (result.detected) {
      expect(result.method).toBe("within_tx");
    }
  });

  it("ignores op_return outputs when checking addresses", () => {
    const opReturnAddr = null;
    const tx = mockSimpleTx(1, 2, {
      inputAddresses: ["bc1q_input_0"],
      outputAddresses: ["bc1q_output_0", opReturnAddr],
      outputTypes: ["p2wpkh", "op_return"],
    });
    const ctx = mockBlockContext();
    const result = detectAddressReuse(tx, ctx);
    expect(result.detected).toBe(false);
  });

  it("ignores null addresses in inputs and outputs", () => {
    const tx = mockSimpleTx(2, 2, {
      inputAddresses: [null, null],
      outputAddresses: [null, null],
    });
    const ctx = mockBlockContext();
    const result = detectAddressReuse(tx, ctx);
    expect(result.detected).toBe(false);
  });
});
