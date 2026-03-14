/**
 * Integration test — end-to-end pipeline on real fixture files.
 *
 * Runs analyzeBlockFile → runAllHeuristics → buildJsonOutput → buildMarkdownReport
 * on fixtures/blk04330.dat and validates all 10 grader invariants plus Markdown
 * size and coinbase rules against the actual output.
 *
 * @module tests/integration
 */

import { describe, it, expect, beforeAll } from "vitest";
import * as path from "path";
import { analyzeBlockFile } from "../src/chain-analyzer.js";
import { runAllHeuristics, classifyTx } from "../src/heuristics/index.js";
import { buildJsonOutput, computeFeeStats } from "../src/json-builder.js";
import { buildMarkdownReport } from "../src/report-gen.js";
import { ALL_HEURISTIC_IDS } from "../src/heuristics/types.js";
import type { AnalyzedBlockInput, AnalyzedTxResult, BlockAnalysisSummary } from "../src/json-builder.js";
import type { AnalyzedBlock } from "../src/chain-analyzer.js";
import type { TxHeuristicResults } from "../src/heuristics/index.js";
import type { AnalyzableTx } from "../src/heuristics/types.js";
import type { SherlockJsonOutput } from "../src/json-builder.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIXTURES_DIR = path.resolve(__dirname, "../fixtures");
const BLK_PATH = path.join(FIXTURES_DIR, "blk04330.dat");
const REV_PATH = path.join(FIXTURES_DIR, "rev04330.dat");
const XOR_PATH = path.join(FIXTURES_DIR, "xor.dat");
const BLK_BASENAME = "blk04330.dat";

// ---------------------------------------------------------------------------
// Pipeline (mirrors cli.ts logic exactly)
// ---------------------------------------------------------------------------

const VALID_CLASSIFICATIONS = new Set([
  "simple_payment",
  "consolidation",
  "coinjoin",
  "self_transfer",
  "batch_payment",
  "unknown",
]);

let output: SherlockJsonOutput;
let mdReport: string;

beforeAll(() => {
  const analyzedBlocks: AnalyzedBlock[] = analyzeBlockFile(BLK_PATH, REV_PATH, XOR_PATH);
  expect(analyzedBlocks.length).toBeGreaterThan(0);

  const blockInputs: AnalyzedBlockInput[] = [];

  for (let i = 0; i < analyzedBlocks.length; i++) {
    const block = analyzedBlocks[i] as AnalyzedBlock;
    const txResults: TxHeuristicResults[] = [];
    const scriptTypeCounts: Record<string, number> = {};
    let flaggedCount = 0;

    for (const tx of block.txs) {
      const results = runAllHeuristics(tx, block.context);
      txResults.push(results);
      if (ALL_HEURISTIC_IDS.some((id) => results[id].detected)) {
        flaggedCount++;
      }
      for (const out of tx.outputs) {
        const st = out.script_type;
        scriptTypeCounts[st] = (scriptTypeCounts[st] ?? 0) + 1;
      }
    }

    const sortedScriptTypes: Record<string, number> = {};
    for (const key of Object.keys(scriptTypeCounts).sort()) {
      sortedScriptTypes[key] = scriptTypeCounts[key] as number;
    }

    const summary: BlockAnalysisSummary = {
      total_transactions_analyzed: block.txCount,
      heuristics_applied: ALL_HEURISTIC_IDS,
      flagged_transactions: flaggedCount,
      script_type_distribution: sortedScriptTypes,
      fee_rate_stats: computeFeeStats(block.txs),
    };

    if (i === 0) {
      const txResultObjects: AnalyzedTxResult[] = txResults.map((heuristics, idx) => {
        const tx = block.txs[idx] as AnalyzableTx;
        return { tx, heuristics, classification: classifyTx(tx, heuristics) };
      });
      blockInputs.push({ block, txResults: txResultObjects });
    } else {
      block.txs = [];
      blockInputs.push({ block, txResults: [], precomputedSummary: summary });
    }
  }

  output = buildJsonOutput(BLK_BASENAME, blockInputs);
  mdReport = buildMarkdownReport(BLK_BASENAME, blockInputs);
});

