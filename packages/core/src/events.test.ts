import { describe, expect, it } from "bun:test";
import type { Hex } from "viem";
import { DepositError } from "./errors";
import { amountMismatch, type SettledEvent, type TimelineEntry } from "./events";

const DEPOSIT_TX = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as Hex;
const DEST_TX = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as Hex;

function paidEvent(depositTx: Hex | null): SettledEvent {
  return {
    id: "pay_1:settled",
    kind: "order",
    createdAt: "2026-10-14T12:00:00.000Z",
    test: false,
    order: { id: "ord_1", externalId: "cart_9", amount: "1150000" },
    payment: {
      id: "pay_1",
      receivedAmount: "1150000",
      depositTx,
      destination: { chainId: 8453, txHash: DEST_TX, logIndex: 2 },
    },
  };
}

describe("SettledEvent", () => {
  it("survives JSON.stringify and JSON.parse unchanged", () => {
    for (const event of [paidEvent(DEPOSIT_TX), paidEvent(null)]) {
      expect(JSON.parse(JSON.stringify(event))).toEqual(event);
      expect(typeof event.order.amount).toBe("string");
      expect(typeof event.payment.receivedAmount).toBe("string");
    }
  });
});

describe("TimelineEntry", () => {
  it("can record a payment status or a failed delivery", () => {
    const seen: TimelineEntry = {
      seq: 1,
      status: "waiting",
      at: new Date("2026-10-14T12:00:00.000Z"),
      actor: "system",
      evidence: { routerStatus: "waiting", amount: "1150000" },
    };
    const failed: TimelineEntry = {
      seq: 2,
      status: "delivery_failed",
      at: new Date("2026-10-14T12:05:00.000Z"),
      actor: "operator",
      evidence: { note: "webhook exhausted" },
    };
    expect(seen.actor).toBe("system");
    expect(failed.status).toBe("delivery_failed");
  });
});

describe("amountMismatch", () => {
  it("records the order price and the receipt as base-unit strings", () => {
    const evidence = amountMismatch(1150000n, 1000000n);
    expect(evidence).toEqual({
      reason: "amount_mismatch",
      expected: "1150000",
      received: "1000000",
    });
    expect(JSON.parse(JSON.stringify(evidence))).toEqual(evidence);

    const row: TimelineEntry = {
      seq: 3,
      status: "needs_attention",
      at: new Date("2026-10-14T12:10:00.000Z"),
      actor: "system",
      evidence,
    };
    expect(row.status).toBe("needs_attention");
  });

  it("rejects a negative bigint", () => {
    expect(() => amountMismatch(-1n, 1000000n)).toThrow(DepositError);
    expect(() => amountMismatch(1150000n, -1n)).toThrow(DepositError);
  });
});
