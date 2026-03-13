/**
 * CoinJoin Heuristic.
 *
 * Detects CoinJoin transactions by identifying groups of equal-value outputs,
 * which is the primary on-chain signature of a CoinJoin coordination protocol.
 *
 * @module heuristics/coinjoin
 */

import type { AnalyzableTx, BlockContext, HeuristicResult } from "./types.js";

/** Minimum number of inputs required to consider a CoinJoin. */
const MIN_INPUTS = 3;

/** Minimum number of equal-value outputs to flag as CoinJoin. */
const MIN_EQUAL_OUTPUTS = 3;

/** Threshold for equal outputs + inputs to qualify as high confidence. */
const HIGH_CONFIDENCE_THRESHOLD = 5;

/** Whirlpool CoinJoin: exactly this many inputs and outputs, all equal. */
const WHIRLPOOL_PARTICIPANT_COUNT = 5;

const CONFIDENCE_HIGH = "high" as const;
const CONFIDENCE_MEDIUM = "medium" as const;

/** Result shape returned by detectCoinJoin when detected. */
export interface CoinJoinResult extends HeuristicResult {
  detected: true;
  equal_output_count: number;
  denomination_sats: number;
  confidence: typeof CONFIDENCE_HIGH | typeof CONFIDENCE_MEDIUM;
}

/** Result shape returned by detectCoinJoin when not detected. */
export interface CoinJoinResultNeg extends HeuristicResult {
  detected: false;
}

/**
 * Runs the CoinJoin Heuristic on a single transaction.
 *
 * Groups non-OP_RETURN output values by exact amount and finds the largest
 * equal-value group. ≥3 equal outputs triggers detection. Confidence is
 * "high" if ≥5 equal outputs and ≥5 inputs, or if it matches the Whirlpool
 * signature (exactly 5-in / 5-out with all outputs equal).
 *
 * @param tx   - The transaction to analyse.
 * @param _ctx - Block-level context (unused by this heuristic).
 * @returns A HeuristicResult with `detected`, `equal_output_count`, `denomination_sats`, and `confidence`.
 */
export function detectCoinJoin(
  tx: AnalyzableTx,
  _ctx: BlockContext,
): CoinJoinResult | CoinJoinResultNeg {
  if (tx.isCoinbase) {
    return { detected: false };
  }

  if (tx.inputs.length < MIN_INPUTS) {
    return { detected: false };
  }

  const nonOpReturnValues = tx.outputs
    .filter((o) => o.script_type !== "op_return")
    .map((o) => o.value_sats);

  const { denomination, equalCount } = largestEqualGroup(nonOpReturnValues);

  if (equalCount < MIN_EQUAL_OUTPUTS) {
    return { detected: false };
  }

  const isWhirlpool =
    tx.inputs.length === WHIRLPOOL_PARTICIPANT_COUNT &&
    nonOpReturnValues.length === WHIRLPOOL_PARTICIPANT_COUNT &&
    equalCount === WHIRLPOOL_PARTICIPANT_COUNT;

  const confidence =
    isWhirlpool ||
    (equalCount >= HIGH_CONFIDENCE_THRESHOLD && tx.inputs.length >= HIGH_CONFIDENCE_THRESHOLD)
      ? CONFIDENCE_HIGH
      : CONFIDENCE_MEDIUM;

  return {
    detected: true,
    equal_output_count: equalCount,
    denomination_sats: denomination,
    confidence,
  };
}

/**
 * Finds the denomination and count of the largest group of equal values.
 *
 * @param values - Array of satoshi values to group.
 * @returns The denomination and count of the most common value.
 */
function largestEqualGroup(values: number[]): { denomination: number; equalCount: number } {
  if (values.length === 0) {
    return { denomination: 0, equalCount: 0 };
  }

  const freq = new Map<number, number>();
  for (const v of values) {
    freq.set(v, (freq.get(v) ?? 0) + 1);
  }

  let denomination = 0;
  let equalCount = 0;
  for (const [val, count] of freq) {
    if (count > equalCount) {
      equalCount = count;
      denomination = val;
    }
  }

  return { denomination, equalCount };
}
