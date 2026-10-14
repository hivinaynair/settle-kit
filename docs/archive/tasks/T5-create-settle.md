# T5 · `createSettle`: orders, the payment workflow, signed webhook, test mode

**Read first:** design doc §6 (processing, delivery), §6a (checkout), §7 (Public API),
§10.1 (test mode). **Depends on:** T1–T4.
**Time box:** ~5 hours. **Branch:** `vinay/t5-create-settle`.
**Done when:** in the demo app with `SETTLE_MODE=test`, an order created with
`settle.createOrder` goes pending → route picked → simulated payment → one signed
`order.paid` webhook accepted by the demo's webhook route → order `paid`, driven only
through the public API; acceptance tests pass.

---

## Goal

Turn the pieces (router, states, store, verifier) into the developer API of design §7.
After this task a merchant can set env vars, mount one route file, create orders with
their own prices and receive a signed webhook when one is paid; only the UI (T6) is
missing.

---

## The two decisions this task rests on

**1. The merchant's code runs behind a signed webhook, not an in-process callback.**
When an order is paid, the workflow POSTs a signed `order.paid` event to a URL the
merchant owns (Stripe, Coinbase Commerce and Daimo work the same way). The merchant's
fulfilment code is an ordinary route handler: it can live in the same Next.js app or any
other service, it can be tested with `curl`, and it never has to be loaded into our
background job.

**2. All settings come from environment variables.**
Workflow steps run on short-lived servers that start fresh, so they can't rely on the
merchant's `lib/settle.ts` having been imported. Once the merchant's code is behind a URL,
everything a step needs is plain data (database URL, Relay key, RPC URL, addresses,
webhook URL and secret), and every Vercel server already has the environment variables.
So each step rebuilds its settings from `process.env`. No `instrumentation.ts`, no
global registry.

Trade-off: the SDK opens its own database connection from a URL instead of taking the
merchant's `db` object, and the few tunables (poll interval, watch window) are constants
in 0.1 rather than options.

---

## Step 0: spike S8, the background job on Vercel (30 min, do first)

On a Vercel preview, a test workflow inside `@settle-kit/server`:
1. Is discovered and compiled (Workflow SDK compiles workflow code from dependencies that
   list `workflow` in `dependencies` or `peerDependencies`; checked in
   `@workflow/builders/dist/fast-discovery.js`).
2. After a 2-minute `sleep` (forces a fresh server, as in S1), reads its settings from
   env and POSTs a signed request to a route on the same preview, which verifies it.
   Previews have Vercel Deployment Protection: the request needs
   `x-vercel-protection-bypass: $VERCEL_AUTOMATION_BYPASS_SECRET` (see §5 "Webhook").

Record the result as S8 in `docs/spikes.md`. If either part fails, stop and tell Vinay.

---

## Files

| File | What |
|---|---|
| `packages/core/src/routes.ts` | Route manifest: `RouteId`, `ROUTES` (chain, token, decimals, labels), `BASE_USDC` |
| `packages/core/src/api.ts` | `OrderView`, `RouteView`, `ApiError` JSON shapes shared with the widget |
| `packages/core/src/payment-uri.ts` | `paymentUri()`: EIP-681 string for the QR (design §10.4) |
| `packages/server/src/config.ts` | `loadConfig(env)`: reads and validates the env vars below, cached per server |
| `packages/server/src/settle.ts` | `createSettle(options?)`: `createOrder`, `getOrder`, `handlers` |
| `packages/server/src/webhook.ts` | `signWebhook`, `verifyWebhook` (Standard Webhooks), `deliverWebhook` |
| `packages/server/src/workflows/pay-order.ts` | `payOrder` workflow and its steps |
| `packages/server/src/handlers.ts` | `GET`/`POST` route handlers |
| `packages/server/src/simulate.ts` | `simulateRouter`, `simulatedVerifier`, scenarios |
| `packages/server/src/*.test.ts` | Acceptance tests |
| `apps/demo/lib/settle.ts`, `app/api/settle/[...path]/route.ts`, `app/api/settle-webhook/route.ts` | Wiring in the demo |
| delete `apps/demo/workflows/spike.ts`, `apps/demo/app/api/spike` | Spike code is replaced |

