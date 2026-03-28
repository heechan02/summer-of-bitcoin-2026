import { describe, it, expect } from "vitest";
import { buildPsbt, OutputSpec } from "../src/psbt";
import type { Utxo } from "../src/parser";
import { Psbt } from "bitcoinjs-lib";

describe("psbt.ts", () => {
  describe("Test 15: Built PSBT decodes to valid base64 with correct input count", () => {
    it("should return valid base64 PSBT with correct input count", () => {
      // Create test inputs
      const inputs: Utxo[] = [
        {
          txid: "a".repeat(64),
          vout: 0,
          value_sats: 100000,
          script_pubkey_hex: "0014" + "b".repeat(40),
          script_type: "p2wpkh",
          address: "bc1q...",
        },
        {
          txid: "b".repeat(64),
          vout: 1,
          value_sats: 200000,
          script_pubkey_hex: "0014" + "c".repeat(40),
          script_type: "p2wpkh",
          address: "bc1q...",
        },
      ];

      const outputs: OutputSpec[] = [
        {
          script_pubkey_hex: "0014" + "d".repeat(40),
          value_sats: 250000,
          is_change: false,
        },
      ];

      // Build PSBT
      const psbtBase64 = buildPsbt("mainnet", inputs, outputs, 0, 0xffffffff);

      // Verify it's valid base64
      expect(psbtBase64).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);

      // Decode PSBT
      const psbt = Psbt.fromBase64(psbtBase64);
      expect(psbt).toBeDefined();

      // Verify correct input count
      expect(psbt.data.inputs.length).toBe(2);
      expect(psbt.txInputs.length).toBe(2);
    });
  });
});
