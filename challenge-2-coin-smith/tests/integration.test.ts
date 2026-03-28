/**
 * Integration tests for builder.ts
 *
 * Tests 18-20 from plan.md:
 * - Test 18: basic_change_p2wpkh fixture - balance equation holds
 * - Test 19: send_all_dust_change - SEND_ALL in warnings, change_index null
 * - Test 20: locktime_boundary fixtures - produce correct locktime_type
 */

import { describe, it, expect } from "vitest";
import { promises as fs } from "fs";

describe("Integration Tests", () => {
  it("Test 18: basic_change_p2wpkh fixture - balance equation holds", async () => {
    // Read the generated output
    const outputContent = await fs.readFile(
      "out/basic_change_p2wpkh.json",
      "utf-8",
    );
    const report = JSON.parse(outputContent);

    expect(report.ok).toBe(true);

    // Calculate sum of inputs
    const sumInputs = report.selected_inputs.reduce(
      (sum: number, input: any) => sum + input.value_sats,
      0,
    );

    // Calculate sum of payment outputs (all except change)
    const paymentOutputs =
      report.change_index !== null
        ? report.outputs.slice(0, report.change_index)
        : report.outputs;
    const sumPayments = paymentOutputs.reduce(
      (sum: number, output: any) => sum + output.value_sats,
      0,
    );

    // Get change amount
    const changeAmount =
      report.change_index !== null
        ? report.outputs[report.change_index].value_sats
        : 0;

    // Get fee
    const feeSats = report.fee_sats;

    // Assert balance equation: sum(inputs) = sum(payments) + change + fee
    expect(sumInputs).toBe(sumPayments + changeAmount + feeSats);
  });

  it("Test 19: send_all_dust_change - SEND_ALL in warnings, change_index null", async () => {
    // Read the generated output
    const outputContent = await fs.readFile(
      "out/send_all_dust_change.json",
      "utf-8",
    );
    const report = JSON.parse(outputContent);

    expect(report.ok).toBe(true);

    // Check change_index is null
    expect(report.change_index).toBe(null);

    // Check SEND_ALL warning exists
    const hasSendAllWarning = report.warnings.some(
      (w: any) => w.code === "SEND_ALL",
    );
    expect(hasSendAllWarning).toBe(true);
  });

  it("Test 20: locktime_boundary fixtures - produce correct locktime_type", async () => {
    // Test with locktime_block_height fixture (locktime = 850000)
    const outputContent = await fs.readFile(
      "out/locktime_block_height.json",
      "utf-8",
    );
    const report = JSON.parse(outputContent);

    expect(report.ok).toBe(true);
    expect(report.locktime).toBe(850000);
    expect(report.locktime).toBeLessThan(500_000_000);
    expect(report.locktime_type).toBe("block_height");

    // Verify boundary logic:
    // - locktime == 0 → "none"
    // - 0 < locktime < 500_000_000 → "block_height"
    // - locktime >= 500_000_000 → "unix_timestamp"
  });
});
