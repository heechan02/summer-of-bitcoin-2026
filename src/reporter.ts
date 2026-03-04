/**
 * Module 8 — reporter.ts
 *
 * Purpose: Assemble the final JSON report object from all computed values.
 *
 * This module takes all the computed transaction components and formats them
 * into the machine-checkable output report format required by the evaluator.
 *
 * Key responsibilities:
 * - Construct success report with all required fields
 * - Construct error report with proper error structure
 * - Compute actual fee_rate_sat_vb from fee_sats and vbytes (NOT the input fee rate)
 * - Format selected_inputs and outputs arrays properly
 * - Determine change_index (null if no change, otherwise index in outputs array)
 */

// ============================================================================
// IMPORTS
// ============================================================================

import type { Network, Utxo, ScriptType } from "./parser.js";
import type { Warning } from "./warnings.js";
import type { PrivacyRisk } from "./privacy.js";

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Input object in the report (simplified from Utxo)
 */
export interface ReportInput {
  txid: string;
  vout: number;
  value_sats: number;
  script_type: ScriptType;
}

/**
 * Output object in the report
 */
export interface ReportOutput {
  value_sats: number;
  script_pubkey_hex: string;
  script_type: ScriptType;
  is_change: boolean;
}

/**
 * Parameters needed to build a success report
 */
export interface ReportParams {
  // Network and strategy
  network: Network;
  strategy: "greedy" | "branch-and-bound";

  // Selected inputs
  selectedInputs: Utxo[];

  // Outputs (payments + optional change)
  // Must be in correct order: payments first, change last (if present)
  outputs: ReportOutput[];

  // Change information
  changeIndex: number | null; // Index in outputs array where change is, or null

  // Fee and size
  feeSats: number;
  vbytes: number;

  // Locktime and RBF
  rbfSignaling: boolean;
  locktime: number;
  locktimeType: "none" | "block_height" | "unix_timestamp";

  // PSBT
  psbtBase64: string;

  // Warnings
  warnings: Warning[];

  // Privacy analysis
  privacyScore: number;
  privacyRisks: PrivacyRisk[];
}

/**
 * Success report structure
 */
export interface Report {
  ok: true;
  network: Network;
  strategy: "greedy" | "branch-and-bound";
  selected_inputs: ReportInput[];
  outputs: ReportOutput[];
  change_index: number | null;
  fee_sats: number;
  fee_rate_sat_vb: number; // COMPUTED from fee_sats / vbytes
  vbytes: number;
  rbf_signaling: boolean;
  locktime: number;
  locktime_type: "none" | "block_height" | "unix_timestamp";
  psbt_base64: string;
  warnings: Warning[];
  privacy_score: number;
  privacy_risks: PrivacyRisk[];
}

/**
 * Error report structure
 */
export interface ErrorReport {
  ok: false;
  error: {
    code: string;
    message: string;
  };
}

// ============================================================================
// MAIN FUNCTIONS
// ============================================================================

/**
 * Build a success report from all computed transaction components.
 *
 * Converts UTXOs to simplified input format, computes actual fee rate
 * (fee_sats / vbytes rounded to 2 decimals), and assembles all fields.
 *
 * @param params - All computed transaction parameters
 * @returns Success report object
 */
export function buildReport(params: ReportParams): Report {
  // Step 1: Convert selectedInputs to ReportInput[] format
  const selected_inputs: ReportInput[] = params.selectedInputs.map((utxo) => ({
    txid: utxo.txid,
    vout: utxo.vout,
    value_sats: utxo.value_sats,
    script_type: utxo.script_type,
  }));

  // Step 2: Compute actual fee_rate_sat_vb
  // Formula: fee_sats / vbytes, rounded to 2 decimal places
  const feeRate = params.feeSats / params.vbytes;
  const fee_rate_sat_vb = Math.round(feeRate * 100) / 100;

  // Step 3: Assemble Report object with all fields
  return {
    ok: true,
    network: params.network,
    strategy: params.strategy,
    selected_inputs,
    outputs: params.outputs,
    change_index: params.changeIndex,
    fee_sats: params.feeSats,
    fee_rate_sat_vb,
    vbytes: params.vbytes,
    rbf_signaling: params.rbfSignaling,
    locktime: params.locktime,
    locktime_type: params.locktimeType,
    psbt_base64: params.psbtBase64,
    warnings: params.warnings,
    privacy_score: params.privacyScore,
    privacy_risks: params.privacyRisks,
  };
}

/**
 * Build an error report for invalid fixtures or processing failures.
 *
 * @param code - Error code (e.g., "INVALID_FIXTURE", "INSUFFICIENT_FUNDS")
 * @param message - Detailed error message
 * @returns Error report object
 */
export function buildErrorReport(code: string, message: string): ErrorReport {
  // Step 1: Create ErrorReport object
  return {
    ok: false,
    error: {
      code,
      message,
    },
  };
}
