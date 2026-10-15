# Spikes — 2026-10-13

What we tested before designing, and what it changes.

## S1 · Workflow SDK under Bun and on Vercel

| Check | Result |
|---|---|
| `bun add workflow` (5.2.1) + `withWorkflow` + hoisted linker | Works |
| Local dev, Node runtime | Poll loop, `sleep`, retries, `FatalError` all behave |
| Local dev, Bun runtime (`bun --bun next dev`) | Same results; step reports `bun 1.4.0` |
| `stepId` across retries | Stable — usable as an idempotency key |
| Local dev, `kill -9` mid-run | **Run stuck at `running` forever** (Node and Bun alike) |
| Vercel preview: step calls `process.exit(1)` on attempt 1 | Retried; attempt 2 completed |
| Vercel preview: two 2-minute sleeps | Resumed after the instance was gone |
| Vercel preview: redeploy during a sleep | Run finished on the deployment that started it |

**So:** the local World keeps its queue in memory (`setTimeout` in
`@workflow/world-local/dist/queue.js`); durability exists only on the Vercel or
Postgres World. Vercel functions ran Node 24 (no `bunVersion` set) — keep it that way.
The database stays the source of truth either way.

## S2 · Relay API (read-only, no funds)

- `GET /chains`: Ethereum, Optimism, Polygon, Base, Arbitrum all report
  `depositAddressEnabled: true`. Base has `depositFee: 2`; the others 0.
  Solver currencies per chain are listed — drive the widget's token list from them.
- `POST /quote/v2` with `useDepositAddress: true` (Arbitrum USDC → Base USDC):
  - returns `steps[0].depositAddress`, `requestId`, and `items[0].check.endpoint`
    (`/intents/status/v3?requestId=…`).
  - `items[0].data` is a plain ERC-20 `transfer` (`0xa9059cbb…`) to the deposit
    address — **the wallet path can send exactly this.**
  - Fees: 2 USDC in → 1.9657 out (~1.7%); 5 USDC in → 4.9654 out (~0.7%).
    A $1 minimum is too small; **use $2–5.** Estimate: ~2 s.
- **Quoting the same route twice returned a different address.** Store the first
  address per `(account, route)` and reuse it; don't re-quote to show it again.
- `GET /intents/status/v3?requestId=` works without a key → `{"status":"waiting"}`.
- **`GET /requests/v3?depositAddress=` requires `x-api-key`.** This is how we find
  every fill at an address (re-quotes create new request ids). **We need a Relay API key.**
  `/requests/v2` still answers without a key but retires 2026-11-24.
- Errors: `{ message, errorCode, requestId }`, e.g. `AMOUNT_TOO_LOW`
  ("Amount must be greater than 50000 for deposit address quotes"),
  `INVALID_INPUT_CURRENCY`. Map `errorCode`, never parse `message`.
- No rate-limit headers on unauthenticated calls.

### With the API key

`GET /requests/v3?depositAddress=…` with `x-api-key` returns `{ requests: [] }` for an
unused address. A request carries `id`, `status`, `depositAddress`,
`duplicateDeposits`, **`supersededByRequestId`** (the re-quote chain), `refundTo`,
`sender`, `recipient`, and `data.{inTxs,outTxs}[]` with `chainId`, `txHash`, `block`,
`status`, plus `data.failReason` / `data.refundFailReason`. None of 20 sampled
requests used a deposit address, so the deposit-address-specific fields still need
a real deposit (S4). The key is set in Vercel (preview + production, encrypted).

## S3 · Verify a real fill on Base

Took a recent successful Relay request to Base USDC; viem read the receipt:
`status: success`, one USDC `Transfer` to the recipient (amount, `logIndex`, sender
= Relay solver). Block was 20 confirmations deep: inside `safe` (head − 17), not yet
`finalized` (head − 485, ~16 min).

**So:** credit when the fill's block is at or below the `safe` tag (~30 s on Base),
not a raw confirmation count. Unique keys: `fill_id` and `(chain_id, tx_hash, log_index)`.

## Still open

