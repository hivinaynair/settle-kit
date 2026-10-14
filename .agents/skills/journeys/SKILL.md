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
2. **Name the invariants** (`I1…`): the few rules that must hold whatever happens, such as
   "never credit a transfer twice" or "never credit more than arrived". See
   [schema: Invariants](schema.md#invariants). Agree them with the owner.
3. **Write the happy path** as steps. Tag each `script` (our code decides), `human` (a
   person acts) or `external` (Relay, Circle, a chain, an exchange, the merchant's server).
   A step that shows something names its `surface` and `state`. List the decisions a step
   relies on in `decisions:` and the invariants it could break in `invariants:`; cite an
   open question (`Q2`) rather than guess.
4. **Branch every step** with the [branch checklist](branch-checklist.md). Each answer is
   a labeled `next` edge to a new step, an exit, or a criterion saying what must not happen.
5. **Criteria in EARS**, one behavior each, keyed `c1`, `c2`…:
   `WHEN <trigger> THE SYSTEM SHALL <behavior>`; also `IF` (unwanted case), `WHILE` (state)
   and `SHALL NOT` (forbidden effect). Name the resulting state and the side effects that
   must not happen, not just what is shown. Use numbers with units ("within 60 s", "at
   Base's safe block"), never *promptly* or *as needed*. A step that touches money needs
   at least one `IF` criterion.
6. Run `bun run journeys:validate` while drafting; fix every error and warning.
7. **Walk each journey with the owner**: ordinary case, an incomplete case, an exception.
   Record corrections as decisions when they change policy.
8. `bun run journeys:render`, then `bun run check-journeys`.

Rules: IDs are permanent (steps, criteria and invariants). Never renumber or reuse; insert
`J2.S3b` between `J2.S3` and `J2.S4`; add a criterion as the next free `cN`; retire one by
deleting it, never by reusing its ID. A changed meaning gets a new ID, so old tests stop
resolving instead of silently proving the wrong rule. Never hand-edit the
generated `.md`. A step needs no surface if nothing is shown; do not invent UI for a script step.
