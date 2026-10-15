# S15: When a signed payment can safely end without a debit

**15 checks passed on each local fork**, including the ten authorization checks
reused from S14 and five lifecycle checks added after the scope review. This is
local-fork evidence, not a browser payment or a live CCTP transfer.

```sh
bun scripts/spikes/s15-authorization-lifecycle/run.ts
```

Requires Bun, Forge, Anvil, workspace dependencies and public RPC access to the pinned
state. The runner builds S14's experimental adapter, starts only localhost Anvil on
port 18546, impersonates a token minter locally and uses public deterministic test
keys. It never submits transactions to the remote networks. Never fund these keys.

## Observed results

| Case | Result on both forks | Spec implication |
|---|---|---|
| Insufficient balance causes an actual source transaction to revert; balance is then replenished locally | The exact same authorization subsequently executes successfully | A failed transaction does not prove that the payment cannot execute later (D111) |
| Payer signs cancellation and the relayer submits it | Cancellation event emitted; authorizationState is true; payer and destination USDC balances do not change | A consumed nonce is not payment evidence (D21, D111) |
| Try executing the cancelled authorization | Decoded EVM revert | Distinguish cancellation evidence from an unknown outcome |
| Simulate a valid signature, then advance the fork to its validBefore timestamp | Execution is rejected at that timestamp | Acceptance before expiry cannot extend the token's execution window |
| Inspect the expired unused signature | Nonce remains unused, USDC stays with payer and payer ETH remains zero | An unexecutable unused authorization can have nonce-state false |

The retained S14 checks cover changed destination/split, wrong chain, already-expired
signature, direct signature consumption, atomic rollback, successful zero-ETH payment,
replay, nonce observation and insufficient funds. Rejection checks require decoded
EVM revert data; an RPC error wrapped as a contract exception is not a pass.

Pinned blocks in the successful run:

- Base Sepolia: **48,143,481**.
- Arbitrum Sepolia: **319,387,788**.

The first run passed Base but stopped on Arbitrum at the older S14 block 319,373,016
because the public RPC could not serve a required historical storage slot. We did
not count that as a rejection result. The complete rerun used the newer pinned
Arbitrum block above. Public RPC historical retention may affect reproducibility;
the runner fails rather than silently switching its pinned block.

Raw named results and local transaction identities: [results.json](results.json).
Fork transaction hashes are not public explorer evidence.

## What this does not validate

The adapter is S14's isolated receive-and-split experiment. This does not test the
production fixed-destination contract, quoted CCTP maxFee enforcement, gas budget
reservations, SDK retry policy, canonical source-safe scanning, reorgs, DBOS or
browser UX. In particular, the SDK still has to prove that no earlier execution
exists before it uses the terminal failed_no_debit rule.

Remaining gates and primary-source research are in [S15](../../../docs/spikes.md#s15--review-validation-and-remaining-proofs--2026-10-15).
