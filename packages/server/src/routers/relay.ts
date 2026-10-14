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
import { type Address, type Hash, isAddress, isAddressEqual, isHash, zeroAddress } from "viem";
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
// Anything that isn't a 32-byte hash becomes undefined, so mappers can fall back with `??`.
const txHash = z
  .string()
  .optional()
  .transform((value): Hash | undefined =>
    value !== undefined && isHash(value) ? value : undefined,
  );

/** An array item that fails its schema becomes null instead of failing the whole list. */
function skippable<T extends z.ZodType>(item: T) {
  return item.nullable().catch(null);
}

const QuoteResponse = z.object({
  steps: z.array(z.object({ depositAddress: address.optional() })).optional(),
  details: z.object({
    currencyIn: z.object({ amount: baseUnits }),
    currencyOut: z.object({ amount: baseUnits, minimumAmount: baseUnits }),
    timeEstimate: z.number(),
  }),
});

const RelayRequest = z.object({
  id: z.string().min(1),
  status: z.string(),
  updatedAt: z.coerce.date(),
  // TODO(S4): depositAddress on a real deposit-address request is unconfirmed.
  depositAddress: z.object({ depositTxHash: txHash }).nullish(),
  data: z
    .object({
      inTxs: z.array(z.object({ txHash })).optional(),
      outTxs: z.array(z.object({ chainId: z.number().optional(), txHash })).optional(),
    })
    .nullish(),
});

// One malformed request is skipped (reconciliation re-reads it), not fatal for the address.
const RequestsPage = z.object({
  requests: z.array(skippable(RelayRequest)),
  continuation: z.string().nullish(),
});

const StatusResponse = z.object({ status: z.string() });

const Currency = z.object({
  address,
  symbol: z.string().min(1),
  decimals: z.number().int().nonnegative(),
});

const Chain = z.object({
  id: z.number(),
  name: z.string().min(1),
  depositAddressEnabled: z.boolean().optional(),
  disabled: z.boolean().optional(),
  solverCurrencies: z.array(skippable(Currency)).optional(),
});

const ChainsResponse = z.object({ chains: z.array(skippable(Chain)) });

const ErrorBody = z.object({ errorCode: z.string() });

export type RelayFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type RelayOptions = {
  apiKey: string;
  fetch?: RelayFetch;
};

type QuoteOptions = {
  route: Route;
  amount: bigint;
  tradeType: "EXACT_INPUT" | "EXACT_OUTPUT";
  recipient?: Address;
  refundTo?: Address;
  useDepositAddress?: true;
  strict?: true;
};

