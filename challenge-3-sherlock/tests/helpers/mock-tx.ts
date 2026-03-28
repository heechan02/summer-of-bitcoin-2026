/**
 * Test factory functions for building AnalyzableTx and BlockContext fixtures.
 * Used by all heuristic unit tests.
 * @module tests/helpers/mock-tx
 */

import type {
  AnalyzableInput,
  AnalyzableOutput,
  AnalyzableTx,
  BlockContext,
} from "../../src/heuristics/types.js";

/** Options for overriding individual input fields. */
export interface MockInputOpts {
  txid?: string;
  vout?: number;
  sequence?: number;
  scriptSig?: Buffer;
  witness?: Buffer[];
  prevout_value_sats?: number;
  prevout_script_type?: string;
  prevout_address?: string | null;
}

/** Options for overriding individual output fields. */
export interface MockOutputOpts {
  index?: number;
  value_sats?: number;
  script_type?: string;
  address?: string | null;
  script_pubkey_hex?: string;
  op_return_data_hex?: string;
  op_return_protocol?: string;
}

/** Options for overriding mockSimpleTx construction. */
export interface MockTxOpts {
  /** Override all inputs' prevout_script_type. */
  inputType?: string;
  /** Override per-output script_type (index-aligned). */
  outputTypes?: string[];
  /** Override per-input prevout_value_sats (index-aligned). */
  inputValues?: number[];
  /** Override per-output value_sats (index-aligned). */
  outputValues?: number[];
  /** Override the txid of the transaction. */
  txid?: string;
  /** Override per-input prevout_address (index-aligned). */
  inputAddresses?: (string | null)[];
  /** Override per-output address (index-aligned). */
  outputAddresses?: (string | null)[];
}

const DEFAULT_INPUT_VALUE_SATS = 100_000;
const DEFAULT_OUTPUT_VALUE_SATS = 90_000;
const DEFAULT_WEIGHT = 440;

/**
 * Builds a single AnalyzableInput with sensible defaults.
 * All fields are overridable via opts.
 *
 * @param index - Zero-based index used to generate deterministic addresses/txids.
 * @param opts  - Optional field overrides.
 * @returns A fully-populated AnalyzableInput.
 */
export function mockInput(index = 0, opts: MockInputOpts = {}): AnalyzableInput {
  return {
    txid: opts.txid ?? `${"aa".repeat(31)}${index.toString(16).padStart(2, "0")}`,
    vout: opts.vout ?? 0,
    sequence: opts.sequence ?? 0xffffffff,
    scriptSig: opts.scriptSig ?? Buffer.alloc(0),
    witness: opts.witness ?? [],
    prevout_value_sats: opts.prevout_value_sats ?? DEFAULT_INPUT_VALUE_SATS,
    prevout_script_type: opts.prevout_script_type ?? "p2wpkh",
    prevout_address: opts.prevout_address !== undefined
      ? opts.prevout_address
      : `bc1q_input_${index}`,
  };
}

/**
 * Builds a single AnalyzableOutput with sensible defaults.
 * All fields are overridable via opts.
 *
 * @param index - Zero-based index used to generate deterministic addresses.
 * @param opts  - Optional field overrides.
 * @returns A fully-populated AnalyzableOutput.
 */
export function mockOutput(index = 0, opts: MockOutputOpts = {}): AnalyzableOutput {
  const scriptType = opts.script_type ?? "p2wpkh";
  const base: AnalyzableOutput = {
    index: opts.index ?? index,
    value_sats: opts.value_sats ?? DEFAULT_OUTPUT_VALUE_SATS,
    script_type: scriptType,
    address: opts.address !== undefined ? opts.address : `bc1q_output_${index}`,
    script_pubkey_hex: opts.script_pubkey_hex ?? `0014${"bb".repeat(20)}`,
  };
  if (scriptType === "op_return" || opts.op_return_data_hex !== undefined) {
    base.op_return_data_hex = opts.op_return_data_hex ?? "deadbeef";
  }
  if (opts.op_return_protocol !== undefined) {
    base.op_return_protocol = opts.op_return_protocol;
  }
  return base;
}

