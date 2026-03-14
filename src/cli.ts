/**
 * cli.ts — CLI entry point for Sherlock Bitcoin chain analysis engine.
 *
 * Usage: npx tsx src/cli.ts --block <blk.dat> <rev.dat> <xor.dat>
 *
 * Flow:
 *   1. Attach global crash handlers (uncaughtException + unhandledRejection)
 *   2. Ensure out/ directory exists
 *   3. Parse + validate CLI arguments
 *   4. Validate all 3 input files exist
 *   5. analyzeBlockFile() → AnalyzedBlock[]
 *   6. For each block:
 *      a. runAllHeuristics() on each tx in block.txs
 *      b. classifyTx() for each tx
 *      c. Compute per-block summary (flagged, script types, fee stats)
 *      d. For blocks[1+]: drop txs from memory (set block.txs = [])
 *   7. buildJsonOutput() → SherlockJsonOutput
 *   8. buildMarkdownReport() → string
 *   9. Write out/<stem>.json and out/<stem>.md
 *  10. Log success to stderr, exit 0
 *
 * On any error: write { ok: false, error: { code, message } } to stdout, exit 1.
 *
 * @module cli
 */

import * as fs from "fs";
import * as path from "path";
import { analyzeBlockFile } from "./chain-analyzer.js";
import { runAllHeuristics, classifyTx } from "./heuristics/index.js";
import {
  buildJsonOutput,
  buildErrorOutput,
  computeFeeStats,
} from "./json-builder.js";
import { buildMarkdownReport } from "./report-gen.js";
import type { AnalyzedBlock } from "./chain-analyzer.js";
import type { AnalyzedBlockInput, AnalyzedTxResult, BlockAnalysisSummary } from "./json-builder.js";
import type { TxHeuristicResults } from "./heuristics/index.js";
import type { AnalyzableTx } from "./heuristics/types.js";
import { ALL_HEURISTIC_IDS } from "./heuristics/types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Expected argument structure for --block mode. */
const BLOCK_MODE_FLAG = "--block";

/** Number of file arguments required after --block flag. */
const BLOCK_MODE_FILE_COUNT = 3;

/** Output directory for JSON and Markdown reports. */
const OUT_DIR = "out";

// ---------------------------------------------------------------------------
// Global crash handlers (must be first)
// ---------------------------------------------------------------------------

/**
 * Emit a structured JSON error to stdout and exit with code 1.
 * Used by crash handlers and the main try/catch.
 *
 * @param code    - Error code string (INVALID_ARGS, FILE_NOT_FOUND, PARSE_ERROR, ANALYSIS_ERROR).
 * @param message - Human-readable error description.
 */
function fatalError(code: string, message: string): never {
  process.stdout.write(
    JSON.stringify(buildErrorOutput(code, message), null, 2) + "\n",
  );
  process.exit(1);
}

process.on("uncaughtException", (err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  fatalError("PARSE_ERROR", `Uncaught exception: ${message}`);
});

process.on("unhandledRejection", (reason: unknown) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  fatalError("ANALYSIS_ERROR", `Unhandled rejection: ${message}`);
});

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

/**
 * Parse and validate CLI arguments.
 * Expects: --block <blk.dat> <rev.dat> <xor.dat>
 *
 * @param argv - process.argv slice (starting after "node" and script).
 * @returns Parsed paths for blk, rev, and xor files.
 */
function parseArgs(argv: string[]): {
  blkPath: string;
  revPath: string;
  xorPath: string;
} {
  const blockFlagIdx = argv.indexOf(BLOCK_MODE_FLAG);
  if (blockFlagIdx === -1) {
    fatalError(
      "INVALID_ARGS",
      `Missing required flag: ${BLOCK_MODE_FLAG}. Usage: cli.ts --block <blk.dat> <rev.dat> <xor.dat>`,
    );
  }

  const fileArgs = argv.slice(blockFlagIdx + 1);
  if (fileArgs.length < BLOCK_MODE_FILE_COUNT) {
    fatalError(
      "INVALID_ARGS",
      `Expected ${BLOCK_MODE_FILE_COUNT} file arguments after ${BLOCK_MODE_FLAG}, got ${fileArgs.length}`,
    );
  }

  // Safe non-null assertions: we just confirmed fileArgs.length >= 3
  const blkPath = fileArgs[0] as string;
  const revPath = fileArgs[1] as string;
  const xorPath = fileArgs[2] as string;

  return { blkPath, revPath, xorPath };
}

/**
 * Validate that all required input files exist on disk.
 *
 * @param paths - Object with blkPath, revPath, xorPath.
 */
