import type { Hex } from "viem";
import { toBaseUnits } from "./amounts";
import type { DepositStatus } from "./payment";

/**
 * The `order.paid` webhook body. Stored once; a retry sends this same object.
 * Amounts are decimal strings of base units, so `JSON.stringify` needs no replacer.
 */
export type SettledEvent = {
  /** `${payment.id}:settled`. The app dedupes on this. */
  id: string;
  /** `"deposit"` arrives when deposit mode does. Checkout events are orders. */
  kind: "order";
  /** ISO 8601. */
  createdAt: string;
  /** True for a simulated payment. */
  test: boolean;
  order: { id: string; externalId: string; amount: string };
  payment: {
    id: string;
    /** Verified arrival on Base, in base units. Equals `order.amount`. */
    receivedAmount: string;
    depositTx: Hex | null;
    destination: { chainId: number; txHash: Hex; logIndex: number };
  };
};

/**
 * One append-only timeline row. `delivery_failed` is not a payment status:
 * the row stays `settled` while delivery is what failed.
 * Evidence stays an open record: tx hashes, amounts as strings, the router status, a note.
 * An amount-mismatch row stores an `AmountMismatch` here and stays `needs_attention`.
 */
export type TimelineEntry = {
  seq: number;
  status: DepositStatus | "delivery_failed";
  at: Date;
  actor: "system" | "operator";
  evidence: Record<string, unknown>;
};

/**
 * The Base receipt was not the order price. Not a payment status.
 * T4 attaches this when it moves the row to `needs_attention`.
 */
export type AmountMismatch = {
  reason: "amount_mismatch";
  /** Order price, base units. */
  expected: string;
  /** Amount on the Base receipt, base units. */
  received: string;
};

/** Format both amounts with the base-unit rules. Does not decide that they differ. */
export function amountMismatch(expected: bigint, received: bigint): AmountMismatch {
  return {
    reason: "amount_mismatch",
    expected: toBaseUnits(expected),
    received: toBaseUnits(received),
  };
}
