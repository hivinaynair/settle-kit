import { describe, expect, it } from "bun:test";
import { DepositError, type DepositErrorCode, type Fill, type Route } from "@settle-kit/core";
import { type Address, type Hex, isAddress, zeroAddress } from "viem";
import chainsFixture from "../../test/fixtures/relay/chains.mainnet.json";
import amountTooLowFixture from "../../test/fixtures/relay/error-amount-too-low.json";
import invalidCurrencyFixture from "../../test/fixtures/relay/error-invalid-currency.json";
import quoteFixture from "../../test/fixtures/relay/quote-deposit-address.mainnet.json";
import strictQuoteFixture from "../../test/fixtures/relay/quote-strict-exact-output.mainnet.json";
import requestsFixture from "../../test/fixtures/relay/requests-v3.sample.json";
import statusWaitingFixture from "../../test/fixtures/relay/status-waiting.json";
import { fakeRouter, type RelayFetch, relay } from "../index";

const API_KEY = "relay-test-key-9f3a";
const ARBITRUM_USDC = address("0xaf88d065e77c8cc2239327c5edb3a432268e5831");
const BASE_USDC = address("0x833589fcd6edb6e08f4c7c32d4f71b54bda02913");
const RECIPIENT = address("0x0000000000000000000000000000000000000001");
const REFUND_TO = address("0x0000000000000000000000000000000000000002");

const USDC_ROUTE: Route = {
  from: { chainId: 42161, token: ARBITRUM_USDC, decimals: 6 },
  to: { chainId: 8453, token: BASE_USDC, decimals: 6 },
  minimum: 2000000n,
};

const NATIVE_ROUTE: Route = {
  from: { chainId: 42161, token: "native", decimals: 18 },
  to: { chainId: 8453, token: BASE_USDC, decimals: 6 },
  minimum: 1000000000000000n,
};

const ADDRESS_REQUEST = {
  recipient: RECIPIENT,
  refundTo: REFUND_TO,
};

type FetchCall = {
  url: URL;
  method: string;
  headers: Headers;
  body: unknown;
};

function address(value: string): Address {
  if (!isAddress(value)) throw new Error(`not an address: ${value}`);
  return value;
}

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

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
    // Bun.inspect covers message, stack and nested cause.
    expect(Bun.inspect(error)).not.toContain(API_KEY);
    return error;
  }
  throw new Error(`expected DepositError ${code}`);
}

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
  return { calls, fetch, router: relay({ apiKey: API_KEY, fetch }) };
}

