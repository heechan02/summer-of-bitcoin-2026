/**
 * server.ts — The Coin Smith's Forge Web Server
 *
 * Purpose: Serve the interactive web UI and provide REST API for PSBT building
 *
 * Endpoints:
 * - GET /api/health → Health check
 * - POST /api/build → Build PSBT from fixture JSON
 * - GET / → Serve web UI
 */

// ============================================================================
// IMPORTS
// ============================================================================

import express from "express";
import type { Request, Response } from "express";
import * as path from "path";

import { parseFixture } from "./parser.js";
import type { Fixture } from "./parser.js";

import { selectCoins } from "./selector.js";
import { resolveFeeAndChange } from "./feeChange.js";
import { computeLocktime, computeSequence, classifyLocktime } from "./sequences.js";
import { buildPsbt } from "./psbt.js";
import type { OutputSpec } from "./psbt.js";
import { computeWarnings } from "./warnings.js";
import { buildReport, buildErrorReport } from "./reporter.js";
import type { ReportParams, ReportOutput } from "./reporter.js";

// ============================================================================
// CONSTANTS
// ============================================================================

const PORT = parseInt(process.env.PORT || "3000", 10);

// ============================================================================
// SERVER SETUP
// ============================================================================

const app = express();

// Middleware
app.use(express.json({ limit: "10mb" }));
app.use(express.static(path.join(__dirname, "../public")));
app.use("/fixtures", express.static(path.join(__dirname, "../fixtures")));

// ============================================================================
// API ENDPOINTS
// ============================================================================

/**
 * GET /api/health
 *
 * Health check endpoint required by grading infrastructure.
 */
app.get("/api/health", (_req: Request, res: Response) => {
  res.status(200).json({ ok: true });
});

/**
 * POST /api/build
 *
 * Build a PSBT transaction from a fixture JSON.
 *
 * Request body: Fixture JSON (same format as CLI input files)
 * Response: Report JSON (same format as CLI output)
 */
app.post("/api/build", async (req: Request, res: Response) => {
  try {
    // ──────────────────────────────────────────────────────────────────────────
    // STEP 1: Parse and validate fixture
    // ──────────────────────────────────────────────────────────────────────────

    const rawJson = req.body;
    const fixture: Fixture = parseFixture(rawJson);

    const {
      network,
      utxos,
      payments,
      change,
      fee_rate_sat_vb,
      policy,
    } = fixture;

    const rbf = fixture.rbf ?? false;
    const explicitLocktime = fixture.locktime;
    const currentHeight = fixture.current_height;

    // ──────────────────────────────────────────────────────────────────────────
    // STEP 2: Select coins
    // ──────────────────────────────────────────────────────────────────────────

    const { selected, strategy } = selectCoins(
      utxos,
      payments,
      fee_rate_sat_vb,
      change.script_type,
      policy,
    );

    console.error(`Selected ${selected.length} UTXOs using ${strategy} strategy`);

    // ──────────────────────────────────────────────────────────────────────────
    // STEP 3: Resolve fee and change (two-pass algorithm)
    // ──────────────────────────────────────────────────────────────────────────

    const { feeSats, changeAmount, vbytes } = resolveFeeAndChange(
      selected,
      payments,
      change.script_type,
      fee_rate_sat_vb,
    );

    console.error(`Fee: ${feeSats} sats, Change: ${changeAmount ?? "none"}, Vbytes: ${vbytes}`);

    // ──────────────────────────────────────────────────────────────────────────
    // STEP 5: Compute nLockTime and nSequence
    // ──────────────────────────────────────────────────────────────────────────

    const nLockTime = computeLocktime(rbf, explicitLocktime, currentHeight);
    const nSequence = computeSequence(rbf, nLockTime);
    const locktimeType = classifyLocktime(nLockTime);

    console.error(`nLockTime: ${nLockTime}, nSequence: 0x${nSequence.toString(16)}`);

    // ──────────────────────────────────────────────────────────────────────────
    // STEP 6: Assemble outputs for PSBT (with is_change flag)
    // ──────────────────────────────────────────────────────────────────────────

    const psbtOutputs: OutputSpec[] = payments.map((p) => ({
      value_sats: p.value_sats,
      script_pubkey_hex: p.script_pubkey_hex,
      is_change: false,
    }));

    let changeIndex: number | null = null;

    if (changeAmount !== null) {
      changeIndex = psbtOutputs.length;
      psbtOutputs.push({
        value_sats: changeAmount,
        script_pubkey_hex: change.script_pubkey_hex,
        is_change: true,
      });
    }

    // ──────────────────────────────────────────────────────────────────────────
    // STEP 7: Build PSBT
    // ──────────────────────────────────────────────────────────────────────────

    const psbtBase64 = buildPsbt(
      network,
      selected,
      psbtOutputs,
      nLockTime,
      nSequence,
    );

    console.error("PSBT built successfully");

    // ──────────────────────────────────────────────────────────────────────────
    // STEP 8: Compute warnings
    // ──────────────────────────────────────────────────────────────────────────

    const actualFeeRate = feeSats / vbytes;
    const rbfSignaling = nSequence <= 0xfffffffd;

    const warnings = computeWarnings({
      feeSats,
      feeRateSatVb: actualFeeRate,
      changeAmount,
      rbfSignaling,
    });

    // ──────────────────────────────────────────────────────────────────────────
    // STEP 9: Assemble outputs for report (with script_type)
    // ──────────────────────────────────────────────────────────────────────────

    const reportOutputs: ReportOutput[] = payments.map((p) => ({
      value_sats: p.value_sats,
      script_pubkey_hex: p.script_pubkey_hex,
      script_type: p.script_type,
      is_change: false,
    }));

    if (changeAmount !== null) {
      reportOutputs.push({
        value_sats: changeAmount,
        script_pubkey_hex: change.script_pubkey_hex,
        script_type: change.script_type,
        is_change: true,
      });
    }

    // ──────────────────────────────────────────────────────────────────────────
    // STEP 10: Build report
    // ──────────────────────────────────────────────────────────────────────────

    const reportParams: ReportParams = {
      network,
      strategy,
      selectedInputs: selected,
      outputs: reportOutputs,
      changeIndex,
      feeSats,
      vbytes,
      rbfSignaling,
      locktime: nLockTime,
      locktimeType,
      psbtBase64,
      warnings,
    };

    const report = buildReport(reportParams);

    // ──────────────────────────────────────────────────────────────────────────
    // STEP 11: Return response
    // ──────────────────────────────────────────────────────────────────────────

    res.status(200).json(report);

  } catch (error: any) {
    console.error("Error building transaction:", error.message);

    // Build error report
    const errorReport = buildErrorReport(
      error.code || "BUILD_ERROR",
      error.message || "Unknown error occurred",
    );

    res.status(400).json(errorReport);
  }
});

// ============================================================================
// START SERVER
// ============================================================================

app.listen(PORT, () => {
  // Print URL to stdout (required by web.sh specification)
  console.log(`http://127.0.0.1:${PORT}`);

  // Log to stderr
  console.error(`🔥 The Coin Smith's Forge is burning at http://127.0.0.1:${PORT}`);
  console.error(`Press Ctrl+C to extinguish the flames`);
});
