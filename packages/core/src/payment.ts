import type { FillStatus } from "./router";

/**
 * One transfer the router saw at an order's address.
 * A row exists only after money moved, so there is no `failed`:
 * a problem ends as a verified refund, or it stays open for a person.
 */
export type DepositStatus =
  | "waiting"
  | "processing"
  | "delayed"
  | "needs_attention"
  | "settled"
  | "credited"
  | "refunded"
  | "resolved";

/**
 * Legal moves. The store will compare-and-set on this table and reject anything else.
 * Discovery can observe a finished fill first, so a row may skip the middle.
 * `settled` waits for the app to confirm it delivered. The last three never move.
 */
export const TRANSITIONS: Readonly<Record<DepositStatus, readonly DepositStatus[]>> = {
  waiting: ["processing", "delayed", "settled", "refunded", "needs_attention"],
  processing: ["delayed", "settled", "refunded", "needs_attention"],
  delayed: ["processing", "settled", "refunded", "needs_attention"],
  needs_attention: ["processing", "settled", "refunded", "resolved"],
  settled: ["credited"],
  credited: [],
  refunded: [],
  resolved: [],
};

export function canTransition(from: DepositStatus, to: DepositStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Credited, refunded, and resolved. Empty rows in the table, named here on purpose. */
export function isFinal(status: DepositStatus): boolean {
  return status === "credited" || status === "refunded" || status === "resolved";
}

/**
 * What the workflow does with the router's latest report.
 * `verify` checks the Base receipt before any credit (T4). Only delivery leaves `settled`.
 */
export type Step = { kind: "move"; to: DepositStatus } | { kind: "verify" } | { kind: "stay" };

export function nextStep(current: DepositStatus, fill: FillStatus): Step {
  // A finished row stays finished. `settled` moves only when the app confirms delivery.
  if (isFinal(current) || current === "settled") return { kind: "stay" };

  switch (fill) {
    case "filled":
      // The router saying "filled" is not proof. The receipt on Base is what authorizes credit.
      return { kind: "verify" };
    case "refunded":
    case "failed":
    case "unknown":
      // "Refunded" here is the router's claim. 0.1 does not verify the return,
      // so this must not become the final payment status.
      return moveIfLegal(current, "needs_attention");
    case "waiting":
    case "processing":
    case "delayed":
      return moveIfLegal(current, fill);
    default: {
      const unreachable: never = fill;
      return unreachable;
    }
  }
}

/** Stay when the table forbids the move, including a report of the state we are already in. */
function moveIfLegal(from: DepositStatus, to: DepositStatus): Step {
  if (!canTransition(from, to)) return { kind: "stay" };
  return { kind: "move", to };
}

/** What the buyer sees. Not the payment row's own status. */
export type OrderStatus = "pending" | "paid" | "refunded" | "needs_attention" | "expired";

export function orderStatusFor(payment: DepositStatus | null, expired: boolean): OrderStatus {
  // Expiry applies only before a payment exists. A late payment is still processed.
  if (payment === null) return expired ? "expired" : "pending";

  switch (payment) {
    case "waiting":
    case "processing":
    case "delayed":
    case "settled":
      return "pending";
    case "credited":
      return "paid";
    case "refunded":
      return "refunded";
    case "needs_attention":
    case "resolved":
      // An operator close is not delivery. The buyer still sees that the case needed a person.
      return "needs_attention";
    default: {
      const unreachable: never = payment;
      return unreachable;
    }
  }
}
