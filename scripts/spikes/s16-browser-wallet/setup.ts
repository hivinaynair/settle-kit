import { encodeDeployData, keccak256 } from "viem";
import { accounts, artifact, assertChain, chain, client, fees, load, save, usdc } from "./shared";

try {
  await assertChain();
  const { operator, treasury } = await accounts();
  const build = Bun.spawnSync(
    ["forge", "build", "--root", `${import.meta.dir}/../s14-gas-payment`],
    { stdout: "ignore", stderr: "ignore" },
  );
  if (build.exitCode !== 0) throw Error("Contract build failed");
  const contract = await artifact();
  let pending = await load("deployment.json");
  if (!pending) {
    const data = encodeDeployData({
      abi: contract.abi,
      bytecode: contract.bytecode.object,
      args: [usdc, operator.address],
    });
    const gas = await client.estimateGas({ account: operator, data });
    if (gas > 1_000_000n) throw Error("Deployment gas ceiling");
    const fee = await fees();
    if (
      (await client.getBalance({ address: operator.address })) <
      gas * fee.maxFeePerGas + 1_000_000_000_000n
    )
      throw Error("Operator needs faucet ETH");
    const nonce = await client.getTransactionCount({
      address: operator.address,
      blockTag: "pending",
    });
    const raw = await operator.signTransaction({
      chainId: chain.id,
      type: "eip1559",
      data,
      gas,
      nonce,
      ...fee,
    });
    pending = { hash: keccak256(raw), raw, operator: operator.address, treasury: treasury.address };
    await save("deployment.json", pending);
    await client.sendRawTransaction({ serializedTransaction: raw });
  }
  let receipt = await client.getTransactionReceipt({ hash: pending.hash }).catch(() => undefined);
  if (!receipt) {
    await client.sendRawTransaction({ serializedTransaction: pending.raw }).catch(() => undefined);
    receipt = await client.waitForTransactionReceipt({ hash: pending.hash, timeout: 90000 });
  }
  if (receipt.status !== "success" || !receipt.contractAddress)
    throw Error("Deployment unsuccessful");
  const code = await client.getCode({ address: receipt.contractAddress });
  if (!code) throw Error("Missing contract");
  const config = {
    chainId: 84532,
    usdc,
    operator: operator.address,
    treasury: treasury.address,
    contract: receipt.contractAddress,
    codeHash: keccak256(code),
    deploymentHash: pending.hash,
  };
  await save("config.json", config);
  console.log(JSON.stringify(config, null, 2));
} catch {
  console.error(
    "Setup stopped. Check operator test ETH, RPC availability and saved deployment state; no new deployment is created after an uncertain broadcast.",
  );
  process.exitCode = 1;
}
