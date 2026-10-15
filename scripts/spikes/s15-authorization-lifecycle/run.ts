// Local forks only. No user keys, provider credentials, or remote transactions.
// Run: bun scripts/spikes/s15-authorization-lifecycle/run.ts
import assert from "node:assert/strict";
import { createServer } from "node:net";
import {
  type Address,
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createTestClient,
  createWalletClient,
  decodeEventLog,
  encodeAbiParameters,
  erc20Abi,
  type Hex,
  http,
  keccak256,
  parseAbi,
  parseSignature,
  toHex,
  zeroAddress,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrumSepolia, baseSepolia } from "viem/chains";

const root = import.meta.dir;
const contractRoot = `${root}/../s14-gas-payment`;
const build = Bun.spawnSync(["forge", "build", "--root", contractRoot], {
  stdout: "inherit",
  stderr: "inherit",
});
assert.equal(build.exitCode, 0);
const artifact = await Bun.file(
  `${contractRoot}/out/AuthorizationDeposit.sol/AuthorizationDeposit.json`,
).json();
const tokenAbi = parseAbi([
  "function masterMinter() view returns (address)",
  "function configureMinter(address,uint256) returns (bool)",
  "function mint(address,uint256) returns (bool)",
  "function name() view returns (string)",
  "function version() view returns (string)",
  "function nonces(address) view returns (uint256)",
  "function authorizationState(address,bytes32) view returns (bool)",
  "function cancelAuthorization(address,bytes32,uint8,bytes32,bytes32)",
  "event AuthorizationCanceled(address indexed authorizer, bytes32 indexed nonce)",
  "function receiveWithAuthorization(address,address,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32)",
]);
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
// Public deterministic experiment keys: never fund these on a real chain.
const relayer = privateKeyToAccount(toHex(10001n, { size: 32 }));
const alice = privateKeyToAccount(toHex(10002n, { size: 32 }));
const bob = privateKeyToAccount(toHex(10003n, { size: 32 }));
const destination = privateKeyToAccount(toHex(10004n, { size: 32 })).address;
const feeRecipient = privateKeyToAccount(toHex(10005n, { size: 32 })).address;
const results: unknown[] = [];
const isContractRevert = (error: unknown) => {
  if (!(error instanceof BaseError)) return false;
  const cause = error.walk((item) => item instanceof ContractFunctionRevertedError);
  // Anvil can wrap fork RPC errors as a contract error without EVM revert bytes.
  return cause instanceof ContractFunctionRevertedError && cause.data !== undefined;
};

