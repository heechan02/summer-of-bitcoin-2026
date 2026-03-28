# Challenge 2: Coin Smith — PSBT Transaction Builder

**Demo:** [https://youtu.be/1VvPf84BggQ?si=BUDh7hTX9tnP6GjF](https://youtu.be/1VvPf84BggQ?si=BUDh7hTX9tnP6GjF)

## Problem

Build a safe PSBT transaction builder that selects coins (UTXOs), constructs an unsigned Bitcoin transaction, exports a valid BIP-174 PSBT, and serves a web UI to visualize and justify the result. This is a wallet engineering problem: protocol-first correctness, defensive validation, and sensible optimization.

## Implementation

### CLI Tool (`cli.sh`)

- **UTXO model & coin selection:** Parses fixture UTXOs and selects an input set to fund payments; enforces `policy.max_inputs` when present; `strategy` reported in output
- **Fee estimation:** Target fee rate × estimated vbytes (ceiled); handles the circular dependency — adding or removing a change output changes vbytes which changes the required fee
- **Dust threshold (546 sats):** No change output created if it would be dust; leftover consumed as fee instead (`SEND_ALL` warning emitted)
- **PSBT (BIP-174):** Exports valid base64 PSBT with global unsigned transaction and `witness_utxo` / `non_witness_utxo` per input; amounts balance: `inputs = payments + change + fee`
- **RBF & nLockTime:** nSequence and nLockTime set per the interaction matrix below
- **Anti-fee-sniping:** When `rbf: true` and `current_height` provided with no explicit locktime, sets `nLockTime = current_height` (matches Bitcoin Core behaviour)
- **Warnings:** `HIGH_FEE`, `DUST_CHANGE`, `SEND_ALL`, `RBF_SIGNALING`

### RBF & Locktime Interaction

| RBF | Locktime present | current_height | nSequence  | nLockTime      |
| --- | ---------------- | -------------- | ---------- | -------------- |
| off | no               | —              | 0xFFFFFFFF | 0              |
| off | yes              | —              | 0xFFFFFFFE | locktime value |
| on  | no               | yes            | 0xFFFFFFFD | current_height |
| on  | yes              | —              | 0xFFFFFFFD | locktime value |
| on  | no               | no             | 0xFFFFFFFD | 0              |

### Web UI (`web.sh`)

- Load fixture JSON and visualize the coin selection result
- Visual breakdown of selected inputs, payment outputs, and change output
- Fee, fee rate, RBF status, locktime value and type
- Warning indicators
- API: `GET /api/health` → `{ "ok": true }`

## How to Run

```bash
# Install dependencies
npm install

# Build a transaction from a fixture
./cli.sh fixtures/basic_change_p2wpkh.json
# Output written to out/basic_change_p2wpkh.json

# Start web UI
./web.sh
# Opens at http://127.0.0.1:3000

# Run tests
npm test
```

## Approach & Design Decisions

Coin selection uses a two-strategy pipeline: Branch-and-Bound first, falling back to Greedy (largest-first) if BnB fails. BnB performs a depth-first search (capped at 1000 iterations) looking for an input set whose total equals `payments + fee_no_change` exactly — an exact match avoids creating a change output entirely, which is both cheaper (smaller transaction) and more private (no change output to trace). When BnB can't find an exact match within the iteration budget, Greedy picks UTXOs in descending value order until the sum covers `payments + fee_with_change`.

The fee/change resolution is a two-pass algorithm. Pass 1 assumes a change output exists, estimates vbytes accordingly, computes `change = inputs - payments - fee`. If change ≥ 546 sats the result is used directly. If change falls below the dust threshold (including going negative), Pass 2 drops the change output, re-estimates vbytes for the smaller transaction, and lets the entire leftover become fee. This handles the boundary conditions correctly — a change of exactly 545 sats must be dropped; 546 must be kept — and means the fee reported is always the minimum required for the chosen output set.

Each module in the pipeline has a single responsibility: `parser.ts` validates the fixture, `selector.ts` picks UTXOs, `estimator.ts` computes vbytes per script type, `feeChange.ts` runs the two-pass resolution, `sequences.ts` computes nSequence/nLockTime, `psbt.ts` assembles the BIP-174 PSBT using `bitcoinjs-lib`, and `warnings.ts` and `reporter.ts` build the final output. This separation made the modules individually testable without mocking the entire pipeline.

## What I Learned

This was my first experience building anything at the wallet layer of Bitcoin, and it was a significant step up in complexity from Challenge 1. Challenge 1 was about reading — parsing what already exists on the blockchain. Challenge 2 was about constructing — producing a transaction that is both structurally valid and wallet-safe, which involves a surprising number of interacting constraints.

The hardest part was the circular fee/change dependency. It sounds simple in the abstract: fee = rate × size. But size depends on whether a change output exists, which depends on whether the change amount clears the dust threshold, which depends on the fee, which depends on the size. Working through the two-pass algorithm — and writing tests for the exact boundary at 545 vs. 546 sats — made it concrete.
