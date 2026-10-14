# Request-ID tracking: T1 implementation and downstream spec changes

Prepared after reading merged PR #2 (`3fb3bf4`), which contains the T4–T9 specs.
This is a handoff for updating the specs. It is not evidence of a live payment.

## Context and decision

The 0.1 build is strict, single-use checkout. Relay documents that a strict order
keeps its original request ID. We now retain that ID from the quote and track the
order through it. The buyer still sends funds to the deposit address.

Keep two router methods. `orderAddress` creates instructions; `fills` reads the
original request and related child requests. A paid boolean or parent-only lookup
would lose transaction evidence and could miss duplicate-deposit handling required
by T5. The returned array contains Relay processing reports, not a scan of every
blockchain transaction.

References:
- https://docs.relay.link/features/deposit-addresses#which-request-owns-the-fill
- https://docs.relay.link/references/api/get-requests (`id`, `includeChildRequests`)

Relay documents the child lookup and exposes duplicate-deposit refund request IDs.
We have not proved that an actual second deposit is discoverable through this query.
That coverage is a required live check, not an assumption to present as verified.

## T1 contract implemented on `vinay/t1-payment-router`

```ts
type OrderAddress = {
  address: Address;
  payAmount: bigint;
  requestId: string;
};

type PaymentRouter = {
  id: string;
  orderAddress(input: OrderAddressInput): Promise<OrderAddress>;
  fills(requestId: string): Promise<Fill[]>;
};
```

- `orderAddress` takes the address and request ID from the same first deposit step.
  Missing/empty step request ID is rejected with `router_unavailable`.
- `fills` queries `/requests/v3?id=<requestId>&includeChildRequests=true&limit=100`.
  It still follows continuation pages and rejects repeated cursors. Empty IDs are
  rejected before HTTP with `invalid_config`, avoiding an unscoped query.
- Each report retains its own `Fill.id`; child IDs are not replaced by the root ID.
- `fakeRouter` now requires `requestId` in its script, returns it with instructions,
  and records request IDs as the inputs to `fills`.
- `Fill`, verification requirements and settlement event identity are unchanged.
- A report can be `waiting` with no transaction evidence. That is not proof of a
  deposit. T1 returns it; T5 must distinguish an unfunded quote from a payment.

## Changes Claude should make to the specs

### T3: `docs/tasks/T3-store.md`

1. Add nullable `router_request_id` to `settle_kit_orders` and `OrderRow`. It is absent
   before route selection, then stored with `route`, `address` and `pay_amount` in the
   same successful CAS. Retries return the stored pair; never mix an address from one
   quote with an ID from another or overwrite a chosen quote.
2. Add a unique constraint on `(router_request_id, test)` to prevent assigning one
   router request to different orders in the same mode. Null is allowed before routing.
3. Add `findOrderByRequestId(requestId: string, test: boolean)` for the simulated
   router's lookup; update its acceptance test. Address is still stored for sending,
   display and support. Keep address lookup only if another specified caller needs it.
4. Keep each deposit's `fill_id` as that report's own ID. Keep the existing per-fill,
   per-transfer and paid-once constraints; a root request ID does not replace them.
5. Add tests for atomic instruction persistence, retries preserving request ID,
   uniqueness per mode, and a root and child recorded as separate payments.

### T5: `docs/tasks/T5-create-settle.md`

1. Route selection saves the returned `requestId` through `setOrderRoute`.
2. `checkOrder` loads `order.routerRequestId` and calls `router.fills` with it instead
   of `order.address`. Both the address and ID must exist for a routed order. A partially
   persisted pair is an invariant violation, not grounds for another quote.
3. Keep the full pass over all returned reports. A child must still be recorded and
   processed even when the parent already settled. Keep `order_paid` handling and
   the database's paid-once guard. Never return early merely because the parent is paid.
4. An empty result or a `waiting` report with neither `depositTx` nor `destination`
   means no payment has been observed yet: do not insert a payment row or start its
   30-minute attention timer. Start that timer when payment activity is observed.
5. Preserve receipt verification, unverified-refund attention, backoff, late-payment
   watch windows and signed merchant-webhook delivery. ID-based lookup does not
   authorize fulfilment or change the webhook's stable event ID.
6. `simulateRouter.orderAddress` returns a stable simulated request ID with the address.
   `simulateRouter.fills(requestId)` finds the stored test order by request ID and mode.
   Simulate parent plus child reports with distinct IDs for the duplicate-payment test.
7. Update acceptance tests to cover request-ID calls, no indexed request, unfunded
   waiting reports, a child after parent settlement, retry/backoff and late payment.
   Preserve the existing all-reports-in-one-pass and one-webhook assertions.
8. Keep the request ID internal to the server/store unless the public `OrderView` has
   a concrete need for it. The widget polls our order endpoint, not Relay.

### T2 and T4

No change to payment-state transitions, event identity or `verifyPayment` API.
The verifier still consumes the destination transaction hash and checks chain,
USDC contract, treasury, exact amount and Base's `safe` block. A root request ID
identifies processing, not an on-chain transfer or merchant fulfilment.

### T6 and T7

No change to checkout's payment instructions or wallet transfer: the buyer still
sends `payAmount` to `order.address` on the configured source chain. Update any
fixtures/mocks that construct `OrderAddress` or invoke `fills`. The local send-attempt
hash remains a UI hint, never settlement evidence.

### T8: `docs/tasks/T8-live-payments.md`

1. Record original quote request ID separately from each observed fill/child ID,
   plus order ID, source transaction and verified destination transfer.
2. Capture `/requests/v3?id=...&includeChildRequests=true` responses for normal,
   underpaid, overpaid and late payments.
3. Add a controlled double-payment test (requires Vinay's explicit approval before
   sending real funds): first payment fulfils once; second deposit and any related
   refund/failure report are discovered and flagged; no second merchant fulfilment.
4. Confirm that child lookup actually covers the second deposit. If it does not,
   retain or restore address-based discovery for this exception path before claiming
   duplicate-payment tracking works. Do not silently weaken the existing requirement.
5. Update the README diagram to show order -> stored request ID -> reports -> verified
   Base transfer -> signed merchant webhook. Keep the existing watch-window limitation.

### T9: `docs/tasks/T9-npm-publish.md`

The packaging/build plan is unchanged. Include the updated `OrderAddress` declaration
and router signature in exported types and examples. The separate-app installation
test must exercise the new simulated request-ID path through the same public API.

### Design doc and task index

Update the current 0.1 scope, matching explanation, Relay integration table, checkout
storage and workflow paragraphs, developer examples and T1/T5 index descriptions.
Say that the address is the payment destination and the stored root request ID is
the strict-checkout tracking key. Keep future reusable-deposit design distinct:
open-address regeneration still needs address-based discovery. Remove contradictory
checkout references without rewriting that future design around a single request ID.

## Scope for Claude

Update specs and examples only; T1 code is being handled in this chat. Re-read files
before targeted edits, preserve unrelated changes, and do not claim live coverage
from fixture tests. Call out the duplicate-child coverage check as pending in T8.
