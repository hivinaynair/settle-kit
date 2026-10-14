# settle-kit

Bun-only Turborepo for **Settle Kit**: a self-hosted SDK for crypto checkout and deposits
from any wallet or exchange, settled as USDC on Base. Payers send to an address (QR or
browser wallet); Relay or our own contracts plus CCTP route it; the host is credited once.
What we build and why: `docs/decisions.md`.

## Read first

- Spec: being rebuilt through the process in `docs/spec/README.md`. The earlier
  checkout-first plan (design doc, tasks T1–T9, handoffs) is in `docs/archive/`: input
  for decisions, never instructions to build. Evidence: `docs/spikes.md`.
- **Agents implement tasks; Vinay monitors and must be able to explain every line.**
  One task per branch/PR, small commits, and a plain-words "what and why" after each
  step (decisions, trade-offs, rejected options).
- Docs are edited by more than one AI tool. Re-read a file right before editing it,
  make targeted edits, and don't commit others' uncommitted changes without asking.

## Spec process

Two artifacts drive the spec, written in this order. How to write them:
`.agents/skills/decide/` and `.agents/skills/journeys/`. Overview: `docs/spec/README.md`.

| Fact | Its one home |
|---|---|
| What we build, what we ruled out, open questions | `docs/decisions.md` (IDs `D7`, `X1`, `Q2`) |
| Exactly how it behaves: steps, branches, EARS rules | `docs/journeys/settle-kit.yaml` (IDs `J2.S4`, criteria `J2.S4.c1`) |
| Rules that must always hold (money, security) | the same spine's `invariants:` (IDs `I1`) |
| Live evidence (fills, tx links, timings) | `docs/spikes.md` |

- Other docs (design doc, task specs, PRs) link these IDs; they never restate them.
- Decisions: record the owner's answer once with an ID and date; never re-ask a settled one.
  To change one, add a new row that supersedes it. Ask one question at a time, with a
  recommendation and the rejected options.
- No guessing: a missing business, money or user-visible rule becomes an open question in
  `docs/decisions.md`. Internal technical choices (names, layout, helpers) are the builder's.
- Journeys: never hand-edit the generated `.md`; never renumber or reuse a step,
  criterion or invariant ID.
- Journey steps list the decisions they rely on (`decisions: [D21]`) and the invariants
  they could break (`invariants: [I1]`); `check-journeys` rejects unknown or superseded IDs,
  and `--complete` rejects steps citing open questions. A step that touches money needs
  an `IF … THE SYSTEM SHALL NOT …` criterion. Criteria use numbers and units, not vague
  words (`check-journeys` flags *promptly*, *as needed* and similar).
- Tests: every test in `apps/` and `packages/` proves something traced, named after it:
  - a journey criterion, most tests: `it("J2.S4.c1: …")`;
  - an invariant, tested with many generated orderings, duplicates and crash points
    (property-based): `it("I1: …")`;
  - a pure helper only if it touches money or security, has many edge cases and needs no
    mocks: the decision it enforces, `it("D21: …")`, preferably one table-driven test.

  Anything else is not tested directly. A test asserts exactly the rule it names; a
  reviewer checks that. `check-journeys` enforces the naming once a journey spine exists.
  PRs list the step IDs they serve.
- Writing: lead with the point, plain words, explain a term on first use, keep fact,
  decision and assumption apart, no `TBD`.

## Constraints

- **Bun only.** `bun`, `bunx`, `bun test`. `only-allow bun` fails other installs.
  Do not add npm/pnpm/yarn, Vitest, or ESLint.
- **shadcn/ui lives in `packages/ui`** (`@repo/ui`). Never install components
  into an app. Add with `bun run ui:add -- <component>`.
- **Semantic tokens only** in apps (`bg-primary`, `text-muted-foreground`).
  `bun run check-tokens` rejects raw palette values.
- **Env vars** are validated per app (`env.ts` / `@t3-oss/env-*`). Prefer those
  helpers over raw `process.env` in app code.

## Money rules

- Amounts are base units: `bigint` in code, `numeric` in Postgres, decimal strings in
  JSON. Never floats.
- Credit only the verified on-chain amount at Base's `safe` block. Provider status
  alone never authorizes credit.
- Map provider `errorCode`s; never parse error messages. Never put API keys or
  webhook secrets in errors, `cause` or logs.
- Treasury and refund addresses come from server config only.

## Packages

`@settle-kit/{core,react,server}` export TypeScript source (`./src/index.ts`);
the demo compiles them via `transpilePackages`, so edits need no rebuild.
Add a build step before the first npm publish. The published widget must not depend
on Tailwind or `@repo/ui`; it themes through CSS variables.

## Apps

| App | Port | Job |
|---|---|---|
| `demo` | 3003 | Reference integration, docs, state gallery |

## Before merging

```sh
bun run format-and-lint && bun run check-types && bun run check-tokens && bun run check-journeys && bun test
```

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->
