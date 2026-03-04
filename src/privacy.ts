/**
 * privacy.ts — Privacy Analysis for Bitcoin Transactions
 *
 * Purpose: Analyze transaction construction for privacy leaks and heuristics
 *
 * Privacy risks detected:
 * - ADDRESS_REUSE: Multiple inputs from same address (obvious common ownership)
 * - ROUND_AMOUNT: Round payment amounts (e.g., 1.00000000 BTC) leak intent
 * - OBVIOUS_CHANGE: Change output larger than payments (easy to identify)
 * - SINGLE_INPUT: No input mixing (no privacy from set anonymity)
 * - SCRIPT_TYPE_MISMATCH: Change uses different script type than inputs
 */

// ============================================================================
// TYPES
// ============================================================================

import type { Utxo } from "./parser.js";
import type { ReportOutput } from "./reporter.js";

/**
 * Privacy risk severity levels
 */
export type PrivacyRiskSeverity = "low" | "medium" | "high";

/**
 * Individual privacy risk
 */
export interface PrivacyRisk {
  code: string;
  severity: PrivacyRiskSeverity;
  description: string;
}

/**
 * Complete privacy analysis result
 */
export interface PrivacyAnalysis {
  /** Privacy score from 0 (terrible) to 100 (excellent) */
  score: number;

  /** Detected privacy risks */
  risks: PrivacyRisk[];
}

// ============================================================================
// PRIVACY ANALYSIS
// ============================================================================

/**
 * Analyze transaction for privacy leaks
 *
 * Algorithm:
 * 1. Start with perfect score (100)
 * 2. Detect privacy risks
 * 3. Deduct points based on severity:
 *    - High: -30 points
 *    - Medium: -20 points
 *    - Low: -10 points
 * 4. Floor at 0
 *
 * @param inputs - Selected UTXOs for transaction
 * @param outputs - Transaction outputs (payments + change)
 * @param changeIndex - Index of change output (null if send-all)
 * @returns Privacy analysis with score and risks
 */
export function analyzePrivacy(
  inputs: Utxo[],
  outputs: ReportOutput[],
  changeIndex: number | null,
): PrivacyAnalysis {
  const risks: PrivacyRisk[] = [];

  // ──────────────────────────────────────────────────────────────────────────
  // Risk 1: ADDRESS_REUSE — Multiple inputs from same address
  // ──────────────────────────────────────────────────────────────────────────
  // Heuristic: If multiple UTXOs share the same address, it's obvious they're
  // owned by the same entity. This is the #1 privacy leak in Bitcoin.

  const inputAddresses = inputs.map((u) => u.address);
  const uniqueAddresses = new Set(inputAddresses);

  if (uniqueAddresses.size < inputAddresses.length) {
    const reusedCount = inputAddresses.length - uniqueAddresses.size;
    risks.push({
      code: "ADDRESS_REUSE",
      severity: "high",
      description: `Multiple inputs from same address (${reusedCount} reused). Obvious common ownership.`,
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Risk 2: ROUND_AMOUNT — Suspiciously round payment amounts
  // ──────────────────────────────────────────────────────────────────────────
  // Heuristic: Payments like 1.00000000 BTC or 0.50000000 BTC are unusual in
  // practice. They likely indicate a human choosing a "nice" number, which
  // leaks intent and makes change easier to identify.

  const paymentOutputs = outputs.filter((_, idx) => idx !== changeIndex);
  const hasRoundAmount = paymentOutputs.some(
    (out) => out.value_sats % 1_000_000 === 0,
  );

  if (hasRoundAmount) {
    risks.push({
      code: "ROUND_AMOUNT",
      severity: "low",
      description:
        "Payment amount is suspiciously round (divisible by 0.01 BTC). May leak intent.",
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Risk 3: OBVIOUS_CHANGE — Change output larger than all payments
  // ──────────────────────────────────────────────────────────────────────────
  // Heuristic: If the change output is larger than every payment, it's trivial
  // to identify which output is change. This breaks privacy.

  if (changeIndex !== null) {
    const changeValue = outputs[changeIndex].value_sats;
    const maxPaymentValue = Math.max(
      ...paymentOutputs.map((out) => out.value_sats),
    );

    if (changeValue > maxPaymentValue) {
      risks.push({
        code: "OBVIOUS_CHANGE",
        severity: "medium",
        description:
          "Change output is larger than all payments. Easy to identify which output is change.",
      });
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Risk 4: SINGLE_INPUT — No input mixing
  // ──────────────────────────────────────────────────────────────────────────
  // Heuristic: Transactions with a single input provide no set anonymity.
  // It's obvious which UTXO was spent.

  if (inputs.length === 1) {
    risks.push({
      code: "SINGLE_INPUT",
      severity: "low",
      description:
        "Transaction uses only one input. No privacy from mixing multiple UTXOs.",
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Risk 5: SCRIPT_TYPE_MISMATCH — Change uses different script type
  // ──────────────────────────────────────────────────────────────────────────
  // Heuristic: If inputs are all p2wpkh but change is p2pkh (or vice versa),
  // the change output is easy to identify by script type.

  if (changeIndex !== null) {
    // Find most common input script type
    const inputScriptTypes = inputs.map((u) => u.script_type);
    const scriptTypeCounts = new Map<string, number>();
    for (const type of inputScriptTypes) {
      scriptTypeCounts.set(type, (scriptTypeCounts.get(type) || 0) + 1);
    }
    const mostCommonInputType = [...scriptTypeCounts.entries()].sort(
      (a, b) => b[1] - a[1],
    )[0][0];

    const changeScriptType = outputs[changeIndex].script_type;

    if (changeScriptType !== mostCommonInputType) {
      risks.push({
        code: "SCRIPT_TYPE_MISMATCH",
        severity: "medium",
        description: `Change output uses different script type (${changeScriptType}) than inputs (${mostCommonInputType}). Easy to identify.`,
      });
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Calculate final privacy score
  // ──────────────────────────────────────────────────────────────────────────

  let score = 100;

  for (const risk of risks) {
    switch (risk.severity) {
      case "high":
        score -= 30;
        break;
      case "medium":
        score -= 20;
        break;
      case "low":
        score -= 10;
        break;
    }
  }

  // Floor at 0
  score = Math.max(0, score);

  return {
    score,
    risks,
  };
}