/**
 * Builds a generic non-coinbase AnalyzableTx with the given input/output counts.
 * Fee is computed as sum(prevout_value_sats) - sum(output value_sats).
 *
 * @param inputCount  - Number of inputs to generate.
 * @param outputCount - Number of outputs to generate.
 * @param opts        - Optional overrides for script types, values, addresses, and txid.
 * @returns A fully-populated AnalyzableTx.
 */
export function mockSimpleTx(
  inputCount: number,
  outputCount: number,
  opts: MockTxOpts = {},
): AnalyzableTx {
  const inputs: AnalyzableInput[] = Array.from({ length: inputCount }, (_, i) => {
    const inputOpts: MockInputOpts = {};
    if (opts.inputType !== undefined) inputOpts.prevout_script_type = opts.inputType;
    if (opts.inputValues?.[i] !== undefined) inputOpts.prevout_value_sats = opts.inputValues[i];
    if (opts.inputAddresses?.[i] !== undefined) inputOpts.prevout_address = opts.inputAddresses[i];
    return mockInput(i, inputOpts);
  });

  const outputs: AnalyzableOutput[] = Array.from({ length: outputCount }, (_, i) => {
    const outputOpts: MockOutputOpts = {};
    if (opts.outputTypes?.[i] !== undefined) outputOpts.script_type = opts.outputTypes[i];
    if (opts.outputValues?.[i] !== undefined) outputOpts.value_sats = opts.outputValues[i];
    if (opts.outputAddresses?.[i] !== undefined) outputOpts.address = opts.outputAddresses[i];
    return mockOutput(i, outputOpts);
  });

  const totalIn = inputs.reduce((s, inp) => s + inp.prevout_value_sats, 0);
  const totalOut = outputs.reduce((s, out) => s + out.value_sats, 0);
  const feeSats = Math.max(0, totalIn - totalOut);
  const vbytes = Math.ceil(DEFAULT_WEIGHT / 4);

  return {
    txid: opts.txid ?? `${"cc".repeat(31)}${inputCount.toString(16).padStart(2, "0")}`,
    isCoinbase: false,
    inputs,
    outputs,
    weight: DEFAULT_WEIGHT,
    vbytes,
    fee_sats: feeSats,
    fee_rate_sat_vb: feeSats / vbytes,
  };
}

/**
 * Builds a coinbase AnalyzableTx (isCoinbase=true, fee=0).
 *
 * @returns A coinbase AnalyzableTx.
 */
export function mockCoinbaseTx(): AnalyzableTx {
  const inputs: AnalyzableInput[] = [
    {
      txid: "0".repeat(64),
      vout: 0xffffffff,
      sequence: 0xffffffff,
      scriptSig: Buffer.from("03abcdef", "hex"),
      witness: [],
      prevout_value_sats: 0,
      prevout_script_type: "coinbase",
      prevout_address: null,
    },
  ];
  const outputs: AnalyzableOutput[] = [
    mockOutput(0, { value_sats: 625_000_000, address: "bc1q_coinbase_0" }),
  ];

  return {
    txid: "0".repeat(64),
    isCoinbase: true,
    inputs,
    outputs,
    weight: 320,
    vbytes: 80,
    fee_sats: 0,
    fee_rate_sat_vb: 0,
  };
}

/**
 * Builds a consolidation AnalyzableTx: many inputs, single output.
 * All inputs share the same script type (p2wpkh).
 *
 * @param inputCount - Number of inputs (typically ≥3 to trigger heuristic).
 * @returns A consolidation AnalyzableTx.
 */
export function mockConsolidationTx(inputCount: number): AnalyzableTx {
  return mockSimpleTx(inputCount, 1, {
    inputType: "p2wpkh",
    inputValues: Array.from({ length: inputCount }, () => 50_000),
    outputValues: [inputCount * 50_000 - 1_000],
  });
}

/**
 * Builds a CoinJoin AnalyzableTx: N equal-value inputs, N equal-value outputs.
 * Each participant has a distinct address.
 *
 * @param participantCount - Number of CoinJoin participants.
 * @param denomination     - Output value in satoshis for each participant output.
 * @returns A CoinJoin AnalyzableTx.
 */
