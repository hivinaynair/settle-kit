import { DepositError, type Fill, type PaymentRouter } from "@settle-kit/core";
import type { Address } from "viem";

export type FakeRouterScript = {
  address: Address;
  fills: Fill[][];
};

export type FakeRouterCall = {
  method: "sources" | "depositAddress" | "orderAddress" | "quote" | "fills" | "status";
  input: unknown;
};

export type FakeRouter = PaymentRouter & {
  calls: FakeRouterCall[];
};

export function fakeRouter(script: FakeRouterScript): FakeRouter {
  const calls: FakeRouterCall[] = [];
  let cursor = 0;
  let latest: readonly Fill[] = [];

  function record(method: FakeRouterCall["method"], input: unknown) {
    calls.push({ method, input });
  }

  return {
    id: "fake",
    calls,

    async sources() {
      record("sources", undefined);
      return [];
    },

    async depositAddress(input) {
      record("depositAddress", input);
      return { address: script.address };
    },

    // No fee schedule: the quoted arrival matches the payment, and an order's pay amount matches the price.
    async orderAddress(input) {
      record("orderAddress", input);
      return { address: script.address, payAmount: input.amount };
    },

    async quote(input) {
      record("quote", input);
      return {
        payAmount: input.payAmount,
        receiveAmount: input.payAmount,
        minimumReceiveAmount: input.payAmount,
        etaSeconds: 0,
      };
    },

    async fills(address) {
      record("fills", address);
      const frame = script.fills[Math.min(cursor, Math.max(script.fills.length - 1, 0))] ?? [];
      if (cursor < script.fills.length - 1) cursor += 1;
      latest = frame;
      return frame.map(copyFill);
    },

    async status(fillId) {
      record("status", fillId);
      const fill = latest.find((item) => item.id === fillId);
      if (!fill) {
        throw new DepositError("router_unavailable", "Fill is not in the latest fills() result");
      }
      return fill.status;
    },
  };
}

function copyFill(fill: Fill): Fill {
  return {
    id: fill.id,
    status: fill.status,
    depositTx: fill.depositTx,
    destination: fill.destination === null ? null : { ...fill.destination },
    updatedAt: new Date(fill.updatedAt),
  };
}
