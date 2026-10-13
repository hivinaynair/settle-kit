# settle-kit

Bun-only Turborepo for **Settle Kit**: deposits from any token, any chain, any exchange → USDC.

## Constraints

- **Bun only.** `bun`, `bunx`, `bun test`. `only-allow bun` fails other installs.
  Do not add npm/pnpm/yarn, Vitest, or ESLint.
- **shadcn/ui lives in `packages/ui`** (`@repo/ui`). Never install components
  into an app. Add with `bun run ui:add -- <component>`.
- **Semantic tokens only** in apps (`bg-primary`, `text-muted-foreground`).
  `bun run check-tokens` rejects raw palette values.
- **Env vars** are validated per app (`env.ts` / `@t3-oss/env-*`). Prefer those
  helpers over raw `process.env` in app code.

## Packages

`@settle-kit/{core,react,server}` export TypeScript source (`./src/index.ts`);
the demo compiles them via `transpilePackages`, so edits need no rebuild.
Add a build step before the first npm publish.

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
