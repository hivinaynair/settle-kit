---
name: design
description: Write the two-page design doc that explains why and how, linking decisions and journeys instead of repeating them.
---

# design

Follow [CONTRACT](../CONTRACT.md). Inputs: `docs/decisions.md`, the journey spine.
Output: `docs/plans/<date>-settle-kit-design.md` from
[the template](../../../docs/spec/templates/design-doc.md). Two pages, hard cap.

The design doc holds only what no other artifact holds:

- **Claim**: what Settle Kit is, for whom, what it is not.
- **Actors** and what each may and must never do.
- **Architecture**: the pieces and how a payment moves through them, one diagram.
- **Entities and states**: the short list of things (Order, Payment, …) and the state
  table with final states. This is the light ontology; journeys cite it.
- **Integrations**: each outside service, what we trust it for and what we verify.
- **Honest limits** and **open questions** (links into `docs/decisions.md`).

It does not repeat: decisions (link `D` IDs), step behavior (link `J` IDs), task order,
schemas or code. If writing it exposes a missing rule, add an open question and send it
back to [decide](../decide/SKILL.md) or a missing branch back to
[journeys](../journeys/SKILL.md).

Replacing an older design doc: move anything still true into the right home, delete the
rest, and say in the PR where each old section went.
