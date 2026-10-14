---
name: spec-check
description: Independently review decisions, journeys, design and tasks for gaps and contradictions. Reports; never edits.
---

# spec-check

Run as a separate agent or session from the one that wrote the spec. Read-only: report,
never edit. Adapted from ViperNxt's spine-checker (MIT). Output goes into
`docs/spec/review.md` ([template](../../../docs/spec/templates/review.md)), written by the
caller.

Check, and cite file and ID for every finding:

1. `bun run check-journeys` passes. Paste the summary line.
2. **Coverage both ways.** Every in-scope decision is reflected in a journey; every
   criterion traces to a decision or an obvious consequence; every step is served by
   exactly one task; every task cites real steps.
3. **Branches.** Apply the [branch checklist](../journeys/branch-checklist.md) to each
   step. Report missing branches, dead ends, and loops with no exit.
4. **Contradictions.** Walk one ordinary, one incomplete and one failing payment across
   decisions, journeys, the state table and tasks: a state change the table forbids, a
   rule two places state differently, a surface state no step reaches.
5. **Money rules** from `AGENTS.md`: settle only on a verified transfer at `safe`; no
   float amounts; no secrets in errors; treasury and refund addresses from config only.

Return pass or fail, then findings ordered by severity, each with the smallest fix and
which stage owns it. Never approve policy for the owner.
