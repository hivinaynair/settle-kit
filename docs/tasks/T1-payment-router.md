# T1 · Payment router types + `relay()` adapter

**Read first:** design doc §2 (decisions), §5 (Relay integration); spikes S2, S6, S7.
**You write:** all code. **Time box:** ~3 hours. **Branch:** `vinay/t1-payment-router`.
**Done when:** every acceptance test below passes with `bun test`, and
`bun run format-and-lint && bun run check-types` are clean.

---

## Final shape (after review, 2026-10-14)

The spec below is the original brief. Review and the 4-day demo cut simplified it to
**two methods**: `orderAddress` and `fills` ("get an address for an order, then watch
what arrives at it"). Removed: `depositAddress()` and `Route.minimum` (deposit mode is
later), `sources()` (routes come from our manifest), `quote()` (returns with deposit
mode), `status()` (`fills` already carries status), native ETH (v1 is USDC-only),
`recoveryAddress`. Added: `"unknown"` fill status, `limit=100` paging, 401/403 → `invalid_config`, the API
key on every call, and a quote body checked with `satisfies` against Relay's official
request type. Response validation lives in each router method; `call` handles HTTP.
The PR description has the final decisions.

## Goal

The rest of Settle Kit talks to one internal interface, `PaymentRouter`, never to Relay
directly. This task defines that interface and builds `relay()` on Relay's HTTP API,
plus `fakeRouter()` for every later test.

