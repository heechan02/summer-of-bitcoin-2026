export interface PrevoutInfo {
  txid: string;
  vout: number;
  value_sats: number;
  script_pubkey_hex: string;
}

export interface FixtureInput {
  network: string;
  raw_tx: string;
  prevouts: PrevoutInfo[];
  mode?: string;
}

export interface RelativeTimelock {
  enabled: boolean;
  type?: 'blocks' | 'time';
  value?: number;
}

export interface VinEntry {
  txid: string;
  vout: number;
  sequence: number;
  script_sig_hex: string;
  script_asm: string;
  witness: string[];
  script_type: string;
  address: string | null;
  prevout: {
    value_sats: number;
    script_pubkey_hex: string;
  };
  relative_timelock: RelativeTimelock;
  witness_script_asm?: string;
}

export interface VoutEntry {
  n: number;
  value_sats: number;
  script_pubkey_hex: string;
  script_asm: string;
  script_type: string;
  address: string | null;
  op_return_data_hex?: string;
  op_return_data_utf8?: string | null;
  op_return_protocol?: string;
}

export interface SegwitSavings {
  witness_bytes: number;
  non_witness_bytes: number;
  total_bytes: number;
  weight_actual: number;
  weight_if_legacy: number;
  savings_pct: number;
}

export interface Warning {
  code: string;
}

export interface TxAnalysisResult {
  ok: boolean;
  network: string;
  segwit: boolean;
  txid: string;
  wtxid: string | null;
  version: number;
  locktime: number;
  size_bytes: number;
  weight: number;
  vbytes: number;
  total_input_sats: number;
  total_output_sats: number;
  fee_sats: number;
  fee_rate_sat_vb: number;
  rbf_signaling: boolean;
  locktime_type: 'none' | 'block_height' | 'unix_timestamp';
  locktime_value: number;
  segwit_savings: SegwitSavings | null;
  vin: VinEntry[];
  vout: VoutEntry[];
  warnings: Warning[];
}

export interface ParsedInput {
  txid: string;       // reversed hex for display
  txidRaw: Buffer;    // raw 32 bytes as stored in tx (not reversed)
  vout: number;
  scriptSig: Buffer;
  sequence: number;
  witness: Buffer[];
}

export interface ParsedOutput {
  value: bigint;
  scriptPubKey: Buffer;
}

export interface ParsedTx {
  version: number;
  inputs: ParsedInput[];
  outputs: ParsedOutput[];
  locktime: number;
  isSegwit: boolean;
  // Serializations for hashing
  nonWitnessSerialization: Buffer; // for txid
  fullSerialization: Buffer;       // for wtxid
  // Size metrics
  sizeBytes: number;
  baseSize: number;       // non-witness size (no marker/flag)
  witnessSize: number;    // marker + flag + all witness stacks
}

export interface ErrorResult {
  ok: false;
  error: {
    code: string;
    message: string;
  };
}
