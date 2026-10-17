# Settle Kit

**USDC deposits for your app. Your server. Your treasury.**

Settle Kit is an open-source TypeScript SDK being built to accept native USDC on
Base, Arbitrum and Solana and settle it to a business's treasury on Base. A React deposit
widget and two hooks sit on top of a self-hosted payment engine.

**Status:** the scope and user journeys are defined. The SDK is not implemented end to end or
published to npm. Contracts are experimental and unaudited.

· [Decisions](docs/decisions.md)
· [User journeys](docs/journeys/settle-kit.md)
· [Technical design](docs/plans/2026-10-15-deposit-sdk-technical-design.md)
· [Build plan](docs/tasks/README.md)

## The deposit experience

The planned product gives users two ways to fund an app account:

- **Connect a wallet.** Enter how much to receive or how much to pay. Review the
  exact credit and fixed processing fee, then sign the chain-specific payment. The
  business's operator submits the transaction and pays ETH or SOL; the payer needs
  neither native token for this connected path.
- **Send to an address.** Copy or scan a reusable deposit address and transfer
  native USDC from an external wallet or an exchange that supports the selected
  network. This path credits the verified net arrival; its displayed estimate is
  not a locked quote. The sending wallet or exchange handles the withdrawal cost.

Both paths show progress through settlement and the host's account update.
Developers can use `<Deposit />` or build their own interface with `useDeposits()`
and `usePayWithWallet()`.

## How settlement is designed to work

```mermaid
flowchart LR
    P["USDC deposit"] --> B["Base: forward USDC"]
    P --> A["Arbitrum: CCTP burn"]
    P --> S["Solana: program + CCTP burn"]
    S --> C["Circle Forwarding: mint on Base"]
    A --> C
    B --> T["Business treasury on Base"]
    C --> T
    T --> V["Verify canonical transfer at Base safe"]
    V --> E["Record settlement credit + signed event"]
    E --> H["Host commits account credit once"]
```

The engine will run on the business's server with Postgres and DBOS durable
workflows. Its job includes recovering interrupted work, reconciling chain
transfers with recorded credits, and retrying signed webhook delivery.

The money rules matter as much as the happy path:

- **Chain evidence authorizes credit.** A provider's success response is not
  enough. The engine verifies the stored token, recipient and amount at Base's
  `safe` block and prevents the same backing from funding two credits.
- **A retry keeps its identity.** An uncertain broadcast is tracked using its
  original operation and transaction, rather than becoming a second payment.
- **Settlement and account credit are separate.** Webhooks are delivered
  at least once. The host deduplicates the event and updates its balance in one
  database transaction; the widget waits for acknowledgment before showing credit.
- **The host owns the operating costs.** It funds the operator with ETH on EVM and SOL on Solana, keeps the
  disclosed fixed fee on quoted payments and absorbs overruns. Collecting USDC
  does not automatically replenish either native token.

The SDK will not require payer or treasury private keys. The business controls
its gas wallet, treasury and resulting customer-credit liability.

[All experiment results and evidence limits](docs/spikes.md) are recorded separately
from the specification. Exploratory spikes and the technical planning are complete.
Solana source → Base is approved scope; its wallet, address and route proofs remain
unexecuted implementation gates (D58). The [build plan](docs/tasks/README.md) assigns every journey step to a task, with an
early simulated interface and live cross-chain verification before final packaging.
Implementation has not started. See [planning status](docs/spec/README.md).

## Explore the repository

| Location | Purpose |
|---|---|
| [`docs/decisions.md`](docs/decisions.md) | Scope, trade-offs, money rules and the agreed API |
| [`docs/journeys/settle-kit.md`](docs/journeys/settle-kit.md) | Generated journeys, acceptance criteria and invariants |
| [`docs/examples/minimal-host.md`](docs/examples/minimal-host.md) | Proposed host integration, explicitly labeled pseudocode |
| [`scripts/spikes/`](scripts/spikes/) | Isolated experiments and reproducible evidence |
| [`packages/core`](packages/core) | Placeholder for shared deposit/quote types and errors |
| [`packages/server`](packages/server) | Placeholder for settlement, verification and recovery |
| [`packages/react`](packages/react) | Placeholder for the widget and hooks |
| [`apps/demo`](apps/demo) | Reference-app scaffold |

To run the app scaffold, use Bun 1.4+ and Node.js 20.9+:

```sh
bun install
bun run dev
```

Open [localhost:3003](http://localhost:3003). This currently shows a placeholder
page, not a working deposit integration. To reproduce the separate wallet test,
follow the [browser experiment setup](scripts/spikes/s16-browser-wallet/README.md);
it requires testnet setup and runs on port 3004.

## Scope

The first release focuses on account deposits: native USDC on Base, Arbitrum and Solana,
owned EVM deposit contracts and a Solana program, CCTP, and a small developer-facing API. Checkout, swaps,
Relay Protocol, paymasters, bank payouts and customer withdrawals are out of scope.

The aim is to make the mechanics of a stablecoin deposit system understandable
and independently verifiable, from payer consent to the host's committed credit.
This is also a learning project and a portfolio for payments engineering roles.
The [first-slice tasks](docs/tasks/README.md) pair implementation with small code
walkthroughs and review checkpoints so I can explain the system from its actual files.
Every implementation test will trace back to a decision, journey criterion or
invariant. Repository conventions are in [AGENTS.md](AGENTS.md).

Licensed under [MIT](LICENSE).