Dependencies: `workflow` and `drizzle-orm` as peers; `pg` (node-postgres) as a regular
dependency. Neon works over `pg` with its pooled connection string; Neon's HTTP driver
can't, because the store needs transactions (T3).

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

## 2. Settings (env vars)

| Variable | Required | Meaning |
|---|---|---|
| `SETTLE_MODE` | no, default `test` | `test` (simulated payments) or `live` |
| `DATABASE_URL` (or `SETTLE_DATABASE_URL` to use a different one) | yes | Postgres 15+; tables are prefixed `settle_kit_`. One database (or Neon branch) per mode: test and live never share one |
| `SETTLE_TREASURY` | yes | Every payment lands here |
| `SETTLE_REFUND_ADDRESS` | yes | Relay refunds go here; must differ from the treasury |
| `SETTLE_ROUTES` | no, default all | Comma-separated `RouteId`s offered to buyers |
| `SETTLE_WEBHOOK_URL` | yes | Where `order.paid` is POSTed. A path (`/api/settle-webhook`) means this same app (§5) |
| `SETTLE_WEBHOOK_SECRET` | yes | `whsec_` + 32 random bytes in base64 (`openssl rand -base64 32`) |
| `RELAY_API_KEY` | live only | |
| `BASE_RPC_URL` | live only | Receipt verification (T4) |

`loadConfig(env)` validates once per server with Zod (a discriminated union on mode, so
live-only variables are required only in live mode) and caches the result: the
`relay()` router (live) or `simulateRouter` (test), the store over a `pg` pool, the Base
client (live) or `simulatedVerifier` (test). Any problem throws
`DepositError("invalid_config")` naming the **variable**, never its value.

Constants in 0.1: order TTL 30 min (overridable per order), poll every 10 s, watch 1 h after
expiry, webhook timeout 10 s.

## 3. `createSettle`

```ts
// lib/settle.ts (merchant)
export const settle = createSettle({
  account: async (request) => (await auth(request))?.userId ?? null,   // optional
});

// returns
{
  createOrder(input: { externalId: string; amount: bigint; accountId: string;
                       display?: { title: string; image?: string };
                       expiresIn?: number }): Promise<OrderView>;
  getOrder(id: string): Promise<OrderView | null>;
  handlers: { GET(req: Request): Promise<Response>; POST(req: Request): Promise<Response> };
  mode: "live" | "test";
}
```

Only request-time hooks (`account`) are options; they run inside the merchant's own route,
where this file is always loaded. `createSettle` calls `loadConfig(process.env)` lazily
(first use), so a missing variable fails on the first request, not at build time.
Tests pass `createSettle({ env: {...} })`.

- `createOrder` → `store.createOrder` (idempotent on `accountId + externalId`), with
  `expiresAt = now + (expiresIn ?? 30 min)`.
  Rejects `amount <= 0n` as `amount_too_low`. No other minimum is hard-coded: strict
  quotes have none (S9); if Relay ever rejects a small amount, its `AMOUNT_TOO_LOW` maps
  to `amount_too_low` when the buyer picks a route.
- Order IDs are random and unguessable (`ord_` + 128 random bits, base58).

## 4. Handlers

Mounted at any path (`app/api/settle/[...path]/route.ts`); they match on the trailing
segments.

