# T8 · Real payments, README, video

**Read first:** design doc §9 (validation, live proofs), §12 item 5 (user docs),
spikes S4, S6, S7. **Depends on:** T5–T7, and Vinay funding the payer wallet.
**Time box:** ~3 hours (plus waiting for funds). **Branch:** `vinay/t8-live`.
**Done when:** the deployed demo in live mode has taken real payments (QR and wallet,
from Base and Arbitrum), each recorded with fill ID and transaction links in
`docs/spikes.md`; the README quickstart works from a clean clone in test mode; a
2-minute video exists.

---

## Goal

Everything so far ran on simulated payments. This task proves it with real money, small
amounts, and packages the proof so a reader believes it in two minutes.

---

## Before starting (Vinay)

- [ ] Buy ~₹1,000 of ETH on Base (Onramp.money) to the payer wallet
      `0xc0ddaFE4d55E5ce58FDa36b85A1125F217130ebE`.
- [ ] Swap ~$6 of it to USDC on Base, and bridge ~$1.50 USDC to Arbitrum (Relay app;
      keep a little ETH on Arbitrum for gas).
- [ ] Fund a browser wallet (MetaMask/Rabby) with ~$1 USDC on Base + gas for the
      wallet payment.

Cost: prices are 0.50–2.00 USDC (T6) and land in our own treasury, so what's actually
spent is Relay's fee (~$0.03 per payment) and gas: about $1 for all seven runs. About
$5 of USDC moves in total; most of it ends up back in the treasury.
- [ ] Vercel production env: `SETTLE_MODE=live`, `RELAY_API_KEY`, `BASE_RPC_URL`,
      `SETTLE_TREASURY=0xac44275dE5bF4109977892c4a256BbFA16B6C804`,
      `SETTLE_REFUND_ADDRESS` (an app-controlled wallet; not the treasury).
- [ ] Keep a separate test-mode deployment (preview or a second project) for visitors.

---

## Files

| File | What |
|---|---|
| `scripts/pay-order.ts` | Pays an order's address from the CDP payer wallet: reads `GET /orders/:id`, sends exactly `payAmount` of the route's USDC. Uses `@coinbase/cdp-sdk` (root dev dependency); CDP credentials from `scripts/.env.local` (gitignored). Same pattern as lycoris `scripts/demo/fund-wallet.ts` |
| `docs/spikes.md` | S4 results: one row per payment |
| `README.md` | Rewritten (below) |
| `docs/built-vs-designed.md` | What 0.1 does vs the full design, linked from the README |

---

## 1. Live runs

Run each, in order; stop at the first failure and fix before going on.

| # | Payment | Expected |
|---|---|---|
| 1 | Market report, Base USDC, by script (stands in for "scan QR in any wallet") | `paid`, one verified webhook, thank-you unlocked |
| 2 | Sticker pack, Arbitrum USDC, by script | `paid` |
| 3 | Market report, Base USDC, browser wallet via `<Checkout>` | `paid` |
| 4 | Send 0.02 USDC less than `payAmount` on Base, by script | Relay refunds to `SETTLE_REFUND_ADDRESS`; order `needs_attention` (`refund_unverified`; record the refund tx by hand); no webhook |
| 5 | Send 0.02 USDC more than `payAmount` on Base | `paid` with exactly the order amount; excess refunded |
| 6 | **Double payment** (only after Vinay explicitly approves sending the second payment): pay a Market report order normally, then send `payAmount` to the same address again | First payment: `paid`, one webhook. Second: found as a child report of the order's request, recorded, `needs_attention` (`order_paid`, or `refund_unverified` if Relay refunds it); no second webhook or `demo_purchases` row |
| 7 | Pay a Market report order 10 min after its `expiresAt`, by script | Found by the same request ID, `paid` (late payment); or, if Relay rejects or refunds it, record exactly what happens |

For each, record in `docs/spikes.md` (S4): order id, the quote's original request ID,
each report's own fill ID (root and any child, kept separate), source deposit tx, the
verified Base tx + log index, amount sent, amount received, seconds from send to `paid`,
and the raw `/requests/v3?id=<requestId>&includeChildRequests=true` responses observed
(status sequence, any 429s) for the normal, underpaid, overpaid, double and late runs.

**Which outgoing transaction is the payment (run 5).** T1's `toFill` takes the first of
`data.outTxs` as the Base delivery. On an overpayment Relay also refunds the excess; if
that refund appears in `outTxs` (it would be on Base too for Base→Base), check its
position. If it can come first, the verifier will reject a good payment
(`needs_attention`, never a wrong credit): change `Fill` to carry every outgoing tx and
verify each.

**Duplicate-deposit discovery is unverified until run 6.** Relay documents child
requests for extra deposits, but no one has yet seen a real second deposit come back
from this query. If run 6's second payment does not appear as a child: say so in
`docs/spikes.md`, don't claim duplicate-payment tracking works, and add address-based
discovery back for this case (as a follow-up task) rather than dropping the requirement.

If the key's 2 req/min `/requests` limit (S7) bites, raise `pollEvery` in the demo
config and note it; don't add new mechanisms in this task.

## 2. README (repo root)

1. One-paragraph pitch + a GIF of a checkout going to "Paid".
2. **Quickstart in test mode (5 minutes):** install, the pieces from design §7
   (env vars, `createSettle()`, route file, webhook route, `createOrder`, `<Checkout>`),
   the migration, "click Simulate payment".
3. **Going live:** Relay API key, Base RPC, treasury and refund wallets (both
   app-controlled), what the payer pays in fees (S6 numbers), the webhook secret and the
   dedupe-on-`event.id` rule; fulfilling on the webhook, never on `<Checkout onPaid>`.
4. **How it works:** the payment-to-order diagram (order → one address for the buyer
   and its stored Relay request ID → Relay's reports for that request → verified transfer
   on Base at `safe` → settle once → signed webhook with retries), with links to the
   design doc. Keep the limit: a payment after the watch window ends isn't tracked in 0.1.
5. **Live proof:** the S4 table with explorer links.
6. Limits of 0.1 and what's next (link `docs/built-vs-designed.md`).
7. Security note: Settle Kit never holds funds or keys; report issues privately
   (design §12 item 7).

## 3. Video (≤ 2 minutes, Vinay records)

Script: problem (5 s) → buy a product on the live demo and pay from a wallet (40 s) →
the timeline and the Base explorer showing USDC in the merchant's treasury (20 s) →
the merchant code: env vars, two route files, `createOrder`, `<Checkout>` (30 s) → test mode for developers (15 s) → what's next
(10 s). Link it from the README.

---

## Acceptance

1. Runs 1–7 recorded with links (run 6 states plainly whether the child lookup found the
   second deposit); every `paid` order has exactly one `demo_purchases`
   row; the treasury's USDC balance rose by exactly the sum of paid order amounts.
2. A fresh clone following only the README reaches a simulated `paid` in test mode.
3. No secret appears in the repo, logs or screenshots (`git grep` for the key prefixes).

## Out of scope

Ethereum route proof, refund evidence verification, webhooks, npm publishing (T9).