describe("relay()", () => {
  it("includes Arbitrum USDC and native ETH, and drops disabled chains", async () => {
    const { router } = routerFor(() => jsonResponse(chainsFixture));
    const sources = await router.sources();
    const arbitrum = sources.find((source) => source.chainId === 42161);

    expect(arbitrum?.name).toBe("arbitrum");
    expect(arbitrum?.tokens).toContainEqual({ token: ARBITRUM_USDC, symbol: "USDC", decimals: 6 });
    expect(arbitrum?.tokens).toContainEqual({ token: "native", symbol: "ETH", decimals: 18 });

    const edited = structuredClone(chainsFixture);
    const optimism = edited.chains.find((chain) => chain.id === 10);
    const base = edited.chains.find((chain) => chain.id === 8453);
    if (!optimism || !base) throw new Error("fixture is missing optimism or base");
    optimism.depositAddressEnabled = false;
    base.disabled = true;

    const filtered = routerFor(() => jsonResponse(edited));
    const chainIds = (await filtered.router.sources()).map((source) => source.chainId);
    expect(chainIds).toContain(42161);
    expect(chainIds).not.toContain(10);
    expect(chainIds).not.toContain(8453);
  });

  it("returns a reusable address quoted at the route minimum", async () => {
    const { router, calls } = routerFor((call) => {
      expect(call.url.pathname).toBe("/quote/v2");
      expect(call.headers.get("x-api-key")).toBe(API_KEY);
      return jsonResponse(quoteFixture);
    });

    const result = await router.depositAddress({ route: USDC_ROUTE, ...ADDRESS_REQUEST });

    expect(result.address).toBe("0xa689cfe5515c4281a7999b9133895244791b34db");
    expect(calls[0]?.body).toMatchObject({
      user: zeroAddress,
      originChainId: 42161,
      destinationChainId: 8453,
      originCurrency: ARBITRUM_USDC,
      destinationCurrency: BASE_USDC,
      amount: "2000000",
      tradeType: "EXACT_INPUT",
      recipient: RECIPIENT,
      refundTo: REFUND_TO,
      useDepositAddress: true,
    });
    expect(calls[0]?.body).not.toHaveProperty("strict");
    expect(calls[0]?.body).not.toHaveProperty("recoveryAddress");

    await router.depositAddress({ route: NATIVE_ROUTE, ...ADDRESS_REQUEST });
    expect(calls[1]?.body).toMatchObject({
      originCurrency: zeroAddress,
      amount: "1000000000000000",
    });
  });

  it("maps a quote to base-unit bigints", async () => {
    const { router, calls } = routerFor(() => jsonResponse(quoteFixture));
    const quote = await router.quote({ route: USDC_ROUTE, payAmount: 2000000n });

    expect(quote.payAmount).toBe(2000000n);
    expect(quote.receiveAmount).toBe(1965708n);
    expect(quote.minimumReceiveAmount).toBe(1899857n);
    expect(quote.etaSeconds).toBe(2);
    expect(calls[0]?.body).toMatchObject({ amount: "2000000", tradeType: "EXACT_INPUT" });
    expect(calls[0]?.body).not.toHaveProperty("useDepositAddress");
  });

  it("rejects a fractional amount instead of coercing it", async () => {
    const fixture = structuredClone(quoteFixture);
    fixture.details.currencyOut.amount = "1.5";
    const { router } = routerFor(() => jsonResponse(fixture));
    await expectCode(
      router.quote({ route: USDC_ROUTE, payAmount: 2000000n }),
      "router_unavailable",
    );
  });

  it("maps the recorded error fixtures by errorCode", async () => {
    const tooLow = routerFor(() => jsonResponse(amountTooLowFixture, 400));
    const tooLowError = await expectCode(
      tooLow.router.quote({ route: USDC_ROUTE, payAmount: 1n }),
      "amount_too_low",
    );
    expect(tooLowError.cause).toEqual(amountTooLowFixture);
    expect(tooLowError.message).not.toContain("50000");

    const invalid = routerFor(() => jsonResponse(invalidCurrencyFixture, 400));
    const invalidError = await expectCode(
      invalid.router.quote({ route: USDC_ROUTE, payAmount: 2000000n }),
      "quote_unavailable",
    );
    expect(invalidError.cause).toEqual(invalidCurrencyFixture);
    expect(invalidError.message).not.toContain("Invalid input");
  });

  it("maps the rest of the errorCode table, and treats 5xx and 429 as unavailable", async () => {
    const cases = [
      ["INVALID_OUTPUT_CURRENCY", "quote_unavailable"],
      ["NO_QUOTES", "quote_unavailable"],
      ["INSUFFICIENT_LIQUIDITY", "quote_unavailable"],
      ["SWAP_IMPACT_TOO_HIGH", "quote_unavailable"],
      ["UNSUPPORTED_ROUTE", "quote_unavailable"],
      ["CHAIN_DISABLED", "route_unavailable"],
      ["ROUTE_TEMPORARILY_RESTRICTED", "route_unavailable"],
      ["UNSUPPORTED_CHAIN", "route_unavailable"],
      ["SANCTIONED_WALLET_ADDRESS", "address_blocked"],
      ["SOMETHING_ELSE", "router_unavailable"],
    ] as const;

    for (const [errorCode, code] of cases) {
      const { router } = routerFor(() =>
        jsonResponse({ message: `ignored ${errorCode}`, errorCode }, 400),
      );
      await expectCode(router.quote({ route: USDC_ROUTE, payAmount: 2000000n }), code);
    }

    const missing = routerFor(() => jsonResponse({ message: "no code" }, 400));
    await expectCode(
      missing.router.quote({ route: USDC_ROUTE, payAmount: 2000000n }),
      "router_unavailable",
    );

    const server = routerFor(() =>
      jsonResponse({ message: "down", errorCode: "AMOUNT_TOO_LOW" }, 500),
    );
    const serverError = await expectCode(
      server.router.quote({ route: USDC_ROUTE, payAmount: 2000000n }),
      "router_unavailable",
    );
    expect(serverError.cause).toEqual({ message: "down", errorCode: "AMOUNT_TOO_LOW" });

    const limited = routerFor(() => jsonResponse({ message: "slow down" }, 429));
    await expectCode(
      limited.router.quote({ route: USDC_ROUTE, payAmount: 2000000n }),
      "router_unavailable",
    );

    const offline = routerFor(() => {
      throw new Error("network down");
    });
    const offlineError = await expectCode(
      offline.router.quote({ route: USDC_ROUTE, payAmount: 2000000n }),
      "router_unavailable",
    );
    expect(offlineError.cause).toBeInstanceOf(Error);
    expect(offlineError.cause).toMatchObject({ message: "network down" });

    const discovered = routerFor((call) => {
      expect(call.headers.get("x-api-key")).toBe(API_KEY);
      return jsonResponse({ message: "down" }, 500);
    });
    const discoveredError = await expectCode(
      discovered.router.fills(address("0x00000000000000000000000000000000000000aa")),
      "router_unavailable",
    );
    expect(discoveredError.cause).toEqual({ message: "down" });
  });

  it("rejects a missing api key before any request", async () => {
    let calls = 0;
    const fetchImpl: RelayFetch = async () => {
      calls += 1;
      return jsonResponse({});
    };
    expect(() => relay({ apiKey: "", fetch: fetchImpl })).toThrow(DepositError);
    expect(() => relay({ apiKey: "   ", fetch: fetchImpl })).toThrow(DepositError);
    expect(calls).toBe(0);

    await expectCode(
      Promise.resolve().then(() => relay({ apiKey: "" })),
      "invalid_config",
    );
  });

  it("maps a rejected API key (401/403) to invalid_config", async () => {
    for (const status of [401, 403]) {
      const { router } = routerFor(() =>
        jsonResponse({ message: "Unauthorized: Check API Key" }, status),
      );
      await expectCode(
        router.fills(address("0x00000000000000000000000000000000000000aa")),
        "invalid_config",
      );
    }
  });

  it("follows continuation and maps both pages of fills", async () => {
    const [first, second] = requestsFixture.requests;
    if (!first || !second) throw new Error("fixture is missing two requests");
    const depositAddress = address("0x00000000000000000000000000000000000000aa");

    const { router, calls } = routerFor((call) => {
      expect(call.headers.get("x-api-key")).toBe(API_KEY);
      if (call.url.searchParams.get("continuation") === "next-page") {
        return jsonResponse({ requests: [second] });
      }
      return jsonResponse({ requests: [first], continuation: "next-page" });
    });

    const fills = await router.fills(depositAddress);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.url.searchParams.get("depositAddress")).toBe(depositAddress);
    expect(calls[0]?.url.searchParams.get("limit")).toBe("100");
    expect(calls[0]?.url.searchParams.get("continuation")).toBeNull();
    expect(calls[1]?.url.searchParams.get("continuation")).toBe("next-page");
    expect(fills.map((fill) => fill.id)).toEqual([first.id, second.id]);

    expect(fills[0]).toMatchObject({
      id: first.id,
      status: "filled",
      depositTx: "0xb681ba6637341ac793a3b2a50840e1780e8bd2598910b7e53a3cf280ea2254eb",
      destination: {
        chainId: 4663,
        txHash: "0x86e5eebb93ed37ea99d292340985bde57158289cd2163a60f8f23d98168076f7",
      },
    });
    expect(fills[0]?.updatedAt.toISOString()).toBe("2026-10-13T09:44:12.513Z");

    const pending = { ...structuredClone(first), status: "pending" };
    const refunded = { ...structuredClone(first), status: "refund" };
    const preferred = {
      ...structuredClone(first),
      depositAddress: {
        depositTxHash: "0x1111111111111111111111111111111111111111111111111111111111111111",
      },
    };
    const notHex = { ...structuredClone(first), depositAddress: { depositTxHash: "not-a-tx" } };
    const fillsFor = (...requests: unknown[]) =>
      routerFor(() => jsonResponse({ requests })).router.fills(depositAddress);

    expect((await fillsFor(pending))[0]).toMatchObject({ status: "processing", destination: null });
    expect((await fillsFor(refunded))[0]).toMatchObject({ status: "refunded", destination: null });
    expect((await fillsFor(preferred))[0]?.depositTx).toBe(
      "0x1111111111111111111111111111111111111111111111111111111111111111",
    );
    expect((await fillsFor(notHex))[0]?.depositTx).toBe(fills[0]?.depositTx);

    // One unknown status or malformed request must not block the other fills.
    const newStatus = { ...structuredClone(first), status: "expired" };
    const malformed = { id: "broken" };
    const mixed = await fillsFor(newStatus, malformed, second);
    expect(mixed.map((fill) => [fill.id, fill.status])).toEqual([
      [first.id, "unknown"],
      [second.id, "filled"],
    ]);
  });

  it("maps each Relay status, and an unrecognised one to unknown", async () => {
    const cases = [
      ["waiting", "waiting"],
      ["depositing", "processing"],
      ["pending", "processing"],
      ["submitted", "processing"],
      ["delayed", "delayed"],
      ["success", "filled"],
      ["refund", "refunded"],
      ["failure", "failed"],
    ] as const;

    for (const [relayStatus, status] of cases) {
      const { router } = routerFor((call) => {
        expect(call.url.pathname).toBe("/intents/status/v3");
        expect(call.url.searchParams.get("requestId")).toBe("fill-1");
        expect(call.headers.get("x-api-key")).toBe(API_KEY);
        return jsonResponse({ status: relayStatus });
      });
      expect(await router.status("fill-1")).toBe(status);
    }

    const unknown = routerFor(() => jsonResponse({ status: "weird" }));
    expect(await unknown.router.status("fill-1")).toBe("unknown");

    const waiting = routerFor(() => jsonResponse(statusWaitingFixture));
    expect(await waiting.router.status("fill-1")).toBe("waiting");
  });

  it("returns the strict order address and what the payer must send", async () => {
    const { router, calls } = routerFor(() => jsonResponse(strictQuoteFixture));
    const order = await router.orderAddress({
      route: USDC_ROUTE,
      amount: 1150000n,
      ...ADDRESS_REQUEST,
    });

    expect(order).toEqual({
      address: "0x24a37cD2723B6FC852A7D296Bd4f20476b2Fd176",
      payAmount: 1184248n,
    });
    expect(calls[0]?.body).toMatchObject({
      strict: true,
      tradeType: "EXACT_OUTPUT",
      amount: "1150000",
      useDepositAddress: true,
      recipient: RECIPIENT,
      refundTo: REFUND_TO,
    });
  });

  it("rejects an order when the quoted arrival differs from the price", async () => {
    const drifted = structuredClone(strictQuoteFixture);
    drifted.details.currencyOut.amount = "1";
    const mismatch = routerFor(() => jsonResponse(drifted));
    const error = await expectCode(
      mismatch.router.orderAddress({
        route: USDC_ROUTE,
        amount: 1150000n,
        ...ADDRESS_REQUEST,
      }),
      "quote_unavailable",
    );
    expect(error.cause).toEqual({ requested: "1150000", quoted: "1" });
    expect(() => JSON.stringify(error.cause)).not.toThrow();
  });
});

