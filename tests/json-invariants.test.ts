/**
 * Tests for json-builder.ts — verifies all 10 grader invariants.
 * @module tests/json-invariants
 */

import { describe, it, expect } from "vitest";
import {
  buildJsonOutput,
  type AnalyzedBlockInput,
  type AnalyzedTxResult,
} from "../src/json-builder.js";
import { ALL_HEURISTIC_IDS } from "../src/heuristics/types.js";
import { mockSimpleTx, mockCoinbaseTx, mockBlockContext } from "./helpers/mock-tx.js";
import { runAllHeuristics, classifyTx } from "../src/heuristics/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a mock AnalyzedBlockInput with N non-coinbase simple txs. */
function makeBlockInput(
  blockIdx: number,
  txCount: number,
  opts?: { flagSome?: boolean },
): AnalyzedBlockInput {
  const coinbase = mockCoinbaseTx();
  const txs = [coinbase];
  for (let i = 0; i < txCount - 1; i++) {
    // Use 6+ inputs to trigger cioh for flagSome
    const tx = opts?.flagSome && i === 0 ? mockSimpleTx(6, 2) : mockSimpleTx(1, 2);
    txs.push(tx);
  }
  const ctx = mockBlockContext(txs);

  const txResults: AnalyzedTxResult[] = txs.map((tx) => {
    const heuristics = runAllHeuristics(tx, ctx);
    const classification = classifyTx(tx, heuristics);
    return { tx, heuristics, classification };
  });

  return {
    block: {
      blockHash: `${"ab".repeat(31)}${blockIdx.toString(16).padStart(2, "0")}`,
      blockHeight: 800000 + blockIdx,
      timestamp: 1700000000 + blockIdx * 600,
      txCount: txs.length,
      txs,
      context: ctx,
    },
    txResults,
  };
}

// ---------------------------------------------------------------------------
// 2-block fixture
// ---------------------------------------------------------------------------

const block0 = makeBlockInput(0, 5, { flagSome: true });
const block1 = makeBlockInput(1, 3);
const output = buildJsonOutput("blk04330.dat", [block0, block1]);

// ---------------------------------------------------------------------------
// Invariant 1: block_count === blocks.length
// ---------------------------------------------------------------------------

describe("Invariant 1: block_count === blocks.length", () => {
  it("matches", () => {
    expect(output.block_count).toBe(output.blocks.length);
  });
});

// ---------------------------------------------------------------------------
// Invariant 2: file total_transactions_analyzed === sum(block tx_count)
// ---------------------------------------------------------------------------

describe("Invariant 2: file total_txs === sum(block tx_count)", () => {
  it("matches", () => {
    const sum = output.blocks.reduce((acc, b) => acc + b.tx_count, 0);
    expect(output.analysis_summary.total_transactions_analyzed).toBe(sum);
  });
});

// ---------------------------------------------------------------------------
// Invariant 3: file flagged === sum(per-block flagged)
// ---------------------------------------------------------------------------

describe("Invariant 3: file flagged === sum(per-block flagged)", () => {
  it("matches", () => {
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
  it("holds for all blocks", () => {
    for (const b of output.blocks) {
      expect(b.analysis_summary.total_transactions_analyzed).toBe(b.tx_count);
    }
  });
});

// ---------------------------------------------------------------------------
// Invariant 5: per-block flagged === actual detected count
// ---------------------------------------------------------------------------

describe("Invariant 5: per-block flagged matches actual detection", () => {
  it("blocks[0] has at least 1 flagged (cioh fires on 6-input tx)", () => {
    const b0 = output.blocks[0]!;
    expect(b0.analysis_summary.flagged_transactions).toBeGreaterThan(0);
  });

  it("flagged count equals transactions with any detected: true", () => {
    const b0 = output.blocks[0]!;
    const actualFlagged = b0.transactions.filter((tx) =>
      Object.values(tx.heuristics).some((h) => h.detected),
    ).length;
    expect(b0.analysis_summary.flagged_transactions).toBe(actualFlagged);
  });
});

// ---------------------------------------------------------------------------
// Invariant 6: fee_rate_stats min ≤ median ≤ max, all ≥ 0
// ---------------------------------------------------------------------------

describe("Invariant 6: fee_rate_stats ordering and non-negativity", () => {
  it("file-level stats are valid", () => {
    const { min_sat_vb, median_sat_vb, max_sat_vb, mean_sat_vb } =
      output.analysis_summary.fee_rate_stats;
    expect(min_sat_vb).toBeGreaterThanOrEqual(0);
    expect(max_sat_vb).toBeGreaterThanOrEqual(0);
    expect(median_sat_vb).toBeGreaterThanOrEqual(0);
    expect(mean_sat_vb).toBeGreaterThanOrEqual(0);
    expect(min_sat_vb).toBeLessThanOrEqual(median_sat_vb);
    expect(median_sat_vb).toBeLessThanOrEqual(max_sat_vb);
  });

  it("per-block stats are valid", () => {
    for (const b of output.blocks) {
      const { min_sat_vb, median_sat_vb, max_sat_vb } = b.analysis_summary.fee_rate_stats;
      expect(min_sat_vb).toBeLessThanOrEqual(median_sat_vb);
      expect(median_sat_vb).toBeLessThanOrEqual(max_sat_vb);
    }
  });
});

// ---------------------------------------------------------------------------
// Invariant 7: heuristics_applied ≥5 IDs including cioh + change_detection
// ---------------------------------------------------------------------------

describe("Invariant 7: heuristics_applied completeness", () => {
  it("has all 9 heuristic IDs", () => {
    const applied = output.analysis_summary.heuristics_applied;
    expect(applied.length).toBeGreaterThanOrEqual(5);
    expect(applied).toContain("cioh");
    expect(applied).toContain("change_detection");
    for (const id of ALL_HEURISTIC_IDS) {
      expect(applied).toContain(id);
    }
  });

  it("per-block heuristics_applied matches", () => {
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
  it("matches", () => {
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
// Invariant 9: every tx has all 9 heuristic keys with detected boolean
// ---------------------------------------------------------------------------

describe("Invariant 9: every tx has all 9 heuristic keys", () => {
  it("all transactions in blocks[0] have all 9 keys", () => {
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

const VALID_CLASSIFICATIONS = new Set([
  "simple_payment",
  "consolidation",
  "coinjoin",
  "self_transfer",
  "batch_payment",
  "unknown",
]);

describe("Invariant 10: classification is a valid enum value", () => {
  it("all transactions have valid classification", () => {
    const b0 = output.blocks[0]!;
    for (const tx of b0.transactions) {
      expect(VALID_CLASSIFICATIONS.has(tx.classification)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Additional: coinbase handling
// ---------------------------------------------------------------------------

describe("Coinbase tx handling", () => {
  it("coinbase is at index 0 in blocks[0].transactions", () => {
    const b0 = output.blocks[0]!;
    const coinbaseTx = b0.transactions[0]!;
    for (const id of ALL_HEURISTIC_IDS) {
      expect(coinbaseTx.heuristics[id].detected).toBe(false);
    }
    expect(coinbaseTx.classification).toBe("unknown");
  });
});

// ---------------------------------------------------------------------------
// Additional: output schema fields
// ---------------------------------------------------------------------------

describe("Output schema structure", () => {
  it("has ok: true and mode: chain_analysis", () => {
    expect(output.ok).toBe(true);
    expect(output.mode).toBe("chain_analysis");
  });

  it("file field matches input", () => {
    expect(output.file).toBe("blk04330.dat");
  });
});
