---
name: decide
description: Turn discussion into numbered decisions and open questions in docs/decisions.md, one question at a time.
---

# decide

Follow [CONTRACT](../CONTRACT.md). Output: `docs/decisions.md` from
[the template](../../../docs/spec/templates/decisions.md).

1. Read `docs/decisions.md`, the design doc and the source the owner names (a conversation,
   notes, an issue). Extract what is already settled; record it, do not re-ask it.
2. Group decisions by area: scope, product behavior, money rules, architecture, SDK,
   operations, release. Each row: ID, decision, why (one line), rejected options, date.
3. List open questions separately. Each: ID (`Q4`), the question, your recommendation, what
   it blocks, who answers. Ask the owner the single question that blocks the most scope.
4. When answered, move it to decisions with the owner's words. A reversal adds a new
   decision with `supersedes: D7`; never edit the old row's meaning.
5. Scope check: every feature named in decisions is either in scope (it will get journeys)
   or explicitly out with a reason. "Later" is out.

Done when no open question blocks in-scope work. Update `docs/spec/README.md`.
