/**
 * Common Input Ownership Heuristic (CIOH).
 *
 * Detects transactions where multiple inputs are likely controlled by the same entity.
 * When a tx has ≥2 inputs, all inputs are assumed to be owned by the same wallet.
 *
 * @module heuristics/cioh
 */

import type { AnalyzableTx, BlockContext, HeuristicResult } from "./types.js";

/** Minimum number of inputs required to fire CIOH. */
const MIN_INPUTS_FOR_CIOH = 2;

/** Upper bound (inclusive) of input count eligible for "high" confidence. */
const HIGH_CONFIDENCE_MAX_INPUTS = 5;

const CONFIDENCE_HIGH = "high" as const;
const CONFIDENCE_MEDIUM = "medium" as const;

/** Result shape returned by detectCioh when detected. */
export interface CiohResult extends HeuristicResult {
  detected: true;
  num_inputs: number;
  confidence: typeof CONFIDENCE_HIGH | typeof CONFIDENCE_MEDIUM;
}

/** Result shape returned by detectCioh when not detected. */
export interface CiohResultNeg extends HeuristicResult {
  detected: false;
}

/**
 * Runs the Common Input Ownership Heuristic on a single transaction.
 *
 * @param tx  - The transaction to analyse.
 * @param _ctx - Block-level context (unused by this heuristic).
 * @returns A HeuristicResult with `detected`, `num_inputs`, and `confidence`.
 */
export function detectCioh(
  tx: AnalyzableTx,
  _ctx: BlockContext,
): CiohResult | CiohResultNeg {
  if (tx.isCoinbase) {
    return { detected: false };
  }

  if (tx.inputs.length < MIN_INPUTS_FOR_CIOH) {
    return { detected: false };
  }

  const numInputs = tx.inputs.length;
  const firstType = tx.inputs[0]?.prevout_script_type;
  const allSameType = tx.inputs.every(
    (inp) => inp.prevout_script_type === firstType,
  );

  const confidence =
    numInputs <= HIGH_CONFIDENCE_MAX_INPUTS && allSameType
      ? CONFIDENCE_HIGH
      : CONFIDENCE_MEDIUM;

  return { detected: true, num_inputs: numInputs, confidence };
}