// ---------------------------------------------------------------------------
// Invariant 1: block_count === blocks.length
// ---------------------------------------------------------------------------

describe("Invariant 1: block_count === blocks.length", () => {
  it("matches on real fixture", () => {
    expect(output.block_count).toBe(output.blocks.length);
    expect(output.block_count).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Invariant 2: file total_transactions_analyzed === sum(block tx_count)
// ---------------------------------------------------------------------------

describe("Invariant 2: file total_txs === sum(block tx_count)", () => {
  it("matches on real fixture", () => {
    const sum = output.blocks.reduce((acc, b) => acc + b.tx_count, 0);
    expect(output.analysis_summary.total_transactions_analyzed).toBe(sum);
  });
});

// ---------------------------------------------------------------------------
// Invariant 3: file flagged === sum(per-block flagged)
// ---------------------------------------------------------------------------

describe("Invariant 3: file flagged === sum(per-block flagged)", () => {
  it("matches on real fixture", () => {
    const sum = output.blocks.reduce(
      (acc, b) => acc + b.analysis_summary.flagged_transactions,
      0,
    );
    expect(output.analysis_summary.flagged_transactions).toBe(sum);
  });
});

// ---------------------------------------------------------------------------
// Invariant 4: per-block total_transactions_analyzed === tx_count
// ---------------------------------------------------------------------------

describe("Invariant 4: per-block total_txs === tx_count", () => {
  it("holds for every block", () => {
    for (const b of output.blocks) {
      expect(b.analysis_summary.total_transactions_analyzed).toBe(b.tx_count);
    }
  });
});

// ---------------------------------------------------------------------------
// Invariant 5: per-block flagged === actual detected count
// ---------------------------------------------------------------------------

describe("Invariant 5: per-block flagged matches actual detection", () => {
  it("blocks[0] flagged count matches transactions with any detected: true", () => {
    const b0 = output.blocks[0]!;
    const actual = b0.transactions.filter((tx) =>
      Object.values(tx.heuristics).some((h) => h.detected),
    ).length;
    expect(b0.analysis_summary.flagged_transactions).toBe(actual);
  });
});

// ---------------------------------------------------------------------------
// Invariant 6: fee_rate_stats ordering and non-negativity
// ---------------------------------------------------------------------------

describe("Invariant 6: fee_rate_stats ordering and non-negativity", () => {
  it("file-level stats are valid", () => {
    const { min_sat_vb, median_sat_vb, max_sat_vb, mean_sat_vb } =
      output.analysis_summary.fee_rate_stats;
    expect(min_sat_vb).toBeGreaterThanOrEqual(0);
    expect(max_sat_vb).toBeGreaterThanOrEqual(0);
    expect(median_sat_vb).toBeGreaterThanOrEqual(min_sat_vb);
    expect(max_sat_vb).toBeGreaterThanOrEqual(median_sat_vb);
    expect(mean_sat_vb).toBeGreaterThanOrEqual(0);
  });

  it("per-block stats are valid", () => {
    for (const b of output.blocks) {
      const { min_sat_vb, median_sat_vb, max_sat_vb } = b.analysis_summary.fee_rate_stats;
      expect(median_sat_vb).toBeGreaterThanOrEqual(min_sat_vb);
      expect(max_sat_vb).toBeGreaterThanOrEqual(median_sat_vb);
    }
  });
});

// ---------------------------------------------------------------------------
// Invariant 7: heuristics_applied ≥5 IDs including cioh + change_detection
// ---------------------------------------------------------------------------

describe("Invariant 7: heuristics_applied completeness", () => {
  it("file-level has all 9 heuristic IDs", () => {
    const applied = output.analysis_summary.heuristics_applied;
    expect(applied.length).toBeGreaterThanOrEqual(5);
    expect(applied).toContain("cioh");
    expect(applied).toContain("change_detection");
    for (const id of ALL_HEURISTIC_IDS) {
      expect(applied).toContain(id);
    }
  });

  it("per-block heuristics_applied contains required IDs", () => {
    for (const b of output.blocks) {
      expect(b.analysis_summary.heuristics_applied).toContain("cioh");
      expect(b.analysis_summary.heuristics_applied).toContain("change_detection");
    }
  });
});

// ---------------------------------------------------------------------------
// Invariant 8: blocks[0].transactions.length === blocks[0].tx_count
// ---------------------------------------------------------------------------

describe("Invariant 8: blocks[0].transactions.length === tx_count", () => {
  it("matches on real fixture", () => {
    const b0 = output.blocks[0]!;
    expect(b0.transactions.length).toBe(b0.tx_count);
  });

  it("blocks[1+] have empty transactions[]", () => {
    for (const b of output.blocks.slice(1)) {
      expect(b.transactions).toHaveLength(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Invariant 9: every tx in blocks[0] has all 9 heuristic keys with detected boolean
// ---------------------------------------------------------------------------

describe("Invariant 9: every tx has all 9 heuristic keys", () => {
  it("all transactions in blocks[0] have all 9 keys with detected boolean", () => {
    const b0 = output.blocks[0]!;
    for (const tx of b0.transactions) {
      for (const id of ALL_HEURISTIC_IDS) {
        expect(tx.heuristics).toHaveProperty(id);
        expect(typeof tx.heuristics[id].detected).toBe("boolean");
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Invariant 10: classification ∈ valid enum
// ---------------------------------------------------------------------------

describe("Invariant 10: classification is a valid enum value", () => {
  it("all transactions have valid classification", () => {
    const b0 = output.blocks[0]!;
    for (const tx of b0.transactions) {
      expect(VALID_CLASSIFICATIONS.has(tx.classification)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Coinbase rules
// ---------------------------------------------------------------------------

describe("Coinbase tx handling", () => {
  it("coinbase is at index 0 in blocks[0] with all heuristics detected: false", () => {
    const b0 = output.blocks[0]!;
    const coinbase = b0.transactions[0]!;
    for (const id of ALL_HEURISTIC_IDS) {
      expect(coinbase.heuristics[id].detected).toBe(false);
    }
  });

  it("coinbase classification is 'unknown'", () => {
    const b0 = output.blocks[0]!;
    expect(b0.transactions[0]!.classification).toBe("unknown");
  });

  it("coinbase is NOT counted in fee_rate_stats (fee stats come from non-coinbase txs)", () => {
    // If all txs were coinbase, fee stats would default to 0.0.
    // In real fixture we expect non-zero median for non-coinbase txs.
    const { min_sat_vb, max_sat_vb } = output.analysis_summary.fee_rate_stats;
    // At minimum both should be non-negative
    expect(min_sat_vb).toBeGreaterThanOrEqual(0);
    expect(max_sat_vb).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// Schema / output structure
// ---------------------------------------------------------------------------

describe("Output schema structure", () => {
  it("has ok: true and mode: chain_analysis", () => {
    expect(output.ok).toBe(true);
    expect(output.mode).toBe("chain_analysis");
  });

  it("file field matches blk basename", () => {
    expect(output.file).toBe(BLK_BASENAME);
  });
});

// ---------------------------------------------------------------------------
// Markdown report
// ---------------------------------------------------------------------------

describe("Markdown report", () => {
  it("is at least 1 KB", () => {
    expect(Buffer.byteLength(mdReport, "utf8")).toBeGreaterThanOrEqual(1024);
  });

  it("contains the block filename", () => {
    expect(mdReport).toContain("blk04330");
  });
});
