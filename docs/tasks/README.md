# Tasks: demo build

Goal: checkout mode end to end with real money, paid by QR or from a browser wallet,
deployed. Scope and reasoning: [design doc §0 and §9 "Demo cut"](../plans/2026-10-13-deposit-kit-design.md).

| Task | What | Day | Spec | Status |
|---|---|---|---|---|
| T1 | Payment router: `orderAddress`, `depositAddress`, `fills` on Relay; `fakeRouter` | 1 | [T1](T1-payment-router.md) | Done (PR #1) |
| T2 | Payment states, `nextStep`, order status, settlement event, amounts (hand-written) | 1 | [T2](T2-deposit-state.md) | Next |
| T3 | Postgres store: orders, payments, timeline; record once, settle once | 1 | [T3](T3-store.md) | Spec ready |
| T4 | Receipt verifier: exactly one USDC `Transfer` of the order amount to the merchant, at Base's `safe` block | 2 | To write | |
| T5 | `payOrder` workflow (poll `fills`, verify, settle, `onSettled` with retries); order API routes (`POST /orders`, `GET /orders/:id`); test mode (`simulateRouter`) | 2 | To write | |
| T6 | Checkout widget + demo "Buy report" page: exact amount, EIP-681 QR, countdown, progress, result, timeline; deployed | 3 | To write | |
| T7 | Pay from a browser wallet (EOA): EIP-6963 connect, network switch, balance and gas checks, exact-amount USDC transfer, no second send | 4 | To write | |
| T8 | Real payments (QR and wallet; Base, Arbitrum if funds allow); README, 2-minute video, "built vs designed" table | 5 | To write | |

Specs for T4 onwards are written one task ahead, so they include what the previous task
taught us.
