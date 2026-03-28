/**
 * Module 1 — parser.ts
 *
 * Purpose: Read fixture JSON, validate schema, return typed object or structured error
 */

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export type ScriptType = "p2wpkh" | "p2pkh" | "p2sh-p2wpkh" | "p2tr";
export type Network = "mainnet" | "testnet" | "regtest";

export interface Utxo {
  txid: string;
  vout: number;
  value_sats: number;
  script_pubkey_hex: string;
  script_type: ScriptType;
  address: string;
}

export interface Payment {
  address: string;
  script_pubkey_hex: string;
  script_type: ScriptType;
  value_sats: number;
}

export interface ChangeTemplate {
  address: string;
  script_pubkey_hex: string;
  script_type: ScriptType;
}

export interface Policy {
  max_inputs?: number;
}

export interface Fixture {
  network: Network;
  utxos: Utxo[];
  payments: Payment[];
  change: ChangeTemplate;
  fee_rate_sat_vb: number;
  rbf?: boolean;
  locktime?: number;
  current_height?: number;
  policy?: Policy;
}

// ============================================================================
// MAIN PARSING FUNCTION
// ============================================================================

/**
 * Parse and validate a fixture JSON
 *
 * @param raw - Unknown input (typically parsed JSON)
 * @returns Validated Fixture object
 * @throws Error with code INVALID_FIXTURE if validation fails
 */
export function parseFixture(raw: unknown): Fixture {
  // 1. Check that raw is an object
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw createError("Input must be an object");
  }

  const obj = raw as Record<string, unknown>;

  // 2. Validate network field
  if (!("network" in obj) || !isValidNetwork(obj.network)) {
    throw createError("Invalid or missing network field");
  }
  const network = obj.network;

  // 3. Validate utxos array
  if (!("utxos" in obj) || !Array.isArray(obj.utxos)) {
    throw createError("utxos must be an array");
  }
  if (obj.utxos.length === 0) {
    throw createError("utxos array must not be empty");
  }
  const utxos = obj.utxos.map((utxo, index) => validateUtxo(utxo, index));

  // 4. Validate payments array
  if (!("payments" in obj) || !Array.isArray(obj.payments)) {
    throw createError("payments must be an array");
  }
  if (obj.payments.length === 0) {
    throw createError("payments array must not be empty");
  }
  const payments = obj.payments.map((payment, index) =>
    validatePayment(payment, index)
  );

  // 5. Validate change template
  if (!("change" in obj)) {
    throw createError("change field is required");
  }
  const change = validateChangeTemplate(obj.change);

  // 6. Validate fee_rate_sat_vb
  if (!("fee_rate_sat_vb" in obj)) {
    throw createError("fee_rate_sat_vb is required");
  }
  if (typeof obj.fee_rate_sat_vb !== "number" || obj.fee_rate_sat_vb <= 0) {
    throw createError("fee_rate_sat_vb must be a positive number");
  }
  const fee_rate_sat_vb = obj.fee_rate_sat_vb;

  // 7. Validate optional fields
  const fixture: Fixture = {
    network,
    utxos,
    payments,
    change,
    fee_rate_sat_vb,
  };

  // rbf (optional boolean)
  if ("rbf" in obj) {
    if (typeof obj.rbf !== "boolean") {
      throw createError("rbf must be a boolean");
    }
    fixture.rbf = obj.rbf;
  }

  // locktime (optional uint32)
  if ("locktime" in obj) {
    if (
      typeof obj.locktime !== "number" ||
      !Number.isInteger(obj.locktime) ||
      !isUint32(obj.locktime)
    ) {
      throw createError("locktime must be a valid uint32 (0-4294967295)");
    }
    fixture.locktime = obj.locktime;
  }

  // current_height (optional non-negative integer)
  if ("current_height" in obj) {
    if (
      typeof obj.current_height !== "number" ||
      !Number.isInteger(obj.current_height) ||
      obj.current_height < 0
    ) {
      throw createError("current_height must be a non-negative integer");
    }
    fixture.current_height = obj.current_height;
  }

  // policy (optional object)
  if ("policy" in obj) {
    if (typeof obj.policy !== "object" || obj.policy === null) {
      throw createError("policy must be an object");
    }
    const policyObj = obj.policy as Record<string, unknown>;
    const policy: Policy = {};

    if ("max_inputs" in policyObj) {
      if (
        typeof policyObj.max_inputs !== "number" ||
        !Number.isInteger(policyObj.max_inputs) ||
        policyObj.max_inputs <= 0
      ) {
        throw createError("policy.max_inputs must be a positive integer");
      }
      policy.max_inputs = policyObj.max_inputs;
    }

    fixture.policy = policy;
  }

  // 8. Unknown fields are silently ignored

  // 9. Return validated fixture
  return fixture;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Check if string is valid hex with even length
 */
function isValidHex(str: string): boolean {
  if (str.length === 0 || str.length % 2 !== 0) {
    return false;
  }
  return /^[0-9a-fA-F]+$/.test(str);
}

/**
 * Check if value is a valid ScriptType
 */
