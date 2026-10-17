# First slice: build, review and learn

2026-10-17 · Planned, not implemented. This replaces the archived checkout-first
T1–T9 plan. [Technical design](../plans/2026-10-15-deposit-sdk-technical-design.md),
[decisions](../decisions.md) and [journeys](../journeys/settle-kit.md) are the inputs.

There are **16 tasks owning all 56 steps across 12 journeys**. J12 completes existing
rescue/repayment scope; it does not add a customer refund product. Each step has one
primary task owner in the YAML spine. Supporting work can cite another task's rules
without becoming a second owner. A merged layer is not proof of the complete journey:
record outstanding integration checks until M4.T1 closes them.

The first slice means this entire D2 native-USDC deposit release. The task IDs stay
stable. D1 sets two outcomes: Vinay understands the technology from the code, and a
payments engineering reviewer can reproduce the result. Finishing generated code
without understanding its money and recovery boundaries does not meet that goal.

Each task starts with its outcome and learning topics, then has three reviewable
checkpoints. Each checkpoint says what to build, how to check it and what to walk
through together. The checkboxes record review progress during implementation;
all are unchecked because product implementation has not started.

## Work order

Task prefixes group responsibilities, not a requirement to finish all M2 work before
touching the interface. For one developer, use this order:

1. **Foundations:** M1.T1 → M1.T2 → M1.T3 → M1.T4 → M2.T1 → M2.T2 → M2.T4.
2. **Early usable preview:** M3.T2 → M3.T3. Show both payment choices, quote consent,
   simulated progress and reload recovery. Label the preview simulated.
3. **Live route and credit:** M2.T3 → M2.T5 → M2.T6 → M2.T7. Prove the combined
   Arbitrum authorization-to-Base route in M2.T5, before final release work.
4. **Operational completeness:** M3.T1 → M4.T1. Close recovery paths, test upgrades
   and install the built SDK in a separate consumer.
5. **Coherent public showing:** M4.T2. Incremental posts can happen earlier (D52).

Start with **M1.T1, checkpoint 1**, after this planning PR is reviewed. This change does not
authorize starting implementation automatically.

| Task | Result | Prerequisites | Focused days |
|---|---|---|---|
| [M1.T1](M1.T1.md) | Public contracts and mode boundary | — | 1–2 |
| [M1.T2](M1.T2.md) | Durable store and migrations | M1.T1 | 2–3 |
| [M1.T3](M1.T3.md) | Contracts, factory and manifest | M1.T1 | 4–6 |
| [M1.T4](M1.T4.md) | Immutable two-direction quotes | M1.T2, M1.T3 | 2–3 |
| [M2.T1](M2.T1.md) | Workflows, transaction identity and spend bounds | M1.T2, M1.T3 | 4–6 |
| [M2.T2](M2.T2.md) | Stable addresses and complete chain discovery | M1.T2, M1.T3, M2.T1 | 3–4 |
| [M2.T3](M2.T3.md) | Manual sweep orchestration | M2.T1, M2.T2 | 2–3 |
| [M2.T4](M2.T4.md) | Wallet acceptance and authenticated history | M1.T4, M2.T1, M2.T2 | 2–3 |
| [M2.T5](M2.T5.md) | Message-linked verification and first live cross-chain proof | M2.T3, M2.T4 | 3–5 |
| [M2.T6](M2.T6.md) | Exclusive backing, credit and atomic event | M2.T5, M1.T2 | 2–3 |
| [M2.T7](M2.T7.md) | Delivery and atomic host credit | M2.T6, M2.T1 | 2–3 |
| [M3.T1](M3.T1.md) | Reconciliation and complete operator procedures | M2.T7 | 3–5 |
| [M3.T2](M3.T2.md) | Hooks and wallet consent | M2.T4 | 2–3 |
| [M3.T3](M3.T3.md) | Deposit and reference app | M3.T2, M2.T2 | 2–3 |
| [M4.T1](M4.T1.md) | Separate consumer, route and upgrade evidence | M3.T1, M3.T3 | 3–5 |
| [M4.T2](M4.T2.md) | Repo, demonstration and write-up | M4.T1 | 1–2 |

These are estimates, not a delivery commitment: **38–59 focused developer days** for
the entire specified release, before job-hunting interruptions, learning time,
testnet outages or an independent tester's availability. The original 5–6-week
estimate is optimistic for this complete scope. Track actual time through the first
three tasks and re-estimate; do not obtain a shorter date by claiming simulation
proves recovery or cross-chain settlement. Sharing early progress does not depend
on reaching the final release gate.

## How we implement together

Use one task per branch/PR and small commits. Default to **one checkpoint per turn**.
If a checkpoint cannot be reviewed in one sitting, split it before editing. Vinay
can explicitly request a longer uninterrupted run; that does not remove the walkthrough.

1. **Before editing:** read this protocol, the task, its exact criteria and the files
   to change. State the intended result, expected files and one failure case. Explain
   the unfamiliar concept that this checkpoint introduces in two or three sentences.
2. **Build one checkpoint:** make the smallest coherent change, with no speculative
   abstractions. Explain new dependencies before adding them. A missing money or
   user-visible rule goes back to the decision process; the agent owns routine
   technical choices and explains their tradeoffs.
