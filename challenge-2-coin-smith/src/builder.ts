/**
 * Module 9 — builder.ts (Orchestrator)
 *
 * Purpose: Wire all modules together. This is the main entry point called by cli.sh.
 *
 * Responsibilities:
 * - Read fixture file and parse it
 * - Orchestrate coin selection, fee calculation, PSBT construction
 * - Handle errors and write output JSON
 * - Ensure all logging goes to stderr, never stdout
 */

// ============================================================================
// IMPORTS
// ============================================================================

import { promises as fs } from "fs";
import * as path from "path";

import { parseFixture } from "./parser.js";
import type { Fixture } from "./parser.js";

import { selectCoins } from "./selector.js";

import { resolveFeeAndChange } from "./feeChange.js";

import {
  computeLocktime,
  computeSequence,
  classifyLocktime,
} from "./sequences.js";

import { buildPsbt } from "./psbt.js";
import type { OutputSpec } from "./psbt.js";

import { computeWarnings } from "./warnings.js";

import { analyzePrivacy } from "./privacy.js";

import {
  buildReport,
  buildErrorReport,
} from "./reporter.js";
import type { ReportParams, ReportOutput } from "./reporter.js";

// ============================================================================
// MAIN FUNCTION
// ============================================================================

/**
 * Build a Bitcoin PSBT transaction from a fixture file.
 *
 * Flow:
 * 1. Read fixture file from disk
 * 2. Parse fixture JSON → validate schema
 * 3. Compute payments total
 * 4. Select coins to fund payments + estimated fee
 * 5. Resolve fee and change amount (two-pass algorithm)
 * 6. Compute nLockTime and nSequence values
 * 7. Assemble outputs array (payments + optional change)
 * 8. Build PSBT (BIP-174 compliant)
 * 9. Compute warnings
 * 10. Build report and write to output file
 * 11. Exit with code 0 on success, 1 on error
 *
 * Error handling:
 * - Catch any errors during processing
 * - Build error report with code and message
 * - Ensure output directory exists
 * - Write error JSON to output file
 * - Exit with code 1
 *
 * Logging requirements:
 * - ALL logs must go to stderr (console.error)
 * - NEVER use console.log (it goes to stdout)
 * - Only the output file contains the result
 *
 * @param fixturePath - Path to input fixture JSON file
 * @param outputPath - Path to write output JSON report
 */