function validateFiles(paths: {
  blkPath: string;
  revPath: string;
  xorPath: string;
}): void {
  for (const [name, filePath] of Object.entries(paths)) {
    if (!fs.existsSync(filePath)) {
      fatalError(
        "FILE_NOT_FOUND",
        `Input file not found: ${filePath} (${name})`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Per-block analysis helpers
// ---------------------------------------------------------------------------

/**
 * Run all heuristics and classify every tx in a block.
 * Computes flagged count, script type distribution, and fee rate stats.
 *
 * @param block - AnalyzedBlock with txs[] populated.
 * @returns Pre-computed summary + aligned txResults array.
 */
function analyzeBlock(block: AnalyzedBlock): {
  txResults: TxHeuristicResults[];
  summary: BlockAnalysisSummary;
} {
  const txResults: TxHeuristicResults[] = [];
  const scriptTypeCounts: Record<string, number> = {};
  let flaggedCount = 0;

  for (const tx of block.txs) {
    const results = runAllHeuristics(tx, block.context);
    txResults.push(results);

    // Count flagged (any heuristic detected: true)
    const isFlagged = ALL_HEURISTIC_IDS.some((id) => results[id].detected);
    if (isFlagged) {
      flaggedCount++;
    }

    // Accumulate script type distribution from outputs
    for (const output of tx.outputs) {
      const st = output.script_type;
      scriptTypeCounts[st] = (scriptTypeCounts[st] ?? 0) + 1;
    }
  }

  // Sort script type distribution keys deterministically
  const sortedScriptTypes: Record<string, number> = {};
  for (const key of Object.keys(scriptTypeCounts).sort()) {
    sortedScriptTypes[key] = scriptTypeCounts[key] as number;
  }

  const feeStats = computeFeeStats(block.txs);

  const summary: BlockAnalysisSummary = {
    total_transactions_analyzed: block.txCount,
    heuristics_applied: ALL_HEURISTIC_IDS,
    flagged_transactions: flaggedCount,
    script_type_distribution: sortedScriptTypes,
    fee_rate_stats: feeStats,
  };

  return { txResults, summary };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Main CLI logic: parse args, analyze block file, write outputs.
 */
function main(): void {
  // Ensure out/ directory exists
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // Parse and validate arguments
  const args = parseArgs(process.argv.slice(2));
  validateFiles(args);

  const { blkPath, revPath, xorPath } = args;

  // Extract stem from blk filename (e.g. "blk04330.dat" → "blk04330")
  const blkBasename = path.basename(blkPath);
  const blkStem = blkBasename.replace(/\.dat$/i, "");
  const jsonOutPath = path.join(OUT_DIR, `${blkStem}.json`);
  const mdOutPath = path.join(OUT_DIR, `${blkStem}.md`);

  console.error(`[cli] Analyzing ${blkBasename}...`);

  // Step 5: Parse raw block files → AnalyzedBlock[]
  let analyzedBlocks: AnalyzedBlock[];
  try {
    analyzedBlocks = analyzeBlockFile(blkPath, revPath, xorPath);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    fatalError("PARSE_ERROR", `Failed to parse block file: ${msg}`);
  }

  if (analyzedBlocks.length === 0) {
    fatalError("PARSE_ERROR", "No valid blocks found in the provided block file.");
  }

  console.error(`[cli] Found ${analyzedBlocks.length} block(s).`);

  // Step 6: Per-block heuristic analysis
  // txResults kept for blocks[0] (needed by json-builder to emit transactions[])
  // For blocks[1+]: drop txs from memory after computing summary
  const blockInputs: AnalyzedBlockInput[] = [];

  for (let i = 0; i < analyzedBlocks.length; i++) {
    // Confirmed defined: i < analyzedBlocks.length
    const block = analyzedBlocks[i] as AnalyzedBlock;

    console.error(`[cli] Block ${i}: height=${block.blockHeight}, txs=${block.txCount}`);

    const { txResults, summary } = analyzeBlock(block);

    if (i === 0) {
      // blocks[0]: keep full txResults — json-builder needs them for transactions[]
      const txResultObjects: AnalyzedTxResult[] = txResults.map((heuristics, idx) => {
        const tx = block.txs[idx] as AnalyzableTx;
        return {
          tx,
          heuristics,
          classification: classifyTx(tx, heuristics),
        };
      });

      blockInputs.push({
        block,
        txResults: txResultObjects,
      });
    } else {
      // blocks[1+]: memory-efficient path — drop txs after summary is computed
      block.txs = [];

      blockInputs.push({
        block,
        txResults: [],
        precomputedSummary: summary,
      });
    }
  }

  // Step 7: Build JSON output
  console.error(`[cli] Building JSON output...`);
  const jsonOutput = buildJsonOutput(blkBasename, blockInputs);

  // Step 8: Build Markdown report
  console.error(`[cli] Building Markdown report...`);
  const mdReport = buildMarkdownReport(blkBasename, blockInputs);

  // Step 9: Write output files
  fs.writeFileSync(jsonOutPath, JSON.stringify(jsonOutput, null, 2));
  console.error(`[cli] Written: ${jsonOutPath}`);

  fs.writeFileSync(mdOutPath, mdReport);
  console.error(`[cli] Written: ${mdOutPath}`);

  console.error(`[cli] Done. Blocks: ${jsonOutput.block_count}, Txs: ${jsonOutput.analysis_summary.total_transactions_analyzed}, Flagged: ${jsonOutput.analysis_summary.flagged_transactions}`);
}

try {
  main();
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  fatalError("ANALYSIS_ERROR", message);
}
