// Reuses Lycoris's installed CDP SDK and env file; no credentials are copied.
import { createRequire } from "node:module";
import { isAddress } from "viem";
import { z } from "zod";
import { lycorisDirectory } from "./shared";

const [address, token] = Bun.argv.slice(2);
if (!address || !isAddress(address) || !["eth", "usdc"].includes(token ?? "")) {
  console.error("Usage: faucet.ts <public address> <eth|usdc>");
  process.exit(1);
}
try {
  const env = z
    .object({
      CDP_API_KEY_ID: z.string().min(1),
      CDP_API_KEY_SECRET: z.string().min(1),
      CDP_WALLET_SECRET: z.string().optional(),
    })
    .parse(process.env);
  const require = createRequire(`${lycorisDirectory}/package.json`);
  const { CdpClient } = await import(require.resolve("@coinbase/cdp-sdk"));
  const cdp = new CdpClient({
    apiKeyId: env.CDP_API_KEY_ID,
    apiKeySecret: env.CDP_API_KEY_SECRET,
    walletSecret: env.CDP_WALLET_SECRET,
  });
  const { transactionHash } = await cdp.evm.requestFaucet({
    address,
    network: "base-sepolia",
    token,
  });
  console.log(JSON.stringify({ transactionHash, address, token, chainId: 84532 }));
} catch {
  console.error(
    "Faucet unavailable. Check local CDP configuration or faucet allowance. No credentials logged.",
  );
  process.exit(1);
}