- **S10 · Workflow SDK Postgres World** — the self-hosted durability D37 relies on. Plan:
  run the S1 checks (poll loop, `sleep`, retries, `FatalError`) on `@workflow/world-postgres`,
  then `kill -9` the process mid-run and restart it. Pass: the run resumes from its last
  step. If it doesn't, self-hosted payments recover through reconciliation restarts (D36),
  which is correct but slower; record the delay.

- **S4 · real deposit on Base mainnet** — waiting for funds (see S4a and S7). Plan:
  Base ETH → Base USDC via a deposit address (funds the payer with USDC), then
  $2 Base USDC → Base USDC to a fresh address, then $2 again to the same address,
  then Arbitrum → Base if funds arrive on Arbitrum. Record fill ids, tx links,
  receipt shape, time to credit and `/requests/v3` behaviour under the key's limit.

## S5 · Credit-card onramp feasibility — 2026-10-14

Documentation review and credential-free probes are complete. Transak staging
metadata returned HTTP 200, including a Base Sepolia USDC-labelled route and USD
card method. MoonPay requests encountered connection resets before an HTTP response.
Neither provider checkout, signed webhook nor token delivery has been tested.

Both document test keys before business verification; live use needs approval.
Transak is the provisional first candidate, conditional on recipient approval and
webhook access. Its sandbox delivers TRNSK, not Circle USDC. Cards remain outside v1.

See [the full spike](spikes/2026-10-14-card-onramp.md) for account/KYC requirements,
provider sources, the runnable probe, recorded results and remaining gates.

## S6 · Same-chain deposit address (Base USDC → Base USDC) — 2026-10-14

Mainnet `/quote/v2` with `useDepositAddress: true` returns a deposit address
(`steps[0].id = "deposit"`, transfer on Base USDC). Fees are roughly flat:

| Route | In | Out | Fee |
|---|---|---|---|
| Base USDC → Base USDC | 2.00 | 1.975117 | ~$0.025 (1.25%) |
| Base USDC → Base USDC | 10.00 | 9.975117 | ~$0.025 (0.25%) |
| Arbitrum USDC → Base USDC | 2.00 | 1.965696 | ~$0.034 (1.7%) |
| Base USDT → Base USDC | 2.00 | 1.962734 | ~$0.037 (1.9%) |

Quote only; no funds sent. Script: scratch `relay-same-chain.sh` (plain curl, no key).

## S4a · Testnet deposit attempt — 2026-10-14 (failed; testnet not usable)

Same-chain Base Sepolia ETH → Base Sepolia ETH. Testnet quotes work without a key
(minimum ~0.0001 ETH same-chain; ~0.0003 ETH Sepolia → Base Sepolia because of a
~0.00016 ETH fee). Payer and treasury were CDP server wallets created by name
(`settle-kit-s4-payer` `0xc0ddaFE4d55E5ce58FDa36b85A1125F217130ebE`,
`settle-kit-s4-treasury` `0xac44275dE5bF4109977892c4a256BbFA16B6C804`), funded by
the CDP faucet.

| Step | Result |
|---|---|
| Deposit address | `0xf6c3f7d15bf99729f2d1c7bac187bc07c57f2f14` (quote requestId `0x1791…8a26`) |
| Transfer 0.00015 ETH | Mined, tx `0x82e7a6ad8273ab68e58eb776d26067c5973ae194346dfe040c2a926593fc7de0` |
| After 31 min | Funds still at the deposit address; quote status `waiting` |
| `POST /transactions/deposit-address/reindex` | 200, "Triggered reindex for 1 currency"; still not swept |
| `GET /requests/v3` on testnet with our key | **401** (same key → 200 on mainnet) |
| `GET /requests/v3` on testnet without a key | 400, `x-api-key` required |

Re-checked later the same day: the 0.00015 ETH is still sitting at the deposit address
(not swept, not refunded). Testnet `/chains` reports `depositAddressEnabled: true` for
Base Sepolia and Sepolia, so it's not switched off. Testnet `/requests/v2?depositAddress=`
(no key) answers 500 "Query read timeout". Untested: whether a **cross-chain** testnet
deposit (Base Sepolia → Sepolia) sweeps. S4a was same-chain *and* same-token (ETH → ETH),
which may simply be a route Relay never executes.

