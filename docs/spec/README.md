# How Settle Kit goes from idea to a build-ready spec

Two artifacts, written in order. Everything else (design doc, task specs, code) links to
their IDs. Shared rules: the Spec process section of
[AGENTS.md](../../AGENTS.md).

| Step | Question it answers | Artifact | How to write it | Your part |
|---|---|---|---|---|
| 1 Decide | What are we building, and what did we rule out? | [`docs/decisions.md`](../decisions.md) | [decide skill](../../.agents/skills/decide/SKILL.md) | Answer open questions, confirm the list |
| 2 Journeys | What exactly happens, step by step, including every failure? What must always hold? | `docs/journeys/settle-kit.yaml` | [journeys skill](../../.agents/skills/journeys/SKILL.md) | Agree the invariants, walk each journey, challenge branches |

**Current status (2026-10-15):** decisions and journeys are complete for the agreed
narrow scope, with no owner product questions open. S14–S16 conclude exploratory
spiking. The live MetaMask result and remaining implementation acceptance checks
are recorded in [spikes](../spikes.md). Product implementation has not started.

**Next:** a short design doc and task specs that cite decision and step IDs, and code whose
tests are named after the criterion or invariant they prove (`it("J2.S4.c1: …")`,
`it("I1: …")`).

| Command | Does |
|---|---|
| `bun run journeys:validate` | Check the spine while drafting (warnings are advice) |
| `bun run journeys:render` | Regenerate the `.md` view (tables, flowcharts, criteria) |
| `bun run check-journeys` | Merge bar: spine valid with no warnings, `.md` fresh, test citations real |
| `bun run check-journeys -- --complete` | Release gate: every criterion of a served step and every invariant has a test; no open questions cited |

The earlier checkout-first plan (design doc, tasks T1–T9, handoffs) is in
[`docs/archive/`](../archive/): input for decisions, not the current spec.
