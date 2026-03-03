/**
 * Module 7 — warnings.ts
 *
 * Purpose: Compute warning codes from final transaction parameters
 *
 * Warning conditions to check:
 * - HIGH_FEE: feeSats > 1,000,000 OR feeRateSatVb > 200
 * - DUST_CHANGE: a change output exists with value_sats < 546
 * - SEND_ALL: no change output was created (changeAmount is null)
 * - RBF_SIGNALING: rbfSignaling is true (nSequence <= 0xFFFFFFFD)
 */

/**
 * Warning object with a code string
 */
export interface Warning {
  code: string;
}

/**
 * Parameters for computing warnings
 */
export interface ComputeWarningsParams {
  feeSats: number;
  feeRateSatVb: number;
  changeAmount: number | null;
  rbfSignaling: boolean;
}

/**
 * Compute all applicable warnings for a transaction
 *
 * Algorithm:
 * 1. Initialize empty warnings array
 *
 * 2. Check HIGH_FEE condition:
 *    - If feeSats > 1_000_000 OR feeRateSatVb > 200
 *      → Add { code: "HIGH_FEE" }
 *
 * 3. Check DUST_CHANGE condition:
 *    - If changeAmount is not null AND changeAmount < 546
 *      → Add { code: "DUST_CHANGE" }
 *    Note: This should never happen in normal flow (feeChange.ts drops dust)
 *          but serves as a safety net
 *
 * 4. Check SEND_ALL condition:
 *    - If changeAmount is null (no change output)
 *      → Add { code: "SEND_ALL" }
 *
 * 5. Check RBF_SIGNALING condition:
 *    - If rbfSignaling is true
 *      → Add { code: "RBF_SIGNALING" }
 *
 * 6. Return the warnings array
 *
 * @param params - Transaction parameters
 * @returns Array of warning objects (may be empty)
 */
export function computeWarnings(params: ComputeWarningsParams): Warning[] {
  const warnings: Warning[] = [];

  // Check HIGH_FEE condition
  if (params.feeSats > 1_000_000 || params.feeRateSatVb > 200) {
    warnings.push({ code: "HIGH_FEE" });
  }

  // Check DUST_CHANGE condition
  if (params.changeAmount !== null && params.changeAmount < 546) {
    warnings.push({ code: "DUST_CHANGE" });
  }

  // Check SEND_ALL condition
  if (params.changeAmount === null) {
    warnings.push({ code: "SEND_ALL" });
  }

  // Check RBF_SIGNALING condition
  if (params.rbfSignaling) {
    warnings.push({ code: "RBF_SIGNALING" });
  }

  return warnings;
}
