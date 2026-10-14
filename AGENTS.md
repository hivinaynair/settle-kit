# settle-kit

Bun-only Turborepo for **Settle Kit**: a self-hosted SDK for crypto deposits from any
wallet or exchange, credited as USDC on Base. Users send to a reusable deposit address
(QR or browser wallet); Relay routes it; the host's account is credited once.

## Read first

- Design: `docs/plans/2026-10-13-deposit-kit-design.md` (source of truth for scope,
  states, API). Evidence: `docs/spikes.md`. Task specs: `docs/tasks/`.
- **Agents implement tasks; Vinay monitors and must be able to explain every line.**
  One task per branch/PR, small commits, and a plain-words "what and why" after each
  step (decisions, trade-offs, rejected options).
- Docs are edited by more than one AI tool. Re-read a file right before editing it,
  make targeted edits, and don't commit others' uncommitted changes without asking.

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
- Treasury, refund and recovery addresses come from server config only.

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
bun run format-and-lint && bun run check-types && bun run check-tokens && bun test
```

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->
