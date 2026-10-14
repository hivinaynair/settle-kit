# Journey spine format

One YAML file, `docs/journeys/settle-kit.yaml`. `bun run journeys:render` writes the `.md`
beside it (tables, Mermaid flowcharts, criteria); never edit that file by hand.
Adapted from ViperNxt's spine schema (MIT).

```yaml
product: settle-kit
source: docs/plans/<date>-settle-kit-design.md

actors:
  - id: buyer            # referenced by journey.actor
    name: Buyer
    type: person         # person | system | external

surfaces:                # anything an actor sees or calls
  - id: checkout
    kind: component      # component | hook | endpoint | webhook | page | cli
    states: [choose_route, pay, processing, paid, needs_attention, expired]

journeys:
  - id: J2
    title: Buyer pays an order by QR
    actor: buyer
    goal: Pay the exact amount from any wallet or exchange
    proves: A payment counts only after the Base transfer is verified
    reusable: false      # true lets other journeys include it with `uses`
    entry: J2.S1         # optional; default is the first step
    exits:               # every way the journey can end
      - { id: paid, title: Order paid; merchant notified once }
    steps:
      - id: J2.S1        # J<n>.S<n>, or J2.S1b to insert later
        title: Sees what to send
        bucket: script   # script | human | external
        surface: checkout
        state: pay
        sees: what is on screen (or in the payload) at this moment
        does: the action taken
        next: J2.S2      # or [{ to: J2.S3, when: verified }, { to: J2.S3b, when: rejected }]
        # exit: paid     # instead of next, on a terminal step
        # uses: J9       # this step is the whole reusable journey J9
        decisions: [D21, D22]  # IDs from docs/decisions.md this step relies on (D, X or Q)
        criteria:
          - WHEN <trigger> THE SYSTEM SHALL <behavior>

tasks:                   # added when tasks are planned
  - id: M1.T1
    title: Verify and settle
    serves: [J2.S3, J2.S4]
```

## What `check` enforces

Errors: missing `product` or journeys; bad ID formats; duplicate IDs; unknown actor,
surface, state, exit, `uses` or served step; a `state` without a `surface`; `next` outside
the journey or to itself; unlabeled branches; `exit` together with `next`; a terminal step
without an exit when exits are declared; unreachable steps; a journey with no terminal step.

Warnings (fail `check`, advice in `validate`): a journey without actor, goal or exits; a
step without bucket or criteria; a criterion that is not EARS; an unused surface or exit;
a task serving nothing; `uses` of a journey not marked reusable.

Decisions: a step's `decisions` must exist in `docs/decisions.md` (read from table rows that
start with an ID) and must not be superseded. Citing an open question (`Q2`) is allowed
while drafting; `check --complete` fails until it is answered.

Citations: every test in `apps/` and `packages/` starts with a step ID (`it("J2.S3: settles
once")`) or, for a critical pure helper, a decision ID (`it("D21: …")`); untraced tests fail
`check`. `check` fails on a cited ID that is not on the spine;
`check --complete` (release gate) fails when a served step with criteria has no test.

## Why EARS

One sentence per behavior that turns directly into a test name. `SHALL NOT` states the
forbidden effect, which is where payment bugs live.