| Route | Does |
|---|---|
| `GET /routes` | The configured `RouteView[]` (id, labels) |
| `GET /orders/:id` | `OrderView`: status (via `orderStatusFor`), amount, payAmount, route, address, expiresAt, display, test (= `mode === "test"`), payment (the order's main payment from `store.getOrder`, T3 rule 8, with its attention reason, read from the latest timeline entry's `evidence.reason`; no extra column), timeline. Not the router request ID: that stays inside the server and store |
| `POST /orders/:id/route { route: RouteId }` | Issues the strict address via `store.setOrderRoute` + `router.orderAddress({ route, recipient: treasury, refundTo: refundAddress, amount })`, which stores the returned `address`, `payAmount` and `requestId` together, then `start(payOrder, [id])`; returns the `OrderView` |
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
    if (next.deliver) await deliverOrGiveUp(orderId);  // catches retry exhaustion
    if (next.done) return;
    await sleep(next.wait);
  }
}
```

Every step starts with `loadConfig(process.env)` (cached), so it works on a fresh server.
Workflow arguments are just the order id.

**How we find the order's payments.** The buyer sends money to the order's address, but
we ask Relay about it by the quote's original request ID (Relay documents that a strict
order keeps it). `router.fills(requestId)` returns that root request plus any child
requests, for example a second deposit to the same address; each report keeps its own
ID. The ID only tells us where to look: credit still needs the verified Base transfer.

`checkOrder` (step) does one full pass over **every** report, then returns
`{ deliver: boolean; done: boolean; wait: number }`. It never returns halfway through the
list, and never stops early because one report already settled, so a second payment
(a child arriving after the parent settled) is always recorded and flagged.

1. Load the order. No route yet (neither `address` nor `routerRequestId`) → `done`.
   A request ID from the other mode (`sim_…` in live, anything else in test) → `done`:
   someone pointed both modes at one database; never send a simulated ID to Relay. One without the other is a bug (T3 stores them in one
   CAS): throw so the step fails loudly; never request another quote.
2. `router.fills(order.routerRequestId)`. `router_unavailable` (outage or 429) → `wait`
   with backoff (double the poll interval, max 60 s); never fail the run for it.
3. **No payment yet.** An empty list (Relay hasn't indexed the request), or a `waiting`
   report with neither `depositTx` nor `destination` (the quote exists, no money has
   arrived), is not a payment: record nothing and start no attention timer. The order
   just stays pending until its watch window ends.
4. For every other report: `recordPayment`, then `nextStep(payment.status, fill.status)` (T2):
   - `move` → `store.transition` with evidence `{ routerStatus, fillId }`. A move to
     `needs_attention` also records `reason`: `refund_unverified` (router said
     refunded; T2 never trusts that as final), `router_failed` or `unknown_status`.
   - `verify` → destination chain must be 8453, then `verifyPayment` (T4) against
     `treasury`, Base USDC and `order.amount`. `verified` → build the `SettledEvent`
     (T2) and `store.settle`. `pending` → try again next pass.
     `rejected`, `transfer_claimed` or `order_paid` → `needs_attention` with the reason.
   - A payment still waiting/processing/delayed 30 min after it was recorded →
     `needs_attention` (design §6 attention threshold). Rows are only recorded once
     money is seen (rule 3), so an unfunded quote never trips this timer.
5. `deliver` = the order has a `settled` payment that isn't `credited` and hasn't
   exhausted its retries.
6. `done` and `wait` follow "How long a run watches" below.

**How long a run watches.** There are no Relay webhooks or reconciliation in 0.1, so this
run is the only thing watching the order. It polls every 10 s (backoff only for
`router_unavailable`) and ends at the first of:

- **Paid** (`credited`) and `expiresAt` + 10 min has passed (catches an accidental second
  payment during checkout).
- `expiresAt` + 1 h has passed and no payment is in progress (waiting, processing or
  delayed). One hour covers a slow exchange withdrawal; a payment in progress is never
  abandoned.

At most ~540 Relay calls per order (1.5 h × 6/min). A payment after the run ends is not
tracked in 0.1; the README says so, and reconciliation (later) closes the gap. T8 run 7
checks whether Relay even fills a strict quote after it expires; if it does and late
payments matter, lengthen the window then.

### Webhook (`deliverOrder` step)

`deliverOrder` (step, `maxRetries = 10`): load the payment; already `credited` → return.
POST the stored `settlementEvent` to `SETTLE_WEBHOOK_URL`, signed per
[Standard Webhooks](https://www.standardwebhooks.com/) (used by Svix, Supabase and
others, so any of their verifier libraries also works):

```text
content-type: application/json
webhook-id: <event.id>                 same on every retry; the merchant dedupes on it
webhook-timestamp: <unix seconds of this attempt>
webhook-signature: v1,<base64 HMAC-SHA256(secret, "<id>.<timestamp>.<body>")>
```

- A 2xx within 10 s is the acknowledgement → `markCredited`. Anything else (non-2xx,
  timeout, network error) → `recordDeliveryFailure` with the status code only (never the
  response body or secret), then throw `RetryableError` with `retryAfter = 2^(attempt-1)`
  minutes (design §6, ~17 h total). `deliverOrGiveUp` catches the final failure; the
  payment stays `settled` with `delivery_error`, visible on the timeline, and later
  passes don't retry it.
- **A path means this same app.** `SETTLE_WEBHOOK_URL=/api/settle-webhook` resolves
  against this deployment's own origin (`https://$VERCEL_URL` on Vercel, else
  `http://localhost:$PORT`). Only for such
  same-app URLs, and only when `VERCEL_AUTOMATION_BYPASS_SECRET` is set, the request
  carries `x-vercel-protection-bypass`, so protected preview deployments can call
  themselves. That secret is never sent to an absolute URL.
