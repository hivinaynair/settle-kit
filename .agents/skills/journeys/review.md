# Coverage review of the native spec

Read for an existing-spec or code/spec review. Keep `schema.md` and `scripts/journey.ts`
unchanged; the portable validator cannot consume this project's native format.

1. Inventory goals from decisions, exclusions and requested entry/recovery paths before
   mapping the graph. Check manual, wallet, background, host and operator handoffs.
   Map concrete criteria, not just similarly named journeys. Missing behavior remains
   unresolved; an implementation evidence gap does not reopen approved policy.
2. Use a dated supplemental `docs/spec/coverage-review-<date>.yaml` and report. Preserve
   earlier reviews as historical snapshots. O observations carry a statement and source
   path/locator; C goals carry actor, policy, status and journey/criterion references.
   Do not add O/C fields to the native spine or copy policy into a second decision record.
3. Pin clean sources to a commit. For uncommitted sources, record the base revision and
   each source's SHA-256; never imply the commit contains those edits. Source observations
   describe recorded evidence, not rerun experiments. A report committed separately
   from its reviewed sources remains a snapshot: missing or changed sources must fail
   validation. Re-read before mapping resolved gaps.
4. Walk producer/consumer handoffs, duplicate and unknown outcomes, crash boundaries,
   authorization, retries and recovery against the branch checklist. For code review,
   inspect actual assertions and label source inspection, mocks, integration and live proof.
5. Run native `bun run check-journeys`, then the supplemental link/freshness check:

   ```sh
   bun scripts/check/coverage-review.ts --review docs/spec/coverage-review-<date>.yaml --complete
   ```

   This checks reference existence, source freshness and unresolved inventory entries;
   manual review establishes mapping meaning. Removing a mapped journey in memory should
   fail its inventory links. Removing both goal and journey can still evade the checker.

Report prior findings as resolved only with actual criteria, and name new gaps separately.
Do not change approved policy to make checks pass, run live payments, or start implementation
as a side effect of planning review.
