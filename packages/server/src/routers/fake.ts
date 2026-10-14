import type { Fill, PaymentRouter } from "@settle-kit/core";
import type { Address } from "viem";

export type FakeRouterScript = {
  address: Address;
  fills: Fill[][];
};

export type FakeRouterCall = {
  method: Exclude<keyof PaymentRouter, "id">;
  input: unknown;
};

export type FakeRouter = PaymentRouter & {
  calls: FakeRouterCall[];
};

/** A router whose answers are scripted, for testing everything above the router. */
export function fakeRouter(script: FakeRouterScript): FakeRouter {
  const calls: FakeRouterCall[] = [];
  let cursor = 0;

  return {
    id: "fake",
    calls,

    // No fees in the fake: the payer sends exactly the price.
    async orderAddress(input) {
      calls.push({ method: "orderAddress", input });
      return { address: script.address, payAmount: input.amount };
    },

    // Each call returns the next scripted page; the last one repeats forever.
    async fills(address) {
      calls.push({ method: "fills", input: address });
      const page = script.fills[cursor] ?? [];
      if (cursor < script.fills.length - 1) cursor += 1;
      return structuredClone(page);
    },
  };
}