- Test mode sends real webhooks too, with `test: true` in the event, so the merchant's
  handler is exercised before going live (like Stripe test-mode webhooks).

For the merchant, `@settle-kit/server` exports the verifier:

```ts
// app/api/settle-webhook/route.ts (merchant)
import { verifyWebhook } from "@settle-kit/server";

export async function POST(request: Request) {
  const event = await verifyWebhook(request, process.env.SETTLE_WEBHOOK_SECRET!);
  // throws on a bad signature or a timestamp more than 5 min old → respond 400
  await fulfil(event.order.externalId, event.id);   // unique on event.id
  return new Response(null, { status: 204 });
}
```

`verifyWebhook` reads the raw body, checks the timestamp is within 5 minutes, compares
signatures in constant time (`crypto.timingSafeEqual` or WebCrypto `verify`), and parses
the body with Zod into a typed `SettledEvent`. Implemented with WebCrypto, no dependency
(~40 lines).

Every write is a CAS or unique insert (T3), so two runs, a retried step or a replayed
workflow cannot settle or credit twice; a duplicate webhook carries the same
`webhook-id`, which the merchant dedupes.

## 6. Test mode (`SETTLE_MODE=test`)

- `simulateRouter(store)` implements `PaymentRouter` without Relay:
  `orderAddress` returns a random address, a random request ID (`sim_` + 128 bits,
  stored with the address, so it stays stable for the order) and
  `payAmount = amount + 25_000n` (a simulated $0.025 fee, the S6 Base figure, so the UI
  shows a realistic "send exactly"). `fills(requestId)` finds the order with
  `store.findOrderByRequestId(requestId)`. Before a scenario starts it returns one
  `waiting` report with no `depositTx`, like Relay for an unfunded quote. After, it reads
  the order's `simulation` (T3) and derives reports from the seconds elapsed, each with a
  fake `depositTx`:

  | Scenario | Fills over time |
  |---|---|
  | `paid` | waiting (0 s) → processing (3 s) → filled (6 s) |
  | `underpaid` | waiting → refunded (5 s) |
  | `failed` | waiting → failed (5 s) |
  | `paid_twice` | root as `paid`; a child report (ID `<requestId>:2`) waiting (10 s) → filled (16 s). For tests and `curl`; not in the widget toolbar |

- `simulatedVerifier` returns `verified` with `receivedAmount = order.amount`,
  `logIndex = 0` and a deterministic fake tx hash (`keccak256(fillId)`).
- `relay()` is never constructed or called in test mode; the simulated router is never
  used in live mode. In test mode `OrderView.test` and the `SettledEvent`'s `test` are `true`.

## 7. Demo wiring

- `apps/demo/.env.local` / Vercel env: the variables in §2 (`SETTLE_MODE=test`,
  `SETTLE_WEBHOOK_URL=/api/settle-webhook`).
