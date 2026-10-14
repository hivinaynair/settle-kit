import {
  DepositError,
  type DepositErrorCode,
  type Fill,
  type FillStatus,
  type OrderAddress,
  type PaymentRouter,
  type Quote,
  type Route,
  type Source,
} from "@settle-kit/core";
import { type Address, type Hex, isAddress, isHex, zeroAddress } from "viem";
import { z } from "zod";

const RELAY_API = "https://api.relay.link";

const FILL_STATUS: Record<string, FillStatus | undefined> = {
  waiting: "waiting",
  depositing: "processing",
  pending: "processing",
  submitted: "processing",
  delayed: "delayed",
  success: "filled",
  refund: "refunded",
  failure: "failed",
};

const ERROR_CODES: Record<string, DepositErrorCode | undefined> = {
  AMOUNT_TOO_LOW: "amount_too_low",
  INVALID_INPUT_CURRENCY: "quote_unavailable",
  INVALID_OUTPUT_CURRENCY: "quote_unavailable",
  NO_QUOTES: "quote_unavailable",
  INSUFFICIENT_LIQUIDITY: "quote_unavailable",
  SWAP_IMPACT_TOO_HIGH: "quote_unavailable",
  UNSUPPORTED_ROUTE: "quote_unavailable",
  CHAIN_DISABLED: "route_unavailable",
  ROUTE_TEMPORARILY_RESTRICTED: "route_unavailable",
  UNSUPPORTED_CHAIN: "route_unavailable",
  SANCTIONED_WALLET_ADDRESS: "address_blocked",
};

const baseUnits = z.string().regex(/^\d+$/).transform(BigInt);
// isAddress only accepts a string, so the check narrows before calling it.
const address = z.custom<Address>((value) => typeof value === "string" && isAddress(value));
const hex = z.custom<Hex>(isHex);
const txHash = z.union([hex, z.string()]).optional();

const QuoteResponse = z.object({
  steps: z.array(z.object({ depositAddress: address.optional() })).optional(),
  details: z.object({
    currencyIn: z.object({ amount: baseUnits }),
    currencyOut: z.object({ amount: baseUnits, minimumAmount: baseUnits }),
    timeEstimate: z.number().finite(),
  }),
});

const RelayRequest = z.object({
  id: z.string().min(1),
  status: z.string(),
  updatedAt: z
    .union([z.string(), z.number()])
    .refine((value) => !Number.isNaN(new Date(value).getTime()))
    .transform((value) => new Date(value)),
  // TODO(S4): depositAddress on a real deposit-address request is unconfirmed.
  depositAddress: z.object({ depositTxHash: txHash }).nullish(),
  data: z
    .object({
      inTxs: z.array(z.object({ txHash })).optional(),
      outTxs: z.array(z.object({ chainId: z.number().optional(), txHash })).optional(),
    })
    .nullish(),
});

const RequestsPage = z.object({
  requests: z.array(RelayRequest),
  continuation: z.string().nullish(),
});

const StatusResponse = z.object({ status: z.string() });

const ChainsResponse = z.object({
  chains: z.array(
    z.object({
      id: z.number(),
      name: z.string(),
      depositAddressEnabled: z.boolean().optional(),
      disabled: z.boolean().optional(),
      solverCurrencies: z.array(z.unknown()).optional(),
    }),
  ),
});

const Currency = z.object({
  address,
  symbol: z.string().min(1),
  decimals: z.number().int().nonnegative(),
});

export type RelayFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type RelayOptions = {
  apiKey: string;
  fetch?: RelayFetch;
};

type QuoteTrade = "EXACT_INPUT" | "EXACT_OUTPUT";

type QuoteBody = {
  user: Address;
  originChainId: number;
  destinationChainId: number;
  originCurrency: Address;
  destinationCurrency: Address;
  amount: string;
  tradeType: QuoteTrade;
  recipient?: Address;
  refundTo?: Address;
  recoveryAddress?: Address;
  useDepositAddress?: true;
  strict?: true;
};

type CallInit = { body?: QuoteBody; key?: true };

