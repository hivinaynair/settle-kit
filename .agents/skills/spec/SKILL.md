---
name: spec
description: Entry point. Find the current spec stage from docs/spec/README.md and run that stage's skill.
---

# spec

Read [CONTRACT](../CONTRACT.md) and the status table in `docs/spec/README.md`. Load only the
skill for the first stage that is not `done`:

| Stage | Skill | Done when |
|---|---|---|
| 1 Decide | [decide](../decide/SKILL.md) | Every feature and policy in scope has a decision; no open question blocks scope |
| 2 Journeys | [journeys](../journeys/SKILL.md) | `bun run check-journeys` passes and the owner walked every journey |
| 3 Design | [design](../design/SKILL.md) | Two-page design doc links decisions and journeys; nothing duplicated |
| 4 Plan | [plan](../plan/SKILL.md) | Every step is served by a task; every task has a spec |
| 5 Check | [spec-check](../spec-check/SKILL.md) | Independent review has no open material finding |
| 6 Build | [build](../build/SKILL.md) | Per task, until `bun run check-journeys -- --complete` passes |

Do the stage's work, update its row (status, date, PR) and stop at the owner's review
points: the decision list, each journey walkthrough and the final approval. Do not ask for
approval between technical steps the owner already authorized.

A change request is not a new project: find the stage that owns the changed fact, change
it there, then re-run the later stages only for what that change touches.
