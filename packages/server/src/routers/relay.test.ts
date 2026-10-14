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
const RECOVERY = address("0x0000000000000000000000000000000000000003");

const USDC_ROUTE: Route = {
  from: { chainId: 42161, token: ARBITRUM_USDC, decimals: 6 },
  to: { chainId: 8453, token: BASE_USDC, decimals: 6 },
};

const NATIVE_ROUTE: Route = {
  from: { chainId: 42161, token: "native", decimals: 18 },
  to: { chainId: 8453, token: BASE_USDC, decimals: 6 },
};

const ADDRESS_REQUEST = {
  recipient: RECIPIENT,
  refundTo: REFUND_TO,
  recoveryAddress: RECOVERY,
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
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function createFetch(handler: (call: FetchCall) => Response | Promise<Response>): {
  fetch: RelayFetch;
  calls: FetchCall[];
} {
  const calls: FetchCall[] = [];
  const fetchImpl: RelayFetch = async (input, init) => {
    const url = new URL(requestUrl(input));
    const headers = new Headers(init?.headers);
    let body: unknown;
    if (typeof init?.body === "string" && init.body.length > 0)
      body = JSON.parse(init.body) as unknown;
    const call: FetchCall = { url, method: init?.method ?? "GET", headers, body };
    calls.push(call);
    return handler(call);
  };
  return { fetch: fetchImpl, calls };
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
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
    expect(containsSecret(error, API_KEY)).toBe(false);
    expect(error.stack ?? "").not.toContain(API_KEY);
    return error;
  }
  throw new Error(`expected DepositError ${code}`);
}

function containsSecret(value: unknown, secret: string, seen = new Set<unknown>()): boolean {
  if (typeof value === "string") return value.includes(secret);
  if (typeof value !== "object" || value === null) return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (value instanceof Error) {
    return containsSecret(value.message, secret, seen) || containsSecret(value.cause, secret, seen);
  }
  if (Array.isArray(value)) return value.some((item) => containsSecret(item, secret, seen));
  return Object.values(value).some((item) => containsSecret(item, secret, seen));
}

function routerFor(handler: (call: FetchCall) => Response | Promise<Response>) {
  const client = createFetch(handler);
  return { ...client, router: relay({ apiKey: API_KEY, fetch: client.fetch }) };
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

  it("returns a reusable address quoted at one whole token", async () => {
    const { router, calls } = routerFor((call) => {
      expect(call.url.pathname).toBe("/quote/v2");
      expect(call.headers.get("x-api-key")).toBeNull();
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
      amount: "1000000",
      tradeType: "EXACT_INPUT",
      recipient: RECIPIENT,
      refundTo: REFUND_TO,
      recoveryAddress: RECOVERY,
      useDepositAddress: true,
    });
    expect(calls[0]?.body).not.toHaveProperty("strict");

    await router.depositAddress({ route: NATIVE_ROUTE, ...ADDRESS_REQUEST });
    expect(calls[1]?.body).toMatchObject({
      originCurrency: zeroAddress,
      amount: "1000000000000000000",
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

  it("rejects a missing api key before any request", () => {
    let calls = 0;
    const fetchImpl: RelayFetch = async () => {
      calls += 1;
      return jsonResponse({});
    };
    expect(() => relay({ apiKey: "", fetch: fetchImpl })).toThrow(DepositError);
    expect(() => relay({ apiKey: "   ", fetch: fetchImpl })).toThrow(DepositError);
    expect(calls).toBe(0);

    try {
      relay({ apiKey: "" });
    } catch (error) {
      expect(error).toBeInstanceOf(DepositError);
      if (!(error instanceof DepositError)) throw error;
      expect(error.code).toBe("invalid_config");
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

    const pendingFills = await relay({
      apiKey: API_KEY,
      fetch: async () => jsonResponse({ requests: [pending] }),
    }).fills(depositAddress);
    expect(pendingFills[0]?.status).toBe("processing");
    expect(pendingFills[0]?.destination).toBeNull();

    const refundFills = await relay({
      apiKey: API_KEY,
      fetch: async () => jsonResponse({ requests: [refunded] }),
    }).fills(depositAddress);
    expect(refundFills[0]?.status).toBe("refunded");
    expect(refundFills[0]?.destination).toBeNull();

    const preferredFills = await relay({
      apiKey: API_KEY,
      fetch: async () => jsonResponse({ requests: [preferred] }),
    }).fills(depositAddress);
    expect(preferredFills[0]?.depositTx).toBe(
      "0x1111111111111111111111111111111111111111111111111111111111111111",
    );

    const fallbackFills = await relay({
      apiKey: API_KEY,
      fetch: async () => jsonResponse({ requests: [notHex] }),
    }).fills(depositAddress);
    expect(fallbackFills[0]?.depositTx).toBe(fills[0]?.depositTx);
  });

  it("maps each Relay status and rejects an unknown one", async () => {
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
        expect(call.headers.get("x-api-key")).toBeNull();
        return jsonResponse({ status: relayStatus });
      });
      expect(await router.status("fill-1")).toBe(status);
    }

    const unknown = routerFor(() => jsonResponse({ status: "weird" }));
    await expectCode(unknown.router.status("fill-1"), "router_unavailable");

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
      recoveryAddress: RECOVERY,
    });
  });

  it("rejects an order when the quoted arrival differs from the price", async () => {
    const drifted = structuredClone(strictQuoteFixture);
    drifted.details.currencyOut.amount = "1";
    const mismatch = routerFor(() => jsonResponse(drifted));
    await expectCode(
      mismatch.router.orderAddress({
        route: USDC_ROUTE,
        amount: 1150000n,
        ...ADDRESS_REQUEST,
      }),
      "quote_unavailable",
    );
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
