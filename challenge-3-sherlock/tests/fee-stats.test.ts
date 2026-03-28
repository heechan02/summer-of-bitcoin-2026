/**
 * Tests for fee rate stats computation edge cases.
 * @module tests/fee-stats
 */

import { describe, it, expect } from "vitest";
import { computeFeeStats, computeFeeStatsFromRates } from "../src/json-builder.js";
import { mockCoinbaseTx, mockSimpleTx } from "./helpers/mock-tx.js";

describe("computeFeeStatsFromRates", () => {
  it("empty array → all 0.0 (guard clause)", () => {
    const stats = computeFeeStatsFromRates([]);
    expect(stats.min_sat_vb).toBe(0.0);
    expect(stats.max_sat_vb).toBe(0.0);
    expect(stats.median_sat_vb).toBe(0.0);
    expect(stats.mean_sat_vb).toBe(0.0);
  });

  it("single value → min === median === max === mean", () => {
    const stats = computeFeeStatsFromRates([10.0]);
    expect(stats.min_sat_vb).toBe(10.0);
    expect(stats.max_sat_vb).toBe(10.0);
    expect(stats.median_sat_vb).toBe(10.0);
    expect(stats.mean_sat_vb).toBe(10.0);
  });

  it("two values → median is average of both", () => {
    const stats = computeFeeStatsFromRates([10.0, 20.0]);
    expect(stats.min_sat_vb).toBe(10.0);
    expect(stats.max_sat_vb).toBe(20.0);
    expect(stats.median_sat_vb).toBe(15.0);
    expect(stats.mean_sat_vb).toBe(15.0);
  });

  it("odd count → median is middle value", () => {
    const stats = computeFeeStatsFromRates([1.0, 2.0, 100.0]);
    expect(stats.median_sat_vb).toBe(2.0);
    expect(stats.min_sat_vb).toBe(1.0);
    expect(stats.max_sat_vb).toBe(100.0);
  });

  it("values rounded to 1 decimal place", () => {
    const stats = computeFeeStatsFromRates([1.05, 2.15, 3.25]);
    // mean = (1.05+2.15+3.25)/3 = 6.45/3 = 2.15
    expect(stats.mean_sat_vb).toBe(2.2); // rounded to 1 decimal
  });

  it("zero fee rate → min = 0.0, not negative", () => {
    const stats = computeFeeStatsFromRates([0, 5.0, 10.0]);
    expect(stats.min_sat_vb).toBe(0.0);
    expect(stats.min_sat_vb).toBeGreaterThanOrEqual(0);
  });

  it("large fee rate handled correctly", () => {
    const stats = computeFeeStatsFromRates([1.0, 800.0]);
    expect(stats.max_sat_vb).toBe(800.0);
    expect(stats.min_sat_vb).toBe(1.0);
  });

  it("invariant: min ≤ median ≤ max for random data", () => {
    const rates = [42.5, 3.1, 100.0, 7.2, 55.0];
    const stats = computeFeeStatsFromRates(rates);
    expect(stats.min_sat_vb).toBeLessThanOrEqual(stats.median_sat_vb);
    expect(stats.median_sat_vb).toBeLessThanOrEqual(stats.max_sat_vb);
  });
});

describe("computeFeeStats (from AnalyzableTx[])", () => {
  it("excludes coinbase transactions", () => {
    const coinbase = mockCoinbaseTx();
    // 1 input (100k), 2 outputs (40k + 50k = 90k) → fee = 10k
    const tx1 = mockSimpleTx(1, 2, { inputValues: [100_000], outputValues: [40_000, 50_000] });
    // 1 input (200k), 2 outputs (80k + 100k = 180k) → fee = 20k
    const tx2 = mockSimpleTx(1, 2, { inputValues: [200_000], outputValues: [80_000, 100_000] });
    // Coinbase fee_rate_sat_vb is 0; it should NOT be included in stats
    const stats = computeFeeStats([coinbase, tx1, tx2]);
    expect(stats.min_sat_vb).toBeGreaterThan(0);
    expect(stats.max_sat_vb).toBeGreaterThan(stats.min_sat_vb);
  });

  it("all-coinbase block → all 0.0", () => {
    const stats = computeFeeStats([mockCoinbaseTx()]);
    expect(stats.min_sat_vb).toBe(0.0);
    expect(stats.max_sat_vb).toBe(0.0);
    expect(stats.median_sat_vb).toBe(0.0);
    expect(stats.mean_sat_vb).toBe(0.0);
  });

  it("single non-coinbase tx → min === max === median === mean", () => {
    const tx = mockSimpleTx(1, 1, { inputValues: [10_000], outputValues: [9_000] });
    const stats = computeFeeStats([mockCoinbaseTx(), tx]);
    expect(stats.min_sat_vb).toBe(stats.max_sat_vb);
    expect(stats.min_sat_vb).toBe(stats.median_sat_vb);
    expect(stats.min_sat_vb).toBe(stats.mean_sat_vb);
    expect(stats.min_sat_vb).toBeGreaterThan(0);
  });
});
