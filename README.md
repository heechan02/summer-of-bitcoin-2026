# Summer of Bitcoin 2026 — Technical Challenges

Completed all three weekly technical challenges of [Summer of Bitcoin](https://www.summerofbitcoin.org/) 2026, a competitive global program that introduces university students to Bitcoin open-source development. Advanced to the final stage before the proposal round.

## Overview

Each challenge builds on the previous one, progressively deepening from raw transaction parsing to wallet construction to chain analysis — covering the core skills of Bitcoin protocol engineering.

| Challenge | Name           | What It Does                                                                   |
| --------- | -------------- | ------------------------------------------------------------------------------ |
| 1         | **Chain Lens** | Bitcoin transaction parser & block analyzer with web visualizer                |
| 2         | **Coin Smith** | PSBT transaction builder with coin selection, fee estimation & change handling |
| 3         | **Sherlock**   | Chain analysis engine applying heuristics to real mainnet block data           |

Each challenge includes a CLI tool and an interactive web UI that explains Bitcoin concepts to non-technical users.

## Tech Stack

- TypeScript / Node.js
- Raw Bitcoin protocol parsing (no high-level Bitcoin libraries for core logic)
- BIP-141 (SegWit), BIP-174 (PSBT), BIP-125 (RBF), BIP-68 (relative timelocks), BIP-34 (coinbase height)
- Chain analysis heuristics: Common Input Ownership, Change Detection, CoinJoin Detection, and more

## Challenge Details

### Challenge 1: Chain Lens — Transaction Parser & Block Analyzer

[→ Full details](./challenge-1-chain-lens/README.md)

Parses raw Bitcoin transactions from hex, computing txid/wtxid, fees, weight/vbytes, script classification (P2PKH, P2SH, P2WPKH, P2WSH, P2TR, OP_RETURN), SegWit savings analysis, RBF signaling, and absolute/relative timelocks. Also parses raw `.blk*.dat` block files with XOR decryption and undo data for prevout recovery, including merkle root verification and BIP-34 coinbase height extraction.

**Key Bitcoin concepts implemented:** Transaction serialization, witness discount (BIP-141), script disassembly, OP_RETURN protocol detection (Omni, OpenTimestamps), fee rate calculation, block header parsing, merkle tree verification.

### Challenge 2: Coin Smith — PSBT Transaction Builder

[→ Full details](./challenge-2-coin-smith/README.md)

Given a set of UTXOs, payment targets, and a fee rate, selects coins, constructs an unsigned transaction, handles change/dust edge cases, and exports a valid BIP-174 PSBT. Implements RBF signaling via nSequence, locktime construction (block height vs unix timestamp), and anti-fee-sniping per Bitcoin Core behaviour.

**Key Bitcoin concepts implemented:** UTXO management, coin selection algorithms, PSBT construction (BIP-174), fee estimation with vbytes, dust threshold handling, RBF (BIP-125), nLockTime semantics, anti-fee-sniping.

### Challenge 3: Sherlock — Chain Analysis Engine

[→ Full details](./challenge-3-sherlock/README.md)

Applies chain analysis heuristics to real Bitcoin mainnet block data. Implements Common Input Ownership Heuristic (CIOH), change output detection (via script type matching, round number analysis), CoinJoin detection, consolidation detection, address reuse detection, and more. Produces machine-readable JSON reports and human-readable Markdown reports for each block file.

**Key Bitcoin concepts implemented:** Chain analysis heuristics, privacy analysis, transaction classification, entity clustering assumptions, fee rate statistical analysis across blocks.

### Post-Submission Fix (Challenge 3)

After submission, I identified two bugs that combined to produce `block_count: 1` for fixture files containing 84 and 78 blocks respectively. First, `parseUndoFile()` was unaware that Bitcoin Core appends a 32-byte checksum after each undo record (not counted in the size field), so it stopped parsing after the first record. Second, the block/undo matching code used a guard that skipped every unmatched block as an "orphan" — with only 1 undo record parsed, all remaining blocks were silently dropped.

The automated grader didn't catch this because the output was structurally valid for 1 block. The fix is documented in the Challenge 3 README.

## How to Run

Each challenge has its own setup and run instructions in its README. Generally:

```bash
cd challenge-1-chain-lens
npm install
./cli.sh fixtures/<fixture>.json        # single transaction mode
./cli.sh --block <blk.dat> <rev.dat> <xor.dat>  # block mode
./web.sh                                 # starts web visualizer
```

## About Summer of Bitcoin

[Summer of Bitcoin](https://www.summerofbitcoin.org/) is a global internship program focused on introducing university students to Bitcoin open-source development. The selection process involves multiple technical challenges of increasing difficulty, followed by a project proposal round where successful candidates are matched with Bitcoin open-source mentors.

## Author

Second-year Computer Science & AI student at Loughborough University. Aspiring Bitcoin engineer.
