# T1 · Payment router types + `relay()` adapter

**Read first:** design doc §2 (vocabulary), §6 (payment routers); lesson 16b §9.
**You write:** all code. **Time box:** ~3 hours.
**Done when:** every acceptance test below passes with `bun test`, and
`bun run check-types && bun run format-and-lint` are clean.

---

## Goal

The rest of Settle Kit must never know Relay exists. It talks to one interface,
`PaymentRouter`. This task defines that interface and builds the first
implementation, `relay()`, on Relay's HTTP API.

No database, no workflows, no UI. Pure functions and HTTP.

---

## Files

| File | What |
|---|---|
| `packages/core/src/router.ts` | Types: `Asset`, `Route`, `Source`, `Quote`, `DepositAddress`, `Fill`, `FillStatus`, `PaymentRouter` |
| `packages/core/src/errors.ts` | `DepositErrorCode` union + `DepositError` class |
| `packages/core/src/index.ts` | Re-export the above |
| `packages/server/src/routers/relay.ts` | `relay(options): PaymentRouter` |
| `packages/server/src/routers/fake.ts` | `fakeRouter(script): PaymentRouter` for tests |
| `packages/server/src/index.ts` | Re-export `relay`, `fakeRouter` |
| `packages/server/src/routers/relay.test.ts` | Acceptance tests |
| `packages/server/test/fixtures/relay/*.json` | **Provided.** Real responses recorded in the spikes |

`viem` is the only new dependency (for `Address`, `Hex`, `isAddressEqual`). Add it to
`core` and `server`.

---

## Types (core)

Write these exactly; later tasks depend on the names.

```ts
import type { Address, Hex } from "viem";

/** "native" means the chain's own coin (ETH). Relay writes it as the zero address. */
export type Asset = { chainId: number; token: Address | "native" };
export type Route = { from: Asset; to: Asset };

export type Source = {
  chainId: number;
  name: string;                       // "arbitrum"
  tokens: { token: Address | "native"; symbol: string; decimals: number }[];
};

export type Quote = {
  amountIn: bigint;                   // base units of route.from
  amountOut: bigint;                  // expected base units of route.to
  minimumOut: bigint;                 // worst case after slippage
  etaSeconds: number;
};

export type DepositAddress = {
  address: Address;
  /** The exact transaction "send from wallet" submits. */
  sendTx: { chainId: number; to: Address; data: Hex; value: bigint };
};

export type FillStatus = "waiting" | "processing" | "delayed" | "filled" | "refunded" | "failed";

export type Fill = {
  id: string;                         // Relay requestId
  status: FillStatus;
  depositTx: Hex | null;              // user's transfer into the address
  destination: { chainId: number; txHash: Hex } | null;  // set once filled
  updatedAt: Date;
};

export type PaymentRouter = {
  id: string;                         // "relay"
  sources(): Promise<Source[]>;
  depositAddress(input: {
    route: Route; amountIn: bigint; recipient: Address; refundTo: Address; recoveryAddress: Address;
  }): Promise<DepositAddress>;
  quote(input: { route: Route; amountIn: bigint }): Promise<Quote>;
  fills(address: Address): Promise<Fill[]>;
  status(fillId: string): Promise<FillStatus>;
};
```

```ts
export type DepositErrorCode =
  | "amount_too_low" | "quote_unavailable" | "route_unavailable"
  | "address_blocked" | "router_unavailable" | "invalid_config";

export class DepositError extends Error {
  constructor(readonly code: DepositErrorCode, message: string, readonly cause?: unknown) { … }
}
```

---

## `relay(options)` (server)

```ts
relay({
  apiKey?: string;                    // required for fills(); see rule 5
  network?: "mainnet" | "testnet";    // default "mainnet"
  fetch?: typeof fetch;               // injectable for tests; default globalThis.fetch
}): PaymentRouter
```

### Rules

1. **Base URL.** mainnet `https://api.relay.link`, testnet `https://api.testnets.relay.link`.
2. **`sources()`** → `GET /chains`. Keep only chains with `depositAddressEnabled: true`
   and `disabled` not true. Tokens come from `solverCurrencies`. A token whose address is
   the zero address becomes `"native"`.
3. **`depositAddress()`** → `POST /quote/v2` with
   `useDepositAddress: true`, `tradeType: "EXACT_INPUT"`, `user` = zero address,
   `recipient`, `refundTo`, `recoveryAddress`, `amount` as a decimal string.
   Return `steps[0].depositAddress` and `steps[0].items[0].data` as `sendTx`
   (`value` parsed to `bigint`).
4. **`quote()`** → `POST /quote/v2` without `useDepositAddress`. Map
   `details.currencyIn.amount`, `currencyOut.amount`, `currencyOut.minimumAmount`,
   `details.timeEstimate`. All amounts become `bigint`. Never use a float.
