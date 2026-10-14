# Spec contract

Shared rules for every Settle Kit skill. Adapted from ViperNxt's execution contract
(github.com/hivinaynair/vipernxt, MIT).

**Where truth lives.** Each fact has one home; link it, never copy it.

| Fact | Home |
|---|---|
| Settled choices and open questions | `docs/decisions.md` |
| Behavior: steps, branches, rules (EARS) | `docs/journeys/settle-kit.yaml` |
| Live evidence (fills, tx links, timings) | `docs/spikes.md` |

Design docs and task specs link decision (`D7`) and step (`J2.S4`) IDs; they never restate
them.

**Decisions.** Record each answer once with an ID (`D12`), date and the owner's words.
Never re-ask a settled decision; change it only by adding a new decision that supersedes it.
Ask one question at a time, with a recommendation and the options you rejected.

**No guessing.** Business rules, money rules and user-visible behavior come from a decision
or a journey criterion. If a builder or writer needs one that does not exist, stop and add
an open question to `docs/decisions.md`; do not invent it. Internal technical choices
(names, file layout, helpers) are the builder's.

**Writing.** Lead with the point. Plain words: explain a term the first time it appears.
Separate fact, decision, assumption and simulation. No `TBD` in a finished artifact: either
decide it or record an open question. Decisions: one line of rationale each.

**Money rules** (`AGENTS.md`) override everything here.

**Order.** Decisions first, then journeys. A journey that needs a rule with no decision
behind it adds an open question and waits for the answer.
