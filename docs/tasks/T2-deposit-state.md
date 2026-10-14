# T2 · Deposit state machine, events and amounts (core)

**Read first:** design doc §4 (Deposit states, Concurrency), §6 (Host credit delivery),
§10.2 (timeline). **Depends on:** T1 (types in `router.ts`).
**You write:** all code. **Time box:** ~2 hours. **Branch:** `vinay/t2-deposit-state`.
**Done when:** the acceptance tests pass with `bun test` and lint/types are clean.

---

## Goal

One pure module that every other layer obeys: which deposit states exist, which moves
are legal, how a router's fill status turns into the next step, and the exact shapes of
the settlement callback and timeline events. No I/O. This is the class-and-types
exercise of the project; keep it small and exhaustive.

---

## Files

| File | What |
|---|---|
| `packages/core/src/deposit.ts` | `DepositStatus`, transition table, `canTransition`, `isFinal`, `isInFlight`, `nextStep` |
| `packages/core/src/events.ts` | `SettledEvent`, `TimelineEntry` types |
| `packages/core/src/amounts.ts` | `toBaseUnits`, `parseBaseUnits` |
| `packages/core/src/errors.ts` | Add wallet error codes |
| `packages/core/src/*.test.ts` | Acceptance tests |
| `packages/core/src/index.ts` | Re-export |

---

## Types

```ts
export type DepositStatus =
  | "waiting" | "processing" | "delayed" | "needs_attention"
  | "settled" | "credited" | "refunded" | "resolved";
```

Transition table (design §4), as one exported constant:

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
export function isFinal(status: DepositStatus): boolean;     // credited | refunded | resolved
export function isInFlight(status: DepositStatus): boolean;  // not final, not needs_attention
```

### `nextStep(current, fill)`

Turns the router's `FillStatus` (T1) into what the processing workflow does next. Pure.

```ts
export type Step =
  | { kind: "move"; to: DepositStatus }   // e.g. waiting → processing
  | { kind: "verify_settlement" }         // fill says filled: check the receipt (T4)
  | { kind: "verify_refund" }             // refunded or failed: look for return-to-app evidence
  | { kind: "stay" };                     // nothing to do (same state, or already final)

export function nextStep(current: DepositStatus, fill: FillStatus): Step;
```

Rules:
1. A final `current` always returns `stay`. So does `settled` (only delivery moves it).
2. `filled` → `verify_settlement`; `refunded` and `failed` → `verify_refund`.
3. `waiting`/`processing`/`delayed` → `move` to the matching state, or `stay` if equal.
4. Never return a `move` that `canTransition` rejects (`needs_attention → waiting`
   becomes `stay`).

### Events

```ts
/** The onSettled payload for both modes. Persisted once; replay sends the same object. */
export type SettledEvent = DepositSettled | OrderSettled;

type SettledBase = {
  id: string;                    // `${deposit.id}:settled`; hosts dedupe on it
  createdAt: string;             // ISO 8601
  test: boolean;                 // true for simulated payments (§10.1)
};
export type DepositSettled = SettledBase & { kind: "deposit"; deposit: SettledDeposit };
export type OrderSettled = SettledBase & {
  kind: "order";
  deposit: SettledDeposit;
  order: { id: string; externalId: string; amountOut: string };
};

type SettledDeposit = {
    id: string;
    accountId: string;
    addressId: string | null;    // null for checkout payments
    amountIn: string;            // base units, decimal string
    amountOut: string;           // verified arrival, base units; the amount to credit
    token: Address;              // destination USDC contract
    chainId: number;             // 8453
    depositTx: Hex | null;
    destination: { txHash: Hex; logIndex: number };
};

/** Checkout order status (design §6a), derived from its deposit's status. */
export type OrderStatus = "pending" | "paid" | "refunded" | "needs_attention" | "expired";
export function orderStatusFor(deposit: DepositStatus | null, expired: boolean): OrderStatus;

export type TimelineEntry = {
  seq: number;
  status: DepositStatus | "delivery_failed" | "delivery_replayed";
  at: Date;
  actor: "system" | "operator";
  evidence: Record<string, unknown>;   // tx hashes, amounts as strings, router status, note
};
```

### Amounts

```ts
export function toBaseUnits(value: bigint): string;      // 1965708n → "1965708"; rejects negatives
export function parseBaseUnits(text: string): bigint;    // "1965708" → 1965708n
```

`parseBaseUnits` accepts only `/^(0|[1-9][0-9]*)$/`. Anything else (decimals, signs,
spaces, exponents, empty) throws `DepositError("invalid_config")`. No floats anywhere.

### Errors

Add `"wallet_rejected" | "wrong_network" | "insufficient_balance" | "insufficient_gas"`
to `DepositErrorCode` (used by the widget in T9).

---

## Acceptance tests

1. `TRANSITIONS` has exactly the 8 statuses as keys, and every listed target is a status.
2. Every allowed pair in the table passes `canTransition`; a sample of 10 disallowed
   pairs fails, including `credited → settled`, `settled → refunded`, `resolved → processing`.
3. Generated check: for every `(from, to)` of the 64 pairs, `canTransition` matches the
   table (no hand-written exceptions).
4. `isFinal` is true for exactly `credited`, `refunded`, `resolved`.
5. `isInFlight` is true for exactly `waiting`, `processing`, `delayed`, `settled`.
6. `nextStep`: every combination of the 8 statuses × 6 fill statuses returns a `Step`,
   and every `move` passes `canTransition` (generated, 48 cases).
7. `nextStep("credited", "filled")` and `nextStep("settled", "failed")` are `stay`.
8. `nextStep("waiting", "filled")` is `verify_settlement`; `("processing", "failed")` is
   `verify_refund`; `("needs_attention", "waiting")` is `stay`.
9. `parseBaseUnits("115792089237316195423570985008687907853269984665640564039457")`
   round-trips through `toBaseUnits` exactly.
10. `parseBaseUnits` rejects `"1.5"`, `"-1"`, `"01"`, `" 1"`, `"1e6"`, `""`.
11. A `SettledEvent` of each `kind` serialises with `JSON.stringify` (no `bigint` inside),
    and narrowing on `kind` gives typed access to `order` only for orders.
12. `orderStatusFor`: no deposit and not expired → `pending`; no deposit and expired →
    `expired`; `credited` → `paid` (even if expired: late payments count);
    `refunded` → `refunded`; `needs_attention` → `needs_attention`; `waiting`,
    `processing`, `delayed`, `settled` → `pending`.

---

## Out of scope

Persistence (T3), workflows (T5), UI. No classes needed unless you want one; plain
functions and a `const` table are enough.

## Questions to answer in your PR description

- Why is there no `failed` status?
- Why does `settled` exist separately from `credited`?
- Why are amounts strings inside events but `bigint` in code?
