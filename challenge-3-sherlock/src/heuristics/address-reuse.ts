/**
 * Address Reuse Heuristic.
 *
 * Detects transactions where an address appears in both inputs and outputs
 * (within-tx reuse) or where an output address was already seen earlier in
 * the same block (within-block reuse).
 *
 * @module heuristics/address-reuse
 */

import type { AnalyzableTx, BlockContext, HeuristicResult } from "./types.js";

/** Result shape returned by detectAddressReuse when detected. */
export interface AddressReuseResult extends HeuristicResult {
  detected: true;
  /** "within_tx" takes precedence over "within_block". */
  method: "within_tx" | "within_block";
  /** Sorted list of addresses that triggered detection. */
  reused_addresses: string[];
}

/** Result shape returned by detectAddressReuse when not detected. */
export interface AddressReuseResultNeg extends HeuristicResult {
  detected: false;
}

/**
 * Runs the Address Reuse heuristic on a single transaction.
 *
 * Priority: within_tx > within_block.
 *
 * @param tx  - The transaction to analyse.
 * @param ctx - Block-level context providing `allTxAddresses` for cross-tx detection.
 * @returns A HeuristicResult with `detected`, `method`, and `reused_addresses`.
 */
export function detectAddressReuse(
  tx: AnalyzableTx,
  ctx: BlockContext,
): AddressReuseResult | AddressReuseResultNeg {
  if (tx.isCoinbase) {
    return { detected: false };
  }

  const inputAddresses = new Set(
    tx.inputs
      .map((inp) => inp.prevout_address)
      .filter((addr): addr is string => addr !== null),
  );

  const outputAddresses = new Set(
    tx.outputs
      .filter((out) => out.script_type !== "op_return")
      .map((out) => out.address)
      .filter((addr): addr is string => addr !== null),
  );

  // within_tx: address appears in both inputs and outputs
  const withinTx = [...outputAddresses].filter((addr) =>
    inputAddresses.has(addr),
  );
  if (withinTx.length > 0) {
    return {
      detected: true,
      method: "within_tx",
      reused_addresses: withinTx.sort(),
    };
  }

  // within_block: output address was seen in a prior tx in this block
  const withinBlock = [...outputAddresses].filter((addr) =>
    ctx.allTxAddresses.has(addr),
  );
  if (withinBlock.length > 0) {
    return {
      detected: true,
      method: "within_block",
      reused_addresses: withinBlock.sort(),
    };
  }

  return { detected: false };
}
