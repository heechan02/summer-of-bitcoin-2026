/**
 * Unit tests for estimator.ts
 */

import { describe, it, expect } from "vitest";
import { estimateVbytes } from "../src/estimator.js";
import type { ScriptType } from "../src/parser.js";

describe("estimator — vbytes calculation", () => {
  it("P2WPKH 1-in 2-out vbytes = 141", () => {
    const inputs: ScriptType[] = ["p2wpkh"];
    const outputs: ScriptType[] = ["p2wpkh", "p2wpkh"];

    const vbytes = estimateVbytes(inputs, outputs);
    expect(vbytes).toBe(141);
  });

  it("P2PKH 1-in 1-out vbytes correct (no segwit flag)", () => {
    const inputs: ScriptType[] = ["p2pkh"];
    const outputs: ScriptType[] = ["p2pkh"];

    // Base: 10 (overhead) + 0 (no segwit flag) + 148 (input) + 34 (output) = 192
    // Witness: 0
    // Weight: (192 * 4) + 0 = 768
    // Vbytes: ceil(768 / 4) = 192
    const vbytes = estimateVbytes(inputs, outputs);
    expect(vbytes).toBe(192);
  });

  it("Mixed P2WPKH + P2PKH adds segwit flag once", () => {
    const inputs: ScriptType[] = ["p2wpkh", "p2pkh"];
    const outputs: ScriptType[] = ["p2wpkh"];

    // Base: 10 + 41 (p2wpkh) + 148 (p2pkh) + 31 (output) = 230 bytes
    // Base weight: 230 * 4 = 920
    // Witness weight: 2 (segwit flag added ONCE) + 108 (p2wpkh) + 0 (p2pkh) = 110
    // Total weight: 920 + 110 = 1030
    // Vbytes: ceil(1030 / 4) = 258
    const vbytes = estimateVbytes(inputs, outputs);
    expect(vbytes).toBe(258);
  });
});
