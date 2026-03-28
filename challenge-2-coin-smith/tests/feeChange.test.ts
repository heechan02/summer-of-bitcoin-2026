/**
 * Unit tests for feeChange.ts
 *
 * Focus: Two-pass fee/change resolution with dust threshold boundary testing
 */

import { describe, it, expect } from "vitest";
import { resolveFeeAndChange } from "../src/feeChange.js";
import type { Utxo, Payment, ScriptType } from "../src/parser.js";

/**
 * Helper to create a mock UTXO
 */
function mockUtxo(valueSats: number, scriptType: ScriptType = "p2wpkh"): Utxo {
  return {
    txid: "a".repeat(64),
    vout: 0,
    value_sats: valueSats,
    script_pubkey_hex: "0014" + "b".repeat(40),
    script_type: scriptType,
    address: "bc1qtest",
  };
}

/**
 * Helper to create a mock payment
 */
function mockPayment(
  valueSats: number,
  scriptType: ScriptType = "p2wpkh",
): Payment {
  return {
    address: "bc1qrecipient",
    script_pubkey_hex: "0014" + "c".repeat(40),
    script_type: scriptType,
    value_sats: valueSats,
  };
}

describe("feeChange — two-pass fee/change resolution", () => {
  /**
   * Test 1: Change above dust threshold (≥ 546 sats)
   * Expected: Change output included, fee minimized to exact required amount
   */
  it("Change above dust → included, fee minimised", () => {
    // Setup: Create scenario where change will be well above dust threshold
    // 1 p2wpkh input, 1 p2wpkh payment, 1 p2wpkh change
    // Estimated vbytes with change: ~141 vbytes
    // Fee at 5 sat/vb: ~705 sats
    // Let's use: 100,000 input - 98,000 payment = 2,000 leftover
    // After fee (~705): change ~1,295 sats (well above 546)

    const selectedInputs = [mockUtxo(100_000, "p2wpkh")];
    const payments = [mockPayment(98_000, "p2wpkh")];
    const changeType: ScriptType = "p2wpkh";
    const feeRateSatVb = 5.0;

    const result = resolveFeeAndChange(
      selectedInputs,
      payments,
      changeType,
      feeRateSatVb,
    );

    // Assertions
    expect(result.isSendAll).toBe(false);
    expect(result.changeAmount).not.toBeNull();
    expect(result.changeAmount).toBeGreaterThanOrEqual(546);

    // Verify balance equation: sum(inputs) = sum(payments) + change + fee
    const totalInput = 100_000;
    const totalPayment = 98_000;
    const balanceCheck =
      totalInput - totalPayment - result.changeAmount! - result.feeSats;
    expect(balanceCheck).toBe(0);

    // Verify fee is minimized (should equal ceil(vbytes * rate))
    const expectedMinFee = Math.ceil(result.vbytes * feeRateSatVb);
    expect(result.feeSats).toBe(expectedMinFee);
  });

  /**
   * Test 2: Change exactly 545 sats (just below dust threshold)
   * Expected: Change dropped, send-all mode, leftover becomes part of fee
   */
  it("Change exactly 545 sats → dropped, SEND_ALL path", () => {
    // Setup: Craft inputs so that Pass 1 yields exactly 545 sats change
    // 1 p2wpkh input, 1 p2wpkh payment, change would be p2wpkh
    // Vbytes with change: ~141
    // Fee with change at 5 sat/vb: ceil(141 * 5) = 705 sats
    // To get exactly 545 change: input - payment - 705 = 545
    // Therefore: input - payment = 1250
    // Let's use: 100,000 input - 98,750 payment = 1,250
    // Change = 1,250 - 705 = 545 sats ✓

    const selectedInputs = [mockUtxo(100_000, "p2wpkh")];
    const payments = [mockPayment(98_750, "p2wpkh")];
    const changeType: ScriptType = "p2wpkh";
    const feeRateSatVb = 5.0;

    const result = resolveFeeAndChange(
      selectedInputs,
      payments,
      changeType,
      feeRateSatVb,
    );

    // Assertions
    expect(result.isSendAll).toBe(true);
    expect(result.changeAmount).toBeNull();

    // Verify balance equation: sum(inputs) = sum(payments) + fee (no change)
    const totalInput = 100_000;
    const totalPayment = 98_750;
    const balanceCheck = totalInput - totalPayment - result.feeSats;
    expect(balanceCheck).toBe(0);

    // Verify actual fee equals inputs - payments (leftover burned)
    expect(result.feeSats).toBe(totalInput - totalPayment);
    expect(result.feeSats).toBe(1_250); // All leftover becomes fee

    // Verify fee is greater than minimum required (includes the 545 dust)
    const expectedMinFee = Math.ceil(result.vbytes * feeRateSatVb);
    expect(result.feeSats).toBeGreaterThanOrEqual(expectedMinFee);
  });

  /**
   * Test 3: Change exactly 546 sats (exactly at dust threshold)
   * Expected: Change output included (boundary case)
   */
  it("Change exactly 546 sats → included", () => {
    // Setup: Craft inputs so that Pass 1 yields exactly 546 sats change
    // 1 p2wpkh input, 1 p2wpkh payment, change p2wpkh
    // Vbytes with change: ~141
    // Fee with change at 5 sat/vb: ceil(141 * 5) = 705 sats
    // To get exactly 546 change: input - payment - 705 = 546
    // Therefore: input - payment = 1251
    // Let's use: 100,000 input - 98,749 payment = 1,251
    // Change = 1,251 - 705 = 546 sats ✓

    const selectedInputs = [mockUtxo(100_000, "p2wpkh")];
    const payments = [mockPayment(98_749, "p2wpkh")];
    const changeType: ScriptType = "p2wpkh";
    const feeRateSatVb = 5.0;

    const result = resolveFeeAndChange(
      selectedInputs,
      payments,
      changeType,
      feeRateSatVb,
    );

    // Assertions
    expect(result.isSendAll).toBe(false);
    expect(result.changeAmount).toBe(546); // Exactly at boundary
    expect(result.changeAmount).not.toBeNull();

    // Verify balance equation: sum(inputs) = sum(payments) + change + fee
    const totalInput = 100_000;
    const totalPayment = 98_749;
    const balanceCheck =
      totalInput - totalPayment - result.changeAmount! - result.feeSats;
    expect(balanceCheck).toBe(0);

    // Verify fee is minimized (should equal ceil(vbytes * rate))
    const expectedMinFee = Math.ceil(result.vbytes * feeRateSatVb);
    expect(result.feeSats).toBe(expectedMinFee);
  });
});
