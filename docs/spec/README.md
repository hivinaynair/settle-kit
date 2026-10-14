# How Settle Kit goes from idea to a build-ready spec

Two artifacts, written in order. Everything else (design doc, task specs, code) links to
their IDs. Shared rules: [CONTRACT](../../.agents/skills/CONTRACT.md).

| Step | Question it answers | Artifact | How to write it | Your part |
|---|---|---|---|---|
| 1 Decide | What are we building, and what did we rule out? | [`docs/decisions.md`](../decisions.md) | [decide skill](../../.agents/skills/decide/SKILL.md) | Answer open questions, confirm the list |
| 2 Journeys | What exactly happens, step by step, including every failure? | `docs/journeys/settle-kit.yaml` | [journeys skill](../../.agents/skills/journeys/SKILL.md) | Walk each journey, challenge branches |

Then: a short design doc and task specs that cite decision and step IDs, and code whose
tests are named after steps (`it("J2.S4: …")`).

| Command | Does |
|---|---|
| `bun run journeys:validate` | Check the spine while drafting (warnings are advice) |
| `bun run journeys:render` | Regenerate the `.md` view (tables, flowcharts, criteria) |
| `bun run check-journeys` | Merge bar: spine valid with no warnings, `.md` fresh, test citations real |
| `bun run check-journeys -- --complete` | Release gate: every step a task serves has a test |

Until the new design doc lands, `docs/plans/2026-10-13-deposit-kit-design.md` and
`docs/tasks/T*.md` describe the earlier checkout-first plan: inputs, not the current spec.
