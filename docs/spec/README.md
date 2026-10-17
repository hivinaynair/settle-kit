# How Settle Kit goes from idea to a build-ready spec

Two artifacts, written in order. Everything else (design doc, task specs, code) links to
their IDs. Shared rules: the Spec process section of
[AGENTS.md](../../AGENTS.md).

| Step | Question it answers | Artifact | How to write it | Your part |
|---|---|---|---|---|
| 1 Decide | What are we building, and what did we rule out? | [`docs/decisions.md`](../decisions.md) | [decide skill](../../.agents/skills/decide/SKILL.md) | Answer open questions, confirm the list |
| 2 Journeys | What exactly happens, step by step, including every failure? What must always hold? | `docs/journeys/settle-kit.yaml` | [journeys skill](../../.agents/skills/journeys/SKILL.md) | Agree the invariants, walk each journey, challenge branches |

**Current status (2026-10-17):** the [technical design](../plans/2026-10-15-deposit-sdk-technical-design.md)
and [16 task specs](../tasks/README.md) assign all 56 steps across 12 journeys.
The [three coverage gaps](coverage-resolution.md) now have explicit acceptance
behavior, including D129's approved evidence labels. No owner product question is
open. S14–S16 conclude exploratory spiking; the live MetaMask result and remaining
implementation acceptance checks are recorded in [spikes](../spikes.md).
Product implementation has not started.

The [current design/coverage review](coverage-review-2026-10-17.md) records the four
technical clarifications and their task owners. All 16 tasks now have three learning
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
