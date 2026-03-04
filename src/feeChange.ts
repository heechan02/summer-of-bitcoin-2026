/**
 * Module 4 — feeChange.ts
 *
 * Purpose: Two-pass fee/change resolution. This is the trickiest module.
 *
 * The core challenge: adding/removing a change output affects transaction size,
 * which affects required fee, which affects change amount (circular dependency).
 * Solution: Two-pass algorithm with dust threshold check.
 */

import type { Utxo, Payment, ScriptType } from "./parser.js";
import { estimateVbytes } from "./estimator.js";

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Dust threshold: Outputs below this value are uneconomical to spend
 * and should not be created (Bitcoin Core policy)
 */
const DUST_THRESHOLD_SATS = 546;

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Result of fee and change resolution
 */
export interface FeeChangeResult {
  /** Change output amount in sats, or null if no change (send-all) */
  changeAmount: number | null;
  /** Actual fee paid in sats */
  feeSats: number;
  /** Transaction size in virtual bytes */
  vbytes: number;
  /** True if no change output created (all leftover becomes fee) */
  isSendAll: boolean;
}

// ============================================================================
// MAIN FUNCTION
// ============================================================================

/**
 * Resolves fee and change amount using two-pass algorithm.
 *
 * Pass 1: Assume change output exists
 * - Calculate vbytes with change output included
 * - Calculate required fee: ceil(vbytes * fee_rate)
 * - Calculate change amount: sum(inputs) - sum(payments) - fee
 * - If change >= 546 sats → DONE (include change)
 * - If change < 0 → INSUFFICIENT_FUNDS (should not happen if selector worked)
 * - If 0 <= change < 546 → Go to Pass 2 (dust territory)
 *
 * Pass 2: Drop change output (send-all scenario)
 * - Calculate vbytes WITHOUT change output
 * - Calculate minimum required fee: ceil(vbytes * fee_rate)
 * - Calculate leftover: sum(inputs) - sum(payments) - min_fee
 * - If leftover < 0 → INSUFFICIENT_FUNDS
 * - Actual fee = sum(inputs) - sum(payments) (leftover becomes extra fee)
 * - Return with changeAmount = null, isSendAll = true
 *
 * CRITICAL: The boundary case where change is 0-545 sats must go to Pass 2.
 * Never create a change output below the dust threshold.
 *
 * @param selectedInputs - UTXOs selected by coin selector
 * @param payments - Payment outputs from fixture
 * @param changeType - Script type for change output
 * @param feeRateSatVb - Target fee rate in sats/vbyte
 * @returns Fee and change resolution result
 * @throws Error with code INSUFFICIENT_FUNDS if balance equation fails
 */
export function resolveFeeAndChange(
  selectedInputs: Utxo[],
  payments: Payment[],
  changeType: ScriptType,
  feeRateSatVb: number,
): FeeChangeResult {
  // -------------------------------------------------------------------------
  // STEP 1: Calculate totals
  // -------------------------------------------------------------------------

  // Sum all selected input values
  const totalInputSats = selectedInputs.reduce(
    (sum, utxo) => sum + utxo.value_sats,
    0,
  );

  // Sum all payment output values
  const totalPaymentSats = payments.reduce(
    (sum, payment) => sum + payment.value_sats,
    0,
  );

  // -------------------------------------------------------------------------
  // STEP 2: Pass 1 — Try with change output
  // -------------------------------------------------------------------------

  // Build array of input script types from selectedInputs
  const inputTypes: ScriptType[] = selectedInputs.map(
    (utxo) => utxo.script_type,
  );

  // Build array of output script types (all payments + change)
  const outputTypesWithChange: ScriptType[] = [
    ...payments.map((p) => p.script_type),
    changeType,
  ];

  // Estimate vbytes WITH change output
  const vbytesWithChange = estimateVbytes(inputTypes, outputTypesWithChange);

  // Calculate required fee (MUST use Math.ceil)
  const feeWithChange = Math.ceil(vbytesWithChange * feeRateSatVb);

  // Calculate change amount
  const changeAmount = totalInputSats - totalPaymentSats - feeWithChange;

  // Check if change amount is viable (>= 546 sats)
  if (changeAmount >= DUST_THRESHOLD_SATS) {
    // SUCCESS: Change output is economical, include it
    return {
      changeAmount,
      feeSats: feeWithChange,
      vbytes: vbytesWithChange,
      isSendAll: false,
    };
  }

  // If we reach here: changeAmount < 546 (dust or negative)
  // This includes both:
  // - Dust case: 0 <= changeAmount < 546
  // - Negative case: changeAmount < 0 (can't afford fee WITH change)
  // In both cases, we must try Pass 2 (send-all) because removing the
  // change output makes the transaction smaller (cheaper fee)

  // -------------------------------------------------------------------------
  // STEP 3: Pass 2 — Drop change output (send-all)
  // -------------------------------------------------------------------------

  // Build output types WITHOUT change (only payments)
  const outputTypesNoChange: ScriptType[] = payments.map((p) => p.script_type);

  // Estimate vbytes WITHOUT change output
  const vbytesNoChange = estimateVbytes(inputTypes, outputTypesNoChange);

  // Calculate minimum required fee
  const minFeeNoChange = Math.ceil(vbytesNoChange * feeRateSatVb);

  // Calculate leftover after paying minimum fee
  const leftover = totalInputSats - totalPaymentSats - minFeeNoChange;

  // Verify we can still cover minimum fee
  if (leftover < 0) {
    const error = new Error(
      `Insufficient funds for send-all: inputs (${totalInputSats}) - payments (${totalPaymentSats}) - min_fee (${minFeeNoChange}) = ${leftover}`,
    ) as Error & { code: string };
    error.code = "INSUFFICIENT_FUNDS";
    throw error;
  }

  // Calculate actual fee (leftover becomes extra fee, burned)
  const actualFee = totalInputSats - totalPaymentSats;

  // Return send-all result
  return {
    changeAmount: null,
    feeSats: actualFee,
    vbytes: vbytesNoChange,
    isSendAll: true,
  };
}

// ============================================================================
// IMPLEMENTATION NOTES
// ============================================================================

/*
 * Balance Equation (MUST always hold):
 *   sum(inputs) = sum(payments) + change_or_0 + fee
 *
 * Fee Minimization:
 *   When change exists, fee = ceil(vbytes * rate) (minimum required)
 *   When change is dust, fee = sum(inputs) - sum(payments) (includes leftover)
 *
 * Edge Cases:
 *   1. Change exactly 545 sats → Drop it (Pass 2)
 *   2. Change exactly 546 sats → Keep it (Pass 1)
 *   3. Large leftover (e.g., 1000 sats dust) → All becomes fee (expected)
 *   4. Negative change in Pass 1 → Bug in selector (should not happen)
 *   5. Negative leftover in Pass 2 → INSUFFICIENT_FUNDS (rare edge case)
 *
 * Warning Emission (NOT handled here, but relevant):
 *   DUST_CHANGE: Only if a change output is somehow created < 546 (should never fire)
 *   SEND_ALL: Emitted by warnings.ts when changeAmount === null
 *
 * Testing Strategy:
 *   - Test change at exactly 545, 546, 547 sats (boundary)
 *   - Test large leftover becoming fee (e.g., 1000 sats dust)
 *   - Test balance equation holds in both passes
 *   - Mock estimateVbytes to control sizes precisely
 */