function isValidScriptType(value: unknown): value is ScriptType {
  return (
    value === "p2wpkh" ||
    value === "p2pkh" ||
    value === "p2sh-p2wpkh" ||
    value === "p2tr"
  );
}

/**
 * Check if value is a valid Network
 */
function isValidNetwork(value: unknown): value is Network {
  return value === "mainnet" || value === "testnet" || value === "regtest";
}

/**
 * Check if number is a valid uint32
 */
function isUint32(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 4294967295;
}

/**
 * Validate a single UTXO object
 */
function validateUtxo(utxo: unknown, index: number): Utxo {
  if (typeof utxo !== "object" || utxo === null) {
    throw createError(`utxos[${index}] must be an object`);
  }

  const obj = utxo as Record<string, unknown>;

  // Validate txid
  if (typeof obj.txid !== "string" || obj.txid.length !== 64) {
    throw createError(`utxos[${index}].txid must be a 64-character string`);
  }
  if (!isValidHex(obj.txid)) {
    throw createError(`utxos[${index}].txid must be valid hex`);
  }

  // Validate vout
  if (
    typeof obj.vout !== "number" ||
    !Number.isInteger(obj.vout) ||
    obj.vout < 0
  ) {
    throw createError(`utxos[${index}].vout must be a non-negative integer`);
  }

  // Validate value_sats
  if (
    typeof obj.value_sats !== "number" ||
    !Number.isInteger(obj.value_sats) ||
    obj.value_sats <= 0
  ) {
    throw createError(`utxos[${index}].value_sats must be a positive integer`);
  }

  // Validate script_pubkey_hex
  if (typeof obj.script_pubkey_hex !== "string") {
    throw createError(`utxos[${index}].script_pubkey_hex must be a string`);
  }
  if (!isValidHex(obj.script_pubkey_hex)) {
    throw createError(
      `utxos[${index}].script_pubkey_hex must be valid even-length hex`
    );
  }

  // Validate script_type
  if (!isValidScriptType(obj.script_type)) {
    throw createError(
      `utxos[${index}].script_type must be one of: p2wpkh, p2pkh, p2sh-p2wpkh, p2tr`
    );
  }

  // Validate address
  if (typeof obj.address !== "string") {
    throw createError(`utxos[${index}].address must be a string`);
  }

  return {
    txid: obj.txid,
    vout: obj.vout,
    value_sats: obj.value_sats,
    script_pubkey_hex: obj.script_pubkey_hex,
    script_type: obj.script_type,
    address: obj.address,
  };
}

/**
 * Validate a single Payment object
 */
function validatePayment(payment: unknown, index: number): Payment {
  if (typeof payment !== "object" || payment === null) {
    throw createError(`payments[${index}] must be an object`);
  }

  const obj = payment as Record<string, unknown>;

  // Validate address
  if (typeof obj.address !== "string") {
    throw createError(`payments[${index}].address must be a string`);
  }

  // Validate script_pubkey_hex
  if (typeof obj.script_pubkey_hex !== "string") {
    throw createError(`payments[${index}].script_pubkey_hex must be a string`);
  }
  if (!isValidHex(obj.script_pubkey_hex)) {
    throw createError(
      `payments[${index}].script_pubkey_hex must be valid even-length hex`
    );
  }

  // Validate script_type
  if (!isValidScriptType(obj.script_type)) {
    throw createError(
      `payments[${index}].script_type must be one of: p2wpkh, p2pkh, p2sh-p2wpkh, p2tr`
    );
  }

  // Validate value_sats
  if (
    typeof obj.value_sats !== "number" ||
    !Number.isInteger(obj.value_sats) ||
    obj.value_sats <= 0
  ) {
    throw createError(
      `payments[${index}].value_sats must be a positive integer`
    );
  }

  return {
    address: obj.address,
    script_pubkey_hex: obj.script_pubkey_hex,
    script_type: obj.script_type,
    value_sats: obj.value_sats,
  };
}

/**
 * Validate change template object
 */
function validateChangeTemplate(change: unknown): ChangeTemplate {
  if (typeof change !== "object" || change === null) {
    throw createError("change must be an object");
  }

  const obj = change as Record<string, unknown>;

  // Validate address
  if (typeof obj.address !== "string") {
    throw createError("change.address must be a string");
  }

  // Validate script_pubkey_hex
  if (typeof obj.script_pubkey_hex !== "string") {
    throw createError("change.script_pubkey_hex must be a string");
  }
  if (!isValidHex(obj.script_pubkey_hex)) {
    throw createError("change.script_pubkey_hex must be valid even-length hex");
  }

  // Validate script_type
  if (!isValidScriptType(obj.script_type)) {
    throw createError(
      "change.script_type must be one of: p2wpkh, p2pkh, p2sh-p2wpkh, p2tr"
    );
  }

  return {
    address: obj.address,
    script_pubkey_hex: obj.script_pubkey_hex,
    script_type: obj.script_type,
  };
}

/**
 * Create a structured error for invalid fixtures
 */
function createError(message: string): Error {
  const error = new Error(message);
  (error as Error & { code: string }).code = "INVALID_FIXTURE";
  return error;
}
