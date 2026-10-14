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

const RELAY_API = "https://api.relay.link";

const QUOTE_UNAVAILABLE = new Set([
  "INVALID_INPUT_CURRENCY",
  "INVALID_OUTPUT_CURRENCY",
  "NO_QUOTES",
  "INSUFFICIENT_LIQUIDITY",
  "SWAP_IMPACT_TOO_HIGH",
  "UNSUPPORTED_ROUTE",
]);

const ROUTE_UNAVAILABLE = new Set([
  "CHAIN_DISABLED",
  "ROUTE_TEMPORARILY_RESTRICTED",
  "UNSUPPORTED_CHAIN",
]);

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

// Structural on purpose. Bun's fetch also has preconnect, which a test double does not.
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

type SourceToken = Source["tokens"][number];

export function relay(options: RelayOptions): PaymentRouter {
  if (typeof options.apiKey !== "string" || options.apiKey.trim() === "") {
    throw new DepositError("invalid_config", "Relay API key is required");
  }

  const apiKey = options.apiKey.trim();
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);

  function raise(code: DepositErrorCode, message: string, cause?: unknown): never {
    const safeMessage = redactString(message, apiKey);
    if (cause === undefined) throw new DepositError(code, safeMessage);
    throw new DepositError(code, safeMessage, redact(cause, apiKey));
  }

  async function send(path: string, body?: QuoteBody, withApiKey = false): Promise<unknown> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (body !== undefined) headers["content-type"] = "application/json";
    // Only /requests/v3 requires the key. Leaving it off other calls means a quote
    // failure has no header to echo back.
    if (withApiKey) headers["x-api-key"] = apiKey;

    let response: Response;
    try {
      response = await doFetch(`${RELAY_API}${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch (error) {
      raise("router_unavailable", "Relay request failed", error);
    }

    let text: string;
    try {
      text = await response.text();
    } catch (error) {
      raise("router_unavailable", "Relay request failed", error);
    }

    const parsed = parseBody(text);
    if (!response.ok)
      raise(httpCode(response.status, parsed), httpMessage(response.status), parsed);
    return parsed;
  }

  return {
    id: "relay",

    async sources() {
      const body = await send("/chains");
      if (!isRecord(body) || !Array.isArray(body.chains)) {
        raise("router_unavailable", "Relay returned an unexpected chain list");
      }
      const sources: Source[] = [];
      for (const chain of body.chains) {
        const source = mapChain(chain);
        if (source) sources.push(source);
      }
      return sources;
    },

    // A second quote is a different address. This method does not remember the first;
    // the store (T3) does, and reuses it for the same account and route.
    // Relay still needs a sample amount to issue the address. Callers never see it.
    async depositAddress(input) {
      const body = await send(
        "/quote/v2",
        quoteBody({
          route: input.route,
          amount: 10n ** BigInt(input.route.from.decimals),
          tradeType: "EXACT_INPUT",
          useDepositAddress: true,
          recipient: input.recipient,
          refundTo: input.refundTo,
          recoveryAddress: input.recoveryAddress,
        }),
      );
      return { address: readDepositAddress(body, raise) };
    },

    async orderAddress(input): Promise<OrderAddress> {
      const body = await send(
        "/quote/v2",
        quoteBody({
          route: input.route,
          amount: input.amount,
          tradeType: "EXACT_OUTPUT",
          useDepositAddress: true,
          strict: true,
          recipient: input.recipient,
          refundTo: input.refundTo,
          recoveryAddress: input.recoveryAddress,
        }),
      );
      const payAmount = readAmount(body, "currencyIn", "amount", raise);
      const quotedArrival = readAmount(body, "currencyOut", "amount", raise);
      if (quotedArrival !== input.amount) {
        raise("quote_unavailable", "Quoted arrival does not match the requested amount", body);
      }
      return { address: readDepositAddress(body, raise), payAmount };
    },

    async quote(input): Promise<Quote> {
      const body = await send(
        "/quote/v2",
        quoteBody({
          route: input.route,
          amount: input.payAmount,
          tradeType: "EXACT_INPUT",
        }),
      );
      return {
        payAmount: readAmount(body, "currencyIn", "amount", raise),
        receiveAmount: readAmount(body, "currencyOut", "amount", raise),
        minimumReceiveAmount: readAmount(body, "currencyOut", "minimumAmount", raise),
        etaSeconds: readEta(body, raise),
      };
    },

    async fills(address) {
      const fills: Fill[] = [];
      const seen = new Set<string>();
      let continuation: string | undefined;

      for (;;) {
        const params = new URLSearchParams({ depositAddress: address });
        if (continuation !== undefined) params.set("continuation", continuation);
        const body = await send(`/requests/v3?${params.toString()}`, undefined, true);
        if (!isRecord(body) || !Array.isArray(body.requests)) {
          raise("router_unavailable", "Relay returned an unexpected fill list");
        }
        for (const request of body.requests) {
          if (!isRecord(request)) raise("router_unavailable", "Relay returned an unexpected fill");
          fills.push(mapFill(request, apiKey, raise));
        }
        if (typeof body.continuation !== "string" || body.continuation.length === 0) return fills;
        if (seen.has(body.continuation)) {
          raise("router_unavailable", "Relay repeated a continuation token");
        }
        seen.add(body.continuation);
        continuation = body.continuation;
      }
    },

    async status(fillId) {
      const params = new URLSearchParams({ requestId: fillId });
      const body = await send(`/intents/status/v3?${params.toString()}`);
      if (!isRecord(body)) raise("router_unavailable", "Relay returned an unexpected status");
      return mapStatus(body.status, apiKey, raise);
    },
  };
}

function quoteBody(input: {
  route: Route;
  amount: bigint;
  tradeType: QuoteTrade;
  useDepositAddress?: boolean;
  strict?: boolean;
  recipient?: Address;
  refundTo?: Address;
  recoveryAddress?: Address;
}): QuoteBody {
  const body: QuoteBody = {
    user: zeroAddress,
    originChainId: input.route.from.chainId,
    destinationChainId: input.route.to.chainId,
    originCurrency: relayCurrency(input.route.from.token),
    destinationCurrency: relayCurrency(input.route.to.token),
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

function relayCurrency(token: Address | "native"): Address {
  return token === "native" ? zeroAddress : token;
}

function mapChain(chain: unknown): Source | null {
  if (!isRecord(chain)) return null;
  if (chain.depositAddressEnabled !== true || chain.disabled === true) return null;
  if (typeof chain.id !== "number" || typeof chain.name !== "string" || chain.name.length === 0) {
    return null;
  }
  const currencies = Array.isArray(chain.solverCurrencies) ? chain.solverCurrencies : [];
  const tokens: SourceToken[] = [];
  for (const currency of currencies) {
    const token = mapToken(currency);
    if (token) tokens.push(token);
  }
  return { chainId: chain.id, name: chain.name, tokens };
}

function mapToken(currency: unknown): SourceToken | undefined {
  if (!isRecord(currency)) return undefined;
  const { address, symbol, decimals } = currency;
  if (typeof address !== "string" || !isAddress(address)) return undefined;
  if (typeof symbol !== "string" || symbol.length === 0) return undefined;
  if (typeof decimals !== "number" || !Number.isInteger(decimals) || decimals < 0) return undefined;
  const token = address.toLowerCase() === zeroAddress ? "native" : address;
  return { token, symbol, decimals };
}

function mapFill(
  request: Record<string, unknown>,
  apiKey: string,
  raise: (code: DepositErrorCode, message: string, cause?: unknown) => never,
): Fill {
  if (typeof request.id !== "string" || request.id.length === 0) {
    raise("router_unavailable", "Relay returned an unexpected fill");
  }
  return {
    id: request.id,
    status: mapStatus(request.status, apiKey, raise),
    depositTx: readDepositTx(request),
    destination: readDestination(request),
    updatedAt: readUpdatedAt(request.updatedAt, raise),
  };
}

function mapStatus(
  status: unknown,
  apiKey: string,
  raise: (code: DepositErrorCode, message: string, cause?: unknown) => never,
): FillStatus {
  const mapped = typeof status === "string" ? FILL_STATUS[status] : undefined;
  if (mapped === undefined) {
    const label =
      typeof status === "string" ? redactString(status, apiKey).slice(0, 80) : "unrecognized";
    raise("router_unavailable", `Relay returned an unknown status (${label})`);
  }
  return mapped;
}

// TODO(S4): depositAddress on a real deposit-address request is unconfirmed.
function readDepositTx(request: Record<string, unknown>): Hex | null {
  const depositAddress = isRecord(request.depositAddress) ? request.depositAddress : null;
  if (isHex(depositAddress?.depositTxHash)) return depositAddress.depositTxHash;
  const data = isRecord(request.data) ? request.data : null;
  const inTxs = Array.isArray(data?.inTxs) ? data.inTxs : [];
  const first: unknown = inTxs[0];
  if (!isRecord(first) || !isHex(first.txHash)) return null;
  return first.txHash;
}

function readDestination(request: Record<string, unknown>): Fill["destination"] {
  if (request.status !== "success") return null;
  const data = isRecord(request.data) ? request.data : null;
  const outTxs = Array.isArray(data?.outTxs) ? data.outTxs : [];
  const first: unknown = outTxs[0];
  if (!isRecord(first) || typeof first.chainId !== "number" || !isHex(first.txHash)) return null;
  return { chainId: first.chainId, txHash: first.txHash };
}

function readUpdatedAt(
  value: unknown,
  raise: (code: DepositErrorCode, message: string, cause?: unknown) => never,
): Date {
  if (typeof value !== "string" && typeof value !== "number") {
    raise("router_unavailable", "Relay returned an unexpected fill");
  }
  const updatedAt = new Date(value);
  if (Number.isNaN(updatedAt.getTime())) {
    raise("router_unavailable", "Relay returned an unexpected fill");
  }
  return updatedAt;
}

function readDepositAddress(
  body: unknown,
  raise: (code: DepositErrorCode, message: string, cause?: unknown) => never,
): Address {
  if (!isRecord(body) || !Array.isArray(body.steps)) {
    raise("router_unavailable", "Relay returned an unexpected quote");
  }
  const step: unknown = body.steps[0];
  if (
    !isRecord(step) ||
    typeof step.depositAddress !== "string" ||
    !isAddress(step.depositAddress)
  ) {
    raise("router_unavailable", "Relay returned an unexpected deposit address");
  }
  return step.depositAddress;
}

function readAmount(
  body: unknown,
  field: "currencyIn" | "currencyOut",
  key: "amount" | "minimumAmount",
  raise: (code: DepositErrorCode, message: string, cause?: unknown) => never,
): bigint {
  if (!isRecord(body) || !isRecord(body.details)) {
    raise("router_unavailable", "Relay returned an unexpected quote");
  }
  const currency = body.details[field];
  if (!isRecord(currency)) raise("router_unavailable", "Relay returned an unexpected quote");
  return parseBaseUnits(currency[key], raise);
}

function readEta(
  body: unknown,
  raise: (code: DepositErrorCode, message: string, cause?: unknown) => never,
): number {
  if (!isRecord(body) || !isRecord(body.details)) {
    raise("router_unavailable", "Relay returned an unexpected quote");
  }
  const eta = body.details.timeEstimate;
  if (typeof eta !== "number" || !Number.isFinite(eta)) {
    raise("router_unavailable", "Relay returned an unexpected time estimate");
  }
  return eta;
}

function parseBaseUnits(
  value: unknown,
  raise: (code: DepositErrorCode, message: string, cause?: unknown) => never,
): bigint {
  if (typeof value !== "string" || !/^[0-9]+$/.test(value)) {
    raise("router_unavailable", "Relay returned a non-integer amount");
  }
  return BigInt(value);
}

function httpCode(status: number, body: unknown): DepositErrorCode {
  if (status >= 500 || status === 429) return "router_unavailable";
  const errorCode =
    isRecord(body) && typeof body.errorCode === "string" ? body.errorCode : undefined;
  if (errorCode === "AMOUNT_TOO_LOW") return "amount_too_low";
  if (errorCode !== undefined && QUOTE_UNAVAILABLE.has(errorCode)) return "quote_unavailable";
  if (errorCode !== undefined && ROUTE_UNAVAILABLE.has(errorCode)) return "route_unavailable";
  if (errorCode === "SANCTIONED_WALLET_ADDRESS") return "address_blocked";
  return "router_unavailable";
}

function httpMessage(status: number): string {
  if (status === 429 || status >= 500) return "Relay is unavailable";
  return "Relay rejected the request";
}

function parseBody(text: string): unknown {
  if (text.trim() === "") return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function redact(value: unknown, secret: string, seen = new WeakSet<object>()): unknown {
  if (typeof value === "string") return redactString(value, secret);
  if (typeof value !== "object" || value === null) return value;
  if (seen.has(value)) return null;
  seen.add(value);
  if (value instanceof Error) {
    const redacted: { name: string; message: string; cause?: unknown } = {
      name: value.name,
      message: redactString(value.message, secret),
    };
    if (value.cause !== undefined) redacted.cause = redact(value.cause, secret, seen);
    return redacted;
  }
  if (Array.isArray(value)) return value.map((item) => redact(item, secret, seen));
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (key.toLowerCase() === "x-api-key" || key.toLowerCase() === "authorization") continue;
    output[redactString(key, secret)] = redact(item, secret, seen);
  }
  return output;
}

function redactString(value: string, secret: string): string {
  if (secret.length === 0 || !value.includes(secret)) return value;
  return value.split(secret).join("[redacted]");
}
