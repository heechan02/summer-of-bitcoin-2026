/**
 * Module 5 — sequences.ts
 *
 * Purpose: Compute nSequence per input and nLockTime for the transaction.
 *
 * This module handles the complex interaction between RBF signaling and locktime semantics.
 */

/**
 * Computes the transaction nLockTime value.
 *
 * Rules:
 * 1. If locktime is explicitly provided in fixture → use that value
 * 2. Else if RBF is enabled AND current_height is provided → use current_height (anti-fee-sniping)
 * 3. Otherwise → use 0 (no locktime)
 *
 * @param rbf - Whether RBF is enabled
 * @param explicitLocktime - Locktime value from fixture (if provided)
 * @param currentHeight - Current block height (if provided)
 * @returns nLockTime value (uint32)
 */
export function computeLocktime(
  rbf: boolean,
  explicitLocktime: number | undefined,
  currentHeight: number | undefined,
): number {
  // Step 1: Check if explicitLocktime is provided (not undefined)
  if (explicitLocktime !== undefined) {
    return explicitLocktime;
  }

  // Step 2: Check if rbf is true AND currentHeight is provided (anti-fee-sniping protection)
  if (rbf && currentHeight !== undefined) {
    return currentHeight;
  }

  // Step 3: Otherwise → return 0 (no locktime)
  return 0;
}

/**
 * Computes the nSequence value for transaction inputs.
 *
 * Rules (applied to ALL inputs):
 * 1. If rbf is true → 0xFFFFFFFD (signals BIP-125 RBF)
 * 2. Else if nLockTime is non-zero → 0xFFFFFFFE (enables locktime without RBF)
 * 3. Otherwise → 0xFFFFFFFF (final, no RBF, no locktime)
 *
 * Critical: Only nSequence <= 0xFFFFFFFD signals RBF.
 * nSequence = 0xFFFFFFFE does NOT signal RBF (locktime-only).
 *
 * @param rbf - Whether RBF is enabled
 * @param nLockTime - The transaction nLockTime value
 * @returns nSequence value (0xFFFFFFFD | 0xFFFFFFFE | 0xFFFFFFFF)
 */
export function computeSequence(rbf: boolean, nLockTime: number): number {
  // Step 1: Check if rbf is true → RBF signaling
  if (rbf) {
    return 0xfffffffd;
  }

  // Step 2: Check if nLockTime is non-zero → locktime enabled, no RBF
  if (nLockTime !== 0) {
    return 0xfffffffe;
  }

  // Step 3: Otherwise → final/disabled
  return 0xffffffff;
}

/**
 * Classifies the locktime value into its semantic type.
 *
 * Rules:
 * - nLockTime == 0 → "none" (no locktime constraint)
 * - 0 < nLockTime < 500_000_000 → "block_height" (interpreted as block height)
 * - nLockTime >= 500_000_000 → "unix_timestamp" (interpreted as Unix timestamp)
 *
 * Critical boundary: 499_999_999 is "block_height", 500_000_000 is "unix_timestamp"
 *
 * @param nLockTime - The transaction nLockTime value
 * @returns Locktime type classification
 */
export function classifyLocktime(
  nLockTime: number,
): "none" | "block_height" | "unix_timestamp" {
  // Step 1: Check if nLockTime == 0
  if (nLockTime === 0) {
    return "none";
  }

  // Step 2: Check if nLockTime < 500_000_000
  if (nLockTime < 500_000_000) {
    return "block_height";
  }

  // Step 3: Otherwise (nLockTime >= 500_000_000)
  return "unix_timestamp";
}

/**
 * Helper to determine if RBF is being signaled.
 *
 * RBF is signaled when nSequence <= 0xFFFFFFFD (per BIP-125).
 * This is true only when rbf is explicitly true.
 *
 * Note: This is a derived value for the report, not a separate computation.
 *
 * @param nSequence - The computed nSequence value
 * @returns true if RBF is signaled, false otherwise
 */
export function isRbfSignaling(nSequence: number): boolean {
  // RBF is signaled when nSequence <= 0xFFFFFFFD (per BIP-125)
  return nSequence <= 0xfffffffd;
}
