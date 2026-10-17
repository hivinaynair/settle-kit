# Settle Kit coverage review

The existing graph passes its native validator, but the inventory review found three
incompletely specified paths within two goals. This is a planning review of revision
`635fc602b2d247027decca5715741917c63da026`, not a payment-system audit or runtime proof.

Applied the reusable decide/journeys instructions from local Decision Journeys
commit `653d52d`. Existing accepted decisions were retained; no new policy was approved
and no application implementation was changed.

## Findings

| Finding | Existing basis | What is missing | Next action |
|---|---|---|---|
| Positive non-USDC/native-ETH rescue path | D33, I11; J7.S2 rejects `rescue(USDC)` | J7 covers over-limit USDC, but not the allowed rescue success path, fixed-destination receipt and how the operator distinguishes recovery from payer repayment | Expand the existing contract/operator specification using D33; keep SDK recovery tooling excluded by X6 |
| Record repayment and close recovery alert | D51/D54; J7.S3.c3 | A condition says the alert stays open until host resolution, but the actor action, authorization, evidence recording and resulting alert state are not mapped end to end | Specify the documented operator procedure; do not introduce a generic resolve API or automatic payer refund |
| Address-poisoning protection | D43; J2.S1/J3.S1; J9.S2.c4 | Account ownership, fixed recipients and accessibility are specified, but the promised poisoning protection has no concrete interaction/acceptance criterion | Define what protection the existing promise means, then add traceable acceptance behavior; do not claim fixed-recipient checks alone fulfill it |

These are specification gaps, not demonstrated exploits or runtime defects. The
first two are grouped under C11; the third is C13. No claim is made that all other
branches are exhaustive. Existing tests or an invariant alone do not substitute for
an operator/user path.

## What was checked

1. Read current accepted decisions, exclusions and the implementation/evidence status.
2. Wrote [18 inventory goals](coverage-inventory-first.md) before detailed journey mapping.
3. Walked all 11 journeys and mapped the inventory to specific steps/criteria.
4. Recorded [seven source-backed observations and final mappings](coverage-review.yaml).
   All observation sources inherit the file's `reviewed_revision`. Descriptions of
   S15/S16 are observations of recorded evidence; those experiments were not rerun.
5. Ran the native graph/render/reference check and a separate review-link check.
6. Removed J5 in an in-memory copy: the review checker caught C7's missing journey
   and its two missing criterion references. The on-disk spine stayed unchanged.

Results: 13 mapped goals, three explicit exclusions, two unresolved goals. All 11
journeys are accounted for, including J7 as partial coverage within unresolved C11.
Native `check-journeys` passes. Review links and pinned source contents pass.
The review completeness gate fails deliberately on C11/C13.

```sh
bun run check-journeys
bun scripts/check/coverage-review.ts
bun scripts/check/coverage-review.ts --complete
```

The last command is expected to exit 1 until the two goals are resolved. The helper
checks current IDs, source locators and source contents against the reviewed commit.
It is a narrow adapter for this review, not a general YAML schema validator. After
source changes, re-review affected observations before updating the pinned revision.
It is not installed into pre-commit or CI automatically.

## Portability finding

The reusable skills apply, but the reusable validator cannot directly consume Settle
Kit's native schema. Its decision table lacks the portable Status column; its journey
format has `bucket`, reusable `uses` calls, string `next` targets and structured exits.
A direct portable validation attempt failed on format incompatibility; those errors
are not missing business decisions. No conversion or policy duplication was made.

The supplemental review uses a named host-specific format. Settle Kit's native checker
remains responsible for the graph. A future reusable integration should offer an
explicit format adapter or migration, preserving reusable subjourneys and stable IDs.
Do not advertise the optional validator as automatically compatible with any repo.

## Evidence and practical next step

Core, server and React public entry points currently contain empty exports. The spec
and spike record already distinguish the agreed design from implementation. Combined
Arbitrum route, workflow-upgrade recovery and separate-consumer onboarding proofs
remain implementation acceptance work. No chain call, wallet interaction, service
startup or product behavior test was performed for this review.

Complete the three small specification details before their implementation tasks.
Carry existing D57/D142 proofs into those tasks instead of opening another spike phase.
The skills are useful here because an inventory exposes accepted goals that a valid
graph only partially represents. They do not automatically discover every missing
goal, prove a mapping's meaning, approve policy or establish implementation correctness.
