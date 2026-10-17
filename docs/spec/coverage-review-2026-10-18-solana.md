# Solana source → Base: planning coverage review

2026-10-18 · Specification review only. No product implementation, deployment,
wallet signature or live payment was performed.

Vinay approved Solana as a source settling to Base and requested decisions,
journeys, technical design, tasks and a PR. D6 records that boundary. This expands
the first release; it does not authorize implementation or Solana treasury receipts.
The five payer-UX decisions from the preceding PR remain part of the plan.

The reviewed base is `31c8383354422e3e2f5e44b520f5160ef0e6a12a` (PR #23).
The [review data](coverage-review-2026-10-18-solana.yaml) pins each reviewed worktree
source by SHA-256; the base commit alone does not contain these edits. Earlier
coverage reports remain unchanged historical snapshots.

## Coverage and task handoffs

The inventory starts from D6 plus the existing two-entry, credit, recovery and
consumer obligations, rather than treating a chain label as complete integration.
There are 30 inventory goals and 30 sourced observations. Five goals are explicitly
excluded; all other goals map to criteria. This is specification coverage, not
implemented or live-test coverage.

| Goal | Acceptance location | Implementation responsibility |
|---|---|---|
| Verify cluster, program and fixed settings | D136/D143; J1.S4a | M1.T1 shapes, M1.T5 program/manifest |
| Initialize reusable owner/ATA instructions before use | D118; J13.S1 | M1.T2 storage, M2.T8 setup, M3.T3 instructions |
| Preserve copy, QR, history and sender-support boundaries | D112–D118; J13.S1–S2, J14.S1–S2 | M3.T2 controller, M3.T3 widget |
| Discover complete finalized source activity | D232; J13.S3, J6.S1 | M2.T8 scanner, M3.T1 reconciliation |
| Drain manual funds without stale retry taking later funds | D233/D234; J13.S4 | M1.T5 expected sequence, M2.T9 submitter |
| Sign and accept exact host-funded wallet messages | D137/D143; J14.S1–S4 | M2.T10, with M3.T2 signing adapter |
| Prove expired-message no-debit before another quote | D233; J14.S10 | M2.T8 complete history, M2.T10 terminal proof |
| Link original CCTP burn to Base arrival across failures | D21/D138; J13.S5, J14.S5 | M2.T5 shared verifier/limiter, M2.T11 source proof |
| Commit exclusive net/fixed credit and host acknowledgment | D121/D124/D126/D230; J13.S5a–S6, J14.S6–S7 | M2.T6 allocation, M2.T7 delivery, M3.T3 display |
| Keep original attention and recover allowed assets | D234; J14.S9, J15.S1–S3 | M1.T5 program guards, M3.T4 verified recovery |
| Record repayment with honest evidence labels | D129; J12.S4.c7, J15.S4–S6 | M3.T1 shared procedure, M3.T4 Solana evidence |
| Prove installed consumer and actual source routes | D58; J11.S1.c12–c14 | M2.T11 route receipts, M4.T1 complete host flow |

The plan now has **15 journeys, 80 steps, 22 tasks and 66 unchecked checkpoints**.
Six tasks are added: M1.T5, M2.T8, M2.T9, M2.T10, M2.T11 and M3.T4. The dependency
order includes their shared handoffs before consumer completion. Each step has one
primary task; supporting controller, storage and delivery work is named separately.
The rough estimate becomes 61–92 focused days, excluding learning and external waits;
it must be revised from actual task progress.

## Consistency checks and preserved boundaries

- Base remains the only treasury destination. Credit still requires exclusive
  independently verified Base-safe backing, complete source attribution and the
  existing manual-net or quoted-fixed allocation. Host acknowledgment stays separate.
- EVM CREATE2, ERC-3009, signer nonces and `safe` retain their EVM scope. Solana uses
  program-owned accounts, transaction signatures, blockhash lifetime and `finalized`.
  An expired accepted message cannot be silently refreshed or re-signed.
- Manual Solana instructions distinguish the receive owner from the token ATA.
  A pre-existing ATA and finalized settings are required before instructions are
  usable. Unverified sender/exchange compatibility is not advertised as support.
- The existing 2-USDC manual minimum and cross-chain default 1,000-USDC gross cap
  extend to Solana under D28. Solana sweep fees and finite SOL/priority-fee/rent
  budgets require explicit host configuration; no new fee price is invented.
- Persistent wallet receipts prevent repeat execution. Manual attempts bind an
  expected full-drain sequence so an old command cannot consume a later deposit.
  Permissionless external drains remain independent settlement records.
- Recovery retains required rent and permanent replay state, sends only to stored
  refund destinations and never counts as payer repayment or Base backing.
  D129 keeps beneficiary confirmation and chain-verified/host-reported labels.
- X19 excludes Solana destinations. X20 excludes Token-2022, arbitrary program calls,
  durable-nonce wallet transactions and automatic re-signing. Existing checkout,
  swaps, withdrawals, dashboard and SDK recovery-submission exclusions remain.

No existing decision, criterion, step or invariant ID was removed or reused.
117 criteria were added. Seven existing criteria explicitly narrow their former
EVM-only mechanisms to EVM: J6.S1.c4/c9/c12, J6.S2.c8, J11.S1.c3/c10 and J12.S4.c2.
New Solana criteria cover the corresponding paths; this does not relax EVM checks.
I1, I5 and I8 clarify source identity, operational-key secrecy and confirmation
boundaries for the added family. Their underlying prohibitions stay the same.
The native schema and validators were not changed to accommodate the expansion.

## Evidence still required

Circle and Solana primary documentation linked in the technical design establishes
protocol primitives and documented support. PDA settings, retry sequencing and the
exact signing envelope are Settle Kit engineering choices; they are not vendor
guarantees or claims of executed tests.

The owned program/account validation, deployed immutability, off-curve manual receive,
separate-fee-payer browser signing, transaction size/compute, complete archival
discovery, composed forwarding and end-to-end host credit all remain implementation
gates. Existing EVM spikes do not establish any Solana result. Local-validator or
fixture checks cannot replace actual devnet-to-Base receipts or the installed
consumer and independent onboarding run.

Executed locally: formatting/lint, type checks (cached), semantic-token check, native
journey validation/render/check and 36 tooling tests (83 assertions) passed. Source
whitespace checks passed; generated Markdown retains the renderer’s intentional
two-space line breaks. The ownership/dependency/ID audit passed. These are planning
and scaffold checks, not tests of the proposed Solana program or route.

Run native planning checks and the current supplemental review:

```sh
bun run journeys:validate
bun run journeys:render
bun run check-journeys
bun scripts/check/coverage-review.ts --review docs/spec/coverage-review-2026-10-18-solana.yaml --complete
```

The supplemental check establishes source freshness and reference existence, not
that the mappings or future implementation are correct. `check-journeys -- --complete`
remains the later product-test citation gate. Implementation stays paused until
Vinay explicitly starts a task.
