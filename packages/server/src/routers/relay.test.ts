import { describe, expect, it } from "bun:test";
import { DepositError, type DepositErrorCode, type Fill, type Route } from "@settle-kit/core";
import { type Address, type Hex, isAddress, zeroAddress } from "viem";
import amountTooLowFixture from "../../test/fixtures/relay/error-amount-too-low.json";
import invalidCurrencyFixture from "../../test/fixtures/relay/error-invalid-currency.json";
import strictQuoteFixture from "../../test/fixtures/relay/quote-strict-exact-output.mainnet.json";
import requestsFixture from "../../test/fixtures/relay/requests-v3.sample.json";
import { fakeRouter, type RelayFetch, relay } from "../index";

const API_KEY = "relay-test-key-9f3a";
const ARBITRUM_USDC = address("0xaf88d065e77c8cc2239327c5edb3a432268e5831");
const BASE_USDC = address("0x833589fcd6edb6e08f4c7c32d4f71b54bda02913");
const MERCHANT = address("0x0000000000000000000000000000000000000001");
const REFUND_TO = address("0x0000000000000000000000000000000000000002");
const DEPOSIT_ADDRESS = address("0x00000000000000000000000000000000000000aa");
const REQUEST_ID = strictQuoteFixture.requestId;

const ROUTE: Route = {
  from: { chainId: 42161, token: ARBITRUM_USDC, decimals: 6 },
  to: { chainId: 8453, token: BASE_USDC, decimals: 6 },
};
const REQUEST = { route: ROUTE, recipient: MERCHANT, refundTo: REFUND_TO };

type FetchCall = { url: URL; method: string; headers: Headers; body: unknown };

function address(value: string): Address {
  if (!isAddress(value)) throw new Error(`not an address: ${value}`);
  return value;
}

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

/** A relay() whose fetch is answered by `handler`, recording every request. */
function routerFor(handler: (call: FetchCall) => Response | Promise<Response>) {
  const calls: FetchCall[] = [];
  const fetch: RelayFetch = async (input, init) => {
    const request = new Request(input, init);
    const text = await request.text();
    const call: FetchCall = {
      url: new URL(request.url),
      method: request.method,
      headers: request.headers,
      body: text ? (JSON.parse(text) as unknown) : undefined,
    };
    calls.push(call);
    return handler(call);
  };
  return { calls, router: relay({ apiKey: API_KEY, fetch }) };
}

/** Awaits a rejection, checks its code, and checks the API key appears nowhere in it. */
async function expectCode(
  promise: Promise<unknown>,
  code: DepositErrorCode,
): Promise<DepositError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(DepositError);
    if (!(error instanceof DepositError)) throw error;
    expect(error.code).toBe(code);
    expect(Bun.inspect(error)).not.toContain(API_KEY);
    return error;
  }
  throw new Error(`expected DepositError ${code}`);
}

