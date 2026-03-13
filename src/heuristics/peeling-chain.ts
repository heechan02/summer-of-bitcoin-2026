/**
 * Peeling Chain Heuristic.
 *
 * Detects transactions that are part of a "peeling chain" — a sequence of
 * transactions where one output is a small payment and the other is a large
 * change output that is immediately spent in the next transaction with the
 * same pattern.
 *
 * Reference: Kappos et al., "How to Peel a Million" (USENIX Security 2022).
 *
 * @module heuristics/peeling-chain
 */

import type { AnalyzableTx, BlockContext, HeuristicResult } from "./types.js";

/** Ratio threshold: the small output must be less than this fraction of the large output. */
const SKEW_RATIO_THRESHOLD = 0.1;

/** Minimum hops to trigger detection. */
const MIN_HOPS = 2;

/** Hops required for high confidence. */
const HIGH_CONFIDENCE_HOPS = 3;

/** Maximum hops to trace to avoid infinite loops. */
const MAX_HOPS = 20;

const CONFIDENCE_HIGH = "high" as const;
const CONFIDENCE_MEDIUM = "medium" as const;

/** Result shape when peeling chain is detected. */
export interface PeelingChainResult extends HeuristicResult {
  detected: true;
  chain_length: number;
  confidence: typeof CONFIDENCE_HIGH | typeof CONFIDENCE_MEDIUM;
}

/** Result shape when peeling chain is not detected. */
export interface PeelingChainResultNeg extends HeuristicResult {
  detected: false;
}

/**
 * Runs the Peeling Chain Heuristic on a single transaction.
 *
 * Fires when the transaction has exactly 2 non-OP_RETURN outputs with a skewed
 * value ratio (one < 10% of the other), and the larger output is subsequently
 * spent in another transaction with the same skewed pattern within the same block.
 *
 * @param tx  - The transaction to analyse.
 * @param ctx - Block-level context used to look up spending transactions.
 * @returns A HeuristicResult with `detected`, `chain_length`, and `confidence`.
 */
export function detectPeelingChain(
  tx: AnalyzableTx,
  ctx: BlockContext,
): PeelingChainResult | PeelingChainResultNeg {
  if (tx.isCoinbase) {
    return { detected: false };
  }

  if (!hasSkewedOutputs(tx)) {
    return { detected: false };
  }

  // Find the larger output index
  const spendableOutputs = tx.outputs.filter((o) => o.script_type !== "op_return");
  const largerOutput = spendableOutputs[0]!.value_sats >= spendableOutputs[1]!.value_sats
    ? spendableOutputs[0]!
    : spendableOutputs[1]!;

  // Walk the chain to count hops, counting the current tx as hop 1
  const hops = 1 + traceChain(tx.txid, largerOutput.index, ctx, 0);

  if (hops < MIN_HOPS) {
    return { detected: false };
  }

  const confidence = hops >= HIGH_CONFIDENCE_HOPS ? CONFIDENCE_HIGH : CONFIDENCE_MEDIUM;
  return { detected: true, chain_length: hops, confidence };
}

/**
 * Returns true if the transaction has exactly 2 non-OP_RETURN outputs
 * where one is less than SKEW_RATIO_THRESHOLD of the other.
 *
 * @param tx - The transaction to inspect.
 * @returns True if the output ratio is skewed.
 */
function hasSkewedOutputs(tx: AnalyzableTx): boolean {
  const spendable = tx.outputs.filter((o) => o.script_type !== "op_return");
  if (spendable.length !== 2) return false;

  const a = spendable[0]!.value_sats;
  const b = spendable[1]!.value_sats;
  if (a === 0 || b === 0) return false;

  const smaller = Math.min(a, b);
  const larger = Math.max(a, b);

  return smaller / larger < SKEW_RATIO_THRESHOLD;
}

/**
 * Recursively traces the peeling chain from a given output, returning the
 * number of additional hops found in the block.
 *
 * @param txid        - The txid whose output we are tracing.
 * @param outputIndex - The output index (the large change output) to trace.
 * @param ctx         - Block context for spending lookups.
 * @param depth       - Current recursion depth (to prevent infinite loops).
 * @returns Number of additional hops in the chain (0 if the chain ends here).
 */
function traceChain(
  txid: string,
  outputIndex: number,
  ctx: BlockContext,
  depth: number,
): number {
  if (depth >= MAX_HOPS) return 0;

  const spendingTxid = ctx.utxoSpentByMap.get(`${txid}:${outputIndex}`);
  if (spendingTxid === undefined) return 0;

  const spendingOutputs = ctx.txOutputMap.get(spendingTxid);
  if (spendingOutputs === undefined) return 0;

  // Check if the spending tx also has the skewed-output pattern
  const spendable = spendingOutputs.filter((o) => o.script_type !== "op_return");
  if (spendable.length !== 2) return 0;

  const a = spendable[0]!.value_sats;
  const b = spendable[1]!.value_sats;
  if (a === 0 || b === 0) return 0;

  const smaller = Math.min(a, b);
  const larger = Math.max(a, b);

  if (smaller / larger >= SKEW_RATIO_THRESHOLD) return 0;

  const largerOut = spendable[0]!.value_sats >= spendable[1]!.value_sats
    ? spendable[0]!
    : spendable[1]!;

  return 1 + traceChain(spendingTxid, largerOut.index, ctx, depth + 1);
}
