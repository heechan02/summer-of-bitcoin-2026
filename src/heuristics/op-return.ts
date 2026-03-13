/**
 * OP_RETURN Heuristic.
 *
 * Detects transactions that embed arbitrary data using OP_RETURN outputs,
 * and classifies the protocol based on known payload prefixes.
 *
 * @module heuristics/op-return
 */

import type { AnalyzableTx, BlockContext, HeuristicResult } from "./types.js";
import { extractOpReturnData } from "../script/disassemble.js";

/** Known protocol prefix (hex) → protocol name. */
const PROTOCOL_PREFIXES: ReadonlyArray<readonly [string, string]> = [
  ["6f6d6e69", "omni"],
  ["0109f91102", "opentimestamps"],
  ["52", "runes"],
] as const;

/** Byte length that identifies a VeriBlock OP_RETURN payload. */
const VERIBLOCK_PAYLOAD_LENGTH = 80;

/** Protocol label for unrecognised payloads. */
const PROTOCOL_UNKNOWN = "unknown" as const;

/** Result shape when OP_RETURN is detected. */
export interface OpReturnResult extends HeuristicResult {
  detected: true;
  /** Number of OP_RETURN outputs found in this transaction. */
  op_return_count: number;
  /** Protocol identifier for the first OP_RETURN output. */
  protocol: string;
  /** Hex-encoded payload of the first OP_RETURN output. */
  data_hex: string;
}

/** Result shape when no OP_RETURN is found. */
export interface OpReturnResultNeg extends HeuristicResult {
  detected: false;
}

/**
 * Runs the OP_RETURN Heuristic on a single transaction.
 *
 * Scans all outputs for `op_return` script types. On the first match, extracts
 * the payload and classifies the embedded protocol by prefix or byte length.
 *
 * @param tx   - The transaction to analyse.
 * @param _ctx - Block-level context (unused by this heuristic).
 * @returns A HeuristicResult with `detected`, `op_return_count`, `protocol`, and `data_hex`.
 */
export function detectOpReturn(
  tx: AnalyzableTx,
  _ctx: BlockContext,
): OpReturnResult | OpReturnResultNeg {
  const opReturnOutputs = tx.outputs.filter((out) => out.script_type === "op_return");

  if (opReturnOutputs.length === 0) {
    return { detected: false };
  }

  const firstOutput = opReturnOutputs[0]!;
  const scriptHex = firstOutput.script_pubkey_hex;
  const scriptBuf = Buffer.from(scriptHex, "hex");
  const payload = extractOpReturnData(scriptBuf);
  const dataHex = payload.toString("hex");
  const protocol = classifyProtocol(payload);

  return {
    detected: true,
    op_return_count: opReturnOutputs.length,
    protocol,
    data_hex: dataHex,
  };
}

/**
 * Classifies an OP_RETURN payload buffer into a known protocol name.
 *
 * Checks known hex prefixes first, then falls back to byte-length for VeriBlock,
 * and finally returns "unknown".
 *
 * @param payload - Raw bytes extracted from the OP_RETURN push.
 * @returns Protocol name string.
 */
function classifyProtocol(payload: Buffer): string {
  const hex = payload.toString("hex");

  for (const [prefix, name] of PROTOCOL_PREFIXES) {
    if (hex.startsWith(prefix)) {
      return name;
    }
  }

  if (payload.length === VERIBLOCK_PAYLOAD_LENGTH) {
    return "veriblock";
  }

  return PROTOCOL_UNKNOWN;
}
