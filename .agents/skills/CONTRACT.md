# Spec contract

Shared rules for every Settle Kit skill. Adapted from ViperNxt's execution contract
(github.com/hivinaynair/vipernxt, MIT).

**Where truth lives.** Each fact has one home; link it, never copy it.

| Fact | Home |
|---|---|
| Settled choices and open questions | `docs/decisions.md` |
| Behavior: steps, branches, rules (EARS) | `docs/journeys/settle-kit.yaml` |
| Why and how it fits together | `docs/plans/<date>-settle-kit-design.md` (two pages) |
| Build order and per-task scope | `tasks:` in the spine, then `docs/tasks/M<n>.T<n>-<slug>.md` |
| Review findings | `docs/spec/review.md` |
| Live evidence (fills, tx links, timings) | `docs/spikes.md` |

**Decisions.** Record each answer once with an ID (`D12`), date and the owner's words.
Never re-ask a settled decision; change it only by adding a new decision that supersedes it.
Ask one question at a time, with a recommendation and the options you rejected.

**No guessing.** Business rules, money rules and user-visible behavior come from a decision
or a journey criterion. If a builder or writer needs one that does not exist, stop and add
an open question to `docs/decisions.md`; do not invent it. Internal technical choices
(names, file layout, helpers) are the builder's.

**Writing.** Lead with the point. Plain words: explain a term the first time it appears.
Separate fact, decision, assumption and simulation. No `TBD` in a finished artifact: either
decide it or record an open question. Budgets: design doc two pages; task spec 250 to 400
words plus its tests; decisions one line of rationale each. Caps never hide a rule.

**Money rules** (`AGENTS.md`) override everything here.

**Stage order.** decide → journeys → design → plan → spec-check → build. A later stage that
finds a gap sends it back to the stage that owns it. `docs/spec/README.md` tracks status.
