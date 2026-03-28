import { describe, it, expect } from "vitest";
import { parseFixture } from "../src/parser";

describe("parser.ts", () => {
  it("should parse a valid fixture without error", () => {
    const validFixture = {
      network: "mainnet",
      utxos: [
        {
          txid: "a".repeat(64),
          vout: 0,
          value_sats: 100000,
          script_pubkey_hex: "0014abcdef1234567890abcdef1234567890abcdef12",
          script_type: "p2wpkh",
          address: "bc1q1234567890abcdef",
        },
      ],
      payments: [
        {
          address: "bc1qxyz",
          script_pubkey_hex: "00141234567890abcdef1234567890abcdef12345678",
          script_type: "p2wpkh",
          value_sats: 50000,
        },
      ],
      change: {
        address: "bc1qchange",
        script_pubkey_hex: "0014fedcba0987654321fedcba0987654321fedcba09",
        script_type: "p2wpkh",
      },
      fee_rate_sat_vb: 5,
    };

    const result = parseFixture(validFixture);

    expect(result.network).toBe("mainnet");
    expect(result.utxos).toHaveLength(1);
    expect(result.payments).toHaveLength(1);
    expect(result.fee_rate_sat_vb).toBe(5);
    expect(result.change.script_type).toBe("p2wpkh");
  });

  it("should throw INVALID_FIXTURE when utxos field is missing", () => {
    const invalidFixture = {
      network: "mainnet",
      // utxos field is missing
      payments: [
        {
          address: "bc1qxyz",
          script_pubkey_hex: "00141234567890abcdef1234567890abcdef12345678",
          script_type: "p2wpkh",
          value_sats: 50000,
        },
      ],
      change: {
        address: "bc1qchange",
        script_pubkey_hex: "0014fedcba0987654321fedcba0987654321fedcba09",
        script_type: "p2wpkh",
      },
      fee_rate_sat_vb: 5,
    };

    expect(() => parseFixture(invalidFixture)).toThrow();

    try {
      parseFixture(invalidFixture);
    } catch (error) {
      expect((error as Error & { code: string }).code).toBe("INVALID_FIXTURE");
      expect((error as Error).message).toContain("utxos");
    }
  });

  it("should silently ignore unknown extra fields", () => {
    const fixtureWithExtras = {
      network: "testnet",
      utxos: [
        {
          txid: "b".repeat(64),
          vout: 1,
          value_sats: 200000,
          script_pubkey_hex: "0014abcdef1234567890abcdef1234567890abcdef12",
          script_type: "p2wpkh",
          address: "tb1q1234567890abcdef",
        },
      ],
      payments: [
        {
          address: "tb1qxyz",
          script_pubkey_hex: "00141234567890abcdef1234567890abcdef12345678",
          script_type: "p2wpkh",
          value_sats: 100000,
        },
      ],
      change: {
        address: "tb1qchange",
        script_pubkey_hex: "0014fedcba0987654321fedcba0987654321fedcba09",
        script_type: "p2wpkh",
      },
      fee_rate_sat_vb: 10,
      // Extra fields that should be ignored
      metadata: "some metadata",
      comment: "this is a comment",
      version: 1,
      unknownField: { nested: "value" },
    };

    const result = parseFixture(fixtureWithExtras);

    // Should parse successfully
    expect(result.network).toBe("testnet");
    expect(result.utxos).toHaveLength(1);
    expect(result.payments).toHaveLength(1);
    expect(result.fee_rate_sat_vb).toBe(10);

    // Extra fields should not be in the result
    expect(result).not.toHaveProperty("metadata");
    expect(result).not.toHaveProperty("comment");
    expect(result).not.toHaveProperty("version");
    expect(result).not.toHaveProperty("unknownField");
  });
});
