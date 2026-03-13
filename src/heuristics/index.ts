/**
 * Barrel module for all 9 heuristics.
 *
 * Exports `runAllHeuristics` (runs every detector on a single transaction)
 * and `classifyTx` (maps combined results to a TxClassification).
 *
 * @module heuristics/index
 */

import { detectCioh } from "./cioh.js";
import { detectChangeOutput } from "./change-detection.js";
import { detectAddressReuse } from "./address-reuse.js";
import { detectConsolidation } from "./consolidation.js";
import { detectOpReturn } from "./op-return.js";
import { detectCoinJoin } from "./coinjoin.js";
import { detectSelfTransfer } from "./self-transfer.js";
import { detectPeelingChain } from "./peeling-chain.js";
import { detectRoundNumberPayment } from "./round-number.js";
import type {
  AnalyzableTx,
  BlockContext,
  HeuristicResult,
  TxClassification,
} from "./types.js";

export type { AnalyzableTx, BlockContext, HeuristicResult, TxClassification };
export {
  ALL_HEURISTIC_IDS,
  type HeuristicId,
} from "./types.js";

/** Threshold for batch payment classification (number of outputs). */
const BATCH_PAYMENT_MIN_OUTPUTS = 4;

/**
 * Map of all 9 heuristic IDs to their respective results for a single transaction.
 */
export interface TxHeuristicResults {
  cioh: HeuristicResult;
  change_detection: HeuristicResult;
  address_reuse: HeuristicResult;
  consolidation: HeuristicResult;
  op_return: HeuristicResult;
  coinjoin: HeuristicResult;
  self_transfer: HeuristicResult;
  peeling_chain: HeuristicResult;
  round_number_payment: HeuristicResult;
}

/** Negative result used for coinbase transactions (all heuristics return detected: false). */
const NOT_DETECTED: HeuristicResult = { detected: false };

/**
 * Runs all 9 heuristic detectors on a single transaction.
 *
 * Coinbase transactions always return `detected: false` for every heuristic.
 *
 * @param tx  - The enriched transaction to analyse.
 * @param ctx - Block-level context required by some heuristics.
 * @returns An object keyed by heuristic ID containing each detector's result.
 */
export function runAllHeuristics(
  tx: AnalyzableTx,
  ctx: BlockContext,
): TxHeuristicResults {
  if (tx.isCoinbase) {
    return {
      cioh: NOT_DETECTED,
      change_detection: NOT_DETECTED,
      address_reuse: NOT_DETECTED,
      consolidation: NOT_DETECTED,
      op_return: NOT_DETECTED,
      coinjoin: NOT_DETECTED,
      self_transfer: NOT_DETECTED,
      peeling_chain: NOT_DETECTED,
      round_number_payment: NOT_DETECTED,
    };
  }

  return {
    cioh: detectCioh(tx, ctx),
    change_detection: detectChangeOutput(tx, ctx),
    address_reuse: detectAddressReuse(tx, ctx),
    consolidation: detectConsolidation(tx, ctx),
    op_return: detectOpReturn(tx, ctx),
    coinjoin: detectCoinJoin(tx, ctx),
    self_transfer: detectSelfTransfer(tx, ctx),
    peeling_chain: detectPeelingChain(tx, ctx),
    round_number_payment: detectRoundNumberPayment(tx, ctx),
  };
}

/**
 * Classifies a transaction based on combined heuristic results.
 *
 * Priority order (first match wins):
 * 1. coinjoin detected → "coinjoin"
 * 2. consolidation detected → "consolidation"
 * 3. self_transfer detected → "self_transfer"
 * 4. ≥4 outputs → "batch_payment"
 * 5. isCoinbase → "unknown"
 * 6. default → "simple_payment"
 *
 * @param tx      - The transaction being classified.
 * @param results - The combined heuristic results from `runAllHeuristics`.
 * @returns One of the 6 valid classification strings.
 */
export function classifyTx(
  tx: AnalyzableTx,
  results: TxHeuristicResults,
): TxClassification {
  if (results.coinjoin.detected) {
    return "coinjoin";
  }
  if (results.consolidation.detected) {
    return "consolidation";
  }
  if (results.self_transfer.detected) {
    return "self_transfer";
  }
  if (tx.outputs.length >= BATCH_PAYMENT_MIN_OUTPUTS) {
    return "batch_payment";
  }
  if (tx.isCoinbase) {
    return "unknown";
  }
  return "simple_payment";
}
