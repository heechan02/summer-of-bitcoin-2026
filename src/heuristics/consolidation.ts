/**
 * Consolidation Heuristic.
 *
 * Detects transactions that consolidate many UTXOs into fewer outputs,
 * a common wallet maintenance pattern (e.g. merging dust before fees rise).
 *
 * @module heuristics/consolidation
 */

import type { AnalyzableTx, BlockContext, HeuristicResult } from "./types.js";

/** Minimum number of inputs required to fire consolidation detection. */
const MIN_INPUTS = 3;

/** Maximum number of outputs allowed for a consolidation transaction. */
const MAX_OUTPUTS = 2;

/** Input-to-output ratio threshold for "high" confidence. */
const HIGH_RATIO_THRESHOLD = 5;

const CONFIDENCE_HIGH = "high" as const;
const CONFIDENCE_MEDIUM = "medium" as const;

/** Result shape returned by detectConsolidation when detected. */
export interface ConsolidationResult extends HeuristicResult {
  detected: true;
  num_inputs: number;
  num_outputs: number;
  confidence: typeof CONFIDENCE_HIGH | typeof CONFIDENCE_MEDIUM;
}

/** Result shape returned by detectConsolidation when not detected. */
export interface ConsolidationResultNeg extends HeuristicResult {
  detected: false;
}

/**
 * Runs the Consolidation Heuristic on a single transaction.
 *
 * Fires when a transaction has ≥3 inputs and ≤2 outputs, indicating
 * UTXO consolidation. Confidence is elevated to "high" when the
 * input-to-output ratio is ≥5 and all inputs share the same script type.
 *
 * @param tx   - The transaction to analyse.
 * @param _ctx - Block-level context (unused by this heuristic).
 * @returns A HeuristicResult with `detected`, `num_inputs`, `num_outputs`, and `confidence`.
 */
export function detectConsolidation(
  tx: AnalyzableTx,
  _ctx: BlockContext,
): ConsolidationResult | ConsolidationResultNeg {
  if (tx.isCoinbase) {
    return { detected: false };
  }

  if (tx.inputs.length < MIN_INPUTS || tx.outputs.length > MAX_OUTPUTS) {
    return { detected: false };
  }

  const numInputs = tx.inputs.length;
  const numOutputs = tx.outputs.length;
  const ratio = numOutputs === 0 ? Infinity : numInputs / numOutputs;
  const allSameInputType = allInputsSameType(tx);

  const confidence =
    ratio >= HIGH_RATIO_THRESHOLD && allSameInputType
      ? CONFIDENCE_HIGH
      : CONFIDENCE_MEDIUM;

  return { detected: true, num_inputs: numInputs, num_outputs: numOutputs, confidence };
}

/**
 * Returns true if every input shares the same prevout script type.
 *
 * @param tx - The transaction to inspect.
 * @returns Whether all inputs have an identical prevout_script_type.
 */
function allInputsSameType(tx: AnalyzableTx): boolean {
  if (tx.inputs.length === 0) return true;
  const firstType = tx.inputs[0]!.prevout_script_type;
  return tx.inputs.every((inp) => inp.prevout_script_type === firstType);
}
