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

## S3 · Verify a real fill on Base

Took a recent successful Relay request to Base USDC; viem read the receipt:
`status: success`, one USDC `Transfer` to the recipient (amount, `logIndex`, sender
= Relay solver). Block was 20 confirmations deep: inside `safe` (head − 17), not yet
`finalized` (head − 485, ~16 min).

**So:** credit when the fill's block is at or below the `safe` tag (~30 s on Base),
not a raw confirmation count. Unique keys: `fill_id` and `(chain_id, tx_hash, log_index)`.

## Still open

- **S4 · real deposit, ~$5** — needs a funded wallet (you send; we watch statuses).
- Relay API key — needed for `/requests/v3`.
