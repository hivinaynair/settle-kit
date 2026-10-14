import type { paths } from "@relayprotocol/relay-sdk";
import {
  DepositError,
  type DepositErrorCode,
  type Fill,
  type FillStatus,
  type PaymentRouter,
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
  steps: z
    .array(
      z.object({
        depositAddress: address.optional(),
        requestId: z.string().min(1).optional(),
      }),
    )
    .optional(),
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

// Records are checked one by one in toFill, so one malformed record can't hide the others.
const RequestsPage = z.object({
  requests: z.array(z.unknown()),
  continuation: z.string().nullish(),
});

const RecordId = z.object({ id: z.string().min(1) });

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

  /** Send a request and map HTTP errors; callers validate the response. */
  async function call(path: string, body?: RelayQuoteBody): Promise<unknown> {
    // Authenticate every request, including payment discovery.
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

    return json;
  }

  return {
    id: "relay",

    /**
     * Request strict payment instructions: address, payer amount and original request ID.
     * This creates payment instructions only. Settlement still needs on-chain verification.
     */
    async orderAddress(input) {
      const body = {
        user: zeroAddress,
        originChainId: input.route.from.chainId,
        originCurrency: input.route.from.token,
        destinationChainId: input.route.to.chainId,
        destinationCurrency: input.route.to.token,
        amount: input.amount.toString(), // JSON carries base units as a decimal string.
        tradeType: "EXACT_OUTPUT",
        recipient: input.recipient,
        refundTo: input.refundTo,
        useDepositAddress: true,
        strict: true,
      } satisfies RelayQuoteBody;

      const json = await call("/quote/v2", body);
      const parsed = QuoteResponse.safeParse(json);
      if (!parsed.success) {
        throw new DepositError(
          "router_unavailable",
          "Relay returned an unexpected quote response",
          parsed.error.issues,
        );
      }
      const quote = parsed.data;
      const quoted = quote.details.currencyOut.amount;
      if (quoted !== input.amount) {
        // Keep diagnostic amounts as strings so they can be serialized as JSON.
        throw new DepositError("quote_unavailable", "Quoted arrival does not match the price", {
          requested: input.amount.toString(),
          quoted: quoted.toString(),
        });
      }
      const address = quote.steps?.[0]?.depositAddress;
      if (!address) {
        throw new DepositError("router_unavailable", "Relay returned no deposit address");
      }
      const requestId = quote.steps?.[0]?.requestId;
      if (!requestId) {
        throw new DepositError("router_unavailable", "Relay returned no request ID");
      }
      return { address, payAmount: quote.details.currencyIn.amount, requestId };
    },

    // Request related child reports for the workflow's extra-deposit handling.
    async fills(requestId) {
      if (typeof requestId !== "string" || requestId.trim() === "") {
        throw new DepositError("invalid_config", "Relay request ID is required");
      }
      // Keyed by fill ID: a record repeated across pages is returned once, newest wins.
      const fills = new Map<string, Fill>();
      const seen = new Set<string>();
      let continuation: string | undefined;

      do {
        const params = new URLSearchParams({
          id: requestId,
          includeChildRequests: "true",
          limit: "100",
        });
        if (continuation) params.set("continuation", continuation);
        const json = await call(`/requests/v3?${params}`);
        const parsed = RequestsPage.safeParse(json);
        if (!parsed.success) {
          throw new DepositError(
            "router_unavailable",
            "Relay returned an unexpected payments response",
            parsed.error.issues,
          );
        }
        const page = parsed.data;
        for (const record of page.requests) {
          const fill = toFill(record);
          const current = fill && fills.get(fill.id);
          if (fill && (!current || fill.updatedAt >= current.updatedAt)) fills.set(fill.id, fill);
        }

        continuation = page.continuation || undefined;
        if (continuation && seen.has(continuation)) {
          throw new DepositError("router_unavailable", "Relay repeated a continuation token");
        }
        if (continuation) seen.add(continuation);
      } while (continuation);

      return [...fills.values()];
    },
  };
}

// --- Helpers ---

/**
 * A record we can't read but that has an ID becomes "unknown" (→ needs_attention), so a
 * changed Relay format is flagged instead of looking like "no payment yet". Only a record
 * without an ID is skipped: there is nothing to record it under.
 */
function toFill(record: unknown): Fill | null {
  const parsed = RelayRequest.safeParse(record);
  if (parsed.success) return readFill(parsed.data);
  const id = RecordId.safeParse(record).data?.id;
  if (!id) return null;
  return { id, status: "unknown", depositTx: null, destination: null, updatedAt: new Date() };
}

function readFill(request: z.infer<typeof RelayRequest>): Fill {
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
