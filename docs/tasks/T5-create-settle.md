# T5 · `createSettle`: orders, the payment workflow, handlers, test mode

**Read first:** design doc §6 (processing, delivery), §6a (checkout), §7 (Public API),
§10.1 (test mode). **Depends on:** T1–T4.
**Time box:** ~5 hours. **Branch:** `vinay/t5-create-settle`.
**Done when:** in the demo app with `mode: "test"`, an order created with
`settle.createOrder` goes pending → route picked → simulated payment → `onPaid` called
once → order `paid`, driven only through the public API; acceptance tests pass.

---

## Goal

Turn the pieces (router, states, store, verifier) into the four-piece developer API of
design §7. After this task a merchant can configure Settle Kit, mount one route file,
create orders with their own prices and get `onPaid`; only the UI (T6) is missing.

---

## Step 0: spike S8, config inside workflow steps (30 min, do first)

Workflow steps run in their own function invocations. On a cold instance, the merchant's
`lib/settle.ts` (router, store, `onPaid`) has never been imported there, so a step has no
config. Workflow SDK's docs say host process setup belongs in `instrumentation.ts`
(Next.js 16.3+, which runs `register()` before a cold instance handles requests;
see `node_modules/workflow/docs/api-reference/workflow-api/register-lifecycle-hooks.mdx`).

**Plan A:** `createSettle` stores the instance on a `globalThis` symbol; steps read it
with `settleRuntime()`, which throws `invalid_config` with a fix-it message if missing.
The merchant adds:

```ts
// instrumentation.ts
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") await import("./lib/settle");
}
```

Prove it on a Vercel preview: a step that runs after a 2-minute `sleep` (new instance,
as in S1) can read the config. Record the result as S8 in `docs/spikes.md`.

**Plan B (if A fails):** the merchant's own `workflows/settle.ts` imports `lib/settle`
and re-declares the two workflow functions as thin wrappers. Uglier quickstart, same
engine. Stop and tell Vinay before switching.

Also confirm in the same spike that `"use workflow"` code inside the
`@settle-kit/server` workspace package is discovered (it should be: Workflow SDK
compiles workflow code from dependencies that depend on `workflow`).

---

## Files

| File | What |
|---|---|
| `packages/core/src/routes.ts` | Route manifest: `RouteId`, `ROUTES` (chain, token, decimals, labels), `BASE_USDC` |
| `packages/core/src/api.ts` | `OrderView`, `RouteView`, `ApiError` JSON shapes shared with the widget |
| `packages/core/src/payment-uri.ts` | `paymentUri()`: EIP-681 string for the QR (design §10.4) |
| `packages/server/src/settle.ts` | `createSettle(config)`, `SettleConfig`, config validation |
| `packages/server/src/runtime.ts` | `globalThis` registry: `registerSettle`, `settleRuntime` |
| `packages/server/src/workflows/pay-order.ts` | `payOrder` workflow and its steps |
| `packages/server/src/handlers.ts` | `GET`/`POST` route handlers |
| `packages/server/src/simulate.ts` | `simulateRouter`, `simulatedVerifier`, scenarios |
| `packages/server/src/*.test.ts` | Acceptance tests |
| `apps/demo/lib/settle.ts`, `instrumentation.ts`, `app/api/settle/[...path]/route.ts` | Wiring in the demo |
| delete `apps/demo/workflows/spike.ts`, `apps/demo/app/api/spike` | Spike code is replaced |

Dependency: `workflow` as a peer dependency of `@settle-kit/server` (the host installs
it; one copy).

---

## 1. Route manifest (core)

```ts
export const ROUTES = {
  "base-usdc":     { from: { chainId: 8453,  token: BASE_USDC,     decimals: 6 }, to: BASE_USDC_ASSET,
                     label: { chain: "Base", token: "USDC" } },
  "arbitrum-usdc": { from: { chainId: 42161, token: ARBITRUM_USDC, decimals: 6 }, to: BASE_USDC_ASSET,
                     label: { chain: "Arbitrum", token: "USDC" } },
} as const satisfies Record<string, Route & { label: … }>;
export type RouteId = keyof typeof ROUTES;
```

Ethereum is added only after a live proof (design §1, route policy). Labels live here so
the widget and server agree; the widget never sends a raw chain/token, only a `RouteId`.

## 2. Config

