import type { paths } from "@relayprotocol/relay-sdk";
import {
  DepositError,
  type DepositErrorCode,
  type Fill,
  type FillStatus,
  type PaymentRouter,
  type Route,
} from "@settle-kit/core";
import { type Address, type Hash, isAddress, isHash, zeroAddress } from "viem";
import { z } from "zod";

const RELAY_API = "https://api.relay.link";

/** Relay's status words → ours. Anything else becomes "unknown". */
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

/** Relay's errorCode → ours. Anything else becomes "router_unavailable". */
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

// --- What we expect Relay to send (checked at runtime) ---

const baseUnits = z.string().regex(/^\d+$/).transform(BigInt);
const address = z.custom<Address>((value) => typeof value === "string" && isAddress(value));
// Anything that isn't a 32-byte hash becomes undefined, so mappers can fall back with `??`.
const txHash = z
  .string()
  .optional()
  .transform((value): Hash | undefined =>
    value !== undefined && isHash(value) ? value : undefined,
  );

const QuoteResponse = z.object({
  steps: z.array(z.object({ depositAddress: address.optional() })).optional(),
  details: z.object({
    currencyIn: z.object({ amount: baseUnits }),
    currencyOut: z.object({ amount: baseUnits }),
  }),
});

const RelayRequest = z.object({
  id: z.string().min(1),
  status: z.string(),
  updatedAt: z.coerce.date(),
  depositAddress: z.object({ depositTxHash: txHash }).nullish(),
  data: z
    .object({
      inTxs: z.array(z.object({ txHash })).optional(),
      outTxs: z.array(z.object({ chainId: z.number().optional(), txHash })).optional(),
    })
    .nullish(),
});

const RequestsPage = z.object({
  // A malformed record becomes null and is skipped; it can't hide the other payments.
  requests: z.array(RelayRequest.nullable().catch(null)),
  continuation: z.string().nullish(),
});

const ErrorBody = z.object({ errorCode: z.string() });

/** Relay's official request type (type-only import): a renamed field fails the build. */
type RelayQuoteBody = NonNullable<
  paths["/quote/v2"]["post"]["requestBody"]
>["content"]["application/json"];

// --- The adapter ---

export type RelayFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type RelayOptions = {
  apiKey: string;
  fetch?: RelayFetch;
};

export function relay(options: RelayOptions): PaymentRouter {
  if (typeof options.apiKey !== "string" || options.apiKey.trim() === "") {
    throw new DepositError("invalid_config", "Relay API key is required");
  }
  const apiKey = options.apiKey.trim();
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);

  /** The one way we talk to Relay: send, map errors, validate the reply. */
  async function call<Schema extends z.ZodType>(
    schema: Schema,
    path: string,
    body?: RelayQuoteBody,
  ): Promise<z.output<Schema>> {
    // The key is only ever a header; errors only carry Relay's reply, so it can't leak.
    const headers: Record<string, string> = { accept: "application/json", "x-api-key": apiKey };
    if (body) headers["content-type"] = "application/json";

    let response: Response;
    let text: string;
    try {
      response = await doFetch(`${RELAY_API}${path}`, {
        method: body ? "POST" : "GET",
        headers,
        body: body ? JSON.stringify(body) : null,
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

  return {
    id: "relay",

    // Every quote issues a new address, so T3 stores the first one per account and route.
    // Relay needs a sample amount; the route minimum is a safe one.
    async depositAddress(input) {
      const quote = await call(
        QuoteResponse,
        "/quote/v2",
        quoteBody(input.route, input.route.minimum, "EXACT_INPUT", input),
      );
      return { address: quotedAddress(quote) };
    },

    // Strict + exact output: the merchant receives exactly `amount`, or Relay refunds.
    async orderAddress(input) {
      const quote = await call(
        QuoteResponse,
        "/quote/v2",
        quoteBody(input.route, input.amount, "EXACT_OUTPUT", { ...input, strict: true }),
      );
      const quoted = quote.details.currencyOut.amount;
      if (quoted !== input.amount) {
        // Strings, not bigints: a bigint in `cause` would break JSON.stringify(error).
        throw new DepositError("quote_unavailable", "Quoted arrival does not match the price", {
          requested: input.amount.toString(),
          quoted: quoted.toString(),
        });
      }
      return { address: quotedAddress(quote), payAmount: quote.details.currencyIn.amount };
    },

    // Reads every page, 100 at a time (Relay's maximum).
    async fills(depositAddress) {
      const fills: Fill[] = [];
      const seen = new Set<string>();
      let continuation: string | undefined;

      do {
        const params = new URLSearchParams({ depositAddress, limit: "100" });
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
  };
}

// --- Helpers ---

function quoteBody(
  route: Route,
  amount: bigint,
  tradeType: "EXACT_INPUT" | "EXACT_OUTPUT",
  extra: { recipient: Address; refundTo: Address; strict?: true },
) {
  return {
    user: zeroAddress,
    originChainId: route.from.chainId,
    destinationChainId: route.to.chainId,
    originCurrency: route.from.token,
    destinationCurrency: route.to.token,
    amount: amount.toString(),
    tradeType,
    recipient: extra.recipient,
    refundTo: extra.refundTo,
    useDepositAddress: true,
    ...(extra.strict ? { strict: true } : {}),
  } satisfies RelayQuoteBody;
}

function toFill(request: z.infer<typeof RelayRequest>): Fill {
  const outgoing = request.data?.outTxs?.[0];
  return {
    id: request.id,
    // An unrecognised status becomes "unknown" (→ needs_attention), never an error that
    // would look like an outage and block the other payments at the address.
    status: FILL_STATUS[request.status] ?? "unknown",
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
  if (!found) {
    throw new DepositError("router_unavailable", "Relay returned no deposit address");
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