export async function buildTransaction(
  fixturePath: string,
  outputPath: string,
): Promise<void> {
  try {
    // ──────────────────────────────────────────────────────────────────────────
    // STEP 1: Read and parse fixture file
    // ──────────────────────────────────────────────────────────────────────────

    console.error(`Reading fixture: ${fixturePath}`);
    const fileContent = await fs.readFile(fixturePath, "utf-8");
    const rawJson = JSON.parse(fileContent);
    const fixture: Fixture = parseFixture(rawJson);

    // Extract values from fixture
    const {
      network,
      utxos,
      payments,
      change,
      fee_rate_sat_vb,
      policy,
    } = fixture;

    const rbf = fixture.rbf ?? false;
    const locktime = fixture.locktime;
    const current_height = fixture.current_height;

    // ──────────────────────────────────────────────────────────────────────────
    // STEP 2: Coin selection
    // ──────────────────────────────────────────────────────────────────────────

    const selectionResult = selectCoins(
      utxos,
      payments,
      fee_rate_sat_vb,
      change.script_type,
      policy,
    );

    console.error(
      `Selected ${selectionResult.selected.length} inputs using ${selectionResult.strategy} strategy`,
    );

    // ──────────────────────────────────────────────────────────────────────────
    // STEP 3: Resolve fee and change
    // ──────────────────────────────────────────────────────────────────────────

    const feeChangeResult = resolveFeeAndChange(
      selectionResult.selected,
      payments,
      change.script_type,
      fee_rate_sat_vb,
    );

    console.error(
      `Fee: ${feeChangeResult.feeSats} sats (${feeChangeResult.vbytes} vbytes)`,
    );
    console.error(
      `Change: ${feeChangeResult.changeAmount !== null ? `${feeChangeResult.changeAmount} sats` : "none (send-all)"}`,
    );

    // ──────────────────────────────────────────────────────────────────────────
    // STEP 4: Compute locktime and sequence
    // ──────────────────────────────────────────────────────────────────────────

    const nLockTime = computeLocktime(rbf, locktime, current_height);
    const nSequence = computeSequence(rbf, nLockTime);
    const locktimeType = classifyLocktime(nLockTime);
    const rbfSignaling = nSequence <= 0xfffffffd;

    // ──────────────────────────────────────────────────────────────────────────
    // STEP 5: Assemble outputs array
    // ──────────────────────────────────────────────────────────────────────────

    // Create outputs for PSBT (OutputSpec[])
    const psbtOutputs: OutputSpec[] = payments.map((payment) => ({
      script_pubkey_hex: payment.script_pubkey_hex,
      value_sats: payment.value_sats,
      is_change: false,
    }));

    // Add change output if present
    if (feeChangeResult.changeAmount !== null) {
      psbtOutputs.push({
        script_pubkey_hex: change.script_pubkey_hex,
        value_sats: feeChangeResult.changeAmount,
        is_change: true,
      });
    }

    // Create outputs for report (ReportOutput[])
    const reportOutputs: ReportOutput[] = payments.map((payment) => ({
      value_sats: payment.value_sats,
      script_pubkey_hex: payment.script_pubkey_hex,
      script_type: payment.script_type,
      is_change: false,
    }));

    // Add change output to report if present
    let changeIndex: number | null = null;
    if (feeChangeResult.changeAmount !== null) {
      changeIndex = payments.length;
      reportOutputs.push({
        value_sats: feeChangeResult.changeAmount,
        script_pubkey_hex: change.script_pubkey_hex,
        script_type: change.script_type,
        is_change: true,
      });
    }

    // ──────────────────────────────────────────────────────────────────────────
    // STEP 6: Build PSBT
    // ──────────────────────────────────────────────────────────────────────────

    const psbtBase64 = buildPsbt(
      network,
      selectionResult.selected,
      psbtOutputs,
      nLockTime,
      nSequence,
    );

    console.error(`Built PSBT with ${psbtOutputs.length} outputs`);

    // ──────────────────────────────────────────────────────────────────────────
    // STEP 7: Compute warnings
    // ──────────────────────────────────────────────────────────────────────────

    const warnings = computeWarnings({
      feeSats: feeChangeResult.feeSats,
      feeRateSatVb: feeChangeResult.feeSats / feeChangeResult.vbytes,
      changeAmount: feeChangeResult.changeAmount,
      rbfSignaling,
    });

    if (warnings.length > 0) {
      const warningCodes = warnings.map((w) => w.code).join(", ");
      console.error(`Warnings: ${warningCodes}`);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // STEP 8: Analyze privacy
    // ──────────────────────────────────────────────────────────────────────────

    const privacyAnalysis = analyzePrivacy(
      selectionResult.selected,
      reportOutputs,
      changeIndex,
    );

    console.error(
      `Privacy Score: ${privacyAnalysis.score}/100 (${privacyAnalysis.risks.length} risks detected)`,
    );

    // ──────────────────────────────────────────────────────────────────────────
    // STEP 9: Build report and write to file
    // ──────────────────────────────────────────────────────────────────────────

    const reportParams: ReportParams = {
      network,
      strategy: selectionResult.strategy,
      selectedInputs: selectionResult.selected,
      outputs: reportOutputs,
      changeIndex,
      feeSats: feeChangeResult.feeSats,
      vbytes: feeChangeResult.vbytes,
      rbfSignaling,
      locktime: nLockTime,
      locktimeType,
      psbtBase64,
      warnings,
      privacyScore: privacyAnalysis.score,
      privacyRisks: privacyAnalysis.risks,
    };

    const report = buildReport(reportParams);

    // Ensure output directory exists
    const outputDir = path.dirname(outputPath);
    await fs.mkdir(outputDir, { recursive: true });

    // Write report to output file
    await fs.writeFile(outputPath, JSON.stringify(report, null, 2), "utf-8");
    console.error(`Wrote output to: ${outputPath}`);

    // Exit with code 0
    process.exit(0);
  } catch (error: unknown) {
    // ──────────────────────────────────────────────────────────────────────────
    // ERROR HANDLING
    // ──────────────────────────────────────────────────────────────────────────

    // Extract error code and message
    let errorCode = "UNKNOWN_ERROR";
    let errorMessage = "An unknown error occurred";

    if (error instanceof Error) {
      errorMessage = error.message;
      // Check if error has a code property
      if ("code" in error && typeof error.code === "string") {
        errorCode = error.code;
      }
    } else if (typeof error === "string") {
      errorMessage = error;
    }

    console.error(`Error: ${errorMessage}`);

    // Build error report
    const errorReport = buildErrorReport(errorCode, errorMessage);

    // Ensure output directory exists
    const outputDir = path.dirname(outputPath);
    await fs.mkdir(outputDir, { recursive: true });

    // Write error report to output file
    await fs.writeFile(
      outputPath,
      JSON.stringify(errorReport, null, 2),
      "utf-8",
    );

    // Exit with code 1
    process.exit(1);
  }
}

// ============================================================================
// CLI ENTRY POINT
// ============================================================================

/**
 * CLI entry point when this file is run directly.
 * Expects: node dist/builder.js <fixturePath> <outputPath>
 */
if (require.main === module) {
  // Check command line arguments
  if (process.argv.length < 4) {
    console.error("Usage: node dist/builder.js <fixturePath> <outputPath>");
    process.exit(1);
  }

  const fixturePath = process.argv[2];
  const outputPath = process.argv[3];

  // Run the transaction builder
  buildTransaction(fixturePath, outputPath).catch((error) => {
    console.error("Unhandled error:", error);
    process.exit(1);
  });
}
