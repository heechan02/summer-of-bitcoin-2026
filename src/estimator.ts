/**
 * Module 2 — estimator.ts
 *
 * Purpose: Compute transaction weight and vbytes for a given input/output configuration.
 *
 * Critical: The segwit flag (2 witness weight units) is added ONCE if ANY input is segwit.
 */

import type { ScriptType } from "./parser.js";

// ============================================================================
// CONSTANTS (sizes in bytes)
// ============================================================================

/**
 * Base transaction overhead: version (4) + locktime (4) + varint counts (2)
 */
const TX_OVERHEAD_BASE = 10;

/**
 * Segwit flag and marker: 2 witness bytes added ONCE if any segwit input exists
 */
const SEGWIT_FLAG = 2;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Returns the base (non-witness) bytes for a given input script type.
 *
 * Base = outpoint (36) + scriptSig length varint (1) + scriptSig + sequence (4)
 *
 * @param type - The script type of the input
 * @returns Base bytes for this input type
 */
export function inputBaseBytes(type: ScriptType): number {
  switch (type) {
    case "p2wpkh":
      return 41; // 36 outpoint + 1 len + 0 scriptSig + 4 seq
    case "p2pkh":
      return 148; // 36 outpoint + 1 len + 107 scriptSig + 4 seq
    case "p2sh-p2wpkh":
      return 64; // 36 outpoint + 1 len + 23 scriptSig + 4 seq
    case "p2tr":
      return 41; // 36 outpoint + 1 len + 0 scriptSig + 4 seq
    default:
      throw new Error(`Unknown script type: ${type}`);
  }
}

/**
 * Returns the witness bytes for a given input script type.
 *
 * Witness data is discounted at 0.25x in weight calculation.
 *
 * @param type - The script type of the input
 * @returns Witness bytes for this input type
 */
export function inputWitnessBytes(type: ScriptType): number {
  switch (type) {
    case "p2wpkh":
      return 108; // 1 stack items + 1 len + 72 sig + 1 len + 33 pubkey
    case "p2pkh":
      return 0; // No witness data
    case "p2sh-p2wpkh":
      return 108; // Same witness as p2wpkh
    case "p2tr":
      return 65; // 1 stack items + 1 len + 64 schnorr sig
    default:
      throw new Error(`Unknown script type: ${type}`);
  }
}

/**
 * Returns the bytes for a given output script type.
 *
 * Output = value (8) + scriptPubKey length varint (1) + scriptPubKey
 *
 * @param type - The script type of the output
 * @returns Bytes for this output type
 */
export function outputBytes(type: ScriptType): number {
  switch (type) {
    case "p2wpkh":
      return 31; // 8 value + 1 len + 22 scriptPubKey
    case "p2pkh":
      return 34; // 8 value + 1 len + 25 scriptPubKey
    case "p2sh-p2wpkh":
      return 32; // 8 value + 1 len + 23 scriptPubKey (p2sh output)
    case "p2tr":
      return 43; // 8 value + 1 len + 34 scriptPubKey
    default:
      throw new Error(`Unknown script type: ${type}`);
  }
}

// ============================================================================
// MAIN ESTIMATION FUNCTION
// ============================================================================

/**
 * Estimates the virtual bytes (vbytes) for a transaction with given inputs and outputs.
 *
 * Weight formula:
 *   weight = (base_bytes * 4) + (witness_bytes * 1)
 *   vbytes = ceil(weight / 4)
 *
 * Critical: Segwit flag (2 witness weight units) added ONCE if ANY input is segwit.
 *
 * @param inputs - Array of input script types
 * @param outputs - Array of output script types
 * @returns Virtual bytes (vbytes) for the transaction
 */
export function estimateVbytes(
  inputs: ScriptType[],
  outputs: ScriptType[],
): number {
  // 1. Check if ANY input is segwit (p2wpkh, p2sh-p2wpkh, or p2tr)
  const hasSegwitInput = inputs.some(
    (type) => type === "p2wpkh" || type === "p2sh-p2wpkh" || type === "p2tr",
  );

  // 2. Calculate total base bytes
  let baseBytes = TX_OVERHEAD_BASE;

  // Add base bytes for each input
  for (const inputType of inputs) {
    baseBytes += inputBaseBytes(inputType);
  }

  // Add bytes for each output
  for (const outputType of outputs) {
    baseBytes += outputBytes(outputType);
  }

  // 3. Calculate total witness weight
  let witnessWeight = 0;

  // Add segwit flag (2 weight units) ONCE if any input is segwit
  if (hasSegwitInput) {
    witnessWeight += SEGWIT_FLAG;
  }

  // Add witness data for each input
  for (const inputType of inputs) {
    witnessWeight += inputWitnessBytes(inputType);
  }

  // 4. Calculate weight: (base_bytes * 4) + witness_weight
  const weight = baseBytes * 4 + witnessWeight;

  // 5. Calculate vbytes (ceiling division)
  const vbytes = Math.ceil(weight / 4);

  return vbytes;
}
