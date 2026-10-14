# Tasks: demo build (2 days)

Goal: a plug-and-play checkout SDK on npm. A merchant configures `createSettle`, creates
orders with their own prices, drops in `<Checkout>`, and gets USDC on Base in their own
treasury, paid by QR or from a browser wallet. Scope and reasoning: [design doc §0, §7
and §9 "Demo cut"](../plans/2026-10-13-deposit-kit-design.md).

| Task | What | Day | Spec | Status |
|---|---|---|---|---|
| T1 | Payment router: `orderAddress` (address, payAmount, request ID), `fills(requestId)` with child requests on Relay; `fakeRouter` | 1 | [T1](T1-payment-router.md) | Done ([#1](https://github.com/hivinaynair/settle-kit/pull/1), request ID [#4](https://github.com/hivinaynair/settle-kit/pull/4)) |
| T2 | Payment states, `nextStep`, order status, settlement event, amounts (hand-written) | 1 | [T2](T2-deposit-state.md) | Next |
| T3 | Postgres store: orders (with `display`), payments, timeline; record once, settle once, paid once | 1 | [T3](T3-store.md) | Spec ready |
| T4 | Receipt verifier: exactly one USDC `Transfer` of the order amount to the treasury, at Base's `safe` block | 1 | [T4](T4-verify-payment.md) | Spec ready |
| T5 | `createSettle`: `createOrder`, route selection (stores the request ID), `payOrder` workflow (poll `fills` by request ID, verify, settle, signed `order.paid` webhook with retries), `handlers`, env-var settings, test mode; spike S8 first | 1 | [T5](T5-create-settle.md) | Spec ready |
| T6 | `<Checkout>` + `useCheckout` in `@settle-kit/react`; demo shop with 3 products, deployed in test mode | 2 | [T6](T6-checkout-widget.md) | Spec ready |
| T7 | Pay from a browser wallet: EIP-6963, network switch, balance and gas checks, exact-amount USDC transfer, no second send | 2 | [T7](T7-wallet-payment.md) | Spec ready |
| T8 | Real payments (script + wallet; Base and Arbitrum; underpay refund; double and late payment, proving child-request discovery); README quickstart, 2-minute video, built vs designed | 2 | [T8](T8-live-payments.md) | Spec ready |
| T9 | Publish `0.1.0` to npm: `tsc` build, types, `server-only`/`use client` boundaries, install test in a fresh Next.js app | 2 | [T9](T9-npm-publish.md) | Spec ready |

All specs are written. Each spec is re-checked before its task starts, so it includes
what the previous task taught us. Order: T2 (Vinay) and T4 in parallel → T3 (uses T2's
types) → T5 → T6 → T7; T8 needs funds; T9 can start once T7 is merged.

**Needed from Vinay:** T2 by hand; Base funds for T8 (₹1,500 of ETH on Base via
Onramp.money to the payer wallet); npm login with publish rights on `@settle-kit` for T9.