No database, no workflows, no UI, no webhooks (T7). Pure functions and HTTP.

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
| `packages/server/test/fixtures/relay/*.json` | **Provided.** Real mainnet responses from the spikes. The `*.testnet.json` files are unused (Relay's testnet is not a supported profile, S4a) |

`viem` is the only new dependency (for `Address`, `Hex`, `zeroAddress`). Add it to
`core` and `server`.

---

## Types (core)

Write these exactly; later tasks depend on the names.

```ts
import type { Address, Hex } from "viem";

/** "native" means the chain's own coin (ETH). Relay writes it as the zero address. */
export type Token = { token: Address | "native"; decimals: number };
export type Asset = Token & { chainId: number };
/** minimum: smallest payAmount (route.from base units), from the route manifest; also the
 *  sample amount Relay needs to issue a deposit address. */
export type Route = { from: Asset; to: Asset; minimum: bigint };

export type Source = {
  chainId: number;
  name: string;                       // "arbitrum"
  tokens: { token: Address | "native"; symbol: string; decimals: number }[];
};

export type Quote = {
  amountIn: bigint;                   // base units of route.from
  amountOut: bigint;                  // expected base units of route.to (display only)
  minimumOut: bigint;                 // worst case after slippage
  etaSeconds: number;
};

/** Only the address. The wallet path builds its own transfer to it (design §1). */
export type DepositAddress = { address: Address };

/** Checkout (design §6a): single-use strict address that delivers exactly amountOut. */
export type OrderAddress = { address: Address; amountIn: bigint; amountOut: bigint };

/** The router's view of a fill. Not the deposit state machine (that's T2). */
export type FillStatus = "waiting" | "processing" | "delayed" | "filled" | "refunded" | "failed" | "unknown";

export type Fill = {
  id: string;                         // Relay requestId of the actual fill
  status: FillStatus;
  depositTx: Hex | null;              // payer's transfer into the address
  destination: { chainId: number; txHash: Hex } | null;  // set once filled
  updatedAt: Date;
};

export type PaymentRouter = {
  id: string;                         // "relay"
  sources(): Promise<Source[]>;
  depositAddress(input: {
    route: Route;
    amountIn: bigint;                 // nominal amount to quote with (the route minimum)
    recipient: Address;               // treasury
    refundTo: Address;                // app-controlled refund address
  }): Promise<DepositAddress>;
  orderAddress(input: {
    route: Route;
    amountOut: bigint;                // exact base units the treasury must receive
    recipient: Address; refundTo: Address;
  }): Promise<OrderAddress>;
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
  apiKey: string;                     // required
  fetch?: typeof fetch;               // injectable for tests; default globalThis.fetch
}): PaymentRouter
```

### Rules

1. **Base URL** `https://api.relay.link`. Mainnet only; there is no `network` option.
2. **Config.** An empty or missing `apiKey` throws `DepositError("invalid_config")` when
   `relay()` is called, before any request.
3. **`sources()`** → `GET /chains`. Keep chains with `depositAddressEnabled: true` and
   `disabled` not true. Tokens come from `solverCurrencies`. A zero-address token becomes
   `"native"`. (The tested route manifest is applied later, in `createDeposits`.)
4. **`depositAddress()`** → `POST /quote/v2` with `useDepositAddress: true`,
   `tradeType: "EXACT_INPUT"`, `user` = zero address, `recipient`, `refundTo`,
   `amount` as a decimal string. No `recoveryAddress` (design §6). Return `steps[0].depositAddress`.
   Every call issues a **new** address; callers store the first one (T3).
5. **`orderAddress()`** → `POST /quote/v2` with `useDepositAddress: true`, `strict: true`,
   `tradeType: "EXACT_OUTPUT"`, `amount` = `amountOut`, plus `recipient` and
   `refundTo`. Return `steps[0].depositAddress`, `details.currencyIn.amount` as
   `amountIn` (what the payer must send) and `details.currencyOut.amount` as `amountOut`.
   If the returned `amountOut` differs from the requested one, throw `quote_unavailable`.
6. **`quote()`** → `POST /quote/v2` without `useDepositAddress`. Map
   `details.currencyIn.amount`, `currencyOut.amount`, `currencyOut.minimumAmount`,
   `details.timeEstimate`. Amounts become `bigint`. Never use a float.
7. **`fills(address)`** → `GET /requests/v3?depositAddress=…` with header `x-api-key`.
   Send `limit=100` (Relay's maximum; default 20). Follow `continuation` until absent.
8. **`status(fillId)`** → `GET /intents/status/v3?requestId=…`.
9. **Status mapping, in one table:** `waiting→waiting`;
   `depositing|pending|submitted→processing`; `delayed→delayed`; `success→filled`;
   `refund→refunded`; `failure→failed`. Anything else → `"unknown"` (in both `fills()` and
   `status()`), which T2 sends to `needs_attention`. Never an error: that would look like
   an outage, retry forever, and block the other fills at the address.
10. **Errors.** Non-2xx with an `errorCode` maps: `AMOUNT_TOO_LOW→amount_too_low`;
   `INVALID_INPUT_CURRENCY|INVALID_OUTPUT_CURRENCY|NO_QUOTES|INSUFFICIENT_LIQUIDITY|SWAP_IMPACT_TOO_HIGH|UNSUPPORTED_ROUTE→quote_unavailable`;
   `CHAIN_DISABLED|ROUTE_TEMPORARILY_RESTRICTED|UNSUPPORTED_CHAIN→route_unavailable`;
   `SANCTIONED_WALLET_ADDRESS→address_blocked`; anything else, a 5xx, a 429 or a network
   error → `router_unavailable`. Keep the original body as `cause`. **Never** branch on
   `message`.
11. **Native token.** `"native"` is sent to Relay as the zero address.
12. **No secrets in errors.** The API key never appears in a thrown message or `cause`.

### Fill mapping (`/requests/v3` → `Fill`)

| Fill | From the request |
|---|---|
| `id` | `id` |
| `status` | `status`, via rule 9 |
| `depositTx` | `depositAddress?.depositTxHash ?? data.inTxs[0]?.txHash ?? null` |
| `destination` | `data.outTxs[0]` → `{ chainId, txHash }` when status is `success`, else `null` |
| `updatedAt` | `new Date(updatedAt)` |

v3 uses `inTxs[].txHash` / `outTxs[].txHash` (v2 used `hash`). The exact shape of
`depositAddress` on a real deposit-address request is unconfirmed until S4 on mainnet:
parse it defensively and leave a `// TODO(S4)` comment.

---

## `fakeRouter(script)` (server)

```ts
const router = fakeRouter({
  address: "0xabc…",
  fills: [[], [{ id: "r1", status: "processing", … }], [{ id: "r1", status: "filled", … }]],
});
// each call to fills() returns the next array; the last repeats forever
```

`status(id)` returns that id's status from the most recent `fills()` result.
Record every call in `router.calls` so tests can assert on them.

---

## Acceptance tests (`relay.test.ts`)

Inject a fake `fetch` that serves the fixtures. No network.

1. `sources()` includes Arbitrum (42161) with USDC
   `0xaf88d065e77c8cc2239327c5edb3a432268e5831` (6 decimals) and `"native"` ETH.
2. A chain with `depositAddressEnabled: false` or `disabled: true` (fixture edited in the
   test) is excluded.
3. `depositAddress()` returns `0xa689cfe5515c4281a7999b9133895244791b34db`.
4. `depositAddress()` sends `useDepositAddress: true`, `tradeType: "EXACT_INPUT"`,
   `amount: "2000000"`, the given `recipient`/`refundTo` (no `recoveryAddress`), and the zero
   address for a `"native"` asset.
5. `quote()` maps `amountIn 2000000n`, `amountOut 1965708n`, `minimumOut 1899857n`,
   `etaSeconds 2`, all `bigint`.
6. The `AMOUNT_TOO_LOW` fixture with status 400 throws `DepositError` with code
   `amount_too_low`; the invalid-currency fixture gives `quote_unavailable`.
7. A 500, a 429 and a thrown network error all give `router_unavailable`.
8. `relay({ apiKey: "" })` throws `invalid_config` and makes zero fetch calls.
9. `fills()` sends `x-api-key`, follows `continuation` across two pages and returns both
   pages' fills.
10. Status mapping: each of the 8 Relay statuses maps per rule 9; `"weird"` → `"unknown"`;
    one unknown or malformed request does not hide the other fills on the page.
11. `status()` on `status-waiting.json` returns `"waiting"`.
12. No thrown error or `cause` contains the API key string.
13. `fakeRouter`: three `fills()` calls return the scripted sequence, then repeat the last.
14. `orderAddress()` on `quote-strict-exact-output.mainnet.json` returns address
    `0x24a37cD2723B6FC852A7D296Bd4f20476b2Fd176`, `amountIn 1184248n`, `amountOut 1150000n`,
    and sent `strict: true`, `tradeType: "EXACT_OUTPUT"`, `amount: "1150000"`.

---

## Out of scope

Retries, caching, rate limiting, webhooks (T7), reindex (T11), other routers. Don't add them.

## Questions to answer in your PR description

- Why does `depositAddress()` never get called twice for the same account and route?
- Why does checkout use `EXACT_OUTPUT` with a strict address instead of an open one?
- Why does an unknown status become `"unknown"` instead of `"waiting"` or an error?
