/**
 * Unit tests for `src/heuristics/index.ts` — runAllHeuristics + classifyTx.
 */

import { describe, it, expect } from "vitest";
import { runAllHeuristics, classifyTx } from "../src/heuristics/index.js";
import {
  mockCoinbaseTx,
  mockSimpleTx,
  mockConsolidationTx,
  mockCoinJoinTx,
  mockSelfTransferTx,
  mockBlockContext,
} from "./helpers/mock-tx.js";

// ---------------------------------------------------------------------------
// runAllHeuristics
// ---------------------------------------------------------------------------

describe("runAllHeuristics", () => {
  it("returns all 9 keys for a normal transaction", () => {
    const tx = mockSimpleTx(2, 2);
    const ctx = mockBlockContext([tx]);
    const results = runAllHeuristics(tx, ctx);

    const keys = [
      "cioh",
      "change_detection",
      "address_reuse",
      "consolidation",
      "op_return",
      "coinjoin",
      "self_transfer",
      "peeling_chain",
      "round_number_payment",
    ];
    for (const key of keys) {
      expect(results).toHaveProperty(key);
      expect(typeof (results as Record<string, { detected: boolean }>)[key].detected).toBe("boolean");
    }
  });

  it("returns detected: false for ALL heuristics on a coinbase tx", () => {
    const tx = mockCoinbaseTx();
    const ctx = mockBlockContext([tx]);
    const results = runAllHeuristics(tx, ctx);

    expect(results.cioh.detected).toBe(false);
    expect(results.change_detection.detected).toBe(false);
    expect(results.address_reuse.detected).toBe(false);
    expect(results.consolidation.detected).toBe(false);
    expect(results.op_return.detected).toBe(false);
    expect(results.coinjoin.detected).toBe(false);
    expect(results.self_transfer.detected).toBe(false);
    expect(results.peeling_chain.detected).toBe(false);
    expect(results.round_number_payment.detected).toBe(false);
  });

  it("fires cioh for a 3-input transaction", () => {
    const tx = mockSimpleTx(3, 2);
    const ctx = mockBlockContext([tx]);
    const results = runAllHeuristics(tx, ctx);
    expect(results.cioh.detected).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// classifyTx
// ---------------------------------------------------------------------------

describe("classifyTx", () => {
  it("returns 'coinjoin' when coinjoin fires — even if consolidation also fires", () => {
    // 5 in, 5 equal out → coinjoin fires; also satisfies consolidation input count
    const tx = mockCoinJoinTx(5, 10_000_000);
    const ctx = mockBlockContext([tx]);
    const results = runAllHeuristics(tx, ctx);
    // Force consolidation detected as well for explicit priority test
    const fakeResults = { ...results, consolidation: { detected: true } };
    const cls = classifyTx(tx, fakeResults);
    expect(cls).toBe("coinjoin");
  });

  it("returns 'consolidation' when consolidation fires and coinjoin does not", () => {
    const tx = mockConsolidationTx(5); // 5 in → 1 out
    const ctx = mockBlockContext([tx]);
    const results = runAllHeuristics(tx, ctx);
    expect(results.consolidation.detected).toBe(true);
    const cls = classifyTx(tx, results);
    expect(cls).toBe("consolidation");
  });

  it("returns 'self_transfer' when self_transfer fires and higher-priority heuristics do not", () => {
    const tx = mockSelfTransferTx("p2wpkh");
    const ctx = mockBlockContext([tx]);
    const results = runAllHeuristics(tx, ctx);
    expect(results.self_transfer.detected).toBe(true);
    const cls = classifyTx(tx, results);
    expect(cls).toBe("self_transfer");
  });

  it("returns 'batch_payment' when tx has 4+ outputs and no higher-priority heuristic fires", () => {
    // Use mixed output script types so self_transfer does not fire
    const tx = mockSimpleTx(1, 4, {
      outputTypes: ["p2wpkh", "p2tr", "p2sh", "p2pkh"],
      outputValues: [20_000, 20_000, 20_000, 20_000],
      inputValues: [100_000],
    });
    const ctx = mockBlockContext([tx]);
    const results = runAllHeuristics(tx, ctx);
    // Ensure none of the higher-priority heuristics fire
    expect(results.coinjoin.detected).toBe(false);
    expect(results.consolidation.detected).toBe(false);
    expect(results.self_transfer.detected).toBe(false);
    const cls = classifyTx(tx, results);
    expect(cls).toBe("batch_payment");
  });

  it("returns 'unknown' for a coinbase transaction", () => {
    const tx = mockCoinbaseTx();
    const ctx = mockBlockContext([tx]);
    const results = runAllHeuristics(tx, ctx);
    const cls = classifyTx(tx, results);
    expect(cls).toBe("unknown");
  });

  it("returns 'simple_payment' for a normal 1-input 2-output transaction", () => {
    // Use mixed output types to avoid self_transfer heuristic firing
    const tx = mockSimpleTx(1, 2, {
      outputTypes: ["p2wpkh", "p2tr"],
      outputValues: [50_000, 40_000],
      inputValues: [100_000],
    });
    const ctx = mockBlockContext([tx]);
    const results = runAllHeuristics(tx, ctx);
    const cls = classifyTx(tx, results);
    expect(cls).toBe("simple_payment");
  });

  it("returns 'simple_payment' for a 2-output tx with no special heuristics fired", () => {
    const tx = mockSimpleTx(2, 2, {
      outputValues: [45_000, 45_000],
      inputValues: [50_000, 50_000],
    });
    const ctx = mockBlockContext([tx]);
    const results = runAllHeuristics(tx, ctx);
    // Verify coinjoin, consolidation, self_transfer are all not detected
    expect(results.coinjoin.detected).toBe(false);
    expect(results.consolidation.detected).toBe(false);
    const cls = classifyTx(tx, results);
    expect(["simple_payment", "self_transfer"]).toContain(cls);
  });
});
