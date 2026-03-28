# Challenge 1: Chain Lens — Transaction Parser & Block Analyzer

**Demo:** [https://youtu.be/yUuUyEU-3vE?si=nAT2o3VkCRhEJVig](https://youtu.be/yUuUyEU-3vE?si=nAT2o3VkCRhEJVig)

## Problem

Build a CLI tool that parses raw Bitcoin transactions into machine-checkable JSON reports, and a web visualizer that explains transactions to non-technical users with diagrams and annotations.

The challenge covers both single-transaction parsing (from hex) and full block parsing from Bitcoin Core's raw `.blk*.dat` and `.rev*.dat` files with XOR decryption.

## Implementation

### CLI Tool (`cli.sh`)

- **Transaction serialization:** Parses raw hex into structured JSON — txid, wtxid, version, locktime, all inputs/outputs
- **SegWit (BIP-141):** Witness data parsing, weight (4× non-witness + 1× witness), vbytes, txid vs wtxid distinction; `wtxid` is `null` for legacy transactions
- **Fee accounting:** Input sum minus output sum; fee rate in sat/vbyte; prevouts matched by `(txid, vout)` — order in fixture is not assumed
- **Script classification (outputs):** P2PKH, P2SH, P2WPKH, P2WSH, P2TR, OP_RETURN, unknown — with mainnet address derivation
- **Script classification (inputs):** P2PKH, P2SH-P2WPKH, P2SH-P2WSH, P2WPKH, P2WSH, P2TR keypath, P2TR scriptpath, unknown — address derived from prevout scriptPubKey
- **Script disassembly:** `script_asm` on all inputs/outputs; `witness_script_asm` on P2WSH/P2SH-P2WSH inputs (last witness item)
- **RBF (BIP-125):** Detects replaceability via nSequence ≤ 0xFFFFFFFD
- **Timelocks:** Absolute nLockTime (none / block_height / unix_timestamp); relative per-input BIP-68 (blocks or time, disabled if bit 31 set)
- **SegWit savings:** `witness_bytes`, `non_witness_bytes`, `weight_actual` vs `weight_if_legacy`, `savings_pct` — `null` for legacy transactions
- **OP_RETURN decoding:** All push opcodes handled; protocol detection: Omni (`6f6d6e69`), OpenTimestamps (`0109f91102`), unknown
- **Warnings:** `HIGH_FEE`, `DUST_OUTPUT`, `UNKNOWN_OUTPUT_SCRIPT`, `RBF_SIGNALING`
- **Block parsing:** 80-byte header, merkle root construction and verification, BIP-34 coinbase height from scriptSig, XOR decryption of `.blk*.dat` / `.rev*.dat`; one `out/<block_hash>.json` per block

### Web Visualizer (`web.sh`)

- Visual transaction flow: inputs → outputs with fee as "missing slice"
- Plain-English explanations of Bitcoin concepts with tooltips
- Script type labels, fee breakdowns, warning indicators
- Block mode: transaction list with expandable per-tx details
- API: `GET /api/health` → `{ "ok": true }`, `POST /api/analyze`

## How to Run

```bash
# Install dependencies
npm install

# Single transaction mode
./cli.sh fixtures/transactions/tx_legacy_p2pkh.json

# Block parsing mode
./cli.sh --block <blk*.dat> <rev*.dat> <xor.dat>

# Start web visualizer
./web.sh
# Opens at http://127.0.0.1:3000
```

## Approach & Design Decisions

The entire parser is built from a single `BufferReader` abstraction — a stateful cursor over a raw `Buffer` that advances as it reads. Every field (varint, uint32le, uint64le, bytes) is consumed in one forward pass with no backtracking. This made the SegWit detection straightforward: after reading the 4-byte version, peek 2 bytes; if they are `0x00 0x01` (marker + flag), consume them and set `isSegwit = true`, otherwise treat the next byte as the input count varint.

Computing txid and wtxid requires two different serializations of the same transaction. Rather than copying bytes from the original buffer (which contains witness data interleaved), I rebuild the non-witness serialization explicitly — version + inputs + outputs + locktime — using the same `writeVarInt` helpers. `hash256` (double-SHA256) of that gives the txid; `hash256` of the full serialization gives the wtxid. Both are reversed before hex-encoding, matching the display convention used by block explorers.

Prevout matching uses a `Map<"txid:vout", PrevoutInfo>` keyed on the outpoint string, not array position. This satisfies the requirement that fixture prevouts may be unordered, and lets the validator catch duplicates and missing prevouts before any accounting happens.

For block parsing, the outer loop reads 4-byte magic + 4-byte block size, slices exactly that many bytes, parses header + transactions, then advances the cursor. The loop continues until fewer than 8 bytes remain — this handles multi-block `.dat` files correctly by design.

The Merkle root computation reverses each txid from display convention back to internal byte order before hashing, pairs and double-SHA256s each level (duplicating the last element if the count is odd), then reverses the final root back for comparison against the header field.

## What I Learned

This was my first proper Bitcoin project. The transaction serialization format was the steepest part of the learning curve — nothing in conventional web or systems programming prepares you for parsing raw binary protocols at the byte level. [Grokking Bitcoin](https://rosenbaum.se/book/grokking-bitcoin.html#ch05) was the resource that finally made it click: the chapter on transactions explains the wire format visually and clearly enough that I could map each field directly to code.

The biggest conceptual shift was internalising Bitcoin's two separate byte-order conventions: raw bytes on the wire are little-endian for integers and stored in natural order for hashes, but the display convention (txid, block hash, addresses) reverses the hash bytes. Getting this wrong produces values that look plausible but never match a block explorer — the reversal has to happen consistently at exactly the boundary between "internal representation" and "output string".

The SegWit weight formula felt mechanical until I worked through a real transaction: base size × 4 accounts for the fact that non-witness bytes were always 4-weight-units in the pre-SegWit model, and adding witness bytes at 1-weight-unit each is what creates the discount. The `savings_pct` field — comparing `weight_actual` against `weight * 4` for the hypothetical legacy size — made the discount concrete.

BIP-68 relative timelocks required careful bit manipulation: bit 31 disables the feature entirely, bit 22 selects blocks vs. time, and the low 16 bits carry the value (multiplied by 512 seconds for time-based locks). Missing any one of these conditions produces silently wrong results, which is why the test fixtures covering disabled timelocks (bit 31 set) are important.