export function mockCoinJoinTx(
  participantCount: number,
  denomination: number,
): AnalyzableTx {
  const inputValues = Array.from({ length: participantCount }, () => denomination + 1_000);
  const outputValues = Array.from({ length: participantCount }, () => denomination);
  return mockSimpleTx(participantCount, participantCount, {
    inputType: "p2wpkh",
    inputValues,
    outputValues,
  });
}

/**
 * Builds a peeling-chain AnalyzableTx: 1 input, 2 outputs (large change + small payment).
 *
 * @param largeValue - Value in satoshis for the large (change) output.
 * @param smallValue - Value in satoshis for the small (payment) output.
 * @returns A peeling-chain AnalyzableTx.
 */
export function mockPeelingTx(largeValue: number, smallValue: number): AnalyzableTx {
  return mockSimpleTx(1, 2, {
    inputValues: [largeValue + smallValue + 1_000],
    outputValues: [largeValue, smallValue],
  });
}

/**
 * Builds a self-transfer AnalyzableTx: 1 input, 1 output, same address and script type.
 *
 * @param scriptType - Script type for both input and output.
 * @returns A self-transfer AnalyzableTx.
 */
export function mockSelfTransferTx(scriptType: string): AnalyzableTx {
  const sharedAddress = "bc1q_self_transfer";
  return mockSimpleTx(1, 1, {
    inputType: scriptType,
    outputTypes: [scriptType],
    inputAddresses: [sharedAddress],
    outputAddresses: [sharedAddress],
    inputValues: [100_000],
    outputValues: [99_000],
  });
}

/**
 * Builds an OP_RETURN AnalyzableTx: 1 input, 2 outputs (value output + OP_RETURN).
 *
 * @param protocol - Protocol identifier for the OP_RETURN payload (e.g. 'omni', 'runes').
 * @returns An OP_RETURN AnalyzableTx.
 */
export function mockOpReturnTx(protocol: string): AnalyzableTx {
  const inputs = [mockInput(0)];
  const outputs: AnalyzableOutput[] = [
    mockOutput(0, { value_sats: 80_000 }),
    mockOutput(1, {
      value_sats: 0,
      script_type: "op_return",
      address: null,
      script_pubkey_hex: "6a04deadbeef",
      op_return_data_hex: "deadbeef",
      op_return_protocol: protocol,
    }),
  ];

  const firstInput = inputs[0];
  const feeSats = (firstInput !== undefined ? firstInput.prevout_value_sats : 0) - 80_000;
  const vbytes = Math.ceil(DEFAULT_WEIGHT / 4);

  return {
    txid: "dd".repeat(32),
    isCoinbase: false,
    inputs,
    outputs,
    weight: DEFAULT_WEIGHT,
    vbytes,
    fee_sats: feeSats,
    fee_rate_sat_vb: feeSats / vbytes,
  };
}

/**
 * Builds a BlockContext from an array of AnalyzableTx objects.
 * Populates allTxAddresses, txOutputMap, txInputMap, and utxoSpentByMap.
 *
 * @param txs - Transactions in this block (default: empty array).
 * @returns A fully-populated BlockContext.
 */
export function mockBlockContext(txs: AnalyzableTx[] = []): BlockContext {
  const allTxAddresses = new Set<string>();
  const txOutputMap = new Map<string, AnalyzableOutput[]>();
  const txInputMap = new Map<string, AnalyzableInput[]>();
  const utxoSpentByMap = new Map<string, string>();

  for (const tx of txs) {
    txOutputMap.set(tx.txid, tx.outputs);
    txInputMap.set(tx.txid, tx.inputs);

    for (const out of tx.outputs) {
      if (out.address !== null) allTxAddresses.add(out.address);
    }
    for (const inp of tx.inputs) {
      if (inp.prevout_address !== null) allTxAddresses.add(inp.prevout_address);
      utxoSpentByMap.set(`${inp.txid}:${inp.vout}`, tx.txid);
    }
  }

  return {
    blockHeight: 800_000,
    allTxAddresses,
    txOutputMap,
    txInputMap,
    utxoSpentByMap,
  };
}
