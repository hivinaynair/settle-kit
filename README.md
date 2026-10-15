# Settle Kit

Native USDC deposits on Base and Arbitrum, settled as USDC to your treasury on Base.
Self-hosted, durable, open source.

**Work in progress.** The deposit release is specified, not implemented end to end.
Nothing is published to npm yet. See [decisions](docs/decisions.md) for scope and the
[generated journeys](docs/journeys/settle-kit.md) for behavior.

| Package | Planned responsibility |
|---|---|
| `@settle-kit/core` | Deposit and quote types, payment states and typed errors |
| `@settle-kit/react` | Deposit widget and hooks |
| `@settle-kit/server` | Own-rails settlement, durable workflows, verification and deduplicated credits |

`apps/demo` is the reference integration under development. The
[host integration sketch](docs/examples/minimal-host.md) makes the intended setup
reviewable; it is not a runnable quickstart yet.

The SDK does not hold payer keys. Deposited funds go to the business treasury;
the business controls the resulting app credits.

```sh
bun install
bun run dev   # demo → localhost:3003
```

The [browser spike](scripts/spikes/s16-browser-wallet/README.md) records a real
MetaMask payment on Base Sepolia with zero payer ETH, safe verification and replay
rejection. This validates that payment primitive, not the complete SDK or CCTP route.
The next step is technical design and task breakdown; see [planning status](docs/spec/README.md).

Repo rules: [AGENTS.md](AGENTS.md). License: [MIT](LICENSE).