3. **Show the actual diff:** link the changed files and walk through each logical
   block in plain words: what it does, why it belongs here, what could fail and the
   rejected alternative when it matters. Use a small flow diagram for interactions;
   do not substitute a generic tutorial for the actual code.
4. **Run focused checks:** name the rule and concrete scenario proved, then distinguish
   source inspection, controlled fixtures, real Postgres, local forks and live receipts.
   Record unmet evidence explicitly. Mark a checkpoint reviewed only after Vinay's
   review; a passing tool result alone is not his acknowledgment.
5. **Pause:** give a short checkpoint handoff and one prediction or explanation prompt.
   Wait for Vinay to continue. Answer follow-up questions from the current code before
   advancing; do not implement the next checkpoint while he is reviewing this one.

The handoff fits in a short message:

- Changed: file links and the behavior now available.
- Why: the decision/criterion IDs and the main tradeoff.
- Checked: command, result, scenario and any evidence still missing.
- Walkthrough: the key blocks, plus one question Vinay can answer from them.
- Next: the next checkpoint, ready when Vinay asks to continue.

Do not require Vinay to pass a quiz. The prompt is a way to expose gaps in the
explanation. A request to explain or inspect something is not permission to advance.
Do not start another task, merge, publish or contact anyone merely because checks pass.

## Checks and task completion

Each task spec names outputs, prerequisites, focused checks, exclusions and what Vinay
must be able to explain. Put exact criterion/invariant IDs in tests. Record which
checks actually ran and which still need later integration or a live environment.
The final consumer task cross-checks all owners; it is not permission to defer each
task's own meaningful verification until the end.

Tests in apps/packages name the exact criterion (`it("J8.S4.c7: ...")`) or invariant
(`it("I10: ...")`) they assert. A pure money/security helper may cite its decision
under AGENTS.md. Generate duplicates/orderings/crash points for invariants; do not
write tests merely to mirror a helper or assert that a document contains words.
Foundry tests retain rule IDs in names/comments; the journey checker alone does not
establish Solidity coverage.

Before each task PR is ready, run:

```sh
bun run format-and-lint
bun run check-types
bun run check-tokens
bun run check-journeys
bun test
```

Contract tasks also run their Foundry suite. `check-journeys -- --complete` belongs
to M4.T1's final release check: today it is
expected to fail because the product tests are not implemented. Its passing result
would establish citation coverage, not independently establish correctness.

The task PR names its served step IDs, completed checkpoints, actual validation,
remaining cross-task evidence and what Vinay can explain. Keep small diagrams,
receipt links and worked examples useful to the final write-up; omit secrets and
invented metrics. Finish the task before asking to start the next one.

## Terms used in the tasks

- **Base units:** integer token amounts; USDC has six decimal places.
- **Safe block:** the chain's RPC safe boundary used by D21/D34; it is not irreversible.
- **CREATE2:** a contract deployment rule that predicts an address from factory, salt
  and creation code before the contract exists there.
- **ERC-3009:** USDC's signed transfer authorization; its one-use nonce is different
  from the relayer transaction nonce that orders transactions from the gas wallet.
- **CCTP:** Circle's source-burn/destination-mint protocol; forwarding submits the mint.
- **DBOS:** the workflow runtime that checkpoints work in Postgres for recovery.
- **Outbox:** an immutable outgoing event saved in the same transaction as its state.
- **Backing:** the exclusively allocated verified USDC evidence that permits a credit.

## Planning readiness and cleanup

The [coverage resolution](../spec/coverage-resolution.md) links each of the three
earlier findings to behavior and task owners. The [technical review](../spec/coverage-review-2026-10-17.md)
traces the four technical-design clarifications to their implementation owners.
The [current UX review](../spec/coverage-review-2026-10-17-ux.md) traces Vinay's
approved D112–D116 refinements through the journey criteria and task checkpoints.
Earlier reports retain their original revisions/hashes and are historical snapshots.

| UX work | Policy and acceptance locations | Task handoff |
|---|---|---|
| Return to an unfinished payment; handle unavailable history | D112; J8.S1, J9.S1 | M1.T1 contracts → M2.T4 transport → M3.T2 controller → M3.T3 widget |
| Explain spending consent and review expired quotes | D113; J8.S2–S3, J8.S9 | M1.T4 quote result → M3.T2 controller → M3.T3 widget |
| Explain exceptions and expose the existing reference | D114; J2.S5, J3.S5, J8.S8–S11 | M2.T4/M2.T6/M3.T1 read models → M3.T2/M3.T3 presentation |
| Distinguish status-read failures; announce meaningful changes | D115; J9.S1–S2 | M1.T1 contracts → M2.T4 transport → M3.T2/M3.T3 client |
| Complete copy feedback and manual instructions | D116; J2.S1, J3.S1 | M3.T2 scoped controller → M3.T3 browser checks |

M4.T1 checks all five in the installed consumer. Task ownership and the 48 planned
review checkpoints are unchanged; these additions describe work within those checkpoints.

Repository cleanup is limited to making this plan discoverable, preserving those
reports, ignoring local output/scratch folders and correcting old package descriptions.
The empty SDK exports and app scaffold are intentional starting points. Keep archived
checkout work and spike evidence available; there is no dependency upgrade, rebuild,
new preliminary spike phase or unrelated refactor in this planning change.
