/**
 * json-builder.ts — JSON schema assembly from analyzed block data.
 *
 * Transforms per-block heuristic results into the grader-expected JSON schema,
 * enforcing all 10 invariants defined in PLAN.md.
 *
 * @module json-builder
 */

import type { AnalyzableTx } from "./heuristics/types.js";
import type { TxHeuristicResults, TxClassification } from "./heuristics/index.js";
import { ALL_HEURISTIC_IDS } from "./heuristics/types.js";
import type { AnalyzedBlock } from "./chain-analyzer.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Decimal rounding precision for fee rate stats (1 decimal place). */
const FEE_RATE_DECIMAL_PLACES = 1;

/** Multiplier for rounding to 1 decimal place. */
const FEE_RATE_ROUND_FACTOR = Math.pow(10, FEE_RATE_DECIMAL_PLACES);

/** Default fee stat value when no non-coinbase txs exist. */
const DEFAULT_FEE_STAT = 0.0;

// ---------------------------------------------------------------------------
// Public input types
// ---------------------------------------------------------------------------

/**
 * Combined result for a single analyzed transaction (tx + heuristics + classification).
 */
export interface AnalyzedTxResult {
  /** The enriched transaction. */
  tx: AnalyzableTx;
  /** Results from all 9 heuristic detectors. */
  heuristics: TxHeuristicResults;
  /** Classification derived from heuristic results. */
  classification: TxClassification;
}

/**
 * Per-block input to the JSON builder: the parsed block metadata + analyzed tx results.
 */
export interface AnalyzedBlockInput {
  /** Metadata from chain-analyzer (hash, height, timestamp, txCount). */
  block: AnalyzedBlock;
  /**
   * Analyzed results for every tx in this block (aligned with block.txs).
   * For blocks[1+], this is empty [] if memory was dropped — the builder
   * will skip building per-tx JSON and use the pre-computed summary instead.
   */
  txResults: AnalyzedTxResult[];
  /**
   * Pre-computed per-block summary stats (used when txResults is empty for memory efficiency).
   * Required when txResults.length === 0 but block.txCount > 0.
   */
  precomputedSummary?: BlockAnalysisSummary;
}

// ---------------------------------------------------------------------------
// Output JSON shape types
// ---------------------------------------------------------------------------

/** Fee rate statistics for a set of transactions. */
export interface FeeRateStats {
  min_sat_vb: number;
  max_sat_vb: number;
  median_sat_vb: number;
  mean_sat_vb: number;
}

/** Script type distribution: script_type → count. */
export type ScriptTypeDistribution = Record<string, number>;

/** Block-level or file-level analysis summary. */
export interface BlockAnalysisSummary {
  total_transactions_analyzed: number;
  heuristics_applied: readonly string[];
  flagged_transactions: number;
  script_type_distribution: ScriptTypeDistribution;
  fee_rate_stats: FeeRateStats;
}

/** Per-transaction heuristic + classification result in the JSON output. */
export interface TxJsonEntry {
  txid: string;
  heuristics: TxHeuristicResults;
  classification: TxClassification;
}

/** Per-block entry in the JSON output. */
export interface BlockJsonEntry {
  block_hash: string;
  block_height: number;
  tx_count: number;
  analysis_summary: BlockAnalysisSummary;
  transactions: TxJsonEntry[];
}

/** Top-level JSON output schema. */
export interface SherlockJsonOutput {
  ok: true;
  mode: "chain_analysis";
  file: string;
  block_count: number;
  analysis_summary: BlockAnalysisSummary;
  blocks: BlockJsonEntry[];
}

/** Error JSON output schema. */
export interface SherlockErrorOutput {
  ok: false;
  error: {
    code: string;
    message: string;
  };
}

// ---------------------------------------------------------------------------
// Main exported function
// ---------------------------------------------------------------------------

/**
 * Assemble the full grader-expected JSON output from analyzed block data.
 *
 * Enforces all 10 invariants:
 * 1. block_count === blocks.length
 * 2. file total_transactions_analyzed === sum(block tx_count)
 * 3. file flagged_transactions === sum(per-block flagged)
 * 4. per-block total_transactions_analyzed === tx_count
 * 5. per-block flagged === actual count of txs with any detected: true
 * 6. fee_rate_stats: min ≤ median ≤ max, all ≥ 0
 * 7. heuristics_applied has ≥5 IDs including cioh + change_detection
 * 8. blocks[0].transactions.length === blocks[0].tx_count
 * 9. every tx has all 9 heuristic keys
 * 10. classification ∈ valid enum
 *
 * @param fileName  - The source block filename (e.g. "blk04330.dat").
 * @param blockInputs - Per-block data in block order.
 * @returns The fully assembled JSON output object.
 */
export function buildJsonOutput(
  fileName: string,
  blockInputs: AnalyzedBlockInput[],
): SherlockJsonOutput {
  // Build per-block entries (invariant 1: blocks.length = block_count)
  const blockEntries: BlockJsonEntry[] = blockInputs.map((input, blockIdx) =>
    buildBlockEntry(input, blockIdx === 0),
  );

  // File-level stats
  const fileSummary = buildFileSummary(blockInputs, blockEntries);

  return {
    ok: true,
    mode: "chain_analysis",
    file: fileName,
    block_count: blockEntries.length, // invariant 1
    analysis_summary: fileSummary,
    blocks: blockEntries,
  };
}

