/**
 * Change Output Identification Heuristic.
 *
 * Attempts to identify which output in a transaction is the "change" returned
 * to the sender, using four methods in priority order (first match wins):
 * 1. Address reuse — output address matches an input prevout address.
 * 2. Script type match — exactly one output matches the dominant input script type.
 * 3. Round number — one output is round (÷ 1,000,000 sats), the other is not.
 * 4. Value heuristic — in a 2-output tx, the larger output is treated as change.
 *
 * @module heuristics/change-detection
 */

import type { AnalyzableTx, BlockContext, HeuristicResult } from "./types.js";

/** Minimum number of non-OP_RETURN outputs required to fire this heuristic. */
const MIN_SPENDABLE_OUTPUTS = 2;

/** Satoshi divisor used for "round number" detection (0.01 BTC). */
const ROUND_SAT_DIVISOR = 1_000_000;

const CONFIDENCE_HIGH = "high" as const;
const CONFIDENCE_MEDIUM = "medium" as const;
const CONFIDENCE_LOW = "low" as const;

const METHOD_ADDRESS_REUSE = "address_reuse" as const;
const METHOD_SCRIPT_TYPE_MATCH = "script_type_match" as const;
const METHOD_ROUND_NUMBER = "round_number" as const;
const METHOD_VALUE_HEURISTIC = "value_heuristic" as const;

/** Result shape when change output is identified. */
export interface ChangeDetectionResult extends HeuristicResult {
  detected: true;
  likely_change_index: number;
  method: typeof METHOD_ADDRESS_REUSE | typeof METHOD_SCRIPT_TYPE_MATCH | typeof METHOD_ROUND_NUMBER | typeof METHOD_VALUE_HEURISTIC;
  confidence: typeof CONFIDENCE_HIGH | typeof CONFIDENCE_MEDIUM | typeof CONFIDENCE_LOW;
}

/** Result shape when no change output is identified. */
export interface ChangeDetectionResultNeg extends HeuristicResult {
  detected: false;
}

/**
 * Returns the dominant script type among inputs (most frequent).
 * Ties are broken by first occurrence.
 *
 * @param types - Array of prevout script type strings.
 * @returns The most common script type, or undefined if the array is empty.
 */
function dominantType(types: string[]): string | undefined {
  const counts = new Map<string, number>();
  for (const t of types) {
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  let best: string | undefined;
  let bestCount = 0;
  for (const [type, count] of counts) {
    if (count > bestCount) {
      best = type;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Runs the Change Detection heuristic on a single transaction.
 *
 * @param tx  - The transaction to analyse.
 * @param _ctx - Block-level context (unused by this heuristic).
 * @returns A HeuristicResult indicating whether a likely change output was found.
 */
export function detectChangeOutput(
  tx: AnalyzableTx,
  _ctx: BlockContext,
): ChangeDetectionResult | ChangeDetectionResultNeg {
  if (tx.isCoinbase) {
    return { detected: false };
  }

  // Filter outputs to spendable (non-OP_RETURN) outputs only
  const spendable = tx.outputs.filter((o) => o.script_type !== "op_return");

  if (spendable.length < MIN_SPENDABLE_OUTPUTS) {
    return { detected: false };
  }

  // Build set of input prevout addresses for address-reuse check
  const inputAddresses = new Set<string>();
  for (const inp of tx.inputs) {
    if (inp.prevout_address !== null) {
      inputAddresses.add(inp.prevout_address);
    }
  }

  // --- Method 1: Address reuse ---
  for (const out of spendable) {
    if (out.address !== null && inputAddresses.has(out.address)) {
      return {
        detected: true,
        likely_change_index: out.index,
        method: METHOD_ADDRESS_REUSE,
        confidence: CONFIDENCE_HIGH,
      };
    }
  }

  // --- Method 2: Script type match ---
  const inputTypes = tx.inputs.map((inp) => inp.prevout_script_type);
  const dominant = dominantType(inputTypes);
  if (dominant !== undefined) {
    const matchingOutputs = spendable.filter((o) => o.script_type === dominant);
    const nonMatchingOutputs = spendable.filter((o) => o.script_type !== dominant);
    if (matchingOutputs.length === 1 && nonMatchingOutputs.length >= 1) {
      const changeOut = matchingOutputs[0];
      if (changeOut !== undefined) {
        return {
          detected: true,
          likely_change_index: changeOut.index,
          method: METHOD_SCRIPT_TYPE_MATCH,
          confidence: CONFIDENCE_HIGH,
        };
      }
    }
  }

  // --- Method 3: Round number ---
  // One output is divisible by ROUND_SAT_DIVISOR, the other is not → non-round is change
  const roundOutputs = spendable.filter((o) => o.value_sats % ROUND_SAT_DIVISOR === 0);
  const nonRoundOutputs = spendable.filter((o) => o.value_sats % ROUND_SAT_DIVISOR !== 0);
  if (roundOutputs.length === 1 && nonRoundOutputs.length >= 1) {
    // The non-round output is the change; use the first non-round output
    const changeOut = nonRoundOutputs[0];
    if (changeOut !== undefined) {
      return {
        detected: true,
        likely_change_index: changeOut.index,
        method: METHOD_ROUND_NUMBER,
        confidence: CONFIDENCE_MEDIUM,
      };
    }
  }

  // --- Method 4: Value heuristic (2 spendable outputs only) ---
  if (spendable.length === 2) {
    const [first, second] = spendable as [typeof spendable[0], typeof spendable[0]];
    const changeOut = first.value_sats >= second.value_sats ? first : second;
    return {
      detected: true,
      likely_change_index: changeOut.index,
      method: METHOD_VALUE_HEURISTIC,
      confidence: CONFIDENCE_LOW,
    };
  }

  return { detected: false };
}