for (const config of [
  {
    chain: baseSepolia,
    rpc: "https://sepolia.base.org",
    block: 48143481n,
    token: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as Address,
  },
  {
    chain: arbitrumSepolia,
    rpc: "https://sepolia-rollup.arbitrum.io/rpc",
    block: 319387788n,
    token: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d" as Address,
  },
]) {
  console.log(`Testing ${config.chain.name} fork at ${config.block}`);
  const port = 18546;
  // Refuse to connect to a pre-existing node on our chosen local port.
  await new Promise<void>((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(port, "127.0.0.1", () =>
      probe.close((error) => (error ? reject(error) : resolve())),
    );
  });
  const process = Bun.spawn(
    [
      "anvil",
      "--host",
      "127.0.0.1",
      "--port",
      `${port}`,
      "--fork-url",
      config.rpc,
      "--fork-block-number",
      `${config.block}`,
      "--chain-id",
      `${config.chain.id}`,
      "--hardfork",
      "prague",
      "--silent",
    ],
    { stdout: "ignore", stderr: "pipe" },
  );
  const transport = http(`http://127.0.0.1:${port}`, { retryCount: 0, timeout: 15000 });
  const client = createPublicClient({ chain: config.chain, transport });
  const test = createTestClient({ chain: config.chain, transport, mode: "anvil" });
  const wallet = createWalletClient({ chain: config.chain, transport, account: relayer });
  const balance = (address: Address) =>
    client.readContract({
      address: config.token,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [address],
    });
  // Anvil mines on demand: poll receipts directly rather than waiting for new blocks.
  const waitReceipt = async (hash: Hex) => {
    for (let attempt = 0; attempt < 150; attempt++) {
      const r = await client.getTransactionReceipt({ hash }).catch(() => undefined);
      if (r) return r;
      await Bun.sleep(200);
    }
    throw new Error(`Local fork receipt timed out: ${hash}`);
  };
  const receipt = async (hash: Hex) => {
    const r = await waitReceipt(hash);
    assert.equal(r.status, "success");
    return r;
  };
  const checks: string[] = [];
  const check = (label: string) => {
    checks.push(label);
    console.log(`  PASS ${label}`);
  };
  try {
    let ready = false;
    for (let n = 0; n < 100; n++) {
      if (process.exitCode !== null) throw new Error(await new Response(process.stderr).text());
      try {
        await client.getChainId();
        ready = true;
        break;
      } catch {
        await Bun.sleep(200);
      }
    }
    assert(ready, "fork did not start");
    assert.equal(await client.getChainId(), config.chain.id);
    assert.equal(await client.getBlockNumber(), config.block);
    await test.setBalance({ address: relayer.address, value: 10n ** 20n });
    // Mint only on localhost by impersonating the real token's master minter.
    const master = await client.readContract({
      address: config.token,
      abi: tokenAbi,
      functionName: "masterMinter",
    });
    await test.impersonateAccount({ address: master });
    await test.setBalance({ address: master, value: 10n ** 18n });
    await receipt(
      await wallet.writeContract({
        account: master,
        address: config.token,
        abi: tokenAbi,
        functionName: "configureMinter",
        args: [relayer.address, 100_000_000n],
      }),
    );
    await test.stopImpersonatingAccount({ address: master });
    for (const payer of [alice, bob]) {
      await receipt(
        await wallet.writeContract({
          address: config.token,
          abi: tokenAbi,
          functionName: "mint",
          args: [payer.address, 20_000_000n],
        }),
      );
      assert.equal(await client.getBalance({ address: payer.address }), 0n);
    }
    const deployed = await receipt(
      await wallet.deployContract({
        abi: artifact.abi,
        bytecode: artifact.bytecode.object,
        args: [config.token, feeRecipient],
      }),
    );
    const router = deployed.contractAddress;
    assert(router);
    const domain = {
      name: await client.readContract({
        address: config.token,
        abi: tokenAbi,
        functionName: "name",
      }),
      version: await client.readContract({
        address: config.token,
        abi: tokenAbi,
        functionName: "version",
      }),
      chainId: config.chain.id,
      verifyingContract: config.token,
    };
    const now = (await client.getBlock()).timestamp;
    let salt = 0n;
    async function authorization(
      to = destination,
      validBefore = now + 3600n,
      chainId: number = config.chain.id,
    ) {
      const random = toHex(++salt, { size: 32 });
      const nonce = keccak256(
        encodeAbiParameters(
          [{ type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "bytes32" }],
          [to, 10_000_000n, 200_000n, random],
        ),
      );
      const signature = parseSignature(
        await alice.signTypedData({
          domain: { ...domain, chainId },
          types: receiveTypes,
          primaryType: "ReceiveWithAuthorization",
          message: {
            from: alice.address,
            to: router as Address,
            value: 10_200_000n,
            validAfter: 0n,
            validBefore,
            nonce,
          },
        }),
      );
      const args = [
        alice.address,
        to,
        10_000_000n,
        200_000n,
        random,
        0n,
        validBefore,
        Number(signature.v),
        signature.r,
        signature.s,
      ];
      return { args, nonce, signature, validBefore };
    }
    const auth = await authorization();
    const request = (args: unknown[]) =>
      ({ address: router, abi: artifact.abi, functionName: "deposit", args }) as const;
    const expectRevert = async (label: string, args: unknown[]) => {
      await assert.rejects(
        client.simulateContract({ ...request(args), account: relayer.address }),
        isContractRevert,
      );
      check(label);
    };
    await expectRevert(
      "changed fee split rejected",
      auth.args.map((v, i) => (i === 2 ? 9_900_000n : i === 3 ? 300_000n : v)),
    );
    await expectRevert(
      "changed recipient rejected",
      auth.args.map((v, i) => (i === 1 ? feeRecipient : v)),
    );
    await expectRevert(
      "expired authorization rejected",
      (await authorization(destination, now - 1n)).args,
    );
    await expectRevert(
      "wrong chain rejected",
      (await authorization(destination, now + 3600n, 1)).args,
    );
    await assert.rejects(
      client.simulateContract({
        account: relayer.address,
        address: config.token,
        abi: tokenAbi,
        functionName: "receiveWithAuthorization",
        args: [
          alice.address,
          router,
          10_200_000n,
          0n,
          auth.validBefore,
          auth.nonce,
          Number(auth.signature.v),
          auth.signature.r,
          auth.signature.s,
        ],
      }),
      isContractRevert,
    );
    check("direct signature consumption outside router rejected");
    const invalid = await authorization(zeroAddress);
    const aliceBefore = await balance(alice.address);
    const failedHash = await wallet.writeContract({ ...request(invalid.args), gas: 500_000n });
    const failedReceipt = await waitReceipt(failedHash);
    assert.equal(failedReceipt.status, "reverted");
    assert.equal(await balance(alice.address), aliceBefore);
    assert.equal(await balance(feeRecipient), 0n);
    assert.equal(
      await client.readContract({
        address: config.token,
        abi: tokenAbi,
        functionName: "authorizationState",
        args: [alice.address, invalid.nonce],
      }),
      false,
    );
    check("failed transfer rolls back debit, fee and authorization; relayer burns gas");
    await receipt(await wallet.writeContract(request(auth.args)));
    assert.equal(await balance(destination), 10_000_000n);
    assert.equal(await balance(feeRecipient), 200_000n);
    assert.equal(await balance(alice.address), 9_800_000n);
    assert.equal(await balance(router), 0n);
    assert.equal(await client.getBalance({ address: alice.address }), 0n);
    assert.equal(await client.getCode({ address: alice.address }), undefined);
    check("zero-ETH EOA pays 10.20: destination gets 10, fee recipient gets 0.20");
    await expectRevert("authorization replay rejected", auth.args);
    assert.equal(
      await client.readContract({
        address: config.token,
        abi: tokenAbi,
        functionName: "authorizationState",
        args: [alice.address, auth.nonce],
      }),
      true,
    );
    check("authorization consumption observable for reconciliation; not credit proof");
    await expectRevert("insufficient payer USDC rejected", (await authorization()).args);

    // A reverted transaction does not invalidate an otherwise valid signature.
    const retryable = await authorization();
    const beforeRetry = await balance(alice.address);
    const rejected = await waitReceipt(
      await wallet.writeContract({
        ...request(retryable.args),
        gas: 500_000n,
      }),
    );
    assert.equal(rejected.status, "reverted");
    assert.equal(await balance(alice.address), beforeRetry);
    const used = (nonce: Hex) =>
      client.readContract({
        address: config.token,
        abi: tokenAbi,
        functionName: "authorizationState",
        args: [alice.address, nonce],
      });
    assert.equal(await used(retryable.nonce), false);
    await receipt(
      await wallet.writeContract({
        address: config.token,
        abi: tokenAbi,
        functionName: "mint",
        args: [alice.address, 30_000_000n],
      }),
    );
    const beforeSuccessfulRetry = await balance(alice.address);
    await receipt(await wallet.writeContract(request(retryable.args)));
    assert.equal(beforeSuccessfulRetry - (await balance(alice.address)), 10_200_000n);
    assert.equal(await used(retryable.nonce), true);
    check("same authorization executes after a reverted attempt once payer balance is restored");

    // Cancellation consumes the nonce without transferring funds.
    const cancelled = await authorization();
    const cancellationSignature = parseSignature(
      await alice.signTypedData({
        domain,
        primaryType: "CancelAuthorization",
        types: {
          CancelAuthorization: [
            { name: "authorizer", type: "address" },
            { name: "nonce", type: "bytes32" },
          ],
        },
        message: { authorizer: alice.address, nonce: cancelled.nonce },
      }),
    );
    const beforeCancellation = await balance(alice.address);
    const destinationBeforeCancellation = await balance(destination);
    const cancelReceipt = await receipt(
      await wallet.writeContract({
        address: config.token,
        abi: tokenAbi,
        functionName: "cancelAuthorization",
        args: [
          alice.address,
          cancelled.nonce,
          Number(cancellationSignature.v),
          cancellationSignature.r,
          cancellationSignature.s,
        ],
      }),
    );
    assert.equal(await used(cancelled.nonce), true);
    assert.equal(await balance(alice.address), beforeCancellation);
    assert.equal(await balance(destination), destinationBeforeCancellation);
    const cancelledEvent = cancelReceipt.logs
      .flatMap((log) => {
        try {
          return [decodeEventLog({ abi: tokenAbi, ...log })];
        } catch {
          return [];
        }
      })
      .find((event) => event.eventName === "AuthorizationCanceled");
    assert(cancelledEvent && cancelledEvent.eventName === "AuthorizationCanceled");
    assert.equal(cancelledEvent.args.nonce, cancelled.nonce);
    check("cancellation consumes authorization nonce without payer debit or destination credit");
    await expectRevert("cancelled authorization cannot execute", cancelled.args);

    // A signature valid when prepared becomes unusable at its chain deadline.
    const expires = (await client.getBlock()).timestamp + 60n;
    const expiring = await authorization(destination, expires);
    await client.simulateContract({ ...request(expiring.args), account: relayer.address });
    await test.setNextBlockTimestamp({ timestamp: expires });
    await test.mine({ blocks: 1 });
    await expectRevert("previously valid signature is rejected at validBefore", expiring.args);
    assert.equal(await used(expiring.nonce), false);
    assert.equal(await balance(alice.address), beforeCancellation);
    assert.equal(await client.getBalance({ address: alice.address }), 0n);
    check("expired unused authorization remains unconsumed and payer retains USDC and zero ETH");

    results.push({
      chain: config.chain.name,
      chainId: config.chain.id,
      forkBlock: config.block,
      checksPassed: checks.length,
      checks,
      lifecycleEvidence: {
        revertedAttemptHash: rejected.transactionHash,
        cancellationHash: cancelReceipt.transactionHash,
        executionDeadline: expires,
        observedForkTimestamp: (await client.getBlock()).timestamp,
      },
    });
  } finally {
    process.kill();
    await process.exited;
  }
}
await Bun.write(
  `${root}/results.json`,
  `${JSON.stringify(
    {
      evidence:
        "LOCAL FORKS ONLY; deterministic public keys and simulated funding. Tests token authorization semantics, not source-safe scan completeness, real chain finality, browser wallets, CCTP or SDK recovery.",
      results,
    },
    (_, value) => (typeof value === "bigint" ? value.toString() : value),
    2,
  )}\n`,
);
console.log("Saved authorization lifecycle fork results.");
