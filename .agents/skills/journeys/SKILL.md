---
name: journeys
description: Write the journey spine: every actor path, branch and exit, with EARS acceptance criteria, then validate.
---

# journeys

Follow the Spec process section of `AGENTS.md`. Input: `docs/decisions.md`. Output:
`docs/journeys/settle-kit.yaml` (source of truth) and its generated `.md`.
Format: [schema](schema.md). Example: [example.yaml](example.yaml).
Adapted from ViperNxt's journeys skill (MIT).

1. **List journeys first.** One per actor goal (developer integrates, buyer pays by QR, …).
   Agree the list, actors and surfaces with the owner before writing steps.
2. **Write the happy path** as steps. Tag each `script` (our code decides), `human` (a
   person acts) or `external` (Relay, Circle, a chain, an exchange, the merchant's server).
   A step that shows something names its `surface` and `state`.
3. **Branch every step** with the [branch checklist](branch-checklist.md). Each answer is
   a labeled `next` edge to a new step, an exit, or a criterion saying what must not happen.
4. **Criteria in EARS**, one behavior each: `WHEN <trigger> THE SYSTEM SHALL <behavior>`;
   also `IF` (unwanted case), `WHILE` (state) and `SHALL NOT` (forbidden effect). Name the
   resulting state and the side effects that must not happen, not just what is shown.
5. Run `bun run journeys:validate` while drafting; fix every error and warning.
6. **Walk each journey with the owner**: ordinary case, an incomplete case, an exception.
   Record corrections as decisions when they change policy.
7. `bun run journeys:render`, then `bun run check-journeys`.

Rules: IDs are permanent. Never renumber or reuse; insert `J2.S3b` between `J2.S3` and
`J2.S4`; retire a step by deleting it, never by reusing its ID. Never hand-edit the
generated `.md`. A rule with no decision behind it becomes an open question, not a guess.
A step needs no surface if nothing is shown; do not invent UI for a script step.