5. **`fills(address)`** → `GET /requests/v3?depositAddress=…` with header `x-api-key`.
   Follow `continuation` until absent. Without `apiKey`, throw
   `DepositError("invalid_config")` before any request.
6. **`status(fillId)`** → `GET /intents/status/v3?requestId=…`.
7. **Status mapping, in one table** (lesson 16b §9):
   `waiting→waiting`; `depositing|pending|submitted→processing`; `delayed→delayed`;
   `success→filled`; `refund→refunded`; `failure→failed`. An unknown status throws
   `DepositError("router_unavailable")` (fail loud, not silently "waiting").
8. **Errors.** Non-2xx with an `errorCode` maps: `AMOUNT_TOO_LOW→amount_too_low`;
   `INVALID_INPUT_CURRENCY|INVALID_OUTPUT_CURRENCY|NO_QUOTES|INSUFFICIENT_LIQUIDITY|SWAP_IMPACT_TOO_HIGH|UNSUPPORTED_ROUTE→quote_unavailable`;
   `CHAIN_DISABLED|ROUTE_TEMPORARILY_RESTRICTED|UNSUPPORTED_CHAIN→route_unavailable`;
   `SANCTIONED_WALLET_ADDRESS→address_blocked`; anything else, a 5xx, a 429 or a network
   error → `router_unavailable`. Keep the original body as `cause`. **Never** branch on
   `message`.
9. **Native token.** `Asset.token === "native"` is sent to Relay as the zero address.
10. **No secrets in errors.** The API key never appears in a thrown message or `cause`.

### Fill mapping (`/requests/v3` → `Fill`)

| Fill | From the request |
|---|---|
| `id` | `id` |
| `status` | `status`, via rule 7 |
| `depositTx` | `depositAddress?.depositTxHash ?? data.inTxs[0]?.txHash ?? null` |
| `destination` | `data.outTxs[0]` → `{ chainId, txHash }` when status is `success`, else `null` |
| `updatedAt` | `new Date(updatedAt)` |

The recorded v3 sample uses `inTxs[].txHash` / `outTxs[].txHash` (v2 used `hash`; don't mix them up). The exact shape of `depositAddress` on a
deposit-address request is **unconfirmed** until S4. Parse it defensively and leave a
`// TODO(S4)` comment.

---

## `fakeRouter(script)` (server)

A router you can script, for every later test. Minimum:

```ts
const router = fakeRouter({
  address: "0xabc…",
  fills: [[], [{ id: "r1", status: "processing", … }], [{ id: "r1", status: "filled", … }]],
});
// each call to fills() returns the next array; the last repeats forever
```

`status(id)` returns the status of that id from the most recent `fills()` result.
Record every call in `router.calls` so tests can assert on them.

---

## Acceptance tests (`relay.test.ts`)

Inject a fake `fetch` that serves the fixtures. No network.

1. `sources()` on the mainnet fixture includes Arbitrum (42161) with USDC
   `0xaf88d065e77c8cc2239327c5edb3a432268e5831` (6 decimals) and `"native"` ETH.
2. `sources()` on the testnet fixture returns Sepolia and Base Sepolia, ETH only.
3. `depositAddress()` (mainnet fixture) returns `0xa689cfe5515c4281a7999b9133895244791b34db`;
   `sendTx.chainId` 42161; `sendTx.data` starts with `0xa9059cbb`; `sendTx.value` is `0n`.
4. `depositAddress()` sends `useDepositAddress: true`, `tradeType: "EXACT_INPUT"`,
   `amount: "2000000"`, and the zero address for a `"native"` asset.
5. `quote()` maps `amountIn 2000000n`, `amountOut 1965708n`, `minimumOut 1899857n`,
   `etaSeconds 2`, all `bigint`.
6. The `AMOUNT_TOO_LOW` fixture with status 400 throws `DepositError` with code
   `amount_too_low`; the invalid-currency fixture gives `quote_unavailable`.
7. A 500 and a thrown network error both give `router_unavailable`.
8. `fills()` without `apiKey` throws `invalid_config` and makes zero fetch calls.
9. `fills()` follows `continuation` across two pages and returns both pages' fills.
10. Status mapping: each of the 8 Relay statuses maps per rule 7; `"weird"` throws.
11. `status()` on `status-waiting.json` returns `"waiting"`.
12. No thrown error or `cause` contains the API key string.
13. `fakeRouter`: three `fills()` calls return the scripted sequence, then repeat the last.

---

## Out of scope

Retries, caching, rate limiting, `across()`, `pickRouter`. Don't add them.

## Questions to answer in your PR description

- Why does `fills()` refuse to run without a key instead of falling back to `/requests/v2`?
- Why does an unknown status throw instead of mapping to `"waiting"`?
