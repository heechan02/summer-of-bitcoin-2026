# Challenge 3: Sherlock — Chain Analysis Engine

**Demo:** [https://www.youtube.com/watch?v=73anqMHR1Xw](https://www.youtube.com/watch?v=73anqMHR1Xw)

## Problem

Build a chain analysis engine that applies heuristics to real Bitcoin mainnet block data, a web visualizer to surface the results, and Markdown reports documenting the findings. This challenge builds on the transaction parser (Challenge 1) and PSBT builder (Challenge 2), applying analytical reasoning on top of parsed transaction data to infer patterns, identify entities, and classify transaction behaviour.

## Implementation

### CLI Tool (`cli.sh`)

Parses raw `.blk*.dat` + `.rev*.dat` + `xor.dat` files (same pipeline as Challenge 1) and applies all 9 heuristics to every transaction. Produces two output files per block file:

- `out/<blk_stem>.json` — machine-readable analysis (all blocks in the file)
- `out/<blk_stem>.md` — human-readable Markdown report (committed to repo)

### Heuristics Implemented

All 9 of the following are implemented (`heuristics_applied` in JSON output lists all IDs):

| ID | What it detects |
|----|-----------------|
| `cioh` | Multi-input transactions — all inputs likely controlled by the same entity (Common Input Ownership) |
| `change_detection` | Likely change output via script type matching, round number analysis, and output ordering |
| `address_reuse` | Same address appearing in both inputs and outputs, or across transactions in the block |
| `consolidation` | Many inputs → 1–2 outputs of the same script type (wallet UTXO maintenance) |
| `coinjoin` | Multiple participants, equal-value outputs, high input count (privacy-enhancing transaction) |
| `self_transfer` | All outputs match input script type with no obvious payment component |
| `peeling_chain` | Large input split into one small payment and one large change, repeated across transactions |
| `op_return` | OP_RETURN outputs with protocol classification (Omni, OpenTimestamps, etc.) |
| `round_number_payment` | Outputs with round BTC values — more likely to be payments than change |

Transaction `classification` is one of: `simple_payment`, `consolidation`, `coinjoin`, `self_transfer`, `batch_payment`, `unknown`.

See [`APPROACH.md`](./APPROACH.md) for confidence models, limitations, and architecture details.

### Web Visualizer (`web.sh`)

- Interactive exploration of chain analysis results by block
- Color-coded transaction classifications
- Per-heuristic result display with expandable transaction details
- Block-level statistics: fee rate distribution, script type breakdown, flagged transaction count
- API: `GET /api/health` → `{ "ok": true }`

## How to Run

```bash
# Install dependencies and decompress fixtures
./setup.sh

# Run chain analysis on a block file
./cli.sh --block fixtures/blk04330.dat fixtures/rev04330.dat fixtures/xor.dat
# Output written to:
#   out/blk04330.json  (machine-readable)
#   out/blk04330.md    (human-readable report)

# Start web visualizer
./web.sh
# Opens at http://127.0.0.1:3000

# Run tests
npm test
```

## Post-Submission Fix

**This section documents the critical bug that was present in my original submission.**

### The Problem

My block parser only extracted the first block from each `.dat` file instead of all blocks. The fixture files contained 84 blocks in `blk04330.dat` and 78 blocks in `blk05051.dat`, but my output reported `block_count: 1` for both.

### Root Cause

When building Challenge 3, I reused the block parsing logic from Challenge 1. In Challenge 1, the block mode tests only used single-block files, so the parser worked correctly. When Challenge 3 required parsing multi-block files, I didn't update the iteration logic — the parser would read the first block, process it, and return without continuing to read subsequent blocks from the same file.

The REQUIREMENTS were explicit: _"A single `blk*.dat` file may contain multiple blocks. Both the JSON and Markdown outputs should cover all blocks in the file."_

### Why It Wasn't Caught Earlier

The automated grader only validated structural correctness — it checked that field types were correct, that `block_count === blocks.length`, and that fee statistics were ordered properly. Since the output was internally consistent for 1 block, all automated tests passed. The manual reviewer immediately noticed that only ~3,500 transactions were being analyzed from a file containing hundreds of thousands across 84 blocks.

### The Fix

In `chain-analyzer.ts`, the original `analyzeBlockFile()` function called `parseBlocks()` (which correctly returns a `ParsedBlock[]` array) but only processed `parsedBlocks[0]` — the first element. The fix was replacing that single-element access with a `for` loop that iterates over the entire `parsedBlocks` array, pairing each block with its corresponding undo record via the sequential greedy matching algorithm. The `parseBlocks()` function itself already handled multi-block files correctly by looping on the magic number (`0xF9BEB4D9`) until the buffer is exhausted — the bug was entirely in the calling code that discarded every block after the first.

### Lesson Learned

This was fundamentally a code reuse mistake — I assumed logic from a previous challenge would transfer directly without re-reading the requirements carefully. In Bitcoin development, where a single parsing error can have cascading consequences, this kind of assumption is exactly the type of bug that code review catches. It reinforced why the Bitcoin Core development process emphasises thorough review and testing.

## Approach & Design Decisions

The pipeline is strictly linear: `cli.ts` → `chain-analyzer.ts` → `heuristics/index.ts` → `json-builder.ts` / `report-gen.ts`. `chain-analyzer.ts` handles everything up to and including the `AnalyzableTx[]` representation — XOR decoding, block + undo parsing, block/undo matching, fee calculation, and `BlockContext` construction. Heuristics receive only this enriched representation and have no access to raw bytes or the filesystem.

All 9 heuristic detectors are pure synchronous functions with the signature `(tx: AnalyzableTx, ctx: BlockContext) → HeuristicResult`. They never import from each other, making them independently unit-testable with mock transactions. `heuristics/index.ts` is the sole orchestrator — the only module that imports all nine — and applies the coinbase guard in one place: coinbase transactions always return `detected: false` across every heuristic without invoking the detectors at all.

Transaction classification uses a deterministic priority waterfall: `coinjoin` beats `consolidation` (both have many inputs, but equal-output evidence is more specific), which beats `self_transfer`, then `batch_payment` (≥4 outputs), `simple_payment`, and finally `unknown`. This ordering prevents ambiguous cases from producing inconsistent labels across runs.

The change detection heuristic is a scoring model rather than a binary rule. Each output accumulates points: +3 for matching the dominant input script type, +4 for address reuse in the output set, +1 for a non-round value, +1 for being the smallest output. The highest-scoring candidate is returned as the likely change index, with confidence derived from the score. This multi-signal approach is more robust than any single heuristic alone — for instance, a wallet that exclusively uses P2TR for all inputs and outputs defeats the script-type signal, but address reuse or value asymmetry can still provide a signal.

Memory discipline was necessary for large block files. `cli.ts` keeps the full `txs[]` array only for `blocks[0]` (required by the grader for the `transactions[]` field). For all subsequent blocks, `txs[]` is set to `[]` immediately after per-block stats are computed, preventing the heap from growing linearly with block count across an 84-block file.

## What I Learned

Working with real mainnet data for the first time was a genuine surprise. Fixtures are tidy by design — real `.dat` files are not. Edge cases that never appear in test data (compressed P2PK prevouts, blocks with a single coinbase, unusual script patterns) showed up constantly across 84 blocks. It forced me to write more defensive code than I would have otherwise.

The thing that stuck with me most was how chain analysis changed the way I actually read transactions. Before this challenge a transaction was just a list of inputs and outputs. After building these heuristics, I'd look at a real transaction and notice things — an address being reused, a non-round change output giving away the payment direction, a consolidation sweep that screams exchange cold wallet. The CIOH paper by Meiklejohn et al. was genuinely eye-opening; the idea that a handful of probabilistic assumptions, applied consistently at scale, can cluster most of the early Bitcoin transaction graph feels almost too powerful for something so simple.

The post-submission bug was embarrassing but probably the most useful thing that happened. I was confident the code worked because the grader said it did — but the grader only checked that the output was structurally valid, not that it was actually correct. One block's worth of data passed every automated check while silently ignoring 83 others. It made the point that automated tests and human review are not the same thing, and I won't forget it.
