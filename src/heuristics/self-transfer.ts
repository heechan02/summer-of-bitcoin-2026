/**
 * Self-Transfer Heuristic.
 *
 * Detects transactions where all outputs appear to go back to the same wallet —
 * indicated by every non-OP_RETURN output sharing the dominant input script type.
 * Common patterns: wallet sweeps, address consolidation within a single wallet.
 *
 * @module heuristics/self-transfer
 */

import type { AnalyzableTx, BlockContext, HeuristicResult } from "./types.js";

/** Threshold for "round" outputs: multiples of 0.001 BTC (100_000 sats). */
const ROUND_THRESHOLD_SATS = 100_000;

const CONFIDENCE_HIGH = "high" as const;
const CONFIDENCE_MEDIUM = "medium" as const;

/** Result shape when self-transfer is detected. */
export interface SelfTransferResult extends HeuristicResult {
  detected: true;
  confidence: typeof CONFIDENCE_HIGH | typeof CONFIDENCE_MEDIUM;
}

/** Result shape when self-transfer is not detected. */
export interface SelfTransferResultNeg extends HeuristicResult {
  detected: false;
}

/**
 * Runs the Self-Transfer Heuristic on a single transaction.
 *
 * Fires when all non-OP_RETURN outputs share the dominant input script type,
 * suggesting the sender is sending funds entirely back to themselves.
 * Confidence is "high" when no round-number outputs are present, "medium" if any are.
 *
 * @param tx   - The transaction to analyse.
 * @param _ctx - Block-level context (unused by this heuristic).
 * @returns A HeuristicResult with `detected` and optional `confidence`.
 */
export function detectSelfTransfer(
  tx: AnalyzableTx,
  _ctx: BlockContext,
): SelfTransferResult | SelfTransferResultNeg {
  if (tx.isCoinbase) {
    return { detected: false };
  }

  // Filter out OP_RETURN outputs
  const spendableOutputs = tx.outputs.filter((o) => o.script_type !== "op_return");

  if (spendableOutputs.length === 0) {
    return { detected: false };
  }

  const dominantInputType = getDominantInputType(tx);
  if (dominantInputType === null) {
    return { detected: false };
  }

  // All spendable outputs must match the dominant input type
  const allMatch = spendableOutputs.every((o) => o.script_type === dominantInputType);
  if (!allMatch) {
    return { detected: false };
  }

  // Check for round-number outputs (multiples of ROUND_THRESHOLD_SATS)
  const hasRound = spendableOutputs.some((o) => o.value_sats % ROUND_THRESHOLD_SATS === 0);

  const confidence = hasRound ? CONFIDENCE_MEDIUM : CONFIDENCE_HIGH;
  return { detected: true, confidence };
}

/**
 * Returns the most common prevout script type among inputs.
 * Returns null if there are no inputs.
 *
 * @param tx - The transaction to inspect.
 * @returns The dominant input prevout_script_type, or null if inputs are empty.
 */
function getDominantInputType(tx: AnalyzableTx): string | null {
  if (tx.inputs.length === 0) return null;

  const counts = new Map<string, number>();
  for (const inp of tx.inputs) {
    counts.set(inp.prevout_script_type, (counts.get(inp.prevout_script_type) ?? 0) + 1);
  }

  let dominant = "";
  let max = 0;
  for (const [type, count] of counts) {
    if (count > max) {
      max = count;
      dominant = type;
    }
  }

  return dominant === "" ? null : dominant;
}