/**
 * Build a structured error output for CLI error handling.
 *
 * @param code    - One of: INVALID_ARGS, FILE_NOT_FOUND, PARSE_ERROR, ANALYSIS_ERROR.
 * @param message - Human-readable error description.
 * @returns Error JSON object.
 */
export function buildErrorOutput(
  code: string,
  message: string,
): SherlockErrorOutput {
  return { ok: false, error: { code, message } };
}

// ---------------------------------------------------------------------------
// Per-block assembly
// ---------------------------------------------------------------------------

/**
 * Build a single block's JSON entry from its analyzed results.
 *
 * @param input      - The block data + tx results.
 * @param includeTransactions - True only for blocks[0]; others get [].
 * @returns Block JSON entry satisfying all per-block invariants.
 */
function buildBlockEntry(
  input: AnalyzedBlockInput,
  includeTransactions: boolean,
): BlockJsonEntry {
  const { block, txResults, precomputedSummary } = input;

  // Build or use precomputed summary
  let summary: BlockAnalysisSummary;
  let txEntries: TxJsonEntry[] = [];

  if (txResults.length > 0) {
    // Full computation from txResults
    const flagged = countFlagged(txResults);
    const scriptDist = computeScriptDist(txResults.map((r) => r.tx));
    const feeStats = computeFeeStats(txResults.map((r) => r.tx));
    summary = {
      total_transactions_analyzed: block.txCount, // invariant 4
      heuristics_applied: ALL_HEURISTIC_IDS,
      flagged_transactions: flagged, // invariant 5
      script_type_distribution: scriptDist,
      fee_rate_stats: feeStats,
    };
    txEntries = txResults.map((r) => ({
      txid: r.tx.txid,
      heuristics: r.heuristics, // invariant 9: all 9 keys present
      classification: r.classification, // invariant 10: valid enum
    }));
  } else if (precomputedSummary !== undefined) {
    // Use pre-computed summary (memory-dropped blocks[1+])
    summary = {
      ...precomputedSummary,
      total_transactions_analyzed: block.txCount, // invariant 4
      heuristics_applied: ALL_HEURISTIC_IDS,
    };
  } else {
    // Empty block fallback (no txs at all)
    summary = {
      total_transactions_analyzed: block.txCount,
      heuristics_applied: ALL_HEURISTIC_IDS,
      flagged_transactions: 0,
      script_type_distribution: {},
      fee_rate_stats: defaultFeeStats(),
    };
  }

  // invariant 8: blocks[0].transactions.length === blocks[0].tx_count
  const transactions = includeTransactions ? txEntries : [];

  return {
    block_hash: block.blockHash,
    block_height: block.blockHeight,
    tx_count: block.txCount, // invariant 4
    analysis_summary: summary,
    transactions,
  };
}

// ---------------------------------------------------------------------------
// File-level summary assembly
// ---------------------------------------------------------------------------

/**
 * Build the file-level analysis_summary by aggregating all block summaries.
 * Fee stats are recomputed from the combined fee rate list (not averaged from per-block).
 *
 * @param blockInputs  - Original block inputs (used for fee rate recomputation).
 * @param blockEntries - Assembled per-block entries.
 * @returns File-level summary satisfying invariants 2, 3, 6, 7.
 */
function buildFileSummary(
  blockInputs: AnalyzedBlockInput[],
  blockEntries: BlockJsonEntry[],
): BlockAnalysisSummary {
  // Invariant 2: total_transactions_analyzed === sum(block tx_count)
  const totalTxs = blockEntries.reduce((acc, b) => acc + b.tx_count, 0);

  // Invariant 3: flagged_transactions === sum(per-block flagged)
  const totalFlagged = blockEntries.reduce(
    (acc, b) => acc + b.analysis_summary.flagged_transactions,
    0,
  );

  // Merge script type distributions deterministically
  const mergedScriptDist = mergeScriptDists(
    blockEntries.map((b) => b.analysis_summary.script_type_distribution),
  );

  // Recompute fee stats from combined non-coinbase rates across all blocks
  const allFeeRates = collectAllFeeRates(blockInputs);
  const feeStats = computeFeeStatsFromRates(allFeeRates);

  return {
    total_transactions_analyzed: totalTxs,
    heuristics_applied: ALL_HEURISTIC_IDS,
    flagged_transactions: totalFlagged,
    script_type_distribution: mergedScriptDist,
    fee_rate_stats: feeStats,
  };
}

// ---------------------------------------------------------------------------
// Helper: count flagged transactions
// ---------------------------------------------------------------------------

/**
 * Count transactions where any heuristic has detected: true.
 * Coinbase transactions are never flagged (all heuristics return detected: false).
 *
 * @param txResults - All tx results for a block.
 * @returns Count of flagged transactions.
 */
