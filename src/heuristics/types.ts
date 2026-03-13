/**
 * Shared interfaces and types for all 9 heuristics.
 * @module heuristics/types
 */

/**
 * A single transaction input enriched with prevout data from the undo file.
 */
export interface AnalyzableInput {
  /** Txid of the previous output being spent (hex, display byte order). */
  txid: string;
  /** Output index of the previous output being spent. */
  vout: number;
  /** Input sequence number. */
  sequence: number;
  /** Raw scriptSig bytes. */
  scriptSig: Buffer;
  /** SegWit witness stack items. */
  witness: Buffer[];
  /** Value of the previous output in satoshis (from undo file). */
  prevout_value_sats: number;
  /** Script type of the previous output (from undo file). */
  prevout_script_type: string;
  /** Address of the previous output, or null if undecodable. */
  prevout_address: string | null;
}

/**
 * A single transaction output with script classification and address.
 */
export interface AnalyzableOutput {
  /** Zero-based output index. */
  index: number;
  /** Output value in satoshis. */
  value_sats: number;
  /** Classified script type (p2pkh, p2sh, p2wpkh, p2wsh, p2tr, op_return, unknown). */
  script_type: string;
  /** Derived address, or null if undecodable. */
  address: string | null;
  /** Raw scriptPubKey as hex. */
  script_pubkey_hex: string;
  /** Hex payload of OP_RETURN data, present only when script_type === 'op_return'. */
  op_return_data_hex?: string;
  /** Classified protocol of OP_RETURN payload (e.g. 'omni', 'runes'), if identified. */
  op_return_protocol?: string;
}

/**
 * A transaction enriched with inputs resolved from the undo file and fee statistics.
 */
export interface AnalyzableTx {
  /** Transaction ID (hex, display byte order). */
  txid: string;
  /** True if this is a coinbase transaction. */
  isCoinbase: boolean;
  /** Enriched inputs with prevout data. */
  inputs: AnalyzableInput[];
  /** Classified outputs. */
  outputs: AnalyzableOutput[];
  /** Transaction weight in weight units. */
  weight: number;
  /** Virtual bytes (weight / 4, rounded up). */
  vbytes: number;
  /** Fee in satoshis (sum of prevout values minus sum of output values). */
  fee_sats: number;
  /** Fee rate in sat/vB. */
  fee_rate_sat_vb: number;
}

/**
 * Per-block context passed to heuristics that require cross-transaction data.
 */
export interface BlockContext {
  /** Height of this block. */
  blockHeight: number;
  /** All addresses seen in this block (inputs + outputs), used for within-block reuse detection. */
  allTxAddresses: Set<string>;
  /** Maps txid → outputs for this block. */
  txOutputMap: Map<string, AnalyzableOutput[]>;
  /** Maps txid → inputs for this block. */
  txInputMap: Map<string, AnalyzableInput[]>;
  /**
   * Maps "prevTxid:prevVout" → spending txid.
   * Built by scanning all tx inputs in the block.
   * Used by peeling chain detection to follow chains within a block.
   */
  utxoSpentByMap: Map<string, string>;
}

/**
 * Base result returned by every heuristic detector.
 * Additional heuristic-specific fields (confidence, method, etc.) are allowed.
 */
export interface HeuristicResult {
  /** Whether this heuristic fired on the transaction. */
  detected: boolean;
  [key: string]: unknown;
}

/**
 * Classification of a transaction based on combined heuristic results.
 */
export type TxClassification =
  | "simple_payment"
  | "consolidation"
  | "coinjoin"
  | "self_transfer"
  | "batch_payment"
  | "unknown";

/**
 * Ordered list of all 9 heuristic IDs used throughout the codebase.
 * Must appear in JSON output under `heuristics_applied`.
 */
export const ALL_HEURISTIC_IDS = [
  "cioh",
  "change_detection",
  "address_reuse",
  "consolidation",
  "op_return",
  "coinjoin",
  "self_transfer",
  "peeling_chain",
  "round_number_payment",
] as const;

/** Union type of all valid heuristic ID strings. */
export type HeuristicId = (typeof ALL_HEURISTIC_IDS)[number];