export function relay(options: RelayOptions): PaymentRouter {
  if (typeof options.apiKey !== "string" || options.apiKey.trim() === "") {
    throw new DepositError("invalid_config", "Relay API key is required");
  }

  const apiKey = options.apiKey.trim();
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);

  async function call<Schema extends z.ZodType>(
    schema: Schema,
    path: string,
    body?: object,
  ): Promise<z.output<Schema>> {
    // The key is only ever a header. It's sent on every call: keyed requests get the
    // key's rate limits and show up in the Relay dashboard.
    const headers: Record<string, string> = { accept: "application/json", "x-api-key": apiKey };
    if (body !== undefined) headers["content-type"] = "application/json";

    let response: Response;
    let text: string;
    try {
      response = await doFetch(`${RELAY_API}${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers,
        body: body === undefined ? null : JSON.stringify(body),
      });
      text = await response.text();
    } catch (error) {
      throw new DepositError("router_unavailable", "Relay request failed", error);
    }

    const json = parseBody(text);
    if (!response.ok) {
      const message = isOutage(response.status)
        ? "Relay is unavailable"
        : "Relay rejected the request";
      throw new DepositError(errorCodeFor(response.status, json), message, json);
    }

    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      throw new DepositError(
        "router_unavailable",
        "Relay returned an unexpected response",
        parsed.error.issues,
      );
    }
    return parsed.data;
  }

  const quoteVia = (quote: QuoteOptions) => call(QuoteResponse, "/quote/v2", quoteBody(quote));

  return {
    id: "relay",

    async sources() {
      const page = await call(ChainsResponse, "/chains");
      return page.chains.flatMap((chain) => (chain ? (toSource(chain) ?? []) : []));
    },

    // A second quote is a different address. T3 stores the first one.
    // Relay needs a sample amount to issue the address; the route minimum is a safe one.
    // Callers never see it.
    async depositAddress(input) {
      const quote = await quoteVia({
        ...input,
        amount: input.route.minimum,
        tradeType: "EXACT_INPUT",
        useDepositAddress: true,
      });
      return { address: quotedAddress(quote) };
    },

    async orderAddress(input): Promise<OrderAddress> {
      const quote = await quoteVia({
        ...input,
        tradeType: "EXACT_OUTPUT",
        useDepositAddress: true,
        strict: true,
      });
      const quoted = quote.details.currencyOut.amount;
      if (quoted !== input.amount) {
        // Amounts as strings: a bigint in `cause` would break JSON.stringify(error).
        throw new DepositError("quote_unavailable", "Quoted arrival does not match the price", {
          requested: input.amount.toString(),
          quoted: quoted.toString(),
        });
      }
      return { address: quotedAddress(quote), payAmount: quote.details.currencyIn.amount };
    },

    async quote(input): Promise<Quote> {
      const quoted = await quoteVia({
        route: input.route,
        amount: input.payAmount,
        tradeType: "EXACT_INPUT",
      });
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

      do {
        // 100 is Relay's maximum page size (default 20): fewer calls under tight rate limits.
        const params = new URLSearchParams({ depositAddress: address, limit: "100" });
        if (continuation) params.set("continuation", continuation);
        const page = await call(RequestsPage, `/requests/v3?${params}`);
        for (const request of page.requests) if (request) fills.push(toFill(request));

        continuation = page.continuation || undefined;
        if (continuation && seen.has(continuation)) {
          throw new DepositError("router_unavailable", "Relay repeated a continuation token");
        }
        if (continuation) seen.add(continuation);
      } while (continuation);

      return fills;
    },

    async status(fillId) {
      const params = new URLSearchParams({ requestId: fillId });
      const body = await call(StatusResponse, `/intents/status/v3?${params}`);
      return toFillStatus(body.status);
    },
  };
}

/**
 * One policy for every Relay status we don't recognise: "unknown", which the workflow
 * sends to needs_attention. Never an error that would look like an outage and retry forever.
 */
function toFillStatus(status: string): FillStatus {
  return FILL_STATUS[status] ?? "unknown";
}

/** Relay writes the chain's own coin as the zero address; we write "native". */
function toRelayToken(token: Address | "native"): Address {
  return token === "native" ? zeroAddress : token;
}

function fromRelayToken(token: Address): Address | "native" {
  return isAddressEqual(token, zeroAddress) ? "native" : token;
}

// Undefined optional fields are dropped by JSON.stringify.
function quoteBody({ route, amount, ...rest }: QuoteOptions) {
  return {
    ...rest,
    user: zeroAddress,
    originChainId: route.from.chainId,
    destinationChainId: route.to.chainId,
    originCurrency: toRelayToken(route.from.token),
    destinationCurrency: toRelayToken(route.to.token),
    amount: amount.toString(),
  };
}

function toSource(chain: z.infer<typeof Chain>): Source | null {
  if (chain.depositAddressEnabled !== true || chain.disabled === true) return null;
  const tokens = (chain.solverCurrencies ?? []).flatMap((currency) =>
    currency
      ? [
          {
            token: fromRelayToken(currency.address),
            symbol: currency.symbol,
            decimals: currency.decimals,
          },
        ]
      : [],
  );
  return { chainId: chain.id, name: chain.name, tokens };
}

function toFill(request: z.infer<typeof RelayRequest>): Fill {
  const outgoing = request.data?.outTxs?.[0];
  return {
    id: request.id,
    status: toFillStatus(request.status),
    depositTx: request.depositAddress?.depositTxHash ?? request.data?.inTxs?.[0]?.txHash ?? null,
    destination:
      request.status === "success" && outgoing?.chainId !== undefined && outgoing.txHash
        ? { chainId: outgoing.chainId, txHash: outgoing.txHash }
        : null,
    updatedAt: request.updatedAt,
  };
}

function quotedAddress(quote: z.infer<typeof QuoteResponse>): Address {
  const found = quote.steps?.[0]?.depositAddress;
  if (found === undefined) {
    throw new DepositError("router_unavailable", "Relay returned an unexpected deposit address");
  }
  return found;
}

function parseBody(text: string): unknown {
  if (text.trim() === "") return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function isOutage(status: number): boolean {
  return status >= 500 || status === 429;
}

function errorCodeFor(status: number, body: unknown): DepositErrorCode {
  if (isOutage(status)) return "router_unavailable";
  // A missing, wrong or revoked key is a configuration problem, not an outage.
  if (status === 401 || status === 403) return "invalid_config";
  const code = ErrorBody.safeParse(body).data?.errorCode;
  return (code && ERROR_CODES[code]) || "router_unavailable";
}