```ts
export type SettleConfig = {
  router: PaymentRouter;            // relay({ apiKey }); ignored in test mode
  treasury: Address;                // every payment lands here
  refundAddress: Address;           // Relay refunds go here
  routes: readonly RouteId[];       // subset of ROUTES offered to buyers
  store: Store;                     // drizzleStore(db)
  baseRpcUrl: string;               // receipt verification (T4)
  mode: "live" | "test";
  onPaid: (event: SettledEvent) => Promise<void>;
  account?: (request: Request) => Promise<string | null>;   // see "Access" below
  orderTtl?: number;                // ms, default 30 min
  pollEvery?: number;               // ms, default 10 s
};
```

Validated with Zod once, in `createSettle`; any problem throws
`DepositError("invalid_config")` naming the field (never echoing secrets).
`treasury` and `refundAddress` must be valid, non-zero and different.

## 3. `createSettle` returns

```ts
{
  createOrder(input: { externalId: string; amount: bigint; accountId: string;
                       display?: { title: string; image?: string } }): Promise<OrderView>;
  getOrder(id: string): Promise<OrderView | null>;
  handlers: { GET(req: Request): Promise<Response>; POST(req: Request): Promise<Response> };
  mode: "live" | "test";
}
```

- `createOrder` → `store.createOrder` (idempotent on `accountId + externalId`), with
  `test = (mode === "test")`, `expiresAt = now + orderTtl`. Rejects `amount <= 0n`
  and amounts below the route minimum Relay enforces (50000 base units, S2) as
  `amount_too_low`.
- Order IDs are random and unguessable (`ord_` + 128 random bits, base58).

## 4. Handlers

Mounted at any path (`app/api/settle/[...path]/route.ts`); they match on the trailing
segments.

| Route | Does |
|---|---|
| `GET /routes` | The configured `RouteView[]` (id, labels, min) |
| `GET /orders/:id` | `OrderView`: status (via `orderStatusFor`), amount, payAmount, route, address, expiresAt, display, test, payment, timeline |
| `POST /orders/:id/route { route: RouteId }` | Issues the strict address via `store.setOrderRoute` + `router.orderAddress({ route, recipient: treasury, refundTo: refundAddress, amount })`, then `start(payOrder, [id])`; returns the `OrderView` |
| `POST /orders/:id/simulate { scenario }` | Test mode only (404 in live): records the scenario for the simulated router |

Rules:
- Bodies parsed with Zod; unknown route id → 400. Amounts in JSON are decimal strings.
- `POST …/route` on an expired order → 410 `order_expired`. The route is **locked once
  picked** in 0.1: a second call with a different route returns 409 `route_locked`
  (switching would abandon an address the workflow is already watching).
- Errors are `{ error: { code, message } }`. `DepositError` codes map to HTTP:
  `amount_too_low`/`route_unavailable` 422, `address_blocked` 403,
  `quote_unavailable`/`router_unavailable` 503, `invalid_config` 500 with a generic
  message. Never include `cause` in responses.
