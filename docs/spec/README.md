# How Settle Kit goes from idea to a build-ready spec

Two artifacts, written in order. Everything else (design doc, task specs, code) links to
their IDs. Shared rules: the Spec process section of
[AGENTS.md](../../AGENTS.md).

| Step | Question it answers | Artifact | How to write it | Your part |
|---|---|---|---|---|
| 1 Decide | What are we building, and what did we rule out? | [`docs/decisions.md`](../decisions.md) | [decide skill](../../.agents/skills/decide/SKILL.md) | Answer open questions, confirm the list |
| 2 Journeys | What exactly happens, step by step, including every failure? What must always hold? | `docs/journeys/settle-kit.yaml` | [journeys skill](../../.agents/skills/journeys/SKILL.md) | Agree the invariants, walk each journey, challenge branches |

**Current status (2026-10-18):** the [technical design](../plans/2026-10-15-deposit-sdk-technical-design.md)
and [22 task specs](../tasks/README.md) assign all 80 steps across 15 journeys.
The [three coverage gaps](coverage-resolution.md) now have explicit acceptance
behavior, including D129's approved evidence labels. No owner product question is
open. S14–S16 conclude exploratory spiking; the live MetaMask result and remaining
implementation acceptance checks are recorded in [spikes](../spikes.md).
Product implementation has not started. Vinay approved Solana as a native-USDC
source settling only to Base (D6); its added implementation gates are D58.
No Solana wallet, exchange, program or cross-chain path is yet proven.

The [technical review](coverage-review-2026-10-17.md) records the four design
clarifications and their task owners. The [earlier UX review](coverage-review-2026-10-17-ux.md)
records the approved D112–D116 refinements and their acceptance/task mappings.
The [current Solana review](coverage-review-2026-10-18-solana.md) traces the new
source paths and shared handoffs. All 22 tasks have three learning
checkpoints, focused checks and a code walkthrough. Follow the
[review-and-pause protocol](../tasks/README.md#how-we-implement-together).

**Next:** review the planning PR, then explicitly start M1.T1 checkpoint 1. Implementation tests will
name the criterion or invariant they prove (`it("J2.S4.c1: …")`, `it("I1: …")`).
Passing the planning checker does not establish implementation or live-route coverage.

| Command | Does |
|---|---|
| `bun run journeys:validate` | Check the spine while drafting (warnings are advice) |
| `bun run journeys:render` | Regenerate the `.md` view (tables, flowcharts, criteria) |
| `bun run check-journeys` | Merge bar: spine valid with no warnings, `.md` fresh, test citations real |
| `bun run check-journeys -- --complete` | Release gate: every criterion of a served step and every invariant has a test; no open questions cited |

The earlier checkout-first plan (design doc, tasks T1–T9, handoffs) is in
[`docs/archive/`](../archive/): input for decisions, not the current spec.
