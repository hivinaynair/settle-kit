# T4 · Receipt verifier (server)

**Read first:** design doc §6 (Settlement verification), spikes S3. **Depends on:** T1.
**Time box:** ~1.5 hours. **Branch:** `vinay/t4-verify-payment`.
**Done when:** the acceptance tests pass with `bun test` and lint/types are clean.

---

## Goal

Relay saying "filled" is a claim. Before an order counts as paid, we read the Base
transaction ourselves and check the money really arrived: right token, right wallet,
exact amount, and deep enough in the chain that it won't be undone. This is the only
thing that authorizes a settlement (AGENTS.md money rules).

One pure-ish function: it reads the chain through a client passed in, and has no
database or Relay access.

---

## Files

| File | What |
|---|---|
| `packages/server/src/verify.ts` | `verifyPayment`, `Verification`, `ReceiptClient` |
| `packages/server/src/verify.test.ts` | Acceptance tests with a fake client |
| `packages/server/test/fixtures/base/*.json` | Recorded raw receipts (RPC JSON, hex quantities) |
| `packages/server/src/index.ts` | Re-export |

No new dependencies: viem has everything (`parseEventLogs`, `erc20Abi`,
`isAddressEqual`, `formatTransactionReceipt`).

---

## API

```ts
/** The two RPC reads we need. A viem PublicClient satisfies it; tests pass a fake. */
export type ReceiptClient = Pick<PublicClient, "getTransactionReceipt" | "getBlock">;

export type Verification =
  | { status: "verified"; receivedAmount: bigint; logIndex: number; blockNumber: bigint }
  | { status: "pending"; reason: "not_found" | "not_safe" }
  | { status: "rejected"; reason: "reverted" | "no_transfer" | "multiple_transfers" | "wrong_amount" };

export function verifyPayment(input: {
  client: ReceiptClient;   // Base mainnet
  txHash: Hex;             // fill.destination.txHash
  token: Address;          // USDC on Base, from the route manifest
  recipient: Address;      // the merchant's treasury, from config
  amount: bigint;          // the order amount, base units
}): Promise<Verification>;
```

### Rules, in order

1. Receipt not found (`TransactionReceiptNotFoundError`) → `pending / not_found`.
   Any other RPC error is thrown: the workflow step retries it.
2. `receipt.status !== "success"` → `rejected / reverted`.
3. Read `getBlock({ blockTag: "safe" })`. `receipt.blockNumber > safe.number` →
   `pending / not_safe`. (S3: `safe` is ~17 blocks, ~30 s behind the head on Base.)
4. Decode `Transfer` logs with `parseEventLogs({ abi: erc20Abi, eventName: "Transfer" })`,
   keep those whose log `address` is `token` and whose `to` is `recipient`
   (`isAddressEqual`, so case doesn't matter). Transfers to other wallets in the same
   transaction (Relay's internal hops) are ignored.
5. None → `rejected / no_transfer`. More than one → `rejected / multiple_transfers`.
6. Exactly one: `value !== amount` → `rejected / wrong_amount`; else `verified` with its
   `value`, `logIndex` and the receipt's `blockNumber`.

`pending` means "ask again later"; `rejected` means "a human must look"
(`needs_attention` in T5). Nothing here throws for a payment problem.

The caller (T5) also checks `fill.destination.chainId === 8453` before calling; this
function trusts that the client is Base mainnet.

---

## Fixtures

Record one real receipt of a Relay fill delivering USDC on Base (any public one: pick a
recent successful request from `GET /requests/v3` without a deposit address filter, or
reuse the S3 sample). Save the raw `eth_getTransactionReceipt` JSON so quantities stay
as hex; the fake client turns it into a viem receipt with `formatTransactionReceipt`.
Derive the other cases from it in the test (flip `status`, drop or duplicate the log,
change `to` or `value`) rather than recording more.

---

## Acceptance tests

1. The recorded fill, with `recipient` and `amount` taken from its Transfer log →
   `verified` with the right `receivedAmount`, `logIndex`, `blockNumber`.
2. Receipt not found → `pending / not_found`. Receipt block above `safe` → `pending /
   not_safe`; equal to `safe` → `verified`.
3. Reverted receipt → `rejected / reverted`.
4. Transfer to another address only → `no_transfer`. Same amount but a different token
   contract → `no_transfer`.
5. Two matching Transfers → `multiple_transfers`.
6. Amount one base unit off, in either direction → `wrong_amount`.
7. Recipient given in a different letter case → still `verified`.
8. An RPC error other than not-found is thrown, not turned into a verdict.

---

## Out of scope

Refund verification (later, design §6 "Refund handling"), native ETH, other destination
chains, choosing the RPC endpoint (T5 config).

## Questions to answer in the PR description

- Why `safe` and not a confirmation count or `finalized`?
- Why ignore Transfers to other addresses instead of rejecting them?
- What does the workflow do with `pending` vs `rejected`?
