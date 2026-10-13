# Settle Kit

Accept deposits from any token, any chain, any exchange — settled as USDC on your chain.
Self-hosted, durable, open source.

**Work in progress.** Nothing is published to npm yet.

| Package | Does |
|---|---|
| `@settle-kit/core` | Headless deposit sessions, routes, fills, typed errors |
| `@settle-kit/react` | Deposit widget and hooks |
| `@settle-kit/server` | Payment routers, durable workflows, exactly-once records |

`apps/demo` is the live reference integration.

```sh
bun install
bun run dev   # demo → localhost:3003
```

Repo rules: [AGENTS.md](AGENTS.md). License: [MIT](LICENSE).
