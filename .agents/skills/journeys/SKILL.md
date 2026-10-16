---
name: journeys
description: Map or review Settle Kit actor journeys, failure branches, invariants and testable criteria. Use for new or changed behavior and coverage reviews; skip trivial edits and do not invent product policy.
---

# journeys

Input: approved requirements in `docs/decisions.md` and relevant project context;
decide need not run again for settled scope. Output: `docs/journeys/settle-kit.yaml`
and generated adjacent `.md`. Follow `AGENTS.md` and the native [schema](schema.md);
preserve `bucket`, reusable `uses`, structured exits and task ownership.
Adapted from ViperNxt's journeys skill (MIT), with reusable agentic-skills guidance.

1. Inventory actors, goals and recovery entry points from approved scope **before**
   mapping journeys. Mark goals mapped, excluded or unresolved; exclusions need X
   policy. Do not derive the inventory only from the existing graph or count a
   partly represented goal as complete. For reviews, use [coverage review](review.md)
   to keep observations and mappings outside the native spine.
2. List journeys and cross-path invariants. Ground desired behavior in decisions;
   distinguish source-backed observations from approval. Keep missing policy as Qs
   and unresolved coverage, never placeholder criteria or invented limits. Reuse
   authorized scope; ask only about unsettled choices and block only affected paths.
3. Write steps with `bucket: script | human | external`, labeled branches and named
   outcomes or reconnections. A `uses` step delegates to its reusable journey. Steps
   cite decisions and invariants they could break; draft Q citations are allowed.
   Name a surface/state only when one exists; do not invent UI for background work.
4. Apply the [branch checklist](branch-checklist.md). Write one observable behavior per
   EARS-style criterion: `WHEN … THE SYSTEM SHALL …`, `WHILE … THE SYSTEM SHALL …`,
   or `IF … THE SYSTEM SHALL NOT …`. State the result and forbidden side effects;
   money-risk steps require the IF/SHALL NOT criterion. Use justified numbers with
   units and precise states, never invented policy or vague timing. Preserve exclusive
   Base-safe backing, source attribution and separate host acknowledgment rules.
5. Walk normal, incomplete and exception cases with the owner as needed; do not
   re-ask settled answers. Compare the independent inventory with every entry and
   recovery path; verify mapping meaning as well as IDs. Report conflicts without
   changing policy. Review linked tasks/tests after any meaning change. IDs stay
   permanent: record removals in the spine's retirement comments; never reuse them.
6. Run `bun run journeys:validate` while drafting. After spine edits run
   `bun run journeys:render`, then `bun run check-journeys`; resolve warnings before
   the merge check. Never hand-edit generated Markdown. The native `--complete` gate
   checks test citations and open Qs; it is not the portable `--ready`/`--coverage` gate.

Keep source observations, reference checks, executed tests and reviewed assertions
distinct. A valid graph, linked test or completed coverage inventory does not prove
implementation or live behavior. Preserve the host's criterion/invariant test naming.
