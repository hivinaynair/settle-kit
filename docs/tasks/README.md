# Tasks: demo build (2 days)

Goal: a plug-and-play checkout SDK on npm. A merchant configures `createSettle`, creates
orders with their own prices, drops in `<Checkout>`, and gets USDC on Base in their own
treasury, paid by QR or from a browser wallet. Scope and reasoning: [design doc §0, §7
and §9 "Demo cut"](../plans/2026-10-13-deposit-kit-design.md).

| Task | What | Day | Spec | Status |
|---|---|---|---|---|
| T1 | Payment router: `orderAddress`, `depositAddress`, `fills` on Relay; `fakeRouter` | 1 | [T1](T1-payment-router.md) | Done (PR #1) |
| T2 | Payment states, `nextStep`, order status, settlement event, amounts (hand-written) | 1 | [T2](T2-deposit-state.md) | Next |
| T3 | Postgres store: orders (with `display`), payments, timeline; record once, settle once | 1 | [T3](T3-store.md) | Spec ready |
| T4 | Receipt verifier: exactly one USDC `Transfer` of the order amount to the treasury, at Base's `safe` block | 1 | To write | |
| T5 | `createSettle`: `createOrder`, route selection, `payOrder` workflow (poll `fills`, verify, settle, `onPaid` with retries), `handlers`, test mode | 1 | To write | |
| T6 | `<Checkout>` + `useCheckout` in `@settle-kit/react`; demo shop with 3 products at different prices, deployed | 2 | To write | |
| T7 | Pay from a browser wallet (EOA): EIP-6963 connect, network switch, balance and gas checks, exact-amount USDC transfer, no second send | 2 | To write | |
| T8 | Real payments (QR and wallet; Base, Arbitrum if funds allow); README quickstart, 2-minute video, "built vs designed" table | 2 | To write | |
| T9 | Publish `0.1.0` to npm: build step, type declarations, separate server/client entry points, install test in a fresh Next.js app | 2 | To write | |

Specs for T4 onwards are written just before each task, so they include what the
previous task taught us.

**Needed from Vinay:** T2 by hand; Base funds for T8 (₹1,500 of ETH on Base via
Onramp.money to the payer wallet); npm login with publish rights on `@settle-kit` for T9.
