/**
 * Module 3 — selector.ts
 *
 * Purpose: Choose a subset of UTXOs to fund payments + estimated fee
 *
 * Strategy:
 * 1. Try Branch-and-Bound first (seeks exact match with no change)
 * 2. Fallback to Greedy (largest-first) if BnB fails
 * 3. Respect policy.max_inputs hard limit
 * 4. Throw INSUFFICIENT_FUNDS if target cannot be met
 */

import type { Utxo, ScriptType, Policy, Payment } from "./parser.js";
import {
  estimateVbytes,
  inputBaseBytes,
  inputWitnessBytes,
} from "./estimator.js";

/**
 * Result of coin selection algorithm
 */
export interface SelectionResult {
  selected: Utxo[];
  strategy: "branch-and-bound" | "greedy";
  hasExactMatch: boolean; // true = BnB found no-change solution
}

/**
 * Select UTXOs to fund payments + estimated fee
 *
 * @param utxos - Available coins to select from
 * @param payments - Payment outputs (we extract types for fee estimation)
 * @param feeRateSatVb - Target fee rate in sats/vbyte
 * @param changeType - Script type for change output (affects fee estimation)
 * @param policy - Optional constraints (e.g., max_inputs)
 * @returns SelectionResult with selected coins and metadata
 * @throws Error with code INSUFFICIENT_FUNDS if target cannot be met
 */
export function selectCoins(
  utxos: Utxo[],
  payments: Payment[],
  feeRateSatVb: number,
  changeType: ScriptType,
  policy?: Policy,
): SelectionResult {
  // STEP 1: Compute target from payments and extract max_inputs limit
  const targetSats = payments.reduce((sum, p) => sum + p.value_sats, 0);
  const maxInputs = policy?.max_inputs;
  const paymentTypes = payments.map((p) => p.script_type);

  // STEP 2: Try Branch-and-Bound first
  const bnbResult = tryBranchAndBound(
    utxos,
    targetSats,
    feeRateSatVb,
    paymentTypes,
    maxInputs,
  );
  if (bnbResult !== null) {
    return {
      selected: bnbResult,
      strategy: "branch-and-bound",
      hasExactMatch: true,
    };
  }

  // STEP 3: BnB failed, fallback to Greedy (largest-first)
  const greedyResult = tryGreedy(
    utxos,
    targetSats,
    feeRateSatVb,
    paymentTypes,
    changeType,
    maxInputs,
  );
  if (greedyResult !== null) {
    return {
      selected: greedyResult,
      strategy: "greedy",
      hasExactMatch: false,
    };
  }

  // STEP 4: Both strategies failed → insufficient funds
  throw new Error(
    JSON.stringify({
      code: "INSUFFICIENT_FUNDS",
      message: "Available UTXOs cannot cover payments + fees",
    }),
  );
}

/**
 * Branch-and-Bound algorithm for exact-match coin selection
 *
 * Searches for a combination where: sum(inputs) === targetSats + fee_no_change
 * This avoids creating a change output (better privacy, lower fee)
 *
 * @param utxos - Available coins
 * @param targetSats - Payment total (not including fee)
 * @param feeRateSatVb - Fee rate
 * @param paymentTypes - Payment output script types (for fee estimation)
 * @param maxInputs - Maximum allowed inputs (undefined = no limit)
 * @returns Selected UTXOs on exact match, null if no match found
 */