describe("fakeRouter()", () => {
  it("walks the scripted fills and then repeats the last page", async () => {
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
        txHash: "0x2222222222222222222222222222222222222222222222222222222222222222" as Hex,
      },
    };
    const scriptAddress = address("0x00000000000000000000000000000000000000ab");
    const router = fakeRouter({ address: scriptAddress, fills: [[], [processing], [filled]] });
    const payer = address("0x00000000000000000000000000000000000000ac");

    expect(await router.fills(payer)).toEqual([]);
    expect(await router.fills(payer)).toEqual([processing]);
    expect(await router.status("r1")).toBe("processing");
    expect(await router.fills(payer)).toEqual([filled]);
    expect(await router.fills(payer)).toEqual([filled]);
    expect(await router.status("r1")).toBe("filled");
    expect(router.calls.map((call) => call.method)).toEqual([
      "fills",
      "fills",
      "status",
      "fills",
      "fills",
      "status",
    ]);
    expect(router.calls[0]?.input).toBe(payer);
    expect(router.id).toBe("fake");

    const fresh = fakeRouter({ address: scriptAddress, fills: [[processing]] });
    await expectCode(fresh.status("r1"), "router_unavailable");

    const quoted = await fresh.quote({ route: USDC_ROUTE, payAmount: 2000000n });
    expect(quoted).toEqual({
      payAmount: 2000000n,
      receiveAmount: 2000000n,
      minimumReceiveAmount: 2000000n,
      etaSeconds: 0,
    });
    expect(
      await fresh.orderAddress({ route: USDC_ROUTE, amount: 1150000n, ...ADDRESS_REQUEST }),
    ).toEqual({ address: scriptAddress, payAmount: 1150000n });
    expect(await fresh.depositAddress({ route: USDC_ROUTE, ...ADDRESS_REQUEST })).toEqual({
      address: scriptAddress,
    });
  });
});
