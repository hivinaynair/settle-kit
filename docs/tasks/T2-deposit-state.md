# T2 · Payment states, events and amounts (core)

**Read first:** design doc §0 (build scope), §4 (Deposit states, Concurrency), §6a
(order statuses), §10.2 (timeline). **Depends on:** T1 (`FillStatus` in `router.ts`).
**You write:** all code, by hand (interview practice). **Time box:** ~2 hours.
**Branch:** `vinay/t2-payment-state`.
**Done when:** the acceptance tests pass with `bun test` and lint/types are clean.

---

## Goal

One pure module every other layer obeys: which states a payment can be in, which moves
are legal, how the router's report on a payment turns into the workflow's next step, the
order status shown to the buyer, and the exact shape of the settlement event. No I/O.
This is the "spec to types and functions" exercise of the project: small and exhaustive.

A **payment** (a "deposit" row in the database) is one transfer Relay saw at an order's
address. An **order** is what the buyer is paying for. An order normally has one payment.

---

## Files

| File | What |
|---|---|
| `packages/core/src/payment.ts` | `DepositStatus`, `TRANSITIONS`, `canTransition`, `isFinal`, `nextStep`, `OrderStatus`, `orderStatusFor` |
| `packages/core/src/events.ts` | `SettledEvent`, `TimelineEntry` |
| `packages/core/src/amounts.ts` | `toBaseUnits`, `parseBaseUnits` |
| `packages/core/src/errors.ts` | Add wallet error codes |
| `packages/core/src/*.test.ts` | Acceptance tests |
| `packages/core/src/index.ts` | Re-export |

---

## 1. Payment states

```ts
export type DepositStatus =
  | "waiting" | "processing" | "delayed" | "needs_attention"
  | "settled" | "credited" | "refunded" | "resolved";
```

| Status | Meaning |
|---|---|
| `waiting` | Relay saw the payment; nothing has moved yet |
| `processing` | Relay is moving the money |
| `delayed` | Relay reports it's slow |
| `needs_attention` | Something is off (unknown status, failed verification, too slow); a human looks |
| `settled` | We verified on Base that exactly the price arrived; the app hasn't confirmed delivery yet |
| `credited` | The app confirmed it delivered (unlocked the report) |
| `refunded` | Money went back to the app's refund address |
| `resolved` | An operator closed an attention case by hand |

There is no `failed`: a payment row only exists after money moved, so a failure ends as
`refunded` or `needs_attention`.

Transition table, as one exported constant:

| From | Allowed next |
|---|---|
| `waiting` | processing, delayed, settled, refunded, needs_attention |
| `processing` | delayed, settled, refunded, needs_attention |
| `delayed` | processing, settled, refunded, needs_attention |
| `needs_attention` | processing, settled, refunded, resolved |
| `settled` | credited |
| `credited`, `refunded`, `resolved` | none (final) |

```ts
export const TRANSITIONS: Readonly<Record<DepositStatus, readonly DepositStatus[]>>;
export function canTransition(from: DepositStatus, to: DepositStatus): boolean;
export function isFinal(status: DepositStatus): boolean; // credited | refunded | resolved
```

## 2. `nextStep(current, fill)`: what the workflow does next

```ts
export type Step =
  | { kind: "move"; to: DepositStatus } // e.g. waiting → processing
  | { kind: "verify" }                  // Relay says filled: check the receipt on Base (T4)
  | { kind: "stay" };                   // nothing to do

export function nextStep(current: DepositStatus, fill: FillStatus): Step;
```

Rules:
1. A final `current`, or `settled`, always returns `stay` (only delivery moves `settled`).
2. `filled` → `verify`.
3. `refunded`, `failed` and `unknown` → `move` to `needs_attention`. A router saying
   "refunded" is a claim, not proof the money reached the refund wallet, and 0.1 has no
   refund verifier (design §9, deferred), so it can't put a payment in a final state.
   `refunded` stays in the table for when that verifier exists.
4. `waiting` / `processing` / `delayed` → `move` to the same-named state, or `stay` if
   already there.