function tryBranchAndBound(
  utxos: Utxo[],
  targetSats: number,
  feeRateSatVb: number,
  paymentTypes: ScriptType[],
  maxInputs: number | undefined,
): Utxo[] | null {
  // STEP 1: Sort UTXOs by value descending (helps with pruning)
  const sorted = [...utxos].sort((a, b) => b.value_sats - a.value_sats);

  // STEP 2: Apply max_inputs filter if set
  const candidates = maxInputs !== undefined ? sorted.slice(0, maxInputs) : sorted;

  // STEP 3: Compute effective values (value - cost to spend)
  const effectiveUtxos = candidates
    .map((utxo) => ({
      utxo,
      effectiveValue: computeEffectiveValue(utxo, feeRateSatVb),
    }))
    .filter((item) => item.effectiveValue > 0); // Skip UTXOs that cost more than they're worth

  // STEP 4: Setup for recursive search
  let bestMatch: Utxo[] | null = null;
  const MAX_ITERATIONS = 1000;
  let iterationCount = 0;

  // STEP 5: Recursive depth-first search
  function search(
    index: number,
    selected: Utxo[],
    currentSum: number,
  ): boolean {
    iterationCount++;
    if (iterationCount > MAX_ITERATIONS) {
      return false; // Give up, too many iterations
    }

    // Calculate fee for current selection (no change)
    const inputTypes = selected.map((u) => u.script_type);
    const vbytes = estimateVbytes(inputTypes, paymentTypes);
    const fee = Math.ceil(vbytes * feeRateSatVb);
    const needed = targetSats + fee;

    // Exact match found!
    if (currentSum === needed) {
      bestMatch = [...selected];
      return true;
    }

    // Over target → prune this branch
    if (currentSum > needed) {
      return false;
    }

    // No more UTXOs to try
    if (index >= effectiveUtxos.length) {
      return false;
    }

    // Try including current UTXO
    const { utxo } = effectiveUtxos[index];
    if (
      search(index + 1, [...selected, utxo], currentSum + utxo.value_sats)
    ) {
      return true;
    }

    // Try excluding current UTXO
    return search(index + 1, selected, currentSum);
  }

  search(0, [], 0);
  return bestMatch;
}

/**
 * Compute effective value of a UTXO (value minus cost to spend it)
 *
 * @param utxo - UTXO to evaluate
 * @param feeRateSatVb - Fee rate
 * @returns Effective value in sats (can be negative for dust)
 */
function computeEffectiveValue(utxo: Utxo, feeRateSatVb: number): number {
  const baseBytes = inputBaseBytes(utxo.script_type);
  const witnessBytes = inputWitnessBytes(utxo.script_type);

  // Witness bytes are discounted by 4x in weight calculation
  // weight = base_bytes * 4 + witness_bytes * 1
  // vbytes = ceil(weight / 4)
  const weight = baseBytes * 4 + witnessBytes;
  const vbytes = Math.ceil(weight / 4);

  const costToSpend = Math.ceil(vbytes * feeRateSatVb);
  return utxo.value_sats - costToSpend;
}

/**
 * Greedy coin selection (largest-first)
 *
 * Selects UTXOs in descending value order until target + fee (WITH change) is met
 *
 * @param utxos - Available coins
 * @param targetSats - Payment total (not including fee)
 * @param feeRateSatVb - Fee rate
 * @param paymentTypes - Payment output script types (for fee estimation)
 * @param changeType - Change script type (affects fee estimation)
 * @param maxInputs - Maximum allowed inputs (undefined = no limit)
 * @returns Selected UTXOs on success, null if insufficient
 */
function tryGreedy(
  utxos: Utxo[],
  targetSats: number,
  feeRateSatVb: number,
  paymentTypes: ScriptType[],
  changeType: ScriptType,
  maxInputs: number | undefined,
): Utxo[] | null {
  // STEP 1: Sort UTXOs by value descending (prefer larger coins → fewer inputs)
  const sorted = [...utxos].sort((a, b) => b.value_sats - a.value_sats);

  // STEP 2: Greedy selection loop
  const selected: Utxo[] = [];
  let currentSum = 0;

  for (const utxo of sorted) {
    // Check max_inputs constraint
    if (maxInputs !== undefined && selected.length >= maxInputs) {
      break; // Can't add more inputs
    }

    // Add this UTXO
    selected.push(utxo);
    currentSum += utxo.value_sats;

    // Estimate fee WITH change output
    const inputTypes = selected.map((u) => u.script_type);
    const outputTypes = [...paymentTypes, changeType]; // payments + change
    const vbytes = estimateVbytes(inputTypes, outputTypes);
    const estimatedFee = Math.ceil(vbytes * feeRateSatVb);
    const needed = targetSats + estimatedFee;

    // Check if we have enough
    if (currentSum >= needed) {
      return selected; // Success!
    }
  }

  // Exhausted all UTXOs, still not enough
  return null;
}

