# T6 · `<Checkout>` widget + demo shop

**Read first:** design doc §7 (Public API, step 4), §8 (Widget behavior), §10.3
(Security: address display), §10.4 (QR), §10.5 (polish). **Depends on:** T5.
**Time box:** ~4 hours. **Branch:** `vinay/t6-checkout`.
**Done when:** the deployed demo (test mode) lets a stranger pick one of three
products, pay with "Simulate payment" and land on a thank-you page that only a paid
order unlocks; works on a phone and in dark mode; acceptance tests pass.

---

## Goal

The part the CTO sees. A buyer opens checkout, picks where they're paying from, sees
exactly what to send (QR, address, amount), and watches it go to "Paid". The merchant
writes two lines of JSX. Address/QR only here; the wallet button is T7.

---

## Files

| File | What |
|---|---|
| `packages/react/src/provider.tsx` | `SettleProvider { endpoint }` (context with a tiny typed fetch client) |
| `packages/react/src/use-checkout.ts` | `useCheckout(orderId)`: the state machine below |
| `packages/react/src/checkout.tsx` | `<Checkout orderId onPaid? appearance? />` |
| `packages/react/src/parts/*.tsx` | Summary, RoutePicker, PayByAddress (QR + address), Progress, Result, TestToolbar |
| `packages/react/src/styles.ts` | CSS as a string, injected once with a `<style>`; classes prefixed `sk-` |
| `packages/react/src/copy.ts` | Every user-facing string in one object (design §10.5) |
| `packages/react/src/format.ts` | `formatUnits` display, address grouping, countdown |
| `apps/demo/app/(shop)/…` | Shop, checkout and thanks pages |
| `apps/demo/lib/products.ts`, `lib/db.ts`, purchases table | The merchant side |

Dependencies: `uqr` (tiny, zero-dependency QR → SVG) in `@settle-kit/react`. No
Tailwind, `@repo/ui`, wagmi or data-fetching library in the published widget.
`"use client"` at the top of the widget entry.

---

## 1. `useCheckout(orderId)`

```ts
type CheckoutState =
  | { step: "loading" }
  | { step: "choose_route"; order: OrderView; routes: RouteView[] }
  | { step: "issuing"; order: OrderView; route: RouteId }
  | { step: "pay"; order: OrderView; uri: string }              // waiting for money
  | { step: "processing"; order: OrderView }                     // payment seen
  | { step: "paid"; order: OrderView }
  | { step: "refunded" | "needs_attention" | "expired"; order: OrderView }
  | { step: "error"; error: ApiError; retry: () => void };

function useCheckout(orderId: string): CheckoutState & {
  chooseRoute(route: RouteId): void;
  simulate(scenario: Scenario): void;   // test mode only
};
```

- Derived from the server's `OrderView` alone; no client-side payment state, so a
  reload resumes at the right screen.
- Polls `GET /orders/:id` every 3 s while not final (our database only, no Relay
  call), pauses when the tab is hidden, stops at a final status.
- Skips `choose_route` when only one route is configured.
- A stale reply never overwrites a newer one (request counter, design §8).

## 2. Screens

| State | Shows |
|---|---|
| Summary (always on top) | `display.title`, image, price "0.10 USDC", countdown to `expiresAt` |
| `choose_route` | One button per route: "USDC on Base", "USDC on Arbitrum" |
| `pay` | QR of `paymentUri` (EIP-681: token, chain, address, `payAmount`); "Send exactly **1.184248 USDC** on **Arbitrum**"; address in 4-character groups with the first and last groups emphasised and a "check the first and last 4 characters" hint; copy buttons for address and amount with "Copied: 0x1a2b…9f8e" feedback; "Exchanges: withdraw on the Arbitrum network" note; the fee line (`payAmount − amount`) |
| `processing` | Timeline: Payment seen → Moving to Base → Verified on Base → Paid, with times and explorer links for `depositTx` / destination tx |
| `paid` | "Paid" + amount + Base explorer link; calls `onPaid()` once |
| `refunded` | "Returned to the merchant; contact support with order `ord_…`" (never "you've been refunded", design §8) |
| `needs_attention` | "We're checking this payment" + order id to quote to support |
| `expired` | "This checkout expired. Start a new order." (a late payment still moves it on) |
| `error` | Typed message from `copy` per error code + Retry (only before money moves) |

