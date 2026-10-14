import type { Hex } from "viem";
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
 * Evidence holds strings (tx hashes, amounts, the router status, a note).
 */
export type TimelineEntry = {
  seq: number;
  status: DepositStatus | "delivery_failed";
  at: Date;
  actor: "system" | "operator";
  evidence: Record<string, unknown>;
};
