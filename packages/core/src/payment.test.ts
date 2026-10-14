import { describe, expect, it } from "bun:test";
import {
  canTransition,
  type DepositStatus,
  isFinal,
  nextStep,
  type OrderStatus,
  orderStatusFor,
  TRANSITIONS,
} from "./payment";
import type { FillStatus } from "./router";

/** The spec table, written out so the constant cannot silently drift from it. */
const EXPECTED: Record<DepositStatus, readonly DepositStatus[]> = {
  waiting: ["processing", "delayed", "settled", "refunded", "needs_attention"],
  processing: ["delayed", "settled", "refunded", "needs_attention"],
  delayed: ["processing", "settled", "refunded", "needs_attention"],
  needs_attention: ["processing", "settled", "refunded", "resolved"],
  settled: ["credited"],
  credited: [],
  refunded: [],
  resolved: [],
};

const STATUSES = Object.keys(EXPECTED) as DepositStatus[];

const FILL_LIST = {
  waiting: true,
  processing: true,
  delayed: true,
  filled: true,
  refunded: true,
  failed: true,
  unknown: true,
} as const satisfies Record<FillStatus, true>;

const FILLS = Object.keys(FILL_LIST) as FillStatus[];

describe("TRANSITIONS", () => {
  it("has exactly the eight statuses, and every target is a status", () => {
    expect(Object.keys(TRANSITIONS).sort()).toEqual([...STATUSES].sort());
    expect(STATUSES).toHaveLength(8);

    for (const from of STATUSES) {
      expect(TRANSITIONS[from]).toEqual(EXPECTED[from]);
      for (const to of TRANSITIONS[from]) expect(STATUSES).toContain(to);
    }
  });

  it("matches canTransition for every pair", () => {
    let pairs = 0;
    for (const from of STATUSES) {
      for (const to of STATUSES) {
        pairs += 1;
        const allowed = EXPECTED[from].includes(to);
        expect([from, to, canTransition(from, to)]).toEqual([from, to, allowed]);
      }
    }
    expect(pairs).toBe(64);
  });
});

describe("isFinal", () => {
  it("is true only for credited, refunded, and resolved", () => {
    for (const status of STATUSES) {
      const final = status === "credited" || status === "refunded" || status === "resolved";
      expect(isFinal(status)).toBe(final);
      expect(EXPECTED[status].length === 0).toBe(final);
    }
  });
});

describe("nextStep", () => {
  it("returns a legal move for every status and fill", () => {
    let pairs = 0;
    for (const status of STATUSES) {
      for (const fill of FILLS) {
        pairs += 1;
        const step = nextStep(status, fill);
        expect(step.kind === "move" || step.kind === "verify" || step.kind === "stay").toBe(true);
        if (step.kind !== "move") continue;
        expect(canTransition(status, step.to)).toBe(true);
        // Filled is verified, not jumped. A router refund is not a final refund.
        expect(
          step.to === "processing" || step.to === "delayed" || step.to === "needs_attention",
        ).toBe(true);
      }
    }
    expect(pairs).toBe(56);
  });

  it("follows the worked examples", () => {
    expect(nextStep("waiting", "filled")).toEqual({ kind: "verify" });
    expect(nextStep("processing", "refunded")).toEqual({ kind: "move", to: "needs_attention" });
    expect(nextStep("delayed", "unknown")).toEqual({ kind: "move", to: "needs_attention" });
    expect(nextStep("settled", "failed")).toEqual({ kind: "stay" });
    expect(nextStep("needs_attention", "waiting")).toEqual({ kind: "stay" });

    // Rule order: a settled or final row does not verify again, and does not reopen.
    expect(nextStep("settled", "filled")).toEqual({ kind: "stay" });
    expect(nextStep("credited", "filled")).toEqual({ kind: "stay" });
    expect(nextStep("refunded", "failed")).toEqual({ kind: "stay" });
    // Already in needs_attention: another bad report is not a self-move.
    expect(nextStep("needs_attention", "failed")).toEqual({ kind: "stay" });
    expect(nextStep("needs_attention", "unknown")).toEqual({ kind: "stay" });
    // A person can still send this payment back through verification or processing.
    expect(nextStep("needs_attention", "filled")).toEqual({ kind: "verify" });
    expect(nextStep("needs_attention", "processing")).toEqual({ kind: "move", to: "processing" });
    // The same report we already recorded is not a transition.
    expect(nextStep("waiting", "waiting")).toEqual({ kind: "stay" });
    expect(nextStep("delayed", "processing")).toEqual({ kind: "move", to: "processing" });
    expect(nextStep("processing", "failed")).toEqual({ kind: "move", to: "needs_attention" });
  });
});

describe("orderStatusFor", () => {
  it("matches the buyer-facing table, including a late credit", () => {
    const cases: readonly (readonly [DepositStatus | null, boolean, OrderStatus])[] = [
      [null, false, "pending"],
      [null, true, "expired"],
      ["waiting", false, "pending"],
      ["waiting", true, "pending"],
      ["processing", false, "pending"],
      ["processing", true, "pending"],
      ["delayed", false, "pending"],
      ["delayed", true, "pending"],
      ["settled", false, "pending"],
      ["settled", true, "pending"],
      ["credited", false, "paid"],
      ["credited", true, "paid"],
      ["refunded", false, "refunded"],
      ["refunded", true, "refunded"],
      ["needs_attention", false, "needs_attention"],
      ["needs_attention", true, "needs_attention"],
      ["resolved", false, "needs_attention"],
      ["resolved", true, "needs_attention"],
    ];

    for (const [payment, expired, status] of cases) {
      expect([payment, expired, orderStatusFor(payment, expired)]).toEqual([
        payment,
        expired,
        status,
      ]);
    }
  });
});