export function relay(options: RelayOptions): PaymentRouter {
  if (typeof options.apiKey !== "string" || options.apiKey.trim() === "") {
    throw new DepositError("invalid_config", "Relay API key is required");
  }

  const apiKey = options.apiKey.trim();
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);

  async function call<Schema extends z.ZodType>(
    schema: Schema,
    path: string,
    init?: CallInit,
  ): Promise<z.output<Schema>> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (init?.body !== undefined) headers["content-type"] = "application/json";
    // The key is only ever a header, and only /requests/v3 requires it.
    if (init?.key) headers["x-api-key"] = apiKey;

    let response: Response;
    try {
      response = await doFetch(`${RELAY_API}${path}`, {
        method: init?.body === undefined ? "GET" : "POST",
        headers,
        ...(init?.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      });
    } catch (error) {
      throw new DepositError("router_unavailable", "Relay request failed", error);
    }

    let text: string;
    try {
      text = await response.text();
    } catch (error) {
      throw new DepositError("router_unavailable", "Relay request failed", error);
    }

    let body: unknown = null;
    if (text.trim() !== "") {
      try {
        body = JSON.parse(text) as unknown;
      } catch {
        body = text;
      }
    }

    if (!response.ok) {
      const unavailable = response.status >= 500 || response.status === 429;
      throw new DepositError(
        errorCodeFor(response.status, body),
        unavailable ? "Relay is unavailable" : "Relay rejected the request",
        body,
      );
    }

    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new DepositError(
        "router_unavailable",
        "Relay returned an unexpected response",
        parsed.error.issues,
      );
    }
    return parsed.data;
  }

  return {
    id: "relay",

    async sources() {
      const page = await call(ChainsResponse, "/chains");
      const sources: Source[] = [];
      for (const chain of page.chains) {
        const source = toSource(chain);
        if (source) sources.push(source);
      }
      return sources;
    },

    // A second quote is a different address. T3 stores the first one.
    // Relay needs a sample amount to issue the address. Callers never see it.
    async depositAddress(input) {
      const quote = await call(
        QuoteResponse,
        "/quote/v2",
        quoteInit(input, {
          amount: 10n ** BigInt(input.route.from.decimals),
          tradeType: "EXACT_INPUT",
          useDepositAddress: true,
        }),
      );
      return { address: quotedAddress(quote) };
    },

    async orderAddress(input): Promise<OrderAddress> {
      const quote = await call(
        QuoteResponse,
        "/quote/v2",
        quoteInit(input, {
          amount: input.amount,
          tradeType: "EXACT_OUTPUT",
          useDepositAddress: true,
          strict: true,
        }),
      );
      if (quote.details.currencyOut.amount !== input.amount) {
        throw new DepositError(
          "quote_unavailable",
          "Quoted arrival does not match the requested amount",
          quote,
        );
      }
      return { address: quotedAddress(quote), payAmount: quote.details.currencyIn.amount };
    },

    async quote(input): Promise<Quote> {
      const quoted = await call(
        QuoteResponse,
        "/quote/v2",
        quoteInit({ route: input.route }, { amount: input.payAmount, tradeType: "EXACT_INPUT" }),
      );
      return {
        payAmount: quoted.details.currencyIn.amount,
        receiveAmount: quoted.details.currencyOut.amount,
        minimumReceiveAmount: quoted.details.currencyOut.minimumAmount,
        etaSeconds: quoted.details.timeEstimate,
      };
    },

    async fills(address) {
      const fills: Fill[] = [];
      const seen = new Set<string>();
      let continuation: string | undefined;

      for (;;) {
        const params = new URLSearchParams({ depositAddress: address });
        if (continuation !== undefined) params.set("continuation", continuation);
        const page = await call(RequestsPage, `/requests/v3?${params}`, { key: true });
        for (const request of page.requests) fills.push(toFill(request));
        const next = page.continuation;
        if (typeof next !== "string" || next.length === 0) return fills;
        if (seen.has(next)) {
          throw new DepositError("router_unavailable", "Relay repeated a continuation token");
        }
        seen.add(next);
        continuation = next;
      }
    },

    async status(fillId) {
      const params = new URLSearchParams({ requestId: fillId });
      const body = await call(StatusResponse, `/intents/status/v3?${params}`);
      return mapStatus(body.status);
    },
  };
}

