/**
 * Round Number Payment Heuristic.
 *
 * Detects transactions where one or more outputs have "round" values — amounts
 * that are exact multiples of common BTC denominations. Round amounts are a
 * strong signal of deliberate payment values (vs. change outputs, which tend
 * to be odd amounts from UTXO arithmetic).
 *
 * Uses integer modulo math against satoshi values to avoid floating-point
 * precision issues.
 *
 * @module heuristics/round-number
 */

import type { AnalyzableTx, BlockContext, HeuristicResult } from "./types.js";

/** 1 BTC in satoshis — highest confidence threshold. */
const ONE_BTC = 100_000_000;

/** 0.1 BTC in satoshis — highest confidence threshold. */
const POINT_ONE_BTC = 10_000_000;

/** 0.01 BTC in satoshis — medium confidence threshold. */
const POINT_01_BTC = 1_000_000;

/** 0.001 BTC in satoshis — low confidence threshold. */
const POINT_001_BTC = 100_000;

const CONFIDENCE_HIGH = "high" as const;
const CONFIDENCE_MEDIUM = "medium" as const;
const CONFIDENCE_LOW = "low" as const;

type RoundConfidence = typeof CONFIDENCE_HIGH | typeof CONFIDENCE_MEDIUM | typeof CONFIDENCE_LOW;

/** A single round output entry. */
export interface RoundOutput {
  /** Zero-based output index. */
  index: number;
  /** Output value in satoshis. */
  value_sats: number;
  /** Confidence level derived from the denomination matched. */
  confidence: RoundConfidence;
}

/** Result shape when round number payment is detected. */
export interface RoundNumberResult extends HeuristicResult {
  detected: true;
  round_outputs: RoundOutput[];
  confidence: RoundConfidence;
}

/** Result shape when round number payment is not detected. */
export interface RoundNumberResultNeg extends HeuristicResult {
  detected: false;
}

/**
 * Runs the Round Number Payment Heuristic on a single transaction.
 *
 * Fires when at least one non-OP_RETURN, non-zero output value is an exact
 * multiple of a known BTC denomination (1 BTC, 0.1 BTC, 0.01 BTC, 0.001 BTC).
 * The overall confidence is the highest confidence among all round outputs.
 *
 * @param tx  - The transaction to analyse.
 * @param _ctx - Block-level context (unused by this heuristic).
 * @returns A HeuristicResult with `detected`, `round_outputs`, and `confidence`.
 */
export function detectRoundNumberPayment(
  tx: AnalyzableTx,
  _ctx: BlockContext,
): RoundNumberResult | RoundNumberResultNeg {
  if (tx.isCoinbase) {
    return { detected: false };
  }

  const roundOutputs: RoundOutput[] = [];

  for (const output of tx.outputs) {
    if (output.script_type === "op_return") continue;
    if (output.value_sats === 0) continue;

    const confidence = getRoundConfidence(output.value_sats);
    if (confidence !== null) {
      roundOutputs.push({ index: output.index, value_sats: output.value_sats, confidence });
    }
  }

  if (roundOutputs.length === 0) {
    return { detected: false };
  }

  const overallConfidence = highestConfidence(roundOutputs.map((r) => r.confidence));
  return { detected: true, round_outputs: roundOutputs, confidence: overallConfidence };
}

/**
 * Returns the confidence level for a given satoshi value based on round-number thresholds,
 * or null if the value is not a recognized round amount.
 *
 * @param sats - The output value in satoshis.
 * @returns Confidence level string, or null if not round.
 */
function getRoundConfidence(sats: number): RoundConfidence | null {
  if (sats % ONE_BTC === 0) return CONFIDENCE_HIGH;
  if (sats % POINT_ONE_BTC === 0) return CONFIDENCE_HIGH;
  if (sats % POINT_01_BTC === 0) return CONFIDENCE_MEDIUM;
  if (sats % POINT_001_BTC === 0) return CONFIDENCE_LOW;
  return null;
}

/**
 * Returns the highest confidence level from an array of confidence strings.
 *
 * @param confidences - Array of confidence levels.
 * @returns The highest confidence level.
 */
function highestConfidence(confidences: RoundConfidence[]): RoundConfidence {
  if (confidences.includes(CONFIDENCE_HIGH)) return CONFIDENCE_HIGH;
  if (confidences.includes(CONFIDENCE_MEDIUM)) return CONFIDENCE_MEDIUM;
  return CONFIDENCE_LOW;
}