describe("relay()", () => {
  it("requires an API key before any request", async () => {
    let requests = 0;
    const fetch: RelayFetch = async () => {
      requests += 1;
      return jsonResponse({});
    };
    expect(() => relay({ apiKey: "   ", fetch })).toThrow(DepositError);
    await expectCode(
      Promise.resolve().then(() => relay({ apiKey: "", fetch })),
      "invalid_config",
    );
    expect(requests).toBe(0);
  });

  it("returns a strict order address and what the payer must send", async () => {
    const { router, calls } = routerFor(() => jsonResponse(strictQuoteFixture));

    const order = await router.orderAddress({ ...REQUEST, amount: 1150000n });

    expect(order).toEqual({
      address: "0x24a37cD2723B6FC852A7D296Bd4f20476b2Fd176",
      payAmount: 1184248n,
      requestId: REQUEST_ID,
    });
    expect(calls[0]?.url.pathname).toBe("/quote/v2");
    expect(calls[0]?.headers.get("x-api-key")).toBe(API_KEY);
    expect(calls[0]?.body).toEqual({
      user: zeroAddress,
      originChainId: 42161,
      destinationChainId: 8453,
      originCurrency: ARBITRUM_USDC,
      destinationCurrency: BASE_USDC,
      amount: "1150000",
      tradeType: "EXACT_OUTPUT",
      recipient: MERCHANT,
      refundTo: REFUND_TO,
      useDepositAddress: true,
      strict: true,
    });
  });

  it("rejects quotes without a usable request ID", async () => {
    for (const requestId of [undefined, ""]) {
      const quote = structuredClone(strictQuoteFixture);
      const body = {
        ...quote,
        steps: quote.steps.map((step) => ({ ...step, requestId })),
      };
      const { router } = routerFor(() => jsonResponse(body));
      await expectCode(router.orderAddress({ ...REQUEST, amount: 1150000n }), "router_unavailable");
    }
  });

  it("rejects an order whose quote would not deliver exactly the price", async () => {
    const drifted = structuredClone(strictQuoteFixture);
    drifted.details.currencyOut.amount = "1";
    const { router } = routerFor(() => jsonResponse(drifted));

    const error = await expectCode(
      router.orderAddress({ ...REQUEST, amount: 1150000n }),
      "quote_unavailable",
    );
    expect(error.cause).toEqual({ requested: "1150000", quoted: "1" });
  });

  it("rejects a fractional amount instead of rounding it", async () => {
    const fractional = structuredClone(strictQuoteFixture);
    fractional.details.currencyIn.amount = "1.5";
    const { router } = routerFor(() => jsonResponse(fractional));
    await expectCode(router.orderAddress({ ...REQUEST, amount: 1150000n }), "router_unavailable");
  });

  it("maps errors by errorCode and HTTP status, never by message", async () => {
    const cases: [Response | (() => never), DepositErrorCode][] = [
      [jsonResponse(amountTooLowFixture, 400), "amount_too_low"],
      [jsonResponse(invalidCurrencyFixture, 400), "quote_unavailable"],
      [jsonResponse({ errorCode: "CHAIN_DISABLED" }, 400), "route_unavailable"],
      [jsonResponse({ errorCode: "SANCTIONED_WALLET_ADDRESS" }, 400), "address_blocked"],
      [jsonResponse({ errorCode: "SOMETHING_NEW" }, 400), "router_unavailable"],
      [jsonResponse({ message: "no code" }, 400), "router_unavailable"],
      [jsonResponse({ message: "Unauthorized: Check API Key" }, 401), "invalid_config"],
      [jsonResponse({ message: "forbidden" }, 403), "invalid_config"],
      [jsonResponse({ errorCode: "AMOUNT_TOO_LOW" }, 500), "router_unavailable"],
      [jsonResponse({ message: "slow down" }, 429), "router_unavailable"],
      [
        () => {
          throw new Error("network down");
        },
        "router_unavailable",
      ],
    ];

    for (const [answer, code] of cases) {
      const { router } = routerFor(() => (answer instanceof Response ? answer : answer()));
      await expectCode(router.orderAddress({ ...REQUEST, amount: 1150000n }), code);
    }
  });

  it("reads the original request and its children across every page", async () => {
    const [parentFixture, childFixture] = requestsFixture.requests;
    if (!parentFixture || !childFixture) throw new Error("fixture is missing two requests");
    const first = { ...parentFixture, id: REQUEST_ID };
    const second = {
      ...childFixture,
      duplicateDeposits: { parentRequestId: REQUEST_ID },
    };

    const { router, calls } = routerFor((call) =>
      call.url.searchParams.get("continuation") === "next-page"
        ? jsonResponse({ requests: [second] })
        : jsonResponse({ requests: [first], continuation: "next-page" }),
    );

    const fills = await router.fills(REQUEST_ID);

    expect(calls.map((call) => call.url.searchParams.get("continuation"))).toEqual([
      null,
      "next-page",
    ]);
    for (const call of calls) {
      expect(call.url.searchParams.get("id")).toBe(REQUEST_ID);
      expect(call.url.searchParams.get("includeChildRequests")).toBe("true");
      expect(call.url.searchParams.has("depositAddress")).toBe(false);
      expect(call.url.searchParams.get("limit")).toBe("100");
      expect(call.headers.get("x-api-key")).toBe(API_KEY);
    }
    expect(fills.map((fill) => fill.id)).toEqual([first.id, second.id]);
    expect(fills[0]).toEqual({
      id: first.id,
      status: "filled",
      depositTx: "0xb681ba6637341ac793a3b2a50840e1780e8bd2598910b7e53a3cf280ea2254eb",
      destination: {
        chainId: 4663,
        txHash: "0x86e5eebb93ed37ea99d292340985bde57158289cd2163a60f8f23d98168076f7",
      },
      updatedAt: new Date("2026-10-13T09:44:12.513Z"),
    });
  });

  it("returns no fills while Relay has no indexed request", async () => {
    const { router } = routerFor(() => jsonResponse({ requests: [] }));
    expect(await router.fills(REQUEST_ID)).toEqual([]);
  });

  it("rejects an empty request ID before querying Relay", async () => {
    const { router, calls } = routerFor(() => jsonResponse({ requests: [] }));
    for (const requestId of ["", "   "]) {
      await expectCode(router.fills(requestId), "invalid_config");
    }
    expect(calls).toHaveLength(0);
  });

  it("preserves an unfunded waiting report without inventing transaction evidence", async () => {
    const updatedAt = "2026-10-14T00:00:00.000Z";
    const { router } = routerFor(() =>
      jsonResponse({ requests: [{ id: REQUEST_ID, status: "waiting", updatedAt }] }),
    );
    expect(await router.fills(REQUEST_ID)).toEqual([
      {
        id: REQUEST_ID,
        status: "waiting",
        depositTx: null,
        destination: null,
        updatedAt: new Date(updatedAt),
      },
    ]);
  });

  it("rejects repeated continuation tokens instead of looping", async () => {
    const { router, calls } = routerFor(() =>
      jsonResponse({ requests: [], continuation: "same-page" }),
    );
    await expectCode(router.fills(REQUEST_ID), "router_unavailable");
    expect(calls).toHaveLength(2);
  });

  it("maps each payment's status and fields defensively", async () => {
    const [record] = requestsFixture.requests;
    if (!record) throw new Error("fixture is missing a request");
    const fillsFor = (...requests: unknown[]) =>
      routerFor(() => jsonResponse({ requests })).router.fills(REQUEST_ID);

    const statuses = [
      ["waiting", "waiting"],
      ["depositing", "processing"],
      ["pending", "processing"],
      ["submitted", "processing"],
      ["delayed", "delayed"],
      ["success", "filled"],
      ["refund", "refunded"],
      ["failure", "failed"],
      ["something-new", "unknown"],
    ] as const;
    for (const [relayStatus, status] of statuses) {
      const [fill] = await fillsFor({ ...record, status: relayStatus });
      expect(fill?.status).toBe(status);
      // Only a successful payment has a destination transaction.
      expect(fill?.destination === null).toBe(status !== "filled");
    }

    // The deposit-address tx hash wins; a malformed one falls back to the first incoming tx.
    const preferred = "0x1111111111111111111111111111111111111111111111111111111111111111";
    const [withHash] = await fillsFor({ ...record, depositAddress: { depositTxHash: preferred } });
    expect(withHash?.depositTx).toBe(preferred);
    const [badHash] = await fillsFor({ ...record, depositAddress: { depositTxHash: "nope" } });
    expect(badHash?.depositTx).toBe(record.data.inTxs[0]?.txHash as Hex);

    // A malformed record is skipped instead of hiding the others.
    const mixed = await fillsFor({ id: "broken" }, record);
    expect(mixed.map((fill) => fill.id)).toEqual([record.id]);
  });
});