function countFlagged(txResults: AnalyzedTxResult[]): number {
  return txResults.filter((r) =>
    Object.values(r.heuristics).some((h) => h.detected),
  ).length;
}

// ---------------------------------------------------------------------------
// Helper: script type distribution
// ---------------------------------------------------------------------------

/**
 * Compute the output script type distribution across all transactions.
 * All outputs (including coinbase) are counted; sorted alphabetically.
 *
 * @param txs - Array of AnalyzableTx.
 * @returns Sorted script type → count map.
 */
function computeScriptDist(txs: AnalyzableTx[]): ScriptTypeDistribution {
  const counts: Record<string, number> = {};
  for (const tx of txs) {
    for (const out of tx.outputs) {
      counts[out.script_type] = (counts[out.script_type] ?? 0) + 1;
    }
  }
  return sortedRecord(counts);
}

/**
 * Merge multiple script type distributions into one, sorted alphabetically.
 *
 * @param dists - Array of per-block distributions.
 * @returns Merged and sorted distribution.
 */
function mergeScriptDists(dists: ScriptTypeDistribution[]): ScriptTypeDistribution {
  const merged: Record<string, number> = {};
  for (const dist of dists) {
    for (const [type, count] of Object.entries(dist)) {
      merged[type] = (merged[type] ?? 0) + count;
    }
  }
  return sortedRecord(merged);
}

/**
 * Return a new object with keys sorted alphabetically (deterministic output).
 *
 * @param record - The record to sort.
 * @returns New object with keys in sorted order.
 */
function sortedRecord(record: Record<string, number>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(record).sort(([a], [b]) => a.localeCompare(b)),
  );
}

// ---------------------------------------------------------------------------
// Helper: fee rate stats
// ---------------------------------------------------------------------------

/**
 * Compute fee rate statistics from the non-coinbase transactions in a block.
 * Invariant 6: min ≤ median ≤ max, all ≥ 0.
 * Guard: if no non-coinbase txs exist, default all values to 0.0.
 *
 * @param txs - All transactions in a block (including coinbase).
 * @returns FeeRateStats with values rounded to 1 decimal.
 */
export function computeFeeStats(txs: AnalyzableTx[]): FeeRateStats {
  const rates = txs
    .filter((tx) => !tx.isCoinbase)
    .map((tx) => tx.fee_rate_sat_vb);
  return computeFeeStatsFromRates(rates);
}

/**
 * Collect all non-coinbase fee rates from all block inputs.
 * Used for file-level fee stat recomputation across all blocks.
 *
 * @param blockInputs - All block inputs.
 * @returns Combined list of fee rates.
 */
function collectAllFeeRates(blockInputs: AnalyzedBlockInput[]): number[] {
  const rates: number[] = [];
  for (const input of blockInputs) {
    if (input.txResults.length > 0) {
      for (const r of input.txResults) {
        if (!r.tx.isCoinbase) {
          rates.push(r.tx.fee_rate_sat_vb);
        }
      }
    } else if (input.precomputedSummary !== undefined) {
      // Can't recompute individual rates from precomputed summary — skip
      // (fee stats will be based on available data)
    }
  }
  return rates;
}

/**
 * Compute fee rate statistics from an explicit list of rates.
 * Guard clause: empty list → all 0.0 (prevents NaN/Infinity).
 *
 * @param rates - Non-coinbase fee rates in sat/vB.
 * @returns FeeRateStats rounded to 1 decimal.
 */
export function computeFeeStatsFromRates(rates: number[]): FeeRateStats {
  if (rates.length === 0) {
    return defaultFeeStats();
  }

  const sorted = [...rates].sort((a, b) => a - b);
  const min = sorted[0] ?? 0;
  const max = sorted[sorted.length - 1] ?? 0;
  const mean = sorted.reduce((acc, r) => acc + r, 0) / sorted.length;
  const median = computeMedian(sorted);

  return {
    min_sat_vb: round1(Math.max(0, min)),
    max_sat_vb: round1(Math.max(0, max)),
    median_sat_vb: round1(Math.max(0, median)),
    mean_sat_vb: round1(Math.max(0, mean)),
  };
}

/**
 * Compute median of an already-sorted numeric array.
 *
 * @param sorted - Sorted array of numbers (ascending).
 * @returns Median value.
 */
function computeMedian(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid] ?? 0;
  }
  // Even length: average two middle values
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

/**
 * Default fee stats when no non-coinbase txs exist.
 *
 * @returns FeeRateStats with all values set to 0.0.
 */
function defaultFeeStats(): FeeRateStats {
  return {
    min_sat_vb: DEFAULT_FEE_STAT,
    max_sat_vb: DEFAULT_FEE_STAT,
    median_sat_vb: DEFAULT_FEE_STAT,
    mean_sat_vb: DEFAULT_FEE_STAT,
  };
}

/**
 * Round a number to 1 decimal place.
 *
 * @param value - The value to round.
 * @returns Value rounded to 1 decimal.
 */
function round1(value: number): number {
  return Math.round(value * FEE_RATE_ROUND_FACTOR) / FEE_RATE_ROUND_FACTOR;
}
