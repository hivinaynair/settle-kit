import { expect, test } from "bun:test";
import { plans, probe, summarize } from "./card-onramp";

test("discovery distinguishes provider token metadata from verified funds", () => {
  const result = summarize(
    {
      response: [{ symbol: "USDC", isAllowed: true, network: { name: "base", chainId: "84532" } }],
    },
    "crypto",
  );
  expect(result).toMatchObject({ usdc: [{ symbol: "USDC", network: "base", chainId: "84532" }] });
  expect(result).not.toHaveProperty("settled");
});

test("coverage summary omits credentials and private fields", () => {
  const result = summarize(
    {
      apiKey: "private-marker",
      response: [{ symbol: "USDC", apiSecret: "private-marker", customerEmail: "private-marker" }],
    },
    "crypto",
  );
  expect(JSON.stringify(result)).not.toContain("private-marker");
});

test("unknown response shapes are not mistaken for empty supported coverage", () => {
  expect(() => summarize({ message: "missing key" }, "crypto")).toThrow();
});

test("a production MoonPay key is rejected before requesting anything", () => {
  expect(() => plans(undefined, "pk_live_marker")).toThrow("pk_test_");
});

test("HTTP errors never include provider bodies or key-bearing URLs", async () => {
  const plan = plans(undefined, "pk_test_private-marker")[3];
  if (!plan) throw new Error("missing plan");
  const request = async () =>
    new Response(JSON.stringify({ message: "pk_test_private-marker" }), {
      status: 401,
    });
  const result = await probe(plan, request);
  expect(result).toMatchObject({ httpStatus: 401, outcome: "http_error" });
  expect(JSON.stringify(result)).not.toContain("private-marker");
});

test("transport failure is not reported as credential rejection", async () => {
  const plan = plans()[3];
  if (!plan) throw new Error("missing plan");
  const request = async () => {
    throw new Error("connection reset");
  };
  expect(await probe(plan, request)).toMatchObject({
    httpStatus: null,
    outcome: "transport_error",
  });
});

test("invalid successful response is visible instead of silently passing", async () => {
  const plan = plans()[0];
  if (!plan) throw new Error("missing plan");
  const request = async () => new Response("not json");
  expect(await probe(plan, request)).toMatchObject({
    httpStatus: 200,
    outcome: "unexpected_response_shape",
  });
});