describe("fakeRouter()", () => {
  it("plays the scripted pages, then repeats the last one", async () => {
    const processing: Fill = {
      id: "r1",
      status: "processing",
      depositTx: null,
      destination: null,
      updatedAt: new Date("2026-10-14T00:00:00.000Z"),
    };
    const filled: Fill = {
      ...processing,
      status: "filled",
      destination: {
        chainId: 8453,
        txHash: "0x2222222222222222222222222222222222222222222222222222222222222222",
      },
    };
    const router = fakeRouter({
      address: DEPOSIT_ADDRESS,
      requestId: "r1",
      fills: [[], [processing], [filled]],
    });

    expect(await router.fills("r1")).toEqual([]);
    expect(await router.fills("r1")).toEqual([processing]);
    expect(await router.fills("r1")).toEqual([filled]);
    expect(await router.fills("r1")).toEqual([filled]);
    expect(await router.orderAddress({ ...REQUEST, amount: 1150000n })).toEqual({
      address: DEPOSIT_ADDRESS,
      payAmount: 1150000n,
      requestId: "r1",
    });
    expect(router.calls.slice(0, 4).map((call) => call.input)).toEqual(["r1", "r1", "r1", "r1"]);
    expect(router.calls.map((call) => call.method)).toEqual([
      "fills",
      "fills",
      "fills",
      "fills",
      "orderAddress",
    ]);
  });
});
