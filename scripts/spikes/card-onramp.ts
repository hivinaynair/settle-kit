/** Read-only provider discovery. Never creates orders, sessions, accounts or payments. */
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

type JsonObject = Record<string, unknown>;
type Request = (input: Parameters<typeof fetch>[0], init?: RequestInit) => Promise<Response>;
type Probe = {
  provider: "transak" | "moonpay";
  kind: "crypto" | "fiat" | "countries";
  url: string;
  headers?: Record<string, string>;
};

function object(value: unknown): JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function flag(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function strings(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : undefined;
}

export function rows(body: unknown): JsonObject[] {
  const root = object(body);
  const result = Array.isArray(body) ? body : (root.response ?? root.data);
  if (!Array.isArray(result)) throw new Error("unexpected_response_shape");
  return result.map(object);
}

/** Whitelist public coverage fields; exclude keys, tokens, customer data and raw errors. */
export function summarize(body: unknown, kind: Probe["kind"]) {
  const items = rows(body);
  if (kind === "crypto") {
    return {
      count: items.length,
      usdc: items
        .filter((item) => item.symbol === "USDC" || /^usdc/i.test(text(item.code) ?? ""))
        .map((item) => {
          const network = object(item.network);
          const metadata = object(item.metadata);
          return {
            symbol: text(item.symbol),
            code: text(item.code),
            enabled: flag(item.isAllowed),
            suspended: flag(item.isSuspended),
            supportsTestMode: flag(item.supportsTestMode),
            network: text(network.name) ?? text(metadata.networkCode),
            chainId: text(network.chainId) ?? text(metadata.chainId) ?? number(metadata.chainId),
            excludedKycCountries: strings(item.kycCountriesNotSupported),
          };
        }),
    };
  }
  if (kind === "fiat") {
    return {
      count: items.length,
      currencies: items
        .filter((item) => ["USD", "SGD", "INR"].includes(text(item.symbol) ?? ""))
        .map((item) => ({
          symbol: text(item.symbol),
          enabled: flag(item.isAllowed),
          supportingCountries: strings(item.supportingCountries),
          cards: Array.isArray(item.paymentOptions)
            ? item.paymentOptions
                .map(object)
                .filter((method) => method.id === "credit_debit_card")
                .map((method) => ({
                  id: text(method.id),
                  active: flag(method.isActive),
                  minAmount: number(method.minAmount),
                  maxAmount: number(method.maxAmount),
                  limitCurrency: text(method.limitCurrency),
                }))
            : [],
        })),
    };
  }
  return {
    count: items.length,
    countries: items
      .filter((item) => ["US", "SG", "IN"].includes(text(item.alpha2 ?? item.code) ?? ""))
      .map((item) => ({
        code: text(item.alpha2 ?? item.code),
        allowed: flag(item.isAllowed),
        cardPayment: flag(item.isCardPayment),
        lightKycAllowed: flag(item.isLightKycAllowed),
      })),
  };
}

export function plans(transakKey?: string, moonpayKey?: string): Probe[] {
  if (moonpayKey && !moonpayKey.startsWith("pk_test_")) {
    throw new Error("MoonPay probe accepts only a pk_test_ publishable key");
  }
  const transakHeaders = transakKey ? { "x-api-key": transakKey } : undefined;
  const currencies = new URL("https://api.moonpay.com/v3/currencies");
  currencies.searchParams.set("show", "all");
  if (moonpayKey) currencies.searchParams.set("apiKey", moonpayKey);
  return [
    {
      provider: "transak",
      kind: "crypto",
      url: "https://api-stg.transak.com/cryptocoverage/api/v1/public/crypto-currencies",
      headers: transakHeaders,
    },
    {
      provider: "transak",
      kind: "fiat",
      url: "https://api-stg.transak.com/fiat/public/v1/currencies/fiat-currencies",
      headers: transakHeaders,
    },
    {
      provider: "transak",
      kind: "countries",
      url: "https://api-stg.transak.com/api/v2/countries",
      headers: transakHeaders,
    },
    { provider: "moonpay", kind: "crypto", url: currencies.toString() },
    { provider: "moonpay", kind: "countries", url: "https://api.moonpay.com/v3/countries" },
  ];
}

export async function probe(plan: Probe, request: Request = fetch) {
  const url = new URL(plan.url);
  const result = {
    provider: plan.provider,
    kind: plan.kind,
    endpoint: `${url.origin}${url.pathname}`,
    credentialSupplied: Boolean(plan.headers?.["x-api-key"] || url.searchParams.has("apiKey")),
  };
  try {
    const response = await request(plan.url, {
      method: "GET",
      headers: plan.headers,
      signal: AbortSignal.timeout(15_000),
      redirect: "error",
    });
    if (!response.ok) {
      // Do not persist bodies: provider errors can echo request credentials.
      return { ...result, httpStatus: response.status, outcome: "http_error" };
    }
    try {
      const summary = summarize(await response.json(), plan.kind);
      return { ...result, httpStatus: response.status, outcome: "metadata_received", summary };
    } catch {
      return { ...result, httpStatus: response.status, outcome: "unexpected_response_shape" };
    }
  } catch {
    // Transport failures are distinct from provider HTTP rejection or missing credentials.
    return { ...result, httpStatus: null, outcome: "transport_error" };
  }
}

if (import.meta.main) {
  const args = Bun.argv.slice(2);
  if (args.length !== 0 && (args.length !== 2 || args[0] !== "--output")) {
    throw new Error("Usage: bun scripts/spikes/card-onramp.ts [--output path.json]");
  }
  const result = {
    checkedAt: new Date().toISOString(),
    scope: "Read-only metadata; Transak staging; MoonPay sandbox key if supplied",
    limits: "Metadata is not a quote, payer eligibility, completed checkout, or merchant approval.",
    probes: await Promise.all(
      // biome-ignore lint/suspicious/noUndeclaredEnvVars: Standalone Bun script, never run or cached by Turbo.
      plans(Bun.env.TRANSAK_STAGING_API_KEY, Bun.env.MOONPAY_TEST_PUBLISHABLE_KEY).map((plan) =>
        probe(plan),
      ),
    ),
  };
  const output = `${JSON.stringify(result, null, 2)}\n`;
  if (args[1]) {
    await mkdir(dirname(args[1]), { recursive: true });
    await Bun.write(args[1], output);
  }
  console.log(output);
  if (result.probes.some((item) => item.outcome !== "metadata_received")) process.exitCode = 1;
}
