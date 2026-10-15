import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { type Address, createPublicClient, http } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
export const directory = `${import.meta.dir}/.local`;
// Reuse the owner's existing faucet setup; a different checkout can be supplied explicitly.
export const lycorisDirectory = resolve(
  // biome-ignore lint/suspicious/noUndeclaredEnvVars: Standalone Bun spike, never a cached Turbo task.
  process.env.SETTLE_SPIKE_LYCORIS_DIR ?? `${import.meta.dir}/../../../../lycoris`,
);
export const usdc: Address = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
export const chain = baseSepolia;
export const client = createPublicClient({
  chain,
  transport: http("https://sepolia.base.org", { retryCount: 1, timeout: 15000 }),
});
export async function save(name: string, value: unknown) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const tmp = `${directory}/${name}.tmp`;
  await writeFile(
    tmp,
    JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2),
    { mode: 0o600 },
  );
  await rename(tmp, `${directory}/${name}`);
}
export async function load(name: string) {
  try {
    return JSON.parse(await readFile(`${directory}/${name}`, "utf8"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw e;
  }
}
export async function accounts() {
  let keys = await load("wallets.json");
  if (!keys) {
    keys = { operatorKey: generatePrivateKey(), treasuryKey: generatePrivateKey() };
    await save("wallets.json", keys);
  }
  return {
    operator: privateKeyToAccount(keys.operatorKey),
    treasury: privateKeyToAccount(keys.treasuryKey),
  };
}
export async function artifact() {
  return await Bun.file(
    `${import.meta.dir}/../s14-gas-payment/out/AuthorizationDeposit.sol/AuthorizationDeposit.json`,
  ).json();
}
export async function assertChain() {
  if ((await client.getChainId()) !== 84532) throw Error("Wrong RPC chain");
}
export async function fees() {
  const estimate = await client.estimateFeesPerGas();
  if (estimate.maxFeePerGas > 1_000_000_000n) throw Error("Fee ceiling exceeded");
  return estimate;
}