function quoteInit(
  input: {
    route: Route;
    recipient?: Address;
    refundTo?: Address;
    recoveryAddress?: Address;
  },
  extra: { amount: bigint; tradeType: QuoteTrade; useDepositAddress?: true; strict?: true },
): CallInit {
  return { body: quoteBody({ ...input, ...extra }) };
}

function quoteBody(input: {
  route: Route;
  amount: bigint;
  tradeType: QuoteTrade;
  useDepositAddress?: true;
  strict?: true;
  recipient?: Address;
  refundTo?: Address;
  recoveryAddress?: Address;
}): QuoteBody {
  const body: QuoteBody = {
    user: zeroAddress,
    originChainId: input.route.from.chainId,
    destinationChainId: input.route.to.chainId,
    originCurrency: input.route.from.token === "native" ? zeroAddress : input.route.from.token,
    destinationCurrency: input.route.to.token === "native" ? zeroAddress : input.route.to.token,
    amount: input.amount.toString(),
    tradeType: input.tradeType,
  };
  if (input.recipient !== undefined) body.recipient = input.recipient;
  if (input.refundTo !== undefined) body.refundTo = input.refundTo;
  if (input.recoveryAddress !== undefined) body.recoveryAddress = input.recoveryAddress;
  if (input.useDepositAddress) body.useDepositAddress = true;
  if (input.strict) body.strict = true;
  return body;
}

function toSource(chain: z.infer<typeof ChainsResponse>["chains"][number]): Source | null {
  if (chain.depositAddressEnabled !== true || chain.disabled === true || chain.name.length === 0) {
    return null;
  }
  const tokens: Source["tokens"] = [];
  for (const currency of chain.solverCurrencies ?? []) {
    const parsed = Currency.safeParse(currency);
    if (!parsed.success) continue;
    const token =
      parsed.data.address.toLowerCase() === zeroAddress ? "native" : parsed.data.address;
    tokens.push({ token, symbol: parsed.data.symbol, decimals: parsed.data.decimals });
  }
  return { chainId: chain.id, name: chain.name, tokens };
}

function toFill(request: z.infer<typeof RelayRequest>): Fill {
  const outgoing = request.data?.outTxs?.[0];
  const outgoingHash = outgoing?.txHash;
  return {
    id: request.id,
    status: mapStatus(request.status),
    depositTx: firstHex(request.depositAddress?.depositTxHash, request.data?.inTxs?.[0]?.txHash),
    destination:
      request.status === "success" && typeof outgoing?.chainId === "number" && isHex(outgoingHash)
        ? { chainId: outgoing.chainId, txHash: outgoingHash }
        : null,
    updatedAt: request.updatedAt,
  };
}

function firstHex(...candidates: (string | undefined)[]): Hex | null {
  for (const candidate of candidates) if (isHex(candidate)) return candidate;
  return null;
}

function mapStatus(status: string): FillStatus {
  const mapped = FILL_STATUS[status];
  if (mapped === undefined) {
    throw new DepositError("router_unavailable", "Relay returned an unknown status");
  }
  return mapped;
}

function quotedAddress(quote: z.infer<typeof QuoteResponse>): Address {
  const found = quote.steps?.[0]?.depositAddress;
  if (found === undefined) {
    throw new DepositError("router_unavailable", "Relay returned an unexpected deposit address");
  }
  return found;
}

function errorCodeFor(status: number, body: unknown): DepositErrorCode {
  if (status >= 500 || status === 429) return "router_unavailable";
  if (typeof body !== "object" || body === null || !("errorCode" in body)) {
    return "router_unavailable";
  }
  const code = body.errorCode;
  if (typeof code !== "string") return "router_unavailable";
  return ERROR_CODES[code] ?? "router_unavailable";
}