5. Never return a `move` that `canTransition` rejects; return `stay` instead
   (e.g. `needs_attention` + `waiting` → `stay`).

## 3. Order status (what the buyer sees)

```ts
export type OrderStatus = "pending" | "paid" | "refunded" | "needs_attention" | "expired";
export function orderStatusFor(payment: DepositStatus | null, expired: boolean): OrderStatus;
```

| Payment status | Order status |
|---|---|
| none yet | `pending`, or `expired` if past expiry |
| `waiting`, `processing`, `delayed`, `settled` | `pending` |
| `credited` | `paid` (even after expiry: a late payment still counts) |
| `refunded` | `refunded` |
| `needs_attention`, `resolved` | `needs_attention` |

## 4. Events

```ts
/** The `order.paid` webhook body. Persisted once; a retry sends the same object. */
export type SettledEvent = {
  id: string;           // `${payment.id}:settled`; the app dedupes on it
  kind: "order";        // "deposit" arrives with deposit mode later
  createdAt: string;    // ISO 8601
  test: boolean;        // true for simulated payments
  order: { id: string; externalId: string; amount: string };   // amount: base units
  payment: {
    id: string;
    receivedAmount: string;  // verified arrival on Base, base units (equals order.amount)
    depositTx: Hex | null;
    destination: { chainId: number; txHash: Hex; logIndex: number };
  };
};

export type TimelineEntry = {
  seq: number;
  status: DepositStatus | "delivery_failed";
  at: Date;
  actor: "system" | "operator";
  evidence: Record<string, unknown>; // tx hashes, amounts as strings, router status, note
};
```

When the Base receipt is not the exact order price, T4 moves the payment to
`needs_attention` and stores an `AmountMismatch` as that row's `evidence`:
`{ reason: "amount_mismatch", expected, received }`, both decimal base-unit strings.
`evidence` stays an open record, so other rows can still carry tx hashes, the router
status, and an operator note. The buyer still sees order status `needs_attention`.

## 5. Amounts

```ts
export function toBaseUnits(value: bigint): string;   // 1150000n → "1150000"; rejects negatives
export function parseBaseUnits(text: string): bigint; // "1150000" → 1150000n
```

`parseBaseUnits` accepts only `/^(0|[1-9][0-9]*)$/`. Anything else (decimals, signs,
spaces, exponents, empty) throws `DepositError("invalid_config")`.

## 6. Errors

Add `"wallet_rejected" | "wrong_network" | "insufficient_balance" | "insufficient_gas"`
to `DepositErrorCode` (used by the wallet path in T7).

---

## Acceptance tests

1. `TRANSITIONS` has exactly the 8 statuses as keys; every target is a status.
2. Generated: for all 64 `(from, to)` pairs, `canTransition` matches the table.
3. `isFinal` is true for exactly `credited`, `refunded`, `resolved`.
4. Generated: every `(status, fill)` pair (8 × 7 = 56) returns a `Step`, and every
   `move` passes `canTransition`.
5. `nextStep("waiting", "filled")` → `verify`; `("processing", "refunded")` →
   move `needs_attention`; `("delayed", "unknown")` → move `needs_attention`;
   `("settled", "failed")` → `stay`; `("needs_attention", "waiting")` → `stay`.
6. `orderStatusFor` matches every row of the table in §3, including `credited` + expired
   → `paid`.
7. `parseBaseUnits` round-trips a 60-digit number exactly, and rejects `"1.5"`, `"-1"`,
   `"01"`, `" 1"`, `"1e6"`, `""`.
8. A `SettledEvent` survives `JSON.stringify` → `JSON.parse` unchanged (no `bigint`
   inside).

---

## Out of scope

Persistence (T3), workflows (T5), UI. Plain functions and a `const` table; no classes
needed.

## Questions to answer in your PR description

- Why is there no `failed` payment status?
- Why does `settled` exist separately from `credited`?
- Why are amounts strings inside events but `bigint` in code?
- Why does a router "refunded" go to `needs_attention` instead of `refunded`?
