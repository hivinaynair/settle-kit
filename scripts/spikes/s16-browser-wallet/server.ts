// Local, bounded browser experiment. Not the Settle Kit engine or a production relayer.
import { randomBytes } from "node:crypto";
import {
  type Address,
  BaseError,
  ContractFunctionRevertedError,
  decodeEventLog,
  encodeAbiParameters,
  encodeFunctionData,
  erc20Abi,
  formatEther,
  formatUnits,
  type Hex,
  isAddress,
  keccak256,
  parseSignature,
  verifyTypedData,
} from "viem";
import {
  accounts,
  artifact,
  assertChain,
  chain,
  client,
  fees,
  load,
  lycorisDirectory,
  save,
  usdc,
} from "./shared";

type Payment = {
  id: string;
  payer: Address;
  status: string;
  salt: Hex;
  nonce: Hex;
  validBefore: string;
  signature?: Hex;
  raw?: Hex;
  hash?: Hex;
  ethBefore?: string;
  evidence?: Record<string, string | number>;
  replayRejected?: boolean;
};
type Faucet = { payer: Address; status: string; hash: string | null };
const port = 3004;
const csrf = randomBytes(32).toString("hex");
const config = await load("config.json");
if (!config) throw Error("Run setup.ts first");
await assertChain();
const { operator } = await accounts();
const contract = await artifact();
if (config.operator !== operator.address) throw Error("Operator mismatch");
const receiveTypes = {
  ReceiveWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;
const domain = {
  name: await client.readContract({
    address: usdc,
    abi: [
      {
        type: "function",
        name: "name",
        stateMutability: "view",
        inputs: [],
        outputs: [{ type: "string" }],
      },
    ],
    functionName: "name",
  }),
  version: "2",
  chainId: 84532,
  verifyingContract: usdc,
};
const principal = 990_000n,
  fee = 10_000n,
  gross = principal + fee;
// State stays private on disk; only explicitly selected public fields are returned.
const state: { payments: Payment[]; faucets: Faucet[] } = (await load("state.json")) ?? {
  payments: [],
  faucets: [],
};
let busy = Promise.resolve();
class PublicError extends Error {}
function requireCondition(value: unknown, message: string): asserts value {
  if (!value) throw new PublicError(message);
}
const balance = (address: Address, blockNumber?: bigint) =>
  client.readContract({
    address: usdc,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [address],
    blockNumber,
  });
const persist = () => save("state.json", state);
const typed = (p: Payment) => ({
  domain,
  types: receiveTypes,
  primaryType: "ReceiveWithAuthorization" as const,
  message: {
    from: p.payer,
    to: config.contract as Address,
    value: gross,
    validAfter: 0n,
    validBefore: BigInt(p.validBefore),
    nonce: p.nonce as Hex,
  },
});
const args = (p: Payment) => {
  const sig = parseSignature(p.signature as Hex);
  return [
    p.payer,
    config.treasury,
    principal,
    fee,
    p.salt,
    0n,
    BigInt(p.validBefore),
    Number(sig.v),
    sig.r,
    sig.s,
  ];
};
const request = (p: Payment) => ({
  address: config.contract as Address,
  abi: contract.abi,
  functionName: "deposit",
  args: args(p),
  account: operator,
});
const used = (p: Payment) =>
  client.readContract({
    address: usdc,
    abi: [
      {
        type: "function",
        name: "authorizationState",
        stateMutability: "view",
        inputs: [{ type: "address" }, { type: "bytes32" }],
        outputs: [{ type: "bool" }],
      },
    ],
    functionName: "authorizationState",
    args: [p.payer, p.nonce],
  });
function publicPayment(p: Payment) {
  return {
    id: p.id,
    payer: p.payer,
    status: p.status,
    hash: p.hash ?? null,
    validBefore: p.validBefore,
    evidence: p.evidence ?? null,
    replayRejected: p.replayRejected ?? false,
  };
}
async function inspect(p: Payment) {
  if (!p.hash) return publicPayment(p);
  const receipt = await client.getTransactionReceipt({ hash: p.hash }).catch(() => undefined);
  if (!receipt) return publicPayment(p);
  if (receipt.status === "reverted") {
    p.status = "reverted";
    await persist();
    return publicPayment(p);
  }
  const transfers = receipt.logs
    .filter((l) => l.address.toLowerCase() === usdc.toLowerCase())
    .flatMap((l) => {
      try {
        const event = decodeEventLog({ abi: erc20Abi, ...l });
        return event.eventName === "Transfer" ? [event.args] : [];
      } catch {
        return [];
      }
    });
  const matches = (from: string, to: string, value: bigint) =>
    transfers.filter(
      (t) =>
        t.from.toLowerCase() === from.toLowerCase() &&
        t.to.toLowerCase() === to.toLowerCase() &&
        t.value === value,
    ).length === 1;
  requireCondition(
    matches(p.payer, config.contract, gross) &&
      matches(config.contract, config.treasury, principal) &&
      matches(config.contract, operator.address, fee),
    "Receipt transfer amounts do not match the signed payment.",
  );
  const ethAfter = await client.getBalance({ address: p.payer, blockNumber: receipt.blockNumber });
  requireCondition(ethAfter === 0n && p.ethBefore === "0", "Zero-ETH evidence failed.");
  const safe = await client.getBlock({ blockTag: "safe" });
  const canonical = await client.getBlock({ blockNumber: receipt.blockNumber });
  requireCondition(
    canonical.hash === receipt.blockHash,
    "Receipt is no longer canonical; investigate original transaction.",
  );
  p.status = safe.number >= receipt.blockNumber ? "verified" : "included";
  p.evidence = {
    chainId: 84532,
    blockNumber: receipt.blockNumber.toString(),
    blockHash: receipt.blockHash,
    safeBlock: safe.number.toString(),
    payerEthBefore: p.ethBefore,
    payerEthAfter: ethAfter.toString(),
    payerUsdcDebit: gross.toString(),
    treasuryUsdc: principal.toString(),
    processingFee: fee.toString(),
    operatorGasWei: (receipt.gasUsed * receipt.effectiveGasPrice).toString(),
    payerUsdcAfter: (await balance(p.payer, receipt.blockNumber)).toString(),
    note: "Receipt gas figure excludes any separately reported L1 data fee; no SDK or CCTP credit claimed.",
  };
  await persist();
  return publicPayment(p);
}
async function api(path: string, body: Record<string, unknown>) {
  if (path === "/api/status") {
    const p = state.payments.find((p: Payment) => p.id === body.id);
    requireCondition(p, "Unknown payment.");
    return inspect(p);
  }
  const payer = body.payer as Address;
  if (path === "/api/balances" || path === "/api/prepare" || path === "/api/faucet")
    requireCondition(isAddress(payer ?? ""), "Connect a valid wallet first.");
  if (path === "/api/balances")
    return {
      eth: formatEther(await client.getBalance({ address: payer })),
      usdc: formatUnits(await balance(payer), 6),
      payments: state.payments
        .filter((p: Payment) => p.payer.toLowerCase() === payer.toLowerCase())
        .map(publicPayment),
    };
  if (path === "/api/faucet") {
    requireCondition(
      (await client.getBalance({ address: payer })) === 0n,
      "Use an account with exactly zero Base Sepolia ETH.",
    );
    requireCondition(
      payer.toLowerCase() !== operator.address.toLowerCase(),
      "The payer must differ from the operator.",
    );
    requireCondition(
      state.faucets.length < 3 &&
        !state.faucets.some((f: Faucet) => f.payer.toLowerCase() === payer.toLowerCase()),
      "This local spike already requested its faucet allowance.",
    );
    const entry = { payer, status: "requested", hash: null as string | null };
    state.faucets.push(entry);
    await persist();
    const child = Bun.spawn(
      [
        process.execPath,
        `--env-file=${lycorisDirectory}/scripts/.env.local`,
        `${import.meta.dir}/faucet.ts`,
        payer,
        "usdc",
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    const [output, , exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (exitCode !== 0) {
      entry.status = "unavailable";
      await persist();
      throw new PublicError(
        "USDC faucet unavailable. Retry later using the documented faucet command.",
      );
    }
    const result = JSON.parse(output);
    entry.hash = result.transactionHash;
    entry.status = "submitted";
    await persist();
    return { hash: entry.hash };
  }
  if (path === "/api/prepare") {
    requireCondition(
      (await client.getBalance({ address: payer })) === 0n,
      "This experiment requires exactly zero payer ETH.",
    );
    requireCondition(
      (await balance(payer)) >= gross,
      "Request test USDC and wait for it to arrive first.",
    );
    requireCondition(
      !(await client.getCode({ address: payer })),
      "This spike supports an ordinary wallet account, not a smart account.",
    );
    requireCondition(
      state.payments.filter((p: Payment) => p.hash).length < 3,
      "The three-payment experiment budget is exhausted.",
    );
    let p = state.payments.find(
      (p: Payment) =>
        p.payer.toLowerCase() === payer.toLowerCase() &&
        ["prepared", "broadcast", "included", "reverted"].includes(p.status),
    );
    const now = (await client.getBlock()).timestamp;
    if (p && p.status === "prepared" && BigInt(p.validBefore) <= now) {
      p.status = "expired_unused";
      p = undefined;
    }
    if (p?.hash)
      throw new PublicError("A submitted payment already exists. Check its status first.");
    if (!p) {
      const salt = `0x${randomBytes(32).toString("hex")}` as Hex;
      p = {
        id: crypto.randomUUID(),
        payer,
        status: "prepared",
        salt,
        nonce: keccak256(
          encodeAbiParameters(
            [{ type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "bytes32" }],
            [config.treasury, principal, fee, salt],
          ),
        ),
        validBefore: (now + 900n).toString(),
      };
      state.payments.push(p);
      await persist();
    }
    return {
      ...publicPayment(p),
      typedData: JSON.parse(
        JSON.stringify(
          {
            ...typed(p),
            types: {
              EIP712Domain: [
                { name: "name", type: "string" },
                { name: "version", type: "string" },
                { name: "chainId", type: "uint256" },
                { name: "verifyingContract", type: "address" },
              ],
              ...receiveTypes,
            },
          },
          (_, v) => (typeof v === "bigint" ? v.toString() : v),
        ),
      ),
    };
  }
  const p = state.payments.find((p: Payment) => p.id === body.id);
  requireCondition(p, "Unknown payment.");
  if (path === "/api/submit") {
    if (p.hash) return inspect(p);
    requireCondition(p.status === "prepared", "Prepare a new unused quote.");
    requireCondition(
      typeof body.signature === "string" && /^0x[0-9a-fA-F]{130}$/.test(body.signature),
      "Invalid signature format.",
    );
    requireCondition(
      await verifyTypedData({ ...typed(p), address: p.payer, signature: body.signature as Hex }),
      "Signature does not match this payment.",
    );
    requireCondition(
      (await client.getBlock()).timestamp < BigInt(p.validBefore),
      "Authorization expired; prepare again.",
    );
    requireCondition(
      (await client.getBalance({ address: p.payer })) === 0n,
      "Payer ETH must remain zero.",
    );
    requireCondition(
      state.payments.filter((p: Payment) => p.hash).length < 3,
      "Experiment budget exhausted.",
    );
    requireCondition(
      keccak256((await client.getCode({ address: config.contract })) ?? "0x") === config.codeHash,
      "Contract code mismatch.",
    );
    p.signature = body.signature as Hex;
    await client.simulateContract(request(p));
    const data = encodeFunctionData(request(p));
    const gas = await client.estimateGas({ account: operator, to: config.contract, data });
    requireCondition(gas <= 500_000n, "Transaction exceeds experiment gas limit.");
    const feeEstimate = await fees();
    requireCondition(
      (await client.getBalance({ address: operator.address })) >=
        gas * feeEstimate.maxFeePerGas + 1_000_000_000_000n,
      "Operator needs more test ETH.",
    );
    const nonce = await client.getTransactionCount({
      address: operator.address,
      blockTag: "pending",
    });
    const raw = await operator.signTransaction({
      chainId: chain.id,
      type: "eip1559",
      to: config.contract,
      data,
      gas,
      nonce,
      ...feeEstimate,
    });
    p.raw = raw;
    p.hash = keccak256(raw);
    p.status = "broadcast";
    p.ethBefore = "0";
    await persist();
    await client.sendRawTransaction({ serializedTransaction: raw }).catch(() => undefined);
    return publicPayment(p);
  }
  if (path === "/api/replay") {
    await inspect(p);
    requireCondition(p.status === "verified", "Wait for independent safe verification first.");
    requireCondition(await used(p), "Authorization is not consumed.");
    let rejected = false;
    try {
      await client.simulateContract(request(p));
    } catch (error) {
      if (error instanceof BaseError) {
        const cause = error.walk((e) => e instanceof ContractFunctionRevertedError);
        rejected =
          cause instanceof ContractFunctionRevertedError &&
          cause.data?.errorName === "Error" &&
          String(cause.data.args?.[0]).toLowerCase().includes("authorization");
      }
    }
    requireCondition(rejected, "Replay rejection was not independently established.");
    p.replayRejected = true;
    await persist();
    return publicPayment(p);
  }
  throw new PublicError("Unknown action.");
}
const headers = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'",
};
const json = (value: unknown, status = 200) => Response.json(value, { status, headers });
Bun.serve({
  hostname: "127.0.0.1",
  port,
  idleTimeout: 60,
  maxRequestBodySize: 4096,
  async fetch(req) {
    const url = new URL(req.url);
    const host = req.headers.get("host");
    if (![`localhost:${port}`, `127.0.0.1:${port}`].includes(host ?? ""))
      return json({ error: "Local access only" }, 403);
    if (req.method === "GET") {
      if (url.pathname === "/")
        return new Response(
          (await Bun.file(`${import.meta.dir}/index.html`).text()).replace("__CSRF__", csrf),
          { headers: { ...headers, "Content-Type": "text/html" } },
        );
      if (url.pathname === "/client.js" || url.pathname === "/style.css")
        return new Response(Bun.file(`${import.meta.dir}${url.pathname}`), {
          headers: {
            ...headers,
            "Content-Type": url.pathname.endsWith(".js") ? "text/javascript" : "text/css",
          },
        });
      if (url.pathname === "/api/config")
        return json({
          ...config,
          principal: principal.toString(),
          fee: fee.toString(),
          gross: gross.toString(),
        });
      return json({ error: "Not found" }, 404);
    }
    if (
      req.method !== "POST" ||
      req.headers.get("origin") !== `http://${host}` ||
      req.headers.get("x-spike-token") !== csrf ||
      req.headers.get("content-type") !== "application/json"
    )
      return json({ error: "Local page authorization required" }, 403);
    const run = busy.then(async () => {
      try {
        return json(await api(url.pathname, await req.json()));
      } catch (e) {
        return json(
          {
            error:
              e instanceof PublicError
                ? e.message
                : "RPC or transaction check failed. No automatic second payment was submitted; check the original payment status.",
          },
          400,
        );
      }
    });
    busy = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  },
});
console.log(`Browser spike ready: http://localhost:${port} (Base Sepolia only)`);