**So:** Relay's testnet can't be our development profile: it didn't sweep the
deposit, and `/requests/v3` has no usable key there. Relay's own testnet guide
recommends cheap L2 mainnets over testnets. Development uses test mode (simulated
deposits); the live proof is a small Base mainnet deposit. Reindex is a real
recovery tool and belongs in operator tooling.

## S4b · Cross-chain testnet deposit — 2026-10-14 (failed; confirms S4a)

To test whether S4a failed only because ETH → ETH on one chain is a no-op route, we
tried a real cross-chain route: Base Sepolia ETH → Sepolia ETH, open `EXACT_INPUT`.
The minimum is ~0.0005 ETH (Sepolia's L1 fee is ~0.0004), so the payer was topped up
from the CDP faucet (5 × 0.0001 ETH).

| Step | Result |
|---|---|
| Deposit address | `0x3424abfc245da48f6968fba51b4841f2c7bdd6ff` (requestId `0x1791…5657`), quoted out 0.000152 ETH |
| Transfer 0.0006 ETH | Mined, tx `0xc34e96492b695386ae3f169cf1d2fc5b3f6ddf6f69229c614a5ff9297d931cde` |
| After 15 min (polled every 20 s) | Funds still at the deposit address; status `waiting`; nothing at the treasury on Sepolia |
| Reindex | 200, "Triggered reindex for 1 currency", balance seen; status still `waiting` |

**So:** Relay's testnet doesn't process deposit addresses at all, same-chain or
cross-chain. S4a's failure says nothing about the mainnet Base USDC → Base USDC route;
that still needs its own live proof (T8, run 1). Testnet is closed as a path.

## S7 · Relay account and funding findings — 2026-10-14

- **Rate limit:** the Relay dashboard shows our key at `/requests` **2 req/min**
  (`/quote` 50, others 200). Relay docs list `/requests/v3` at 200/min by default.
  Unconfirmed whether 2/min covers `/requests/v3`; asked support. Until answered,
  reconciliation budget = the key's actual `/requests` limit, and webhooks are the
  primary discovery path.
- **No testnet key** can be created in the dashboard; asked support.
- **Funding from India:** Transak's checkout does not list India as a country of
  residence; MoonPay's quote defaulted to Ethereum mainnet. Onramp.money (INR via
  UPI) quoted ₹1,500 → 0.00546683 ETH **on Base**, ~₹34 total fees (2.3%).
  For payers in markets like India, local exchanges and INR onramps are the funding
  path, which supports building the address/QR path first.

**Re-checked 2026-10-14 (later):** 8 `GET /requests/v3?depositAddress=` calls in 8 s with
our key all returned 200, with no rate-limit headers. The 2 req/min figure doesn't apply
to v3 at that rate, so T5's 10 s poll is fine for the demo. The real v3 limit is still
unknown (Relay documents 200/min).

## S9 · Minimum order amount for strict quotes — 2026-10-14

Strict `EXACT_OUTPUT` deposit-address quotes to Base USDC, mainnet, with our key:

| Order amount (USDC) | From Base, payer sends | From Arbitrum, payer sends |
|---|---|---|
| 0.000001 (1 base unit) | 0.025103 | 0.034058 |
| 0.01 | 0.035092 | 0.044391 |
| 0.05 | 0.075092 | 0.084055 |
| 0.10 | 0.125092 | 0.134070 |
| 0.25 | 0.275092 | 0.284089 |

**So:** strict quotes have no minimum; S2's 50000 (0.05 USDC) minimum applies to open
`EXACT_INPUT` quotes. The fee is flat (~0.0251 from Base, ~0.034 from Arbitrum), so below
~0.05 the fee is larger than the price. Quotes only: whether Relay fills a tiny strict
order is proven in T8. Demo prices: 0.50 / 1.00 / 2.00 USDC, so the fee reads as
2–7% rather than more than the price.
