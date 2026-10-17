# UX specification review: five approved improvements

2026-10-17. Vinay explicitly requested all five UX recommendations in decisions,
journeys and relevant tasks, followed by a PR, with no implementation. D112–D116
record that approval. This review checks the resulting specification and handoffs.

## Mapping and checks to implement

| Improvement | Policy | Acceptance references | Implementation and verification owners |
|---|---|---|---|
| Return to unfinished payments; distinguish unavailable history | D112 | J8.S1.c9–c15; J9.S1.c4/c8 | M1.T1 contracts; M2.T4 read transport; M3.T2 controller; M3.T3 widget |
| Explain signing and review expired quotes without losing input | D113 | J8.S2.c14–c15; J8.S3.c6; J8.S9.c3 | M1.T4 immutable preparation result; M3.T2 consent; M3.T3 presentation |
| Give exceptions an outcome, next actor/action and existing reference | D114 | J2.S5.c15; J3.S5.c16; J8.S8.c6; J8.S10.c6–c7; existing J8.S11.c4 | M2.T4/M2.T6/M3.T1 data; M3.T2/M3.T3 presentation |
| Separate connection failure from payment state; announce meaningful changes | D115 | J9.S1.c4–c8; J9.S2.c6–c7 | M1.T1 contracts; M2.T4 transport; M3.T2/M3.T3 client |
| Complete manual copy feedback, fallback and persistent chain labeling | D116 | J2.S1.c14–c18; J3.S1.c15–c19 | M3.T2 scoped state; M3.T3 browser checks |

M4.T1 checks all five in the separately installed consumer. The added cases include
initial/refresh failures, changed accounts, expired signing prompts, unknown acceptance,
host-side attention, failed clipboard access and stale copy completions. They remain
tests to implement; this planning change does not execute or prove those interactions.

## Policy and identity boundaries

- Retry of a status read uses existing authenticated history/status methods and records.
- Quote review cannot replace an accepted or uncertain attempt or extend signed validity.
- A connection failure cannot advance payment state or authorize another transfer.
- Retaining a snapshot during connection failure never bypasses account authorization.
- Copy/QR interaction cannot create chain evidence or begin money processing.
- Both entry methods remain available; changing methods is not recovery for a pending payment.
- A business-side problem uses its existing support process and account-scoped reference.
  No new support service, ticketing integration, public method or refund tool is introduced.

The technical design assigns the client/data responsibilities by policy ID. It does
not replace the decision rows or EARS criteria as the behavioral source of truth.

## Review method and stable IDs

Re-read the approved decisions and the independent 18-goal inventory before mapping
the new details. These refinements fit its existing payer, UI and recovery goals;
there are still 15 mapped goals and three explicit exclusions. Reviewed the affected
normal, incomplete and failure paths plus account/mode changes against the branch
checklist. Re-read the earlier 14 observations and their sources before carrying them
into the new review data, then added five UX observations with current source hashes.

No journey, step, invariant or task ID was renumbered. J8.S1.c1 previously required
amount entry immediately on opening the wallet view. Its changed meaning now lives
in J8.S1.c9 after history recovery, and c1 is explicitly retired. There are 33 new
criteria and one retired criterion; all other existing criteria retain their text.
The 12 journeys, 56 steps, 16 primary task owners and 48 review checkpoints remain.

Earlier reports and pinned hashes stay unchanged as historical snapshots. The
[current review data](coverage-review-2026-10-17-ux.yaml) records the base revision
and SHA-256 of the actual reviewed sources. The base commit does not contain these
edits. Use this review to check the current specification; do not refresh old hashes
to make historical reports appear current.

## Planning validation

```sh
bun run journeys:validate
bun run journeys:render
bun run check-journeys
bun scripts/check/coverage-review.ts --review docs/spec/coverage-review-2026-10-17-ux.yaml --complete
```

The task audit checks owner lists, prerequisite order, referenced IDs, local links and
all 48 checkpoint structures. The lifecycle audit checks the exact criterion addition,
retirement and absence of silent rewrites. Repository checks are recorded in the PR.
These validate planning structure and source freshness, not UX quality or live behavior.

No runtime source, dependency, money rule, recorded experiment or native planning
tooling was changed. Implementation remains unstarted; M1.T1 checkpoint 1 is the
next product step only when Vinay explicitly requests it.