- **Access:** without `account`, the unguessable order id is the capability (like a
  Stripe Checkout session id). With `account`, every order endpoint also requires
  `account(request) === order.accountId`, else 404 (don't reveal existence).

## 5. The `payOrder` workflow

```ts
export async function payOrder(orderId: string) {
  "use workflow";
  // One active run per order: duplicate starts exit here (Workflow SDK "run idempotency").
  using hook = createHook({ token: `settle-kit:order:${orderId}` });
  if (await hook.getConflict()) return;

  for (;;) {
    const next = await checkOrder(orderId);          // step
    if (next.kind === "deliver") { await deliverOrder(orderId); return; }
    if (next.kind === "done") return;
    await sleep(next.wait);
  }
}
```

`checkOrder` (step) does one pass and returns `{ kind: "wait", wait } | { kind:
"deliver" } | { kind: "done" }`:

1. Load the order. No address, or `order.test !== (mode === "test")` → `done`
   (a live deployment never touches test orders, and the reverse).
2. Already has a `settled` payment → `deliver`; `credited` → `done`.
3. `router.fills(address)`. `router_unavailable` (outage or 429) → `wait` with backoff
   (double `pollEvery`, max 60 s); never fail the run for it.
4. No fills: past `expiresAt` + 10 min grace → `done` (order shows `expired`); else `wait`.
5. For each fill: `recordPayment`, then `nextStep(payment.status, fill.status)` (T2):
   - `move` → `store.transition` with evidence `{ routerStatus, fillId }`.
   - `verify` → destination chain must be 8453, then `verifyPayment` (T4) against
     `treasury`, Base USDC and `order.amount`. `verified` → build the `SettledEvent`
     (T2) and `store.settle`; `"settled"` → `deliver`. `pending` → `wait`.
     `rejected`, `transfer_claimed` or `order_paid` → `needs_attention` with the reason.
6. A payment not final 30 min after it was recorded → `needs_attention` (design §6
   attention threshold) → `done`.

`deliverOrder` (step, `maxRetries = 10`): load the payment; already `credited` → return.
Call `onPaid(settlementEvent)` with a 10 s timeout. Success → `markCredited`. Failure →
`recordDeliveryFailure`, then throw `RetryableError` with `retryAfter = 2^(attempt-1)`
minutes (design §6, ~17 h total). The workflow catches the final failure and returns;
the payment stays `settled` with `delivery_error`, visible on the timeline.

Every write is a CAS or unique insert (T3), so two runs, a retried step or a replayed
workflow cannot settle or credit twice.

## 6. Test mode (`mode: "test"`)

- `simulateRouter(store)` implements `PaymentRouter` without Relay:
  `orderAddress` returns a random address and `payAmount = amount + 25_000n` (a
  simulated $0.025 fee, the S6 Base figure, so the UI shows a realistic "send
  exactly"). `fills(address)` reads the order's `simulation` (T3) and derives fills
  from the seconds elapsed since it started:

  | Scenario | Fills over time |
  |---|---|
  | `paid` | waiting (0 s) → processing (3 s) → filled (6 s) |
  | `delayed` | waiting → delayed (3 s) → processing (20 s) → filled (25 s) |
  | `underpaid` | waiting → refunded (5 s) |
  | `overpaid` | as `paid` (strict address: exact amount delivered, excess refunded) |
  | `failed` | waiting → failed (5 s) |

- `simulatedVerifier` returns `verified` with `receivedAmount = order.amount`,
  `logIndex = 0` and a deterministic fake tx hash (`keccak256(fillId)`).
- `relay()` is never constructed or called in test mode; the simulated router is never
  used in live mode. Test orders carry `test: true` and so does their `SettledEvent`.

## 7. Demo wiring

`apps/demo/lib/settle.ts` with `mode` from env (`SETTLE_MODE`, default `test`), env vars
validated in `env.ts` (`DATABASE_URL`, `RELAY_API_KEY`, `BASE_RPC_URL`,
`SETTLE_TREASURY`, `SETTLE_REFUND_ADDRESS`; Relay key optional in test mode). A
throwaway page or `curl` script proves the done-when; the real UI is T6.

---

## Acceptance tests

Unit tests run the steps directly with `fakeRouter`/`simulateRouter`, a fake verifier
and the real Postgres store from T3.

1. Config: missing treasury, zero address, treasury = refund address, unknown route id
   → `invalid_config`; the Relay key never appears in the error.
2. `createOrder` twice with the same `externalId` → same order; `amount: 0n` and
   below-minimum amounts rejected.
3. `POST …/route`: issues one address (router called once across two calls); different
   route → 409; expired → 410; unknown order → 404; wrong account (with `account`) → 404.
4. `checkOrder` with fills scripted `[] → processing → filled` and a verifier saying
   `verified`: payment goes waiting → processing → settled; returns `deliver`.
5. Verifier says `pending` → `wait`, nothing settled. `rejected` → `needs_attention`.
6. Fill status `refunded` → payment `refunded`, order `refunded`, `onPaid` never called.
7. `deliverOrder`: `onPaid` throws twice then succeeds → one `markCredited`, two
   `delivery_failed` timeline entries, order `paid`. Run `deliverOrder` again →
   `onPaid` not called.
8. Two fills both verified for one order → first settles, second `needs_attention`
   (`order_paid`); `onPaid` called once.
9. A test-mode order is ignored by a live-mode `checkOrder`, and vice versa.
10. Simulated `paid` scenario, end to end in the demo (local dev): `onPaid` called once
    and `GET /orders/:id` reads `paid` with a timeline.
11. `router_unavailable` from `fills` → `wait` with backoff, no state change.

---

## Out of scope

UI (T6), wallet (T7), Relay webhooks, reconciliation cron, operator tools, deposit mode,
changing a route after picking it.

## Questions to answer in the PR description

- How does a step on a fresh Vercel instance get the merchant's config?
- What stops two runs for the same order from calling `onPaid` twice?
- Why poll every 10 s when the key's observed `/requests` limit is 2/min, and what
  happens on a 429?
