import { describe, it, expect } from "vitest";
import { selectCoins } from "../src/selector.js";
import type { Utxo, Payment } from "../src/parser.js";

describe("selector.ts", () => {
  /**
   * Test 7: Greedy picks fewest coins to cover target
   *
   * Verifies that greedy strategy:
   * - Selects UTXOs in descending order by value
   * - Stops when target + fee is covered
   * - Returns "greedy" strategy
   */
  it("should select coins using greedy strategy (largest-first)", () => {
    // Setup: Multiple UTXOs of different sizes
    const utxos: Utxo[] = [
      {
        txid: "a".repeat(64),
        vout: 0,
        value_sats: 50000,
        script_pubkey_hex: "0014" + "ab".repeat(20),
        script_type: "p2wpkh",
        address: "bc1q1234",
      },
      {
        txid: "b".repeat(64),
        vout: 0,
        value_sats: 100000,
        script_pubkey_hex: "0014" + "cd".repeat(20),
        script_type: "p2wpkh",
        address: "bc1q5678",
      },
      {
        txid: "c".repeat(64),
        vout: 0,
        value_sats: 30000,
        script_pubkey_hex: "0014" + "ef".repeat(20),
        script_type: "p2wpkh",
        address: "bc1q9012",
      },
    ];

    // Payment: 60000 sats
    const payments: Payment[] = [
      {
        address: "bc1qrecipient",
        script_pubkey_hex: "0014" + "11".repeat(20),
        script_type: "p2wpkh",
        value_sats: 60000,
      },
    ];

    const result = selectCoins(utxos, payments, 5.0, "p2wpkh");

    // Should select the largest UTXO (100000) which covers 60000 + fee
    expect(result.selected.length).toBe(1);
    expect(result.selected[0].value_sats).toBe(100000);
    expect(result.strategy).toBe("greedy");
    expect(result.hasExactMatch).toBe(false);
  });

  /**
   * Test 8: max_inputs=1 enforced; throws if insufficient
   *
   * Verifies that:
   * - max_inputs policy is respected
   * - INSUFFICIENT_FUNDS error is thrown when constraint cannot be met
   */
  it("should throw INSUFFICIENT_FUNDS when max_inputs constraint cannot be satisfied", () => {
    // Setup: Multiple small UTXOs, none large enough individually
    const utxos: Utxo[] = [
      {
        txid: "a".repeat(64),
        vout: 0,
        value_sats: 30000,
        script_pubkey_hex: "0014" + "ab".repeat(20),
        script_type: "p2wpkh",
        address: "bc1q1234",
      },
      {
        txid: "b".repeat(64),
        vout: 0,
        value_sats: 40000,
        script_pubkey_hex: "0014" + "cd".repeat(20),
        script_type: "p2wpkh",
        address: "bc1q5678",
      },
    ];

    // Payment: 100000 sats (more than any single UTXO)
    const payments: Payment[] = [
      {
        address: "bc1qrecipient",
        script_pubkey_hex: "0014" + "11".repeat(20),
        script_type: "p2wpkh",
        value_sats: 100000,
      },
    ];

    // Policy: max_inputs = 1 (can only use one UTXO)
    const policy = { max_inputs: 1 };

    // Should throw INSUFFICIENT_FUNDS
    expect(() => {
      selectCoins(utxos, payments, 5.0, "p2wpkh", policy);
    }).toThrow();

    // Verify error contains correct code
    try {
      selectCoins(utxos, payments, 5.0, "p2wpkh", policy);
    } catch (error) {
      const parsed = JSON.parse((error as Error).message);
      expect(parsed.code).toBe("INSUFFICIENT_FUNDS");
    }
  });
});
