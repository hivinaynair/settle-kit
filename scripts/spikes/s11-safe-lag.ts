// S11: how far does each chain's `safe` block trail `latest`?
// Run from the repo root (viem is already installed):
//   bun scripts/spikes/s11-safe-lag.ts   # samples every 30 s for 30 minutes
//   bun scripts/spikes/s11-safe-lag.ts 120 <arbitrum-rpc> <base-rpc>   # samples, RPC overrides
import { createPublicClient, http } from "viem";
import { arbitrum, base } from "viem/chains";

const [samplesArg, arbRpc, baseRpc] = Bun.argv.slice(2);
const chains = [
  { name: "arbitrum", chain: arbitrum, rpc: arbRpc ?? "https://arb1.arbitrum.io/rpc" },
  { name: "base", chain: base, rpc: baseRpc ?? "https://mainnet.base.org" },
];
const samples = Number(samplesArg ?? 60);
const everyMs = 30_000;

type Row = { chain: string; blocks: bigint; seconds: bigint };
const rows: Row[] = [];

for (let i = 0; i < samples; i++) {
  for (const c of chains) {
    const client = createPublicClient({ chain: c.chain, transport: http(c.rpc) });
    const [latest, safe] = await Promise.all([
      client.getBlock({ blockTag: "latest" }),
      client.getBlock({ blockTag: "safe" }),
    ]);
    const row = {
      chain: c.name,
      blocks: latest.number - safe.number,
      seconds: latest.timestamp - safe.timestamp,
    };
    rows.push(row);
    console.log(
      `${new Date().toISOString()} ${c.name}: safe trails latest by ${row.blocks} blocks, ${row.seconds} s`,
    );
  }
  if (i < samples - 1) await Bun.sleep(everyMs);
}

for (const c of chains) {
  const secs = rows
    .filter((r) => r.chain === c.name)
    .map((r) => Number(r.seconds))
    .sort((a, b) => a - b);
  const pick = (p: number) => secs[Math.min(secs.length - 1, Math.floor(p * secs.length))];
  console.log(
    `${c.name}: n=${secs.length} min=${secs[0]}s median=${pick(0.5)}s p90=${pick(0.9)}s max=${secs.at(-1)}s`,
  );
}
