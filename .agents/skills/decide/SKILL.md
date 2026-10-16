---
name: decide
description: Clarify vague tickets or ideas into Settle Kit decisions, scope and open questions. Use for uncertain requirements or decision handoffs; skip trivial edits and fully specified implementation.
---

# decide

Input: a ticket, idea or discussion plus project context. Output: `docs/decisions.md`,
preserving its sections and native table. Follow the Spec process in `AGENTS.md`.

1. Read existing decisions and the relevant design, tasks and request sources. Scope
   to the requested feature; reuse settled answers and re-read shared files before edits.
2. Establish users, problem, intended outcome, scope and constraints before detailing
   a solution. Extract known answers; flag contradictions and assumptions. Ask what
   observable result would satisfy an unclear ticket; invent neither metrics nor policy.
3. Keep approved decisions, observations, recommendations and unknowns distinct.
   Cite policy authority and evidence sources without inventing approval. Code, agent
   suggestions and silence do not approve policy. Identify the answer owner; the
   implementing engineer may not own product choices. Observations belong in the
   sourced coverage review when needed, not new D rows or fields in the native spine.
4. Record approved answers once as D decisions or X exclusions, with rationale,
   genuinely rejected alternatives and date. Keep missing user-visible, business or
   money rules as Qs with recommendation, alternatives, blocked work and answer owner
   (unknown if necessary). Ask the question that unblocks most work, one at a time
   unless a batch is requested; continue independent work. Internal technical choices
   belong to the builder. Prepare stakeholder questions without contacting anyone.
5. Follow the host's ID lifecycle: before the first slice 1 task merges, edit a changed
   decision in place and update every citation together; afterward append a superseding
   row. Never reuse retired IDs or silently rewrite criteria to fit changed policy.
   Preserve the table format; do not import the portable checker's Status column.
6. Check scope: each requested feature is in scope or explicitly excluded with a reason;
   "later" is out. End with accepted scope, blockers and next action. A journeys handoff
   separates ready scope from blocked paths; do not wait on unrelated questions or
   reopen completed planning merely because implementation proof is pending.

Done: enough approved policy for the requested slice, or explicit blockers. Planning
alone does not authorize implementation, commits or publishing.