Test mode (`order.test`): a clearly labelled "Test mode" ribbon and a toolbar with
**Simulate payment**, **…delayed**, **…underpaid**, **…overpaid**, **…failed**.

## 3. Look and accessibility

- Theming through CSS variables (`--sk-accent`, `--sk-bg`, `--sk-fg`, `--sk-radius`,
  `--sk-font`) and `appearance={{ variables }}`; light and dark via
  `prefers-color-scheme`, overridable by the host.
- Focus moves to each new screen's heading; status changes are announced in a polite
  live region; everything works by keyboard; the QR has a text alternative.
- Amounts: `formatUnits` from viem, never `Number`; trailing zeros trimmed.
- Mobile first: one column, QR at most 240 px, tap targets ≥ 44 px.

## 4. Demo shop (`apps/demo`)

Three products in `lib/products.ts`, priced just above 0.05 USDC (the only minimum
Relay has enforced on us, S2) so the T8 real payments cost cents. Strict quotes have no
minimum of their own (S9), but the flat fee (~0.025 USDC from Base, ~0.034 from
Arbitrum) is added on top, so going lower makes the fee bigger than the price:

| Product | Price |
|---|---|
| Market report (PDF) | 0.05 USDC |
| Sticker pack | 0.10 USDC |
| Pro plan, one month | 0.15 USDC |

- `/`: product grid (shadcn `@repo/ui` is fine here; it's the merchant's app).
- "Buy" is a server action: `settle.createOrder({ externalId: purchaseId, amount,
  accountId: demoSessionId, display })` → redirect to `/checkout/[orderId]`.
  The price comes from `lib/products.ts` on the server, never from the form.
- `/checkout/[orderId]`: `<SettleProvider endpoint="/api/settle"><Checkout … /></SettleProvider>`.
- `onPaid` in `lib/settle.ts` inserts into `demo_purchases (event_id UNIQUE, order_id,
  product_id)` in one statement (duplicate event → no-op): the merchant-side dedupe
  pattern from design §7, shown for real.
- `/thanks/[orderId]`: shows the "download" only if a `demo_purchases` row exists.
- A `demoSessionId` cookie stands in for login (the demo has no accounts).
- Footer: "Test mode: no real money" banner when `SETTLE_MODE=test`, and links to the
  repo and README.

Deploy to Vercel (test mode) with the Neon database.

---

## Acceptance tests

1. `useCheckout` (Bun test with a fake fetch): each `OrderView` status maps to the
   right `step`; a stale reply is ignored; polling stops at a final status.
2. `paymentUri` (core): for Arbitrum USDC, 1.184248 USDC to `0x24a3…` →
   `ethereum:0xaf88…5831@42161/transfer?address=0x24a3…&uint256=1184248`.
3. Address grouping: 42 chars → `0x` + ten 4-char groups; first and last marked.
4. Copy catalogue: every error code in `DepositErrorCode` and the API error codes has a
   message (type-level `satisfies Record<…>`).
5. Manual, recorded in the PR with screenshots (desktop, phone width, dark): buy each
   product, simulate `paid`, `underpaid`, `delayed`, `expired` (short TTL), reload
   mid-flow and land on the same screen; the thank-you page refuses an unpaid order.

---

## Out of scope

Wallet payment (T7), the `/states` gallery, WalletConnect, translations beyond the copy
object, deposit mode.

## Questions to answer in the PR description

- Why is all checkout state derived from the server instead of kept in the browser?
- Why does the QR encode an EIP-681 request instead of a bare address?
- Why does "refunded" not say the buyer has their money back?