- `lib/settle.ts`: `export const settle = createSettle()`.
- `app/api/settle/[...path]/route.ts`: `export const { GET, POST } = settle.handlers`.
- `app/api/settle-webhook/route.ts`: verifies and records the event (T6 adds the
  purchases table; here it logs and returns 204).
- A throwaway page or `curl` script proves the done-when; the real UI is T6.

---

## Acceptance tests

Unit tests run the steps directly with `fakeRouter`/`simulateRouter`, a fake verifier,
a local webhook receiver (`Bun.serve` on a random port) and the real Postgres store
from T3.

1. Settings: missing `SETTLE_TREASURY`, zero address, treasury = refund address,
   unknown id in `SETTLE_ROUTES`, live mode without `RELAY_API_KEY` →
   `invalid_config` naming the variable; no value (key, secret, URL) appears in the
   error. Test mode loads without `RELAY_API_KEY` or `BASE_RPC_URL`.
2. `createOrder` twice with the same `externalId` → same order; `amount: 0n` and
   negative amounts rejected.
3. `POST …/route`: issues one address (router called once across two calls) and stores
   its request ID; `OrderView` doesn't include the request ID; different route → 409;
   expired → 410; unknown order → 404; wrong account (with `account`) → 404.
4. `checkOrder` calls `fills` with the stored request ID (`fakeRouter` records it). With
   reports scripted `[] → processing → filled` and a verifier saying `verified`: payment
   goes waiting → processing → settled; returns `deliver: true`.
5. Verifier says `pending` → not done, nothing settled. `rejected` → `needs_attention`.
6. Fill status `refunded` → payment `needs_attention` (reason `refund_unverified`),
   never `refunded`; no webhook sent.
7. Two fills both verified for one order, in one pass → first settles, second
   `needs_attention` (`order_paid`) in the same pass; one webhook.
8. A `sim_` request ID is ignored by a live-mode `checkOrder` (Relay never called), and
   a non-`sim_` one by test mode.
9. `router_unavailable` from `fills` → `wait` with backoff, no state change.
9b. No payment yet: `[]` (request not indexed), then a `waiting` report with no
    `depositTx` or `destination`, for 40 min → no payment row, no `needs_attention`,
    order still pending. A routed order missing its request ID → the step throws and
    `orderAddress` is not called again.
9c. A child after the parent: pass 1 settles the root; pass 2 also returns a child
    (different ID), verified → recorded, `needs_attention` (`order_paid`); still one
    webhook.
10. Watch window: unpaid order keeps polling every 10 s and ends at `expiresAt` + 1 h; a
    fill appearing 30 min after expiry is still recorded and settled (same request ID); a
    payment still processing at `expiresAt` + 1 h keeps the run going until it finishes.
    Paid order ends at `expiresAt` + 10 min.
11. Webhook signing: `verifyWebhook(signWebhook(event))` round-trips; a changed body,
    changed id, wrong secret, or timestamp 6 min old → rejected. Matches a Standard
    Webhooks test vector (from their spec repo).
12. `deliverOrder`: receiver answers 500, then times out, then 204 → one
    `markCredited`, two `delivery_failed` timeline entries, order `paid`; all three
    requests carry the same `webhook-id`. Run `deliverOrder` again → no request.
13. Bypass header: sent for a path URL when `VERCEL_AUTOMATION_BYPASS_SECRET` is set;
    never for an absolute URL.
14. Simulated `paid` scenario, end to end in the demo (local dev): one verified webhook
    and `GET /orders/:id` reads `paid` with a timeline. `paid_twice`: still one webhook;
    the order reads `paid`; the second payment is `needs_attention` in the database.

---

## Out of scope

UI (T6), wallet (T7), Relay webhooks, reconciliation cron, operator tools (webhook
replay), deposit mode, changing a route after picking it, more event types.

## Questions to answer in the PR description

- Why a signed webhook instead of calling a merchant function directly?
- How does a step on a fresh Vercel server get its settings?
- What stops two runs for the same order from sending two different paid events, and
  what does the merchant dedupe on?
- What happens if the merchant's webhook route is down for an hour?
- Why track the order by the quote's request ID, and why does that ID never authorize
  credit?
