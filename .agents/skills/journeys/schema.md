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

invariants:              # rules that hold across every journey (see below)
  - id: I1
    title: One credit per transfer
    rule: THE SYSTEM SHALL NOT credit the same Base transfer (chain ID, tx hash, log index) more than once
    decisions: [D21]

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
        invariants: [I1]       # invariants this step could break if it were wrong
        criteria:              # permanent IDs; a test cites J2.S1.c1
          c1: WHEN <trigger> THE SYSTEM SHALL <behavior>
          c2: IF <what goes wrong> THE SYSTEM SHALL NOT <forbidden effect>

tasks:                   # added when tasks are planned
  - id: M1.T1
    title: Verify and settle
    serves: [J2.S3, J2.S4]
```

## What `check` enforces

Errors: missing `product` or journeys; bad ID formats; duplicate IDs; unknown actor,
surface, state, exit, invariant, `uses` or served step; a `state` without a `surface`;
`next` outside the journey or to itself; unlabeled branches; `exit` together with `next`; a
terminal step without an exit when exits are declared; unreachable steps; a step that can
only loop; a journey with no terminal step; `criteria` written as a list instead of an ID
map; an invariant without a rule; a step served by more than one task.

Warnings (fail `check`, advice in `validate`): a journey without actor, goal or exits; a
step without bucket or criteria; a criterion or invariant rule that is not EARS or uses a
vague word (*should, promptly, quickly, soon, appropriate, reasonable, as needed, if
possible, etc, properly, gracefully, seamless, usually* …; text in "double quotes" or
`backticks` is UI copy and is skipped); a step that touches money (cites a decision under
the Money heading of `docs/decisions.md`, or any invariant) with no `IF` criterion; an
unused surface, exit or invariant; a task serving nothing; a step with criteria no task
serves; `uses` of a journey not marked reusable.

Decisions: a step's `decisions` must exist in `docs/decisions.md` (read from table rows that
start with an ID) and must not be superseded. Citing an open question (`Q2`) is allowed
while drafting; `check --complete` fails until it is answered.

Citations: every test in `apps/` and `packages/` starts with what it proves: a criterion
(`it("J2.S3.c1: settles once")`), an invariant (`it("I1: …")`) or, for a critical pure
helper, a money or security decision (`it("D21: …")`). One test may prove several,
comma-separated (`it("J2.S3.c1, J2.S3.c2: …")`). A bare step ID (`J2.S3: …`) is rejected:
name the rule, not the step. `check` fails on an untraced test or a cited ID that is not on
the spine; `check --complete` (release gate) fails when a criterion of a served step, or
any invariant, has no test.

## Invariants

An invariant is a rule that must be true **always**: after every step of every journey, in
any order events arrive, and at any point the process might crash. A criterion says what
happens at one step ("WHEN a fill is verified THE SYSTEM SHALL settle once"); an invariant
says what can never be true of the system as a whole ("THE SYSTEM SHALL NOT credit the
same transfer twice"). Money bugs mostly break invariants through a path nobody drew: two
workers at once, a webhook replayed after a crash, a reorg.

- Keep the list short (a handful): only rules that, if broken, lose or invent money or
  leak a secret. Write each as an EARS rule, usually `THE SYSTEM SHALL NOT …`, that can be
  checked against stored data (rows, balances, chain logs).
- Each step that could break one lists it in `invariants:`; that step then needs an `IF`
  criterion for the case that would break it.
- Test each with many generated cases rather than one example: random event orders,
  duplicates and crash points (property-based testing, e.g. `fast-check` under `bun test`),
  asserting the rule over the final state. Name the test `I1: …`.
- The same rule is a query reconciliation can run against production data, so a broken
  invariant is detected, not just prevented.

## Why EARS

One sentence per behavior that turns directly into a test name. `SHALL NOT` states the
forbidden effect, which is where payment bugs live. EARS came from Rolls-Royce's engine
control requirements; it makes a rule unambiguous, not true. The criterion IDs, invariants
and test naming are what tie each rule to proof.
