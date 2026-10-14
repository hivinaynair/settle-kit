---
name: plan
description: Cut the approved journeys into milestone tasks; each task names the steps it serves and its tests.
---

# plan

Follow [CONTRACT](../CONTRACT.md). Inputs: journey spine, design doc. Outputs: `tasks:` in
the spine, and one `docs/tasks/M<n>.T<n>-<slug>.md` per task from
[the template](../../../docs/spec/templates/task.md). Adapted from ViperNxt's plan skill (MIT).

1. Group steps into milestones by dependency: shared foundations first (states, store,
   verifier), then each surface. A milestone ends in something that runs end to end.
2. Each task serves a set of step IDs, small enough for one PR and one reviewer sitting.
   Every step with criteria is served by exactly one task.
3. Write the task spec: served steps, files, what is new (delta only), tests named after
   steps (`J2.S3: …`) covering each criterion including its `SHALL NOT`, out of scope,
   and "Questions to answer in the PR" so the owner can explain every line.
4. Mark tasks the owner writes by hand.
5. `bun run journeys:render && bun run check-journeys`. The rendered spine lists any step
   no task serves; there must be none.

Do not restate criteria in the task; link the step IDs. A task that needs a rule the
journeys do not have goes back to [journeys](../journeys/SKILL.md).
