/**
 * Module 6 — psbt.ts
 *
 * Purpose: Construct a BIP-174 PSBT using bitcoinjs-lib, return base64.
 *
 * This module handles:
 * - Building unsigned Bitcoin transactions
 * - Attaching proper PSBT metadata per script type
 * - Creating synthetic previous transactions for P2PKH inputs
 * - Encoding the PSBT as base64
 */

// Import types from parser
import type { Network, Utxo, ScriptType } from "./parser.js";

// Import bitcoinjs-lib
import * as bitcoin from "bitcoinjs-lib";
import { Transaction, Psbt } from "bitcoinjs-lib";

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Output specification for PSBT construction.
 * Payments come first (in fixture order), then change (if present).
 */
export interface OutputSpec {
  /** Hex-encoded scriptPubKey */
  script_pubkey_hex: string;
  /** Output value in satoshis */
  value_sats: number;
  /** True if this is the change output */
  is_change: boolean;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Maps our Network type to bitcoinjs-lib network objects.
 *
 * @param network - Network identifier
 * @returns bitcoinjs-lib network object
 */
function getNetwork(network: Network): bitcoin.networks.Network {
  if (network === "mainnet") {
    return bitcoin.networks.bitcoin;
  }
  if (network === "testnet") {
    return bitcoin.networks.testnet;
  }
  // regtest
  return bitcoin.networks.regtest;
}

/**
 * Builds a minimal synthetic previous transaction for P2PKH inputs.
 *
 * Since fixtures don't provide full previous transactions, we construct
 * a minimal valid Bitcoin transaction that satisfies the PSBT spec's
 * nonWitnessUtxo requirement for P2PKH.
 *
 * @param utxo - The UTXO being spent
 * @returns Serialized previous transaction as Buffer
 */
function buildSyntheticPrevTx(utxo: Utxo): Buffer {
  const tx = new Transaction();
  tx.version = 2;

  // Add a dummy coinbase input (all zeros hash with 0xffffffff vout)
  tx.addInput(Buffer.alloc(32, 0), 0xffffffff);

  // Add outputs up to and including the vout we need
  for (let i = 0; i <= utxo.vout; i++) {
    if (i < utxo.vout) {
      // Add dummy outputs before the target vout
      tx.addOutput(Buffer.alloc(0), 0);
    } else {
      // Add the real output at the target vout
      const scriptBuffer = Buffer.from(utxo.script_pubkey_hex, "hex");
      tx.addOutput(scriptBuffer, utxo.value_sats);
    }
  }

  tx.locktime = 0;
  return tx.toBuffer();
}

/**
 * Creates witnessUtxo object for segwit inputs.
 *
 * @param utxo - The UTXO being spent
 * @returns witnessUtxo object
 */
function createWitnessUtxo(utxo: Utxo): { script: Buffer; value: number } {
  return {
    script: Buffer.from(utxo.script_pubkey_hex, "hex"),
    value: utxo.value_sats,
  };
}

/**
 * Attaches the appropriate PSBT metadata to an input based on its script type.
 *
 * Rules per script type:
 * - p2wpkh: witnessUtxo only
 * - p2pkh: nonWitnessUtxo only (synthetic prev tx)
 * - p2sh-p2wpkh: BOTH witnessUtxo AND nonWitnessUtxo (max compatibility)
 * - p2tr: witnessUtxo only
 *
 * @param psbt - The PSBT being constructed
 * @param utxo - The UTXO being spent
 * @param index - Input index
 */
function attachInputMetadata(psbt: Psbt, utxo: Utxo, index: number): void {
  switch (utxo.script_type) {
    case "p2wpkh":
      // Native segwit: witnessUtxo only
      psbt.updateInput(index, {
        witnessUtxo: createWitnessUtxo(utxo),
      });
      break;

    case "p2pkh":
      // Legacy: nonWitnessUtxo only (synthetic prev tx)
      psbt.updateInput(index, {
        nonWitnessUtxo: buildSyntheticPrevTx(utxo),
      });
      break;

    case "p2sh-p2wpkh":
      // Nested segwit: BOTH for max compatibility
      psbt.updateInput(index, {
        witnessUtxo: createWitnessUtxo(utxo),
        nonWitnessUtxo: buildSyntheticPrevTx(utxo),
      });
      break;

    case "p2tr":
      // Taproot: witnessUtxo only
      psbt.updateInput(index, {
        witnessUtxo: createWitnessUtxo(utxo),
      });
      break;
  }
}

// ============================================================================
// MAIN FUNCTION
// ============================================================================

/**
 * Builds a BIP-174 PSBT for the transaction.
 *
 * CRITICAL NOTES:
 * - txid must be reversed when converting to Buffer (Bitcoin internal byte order)
 * - Values must be BigInt in bitcoinjs-lib v6+
 * - nSequence is applied to ALL inputs (same value for all)
 * - Output ordering: payments first, change last (already in correct order in outputs param)
 *
 * @param network - Network identifier
 * @param selectedInputs - UTXOs selected by coin selector
 * @param outputs - Payment outputs + optional change, in final order
 * @param nLockTime - Transaction locktime value
 * @param nSequence - Sequence number for all inputs
 * @returns Base64-encoded PSBT
 */
export function buildPsbt(
  network: Network,
  selectedInputs: Utxo[],
  outputs: OutputSpec[],
  nLockTime: number,
  nSequence: number,
): string {
  // Step 1 - Get network object
  const btcNetwork = getNetwork(network);

  // Step 2 - Create new PSBT
  const psbt = new Psbt({ network: btcNetwork });

  // Step 3 - Add inputs with metadata
  for (let i = 0; i < selectedInputs.length; i++) {
    const utxo = selectedInputs[i];

    // Step 3a - Add input to PSBT
    // txid needs to be reversed (Bitcoin uses little-endian internally)
    const txidBuffer = Buffer.from(utxo.txid, "hex").reverse();
    psbt.addInput({
      hash: txidBuffer,
      index: utxo.vout,
      sequence: nSequence,
    });

    // Step 3b - Attach metadata based on script type
    attachInputMetadata(psbt, utxo, i);
  }

  // Step 4 - Add outputs
  for (const output of outputs) {
    const scriptBuffer = Buffer.from(output.script_pubkey_hex, "hex");
    psbt.addOutput({
      script: scriptBuffer,
      value: output.value_sats,
    });
  }

  // Step 5 - Set locktime
  psbt.setLocktime(nLockTime);

  // Step 6 - Encode to base64
  const psbtBase64 = psbt.toBase64();

  // Step 7 - Return
  return psbtBase64;
}
