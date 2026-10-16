# Coverage review · 2026-10-16

The reviewed working-tree specification maps all 18 goals: 15 in scope and three explicitly
excluded. The three gaps from the earlier review now have concrete acceptance behavior.
No additional missing actor goal was identified in this bounded review. This is a
specification review, not evidence of product implementation or live payment correctness.

## Inputs and method

Reviewed the working tree based on `0b8451c0fd38bfa056a76ec14edccb538b8c13be`, including
uncommitted decisions, journeys, technical design and task documents. That commit does
**not** contain all reviewed content. Each source reference in the
[dated review data](coverage-review-2026-10-16.yaml) records a SHA-256 of the actual file
read, plus a locator. O/C IDs are local to this review, not new product policy.

This PR includes the skills, review and supplemental checker only. The reviewed spec
edits, technical design, task plan and historical review files remain separate,
uncommitted work. The result below applies to that working-tree snapshot, **not** to
the PR branch or `main`. Running the dated review here must fail on absent/changed
sources and unmapped references until those source changes land. Keep the PR draft
pending that reconciliation; never refresh hashes just to make this branch pass.

Applied the local skills adapted from agentic-skills `35d698e`: ticket clarification,
separate observations and approved decisions, an inventory before graph mapping, and
focused branch review. The native schema, validator, retirement comments and test naming
remain authoritative. No portable schema fields or checker were installed.

Re-read the accepted decisions and exclusions against the local independent inventory
(`docs/spec/coverage-inventory-first.md`, outside this PR) before revisiting its journey
mappings. The dated YAML retains its 18 goals and IDs; current scope did not require new
goals. Checked
setup/mode isolation, stable addresses, both manual routes, quote/sign/accept paths,
pre-transfer history, unknown and duplicate outcomes, notification recovery, scan and
workflow recovery, reorg incidents, Circle delays, exceptional host funding, asset
recovery, UI protection, operator alerts and public-evidence requirements. Exclusions
remain scope decisions, not permission to omit their in-scope contract/operator paths.

Manually compared the mapped criteria with those goals, including ordinary, incomplete
and exception cases. Native checks establish graph/render/citation consistency; the
supplemental checker establishes link existence, source freshness and inventory status.
Neither checker establishes the semantic sufficiency of a mapping.

## Earlier findings

| Earlier gap | Current acceptance behavior | Planned implementation owner |
|---|---|---|
| Positive non-USDC/native-ETH rescue | J12.S1–S3 and S6 cover case creation, fixed-destination success, failure, safe verification, deduplication and unresolved evidence; J12.S3.c3 forbids USDC credit/drain attribution | M1.T3 and M3.T1 |
| Record repayment and close its alert | D129; J7.S3.c5 hands off to J12.S4–S5 for authorization, explicit evidence labels, beneficiary confirmation, atomic closure and duplicate/crash handling; J12.S6 retains incomplete cases | M3.T1 |
| Address-poisoning protection | D43; J2.S1.c11–c13, J3.S1.c12–c14 and J9.S2.c5 bind display/copy/QR to the stored account/chain address, reject counterparty suggestions and clear stale instructions | M3.T2 and M3.T3 |

These findings are resolved **in the reviewed working-tree specification**. The original
`coverage-review.md`, its revision-pinned YAML and `coverage-resolution.md` remain
unchanged in the original checkout as historical evidence, outside this PR.

## Validation

```sh
bun run check-journeys
bun scripts/check/coverage-review.ts --review docs/spec/coverage-review-2026-10-16.yaml --complete
```

Reviewed working-tree results: 12 journeys, 56 steps, 16 primary task owners;
18 inventory goals, nine observations, 15 mapped goals, three exclusions, no unresolved goals or link/source
errors. Matching task files exist and their primary-ownership lists match the spine.

Read-only sensitivity checks removed J12 from an in-memory spine: the review links
failed on C11, including its missing J12 journey and criteria. Removing J5 likewise
failed C7. A temporary review with a changed source hash failed freshness checking.
These probes did not edit the source spine. Deleting both an inventory goal and its
journey can still evade a structural checker; source-based inventory review remains
necessary.

The supplemental checker now accepts `--review <file>` and per-source hashes for dirty
working trees. Its default path and commit-pinned checks remain available for historical
reviews. The native `scripts/journey.ts` and schema were not changed.

Original working-tree checks: formatting/lint, workspace types (cached results), semantic tokens,
native draft validation (zero warnings), native journey/render/citation checks and all
32 tooling tests passed (74 assertions). Skill frontmatter and relative references were
also checked with Bun. The skill-creator Python helper was unavailable because PyYAML
is not installed; no dependency was added. These were local checks, not a fresh-agent
automatic-discovery evaluation. Baseline hashes confirm all 35 protected source, native
tooling and historical-review files stayed unchanged. The global `git diff --check`
still reports three pre-existing Markdown hard-break spaces in the generated journey
view; that file was preserved rather than hand-edited.

Isolated PR-branch checks: formatting/lint, workspace types (four cached tasks and one
fresh task), tokens, native journey/render/citation validation and 36 tooling tests
passed (83 assertions). Four new regression cases cover matching sources, source drift,
absent snapshot files and a removed mapped journey. The dated snapshot check correctly
fails against this branch with 68 link/source errors because the reviewed spec changes
are excluded. A read-only run of this PR's checker against the original reviewed sources
passes with no unresolved goals or errors. The PR diff has no whitespace errors.

## Remaining evidence

Core, server and React entry points still contain empty exports. Product implementation
has not started. S16's recorded Base Sepolia MetaMask result was read, not rerun. The
combined Arbitrum route, upgrade recovery, independent consumer onboarding and remaining
browser rejection/switch cases are still implementation acceptance work under D57/J11.

No new product policy was approved, no application or chain behavior was exercised, and
no new spike phase is implied. The next product step remains the existing design review
and explicit start of M1.T1. Future source edits invalidate the hashes and require an
affected-scope review; do not refresh hashes mechanically to make the check pass.
