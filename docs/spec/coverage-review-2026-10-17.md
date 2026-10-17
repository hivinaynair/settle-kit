# Planning review: first slice ready for implementation review

2026-10-17. Reviewed against the accepted D/X records and the independent 18-goal
[inventory](coverage-inventory-first.md). This review covers the current planning
files; it does not prove product implementation or live money correctness.

## Scope and method

Reviewed the technical design, all 12 journeys/56 steps, the 16 task specs, task
dependencies, learning checkpoints and host integration sketch. Walked consent,
source execution, independent destination evidence, atomic allocation/delivery,
operator recovery and public-proof handoffs against the branch checklist. Read the
decisions first and retained all 18 inventory goals: 15 mapped, three excluded.
No new product scope or business policy was inferred from implementation choices.

The [review data](coverage-review-2026-10-17.yaml) pins the actual source contents
with SHA-256 hashes. Its reviewed_revision is the base commit, not a claim that the
base already contains these edits. Earlier reports and their hashes are preserved
as snapshots; their freshness checks are expected to fail against changed sources.
Use this dated review when checking the current plan.

## Four technical-design findings

| Finding | Design clarification and acceptance references | Implementation owners |
|---|---|---|
| R1: repeated equal-amount burns lack a unique protected discriminator | Contract-derived operation tag carried through composed forwarding hook data; source event, attested message and destination consumption must match it. J4.S2.c18 and J8.S6.c8 | M1.T3 creates the format; M1.T4 binds wallet consent; M2.T5 verifies it |
| R2: first wallet payment assumes deployed code | Shared issuance before signing, then persisted ensure_contract before payment execution. Reuse deployment across wallet/manual commands without extending consent. J8.S5.c18 | M1.T2 deployment identity; M1.T4 preparation; M2.T1 submitter; M2.T2 issuer; M2.T4 integration |
| R3: one open SDK sweep conflates submission with externally observed drains | Keep the SDK command gate separate from per-drain settlement identities. A later external drain remains independently attributable while an earlier command is open. J6.S1.c14 | M1.T2 store; M2.T2 discovery; M2.T3 attribution; M2.T6 credit |
| R4: repayment loader requires rescue evidence for USDC recovery | Discriminate over_limit_usdc from asset_rescue, retaining each kind's original evidence through one repayment procedure. J7.S3.c5 and J12.S4.c6 | M3.T1 |

These findings are addressed in the design and implementation handoffs. They are
still requirements to implement and test. No contract or payment behavior was run
to establish that the proposed fixes work.

Circle's [forwarding format](https://developers.circle.com/cctp/concepts/forwarding-service#version-1)
supports separate complete composable frames; its
[source message encoder](https://github.com/circlefin/evm-cctp-contracts/blob/63ab1f0ac06ce0793c0bbfbb8d09816bc211386d/src/messages/v2/MessageV2.sol)
writes an empty nonce. Those sources support the R1 design choice. Compatibility
with the deployed forwarding service remains an actual-testnet gate in M2.T5.

## Human and agent task contract

All 16 existing task IDs and primary owners are retained. Each task has an outcome,
learning topics, prerequisites, expected locations, three checkpoints with build/check/
walkthrough instructions, exclusions and a done/handoff boundary. All 48 review
checkboxes start unchecked. Actual diagrams and explanations come from the code built
during each checkpoint; these planning prompts do not substitute for understanding it.

The shared protocol requires a small diff, focused verification, a walkthrough of
the actual code, and a pause for Vinay before proceeding. He can explicitly request
a longer uninterrupted run. Questions are learning aids, not exams. A finished task
does not start the next task or publish anything automatically.

## Repository cleanup

- Include the reviewed local spec, design/task drafts and historical review artifacts.
- Preserve the planning skills/checker already merged in PR #21.
- Ignore root output/ and tmp/ without deleting local files.
- Correct core/server package descriptions that still refer to the old model.
- Keep SDK placeholders, the app scaffold, archived plans and recorded experiments.

No dependencies, runtime source, secrets, wallet material or local generated documents
belong in this planning PR. No new spike phase is needed.

## Verification and remaining gates

The native journey check validates the graph, generated view and citations. The
supplemental command checks links, inventory status and exact reviewed source hashes:

```sh
bun run check-journeys
bun scripts/check/coverage-review.ts --review docs/spec/coverage-review-2026-10-17.yaml --complete
```

The task audit separately checks that every spine owner has a matching task file,
that its primary-ownership list matches, that all 56 steps have exactly one owner,
that prerequisites precede consumers in the documented order, and that all 48
checkpoints have build/check/walkthrough instructions. These are planning checks.
The PR records the actual repository validation results after the final edits.

Product exports are still placeholders. Combined live routes, browser edge cases,
database/contract behavior, package upgrades and independent consumer onboarding
remain implementation gates. M4.T1's native --complete test-coverage gate is expected
to fail until product tests exist. Next: review this planning PR, then explicitly
start M1.T1 checkpoint 1.
