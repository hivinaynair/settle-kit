# S14: Pay with USDC when the payer has no ETH

**Recommendation: use ERC-3009 signed USDC authorization plus the host's relayer
for Settle Kit's first gasless connected-wallet path. Keep ERC-4337 as a separate
learning experiment, not a required account model for the SDK.**

Both mechanisms worked against deployed contracts on local forks. The choice is
about the wallet audience and operating responsibilities, not whether a paymaster
can technically work. “Relayer” here means the host's transaction-submitting
service, not Relay Protocol. This report recommends a direction; it does not amend
the product decisions or implement the feature.

## What actually ran

Run from the repository root:

```sh
bun scripts/spikes/s14-gas-payment/run.ts
```

Requires installed workspace dependencies, Bun, Forge and Anvil. The runner builds
the small experimental adapter, starts a localhost-only Anvil fork for each chain,
executes the checks, stops its processes and writes `results.json`. Public RPCs
must retain the pinned state. No account keys, API keys or faucet are required.

- Base Sepolia, chain 84532, block **48,143,481**.
- Arbitrum Sepolia, chain 421614, block **319,373,016**.
- Native test USDC, Circle Paymaster v0.8, EntryPoint v0.8 and Viem's deployed
  Simple7702 implementation, using the addresses in `results.json`.
- Local-only impersonation of each USDC master minter to seed payer balances.
  Only the local relayer/bundler receives ETH. Both payers start and finish with
  **zero ETH**.
- Real EIP-712 signatures and EIP-7702 authorization signatures from deterministic
  experiment keys. These publicly known test accounts must never receive real funds.

**Evidence boundary:** these are executable fork tests, not live testnet transfers.
The runner submits `handleOps` directly as a local bundler, so it does not test a
public bundler's admission rules, estimation or availability. Anvil executes an
Ethereum EVM, not the complete Base/Arbitrum sequencer and L1 fee machinery. No
browser extension, mobile wallet, CCTP burn/mint, finality wait, database crash or
webhook was tested. The adapter is deliberately isolated from product packages.

## Results

All **14 named checks passed on each chain**, with assertions on balances,
authorization consumption, contract reverts and UserOperation events. RPC failures
are not accepted as successful rejection tests.

| Experiment | Observed result on both forks |
|---|---|
| Ordinary EOA signs a 10.20-USDC authorization | Destination receives 10 USDC; fixed fee recipient receives 0.20; no ETH or prior allowance needed from payer; payer remains an EOA |
| Relayer changes destination or changes 10 + 0.20 into 9.90 + 0.30 | Rejected: the signature's nonce commits to destination and split |
| Expired signature, wrong chain, insufficient USDC, duplicate authorization | Rejected |
| Outsider calls USDC directly to consume the receive authorization | Rejected: only the authorized recipient contract can receive it |
| Recipient transfer reverts after pulling the USDC | Whole transaction reverts: payer debit, fee and authorization consumption all roll back; relayer still spends ETH gas |
| Re-read used authorization | Consumed state is visible; useful for recovery, but by itself is not evidence to credit an account |
| EOA authorizes 7702 upgrade, USDC permit and UserOperation | Same address pays 10 USDC plus Circle's calculated gas charge, without prior allowance or ETH; delegation code remains installed |
| Repeat the UserOperation | Rejected |
| Permit/fee cap too small for paymaster prefund | Rejected during validation |
| Payment inside UserOperation fails | Outer transaction succeeds, UserOperation reports failure, no payment reaches destination, payer still loses USDC for gas |

The authorization call used roughly 142k EVM gas; the successful first-use 7702
bundle roughly 238k. **This is not an apples-to-apples price comparison:** the first
includes a principal/fee split, the second includes first-use delegation and
paymaster processing, and L2-specific costs are not faithfully represented.
The fixed 0.20 fee is a test input, not a recommended price. Raw paymaster charges
are saved only as local observations, not usable production quotes.

### Recheck after the scope review

The rejection predicate now requires decoded EVM revert data, so a fork RPC failure
wrapped as a contract exception cannot pass a rejection check. The rerun passed all
14 Base checks and the ten Arbitrum authorization checks, then stopped while reading
EntryPoint state because the public RPC no longer served the pinned historical slot.
The original saved results remain historical evidence; the paymaster path was not
fully revalidated in this rerun. S15 uses a newer pinned Arbitrum block and passed all
15 authorization/lifecycle checks on each chain. The paymaster remains out of scope.

## Why authorization fits this project better

| Consideration | USDC authorization + host relayer | Circle USDC paymaster |
|---|---|---|
| Payer already holds USDC in an ordinary wallet | Signs typed payment authorization; no account upgrade | Needs a compatible smart account or wallet-supported 7702 upgrade; making a new smart account does not move existing EOA funds into it |
| What we operate | ETH-funded relayer, fee policy, simulation, nonce and broadcast recovery | Bundler integration and account-specific flow; Circle manages paymaster ETH liquidity |
| Consent in this prototype | One typed signature; fee/destination split is committed in an opaque nonce, so the app must explain it clearly | Three signatures on first use: delegation, bounded USDC permit, UserOperation; actual wallet prompts depend on integration |
| Failure policy | Adapter collects no USDC fee when its call reverts; host absorbs that gas | Observed USDC gas charge even for failed execution |
| Scope | One asset and one payment operation | General smart-account transactions and batching |
| Money held by host | ETH for gas; adapter forwards principal and fee atomically | No app ETH float needed for this payment leg when using an external bundler; Circle receives gas reimbursement |

The host already needs the gas wallet and durable transaction handling in **D27,
D139**. Reusing those for an ordinary USDC payment fits the existing learning
goals. Signature binding, fee consent and replay recovery produce useful interview
evidence without making wallet provisioning another product.

Circle is the better choice if the application already uses supported smart
accounts, or if avoiding the incoming-payment relayer and its ETH/pricing work
outweighs broad ordinary-wallet support. Do not build a custom paymaster to learn
this: the working Circle path in this spike is already a concrete AA exercise.

## How to integrate the recommendation

1. **D10, D33, D39; J2/J3:** keep the issued address/QR route. Add authorization as
   a connected-wallet input into the same settlement pipeline. The experiment's
   generic splitter is not the production deposit contract. Prefer extending the
   existing contract with a receive-and-deposit entry point, preserving its fixed
   treasury, fee recipient and route rules (**I11, D135**). Do not silently use this
   arbitrary-destination adapter as the production implementation.
2. **D13/D39:** show principal, service/processing fee, total debit and quote expiry
   before signing. Bind the authorized destination and split so the relayer cannot
   change either. Do not call a flat 0.20-USDC service fee the measured network fee.
   The later D126 decision makes this one disclosed fee; no second manual sweep fee applies.
3. **D139, D23; I1:** store the authorization and its quote/operation identity
   before submission, plus signed transaction/hash/relayer nonce before broadcast.
   On timeout reconcile the original transaction and events; do not ask for a new
   authorization automatically. Nonce consumption can also mean cancellation;
   only the correct canonical transfer and existing safe-credit rules authorize
   credit (**D21, D124, D230**). This spike did not implement durable recovery.
4. **D27:** keep ETH reserves for the relayer and sweeper. USDC fees reimburse the
   host; they do not become ETH automatically. Validate quotes, simulate immediately
   before broadcast and cap per-account/global submission spend. Simulation cannot
   eliminate a payer spending the USDC before inclusion, so failed-gas loss remains.
5. **D13, D138; J4:** receiving 10 USDC on Arbitrum does not guarantee 10 USDC on
   Base. CCTP/forwarding and any later sweep charge remain separate. “Receive exactly
   10 credits” requires a complete route quote/budget and an explicit policy for
   shortfall; neither entry mechanism solves that. The spike does not test CCTP.

At the time of S14, the connected-wallet branch was a recommendation. The scope
review subsequently added J8 and decisions D111/D126–D128/D140–D142/D231. These
now specify consent, fixed fees, spending limits and recovery; they are not live
implementation evidence. The lifecycle follow-up is S15.

## Historical follow-up recommendations

The recommendations below were written after S14. [S16](../s16-browser-wallet/README.md)
subsequently proved the selected path in one live MetaMask session. Further wallet
and combined-route acceptance checks belong to implementation; the paymaster
alternative remains out of scope, not a scheduled follow-up.

Before making gasless payments a public claim, run the selected authorization path
through a real browser wallet on testnet, starting at zero ETH, then verify receipt
and final balance independently. Test the actual supported wallet list; passing a
private-key script does not prove extension UX. Contract accounts need separate
signature/transfer support, not an assumption that every wallet signs like an EOA.

For the paymaster alternative, repeat with the actual wallet connector and public
bundler, including zero-ETH first-use upgrade, rejected upgrade, fee cap and failed
payment. MetaMask's documented embedded/private-key `signAuthorization` route does
not work with JSON-RPC accounts; its browser upgrade is a separate wallet-managed
flow. Do not assume the Circle CLI-style example drops into `<Deposit>` unchanged.

Rough follow-on engineering estimate, not measured by the spike: **3–5 focused
days** for a bounded Base authorization demo with wallet UI and persisted recovery,
after the core deposit engine exists. Allow **another 2–4 days** for the Arbitrum
fee/settlement integration and failure cases. A provider-controlled smart-account
demo can be similarly small; broad external-wallet paymaster support remains
unestimated until the connector test passes. No audit or production readiness is
included in these estimates.

## Sources checked on 2026-10-15

- [ERC-3009](https://eips.ethereum.org/EIPS/eip-3009): signed transfers, expiry,
  random nonces and the receive function's caller restriction.
- [Circle Paymaster overview](https://developers.circle.com/paymaster): existing
  permissionless USDC paymaster, supported EntryPoint versions and chains, native
  liquidity management; currently a 10% surcharge on gas on Base/Arbitrum, not 10%
  of the payment amount.
- [Circle quickstart](https://developers.circle.com/paymaster/pay-gas-fees-usdc):
  permit format and EOA-to-7702 flow used in the fork experiment.
- [Circle deployments/events](https://developers.circle.com/paymaster/addresses-and-events):
  deployed paymaster addresses, prefund and refund lifecycle.
- [MetaMask EIP-7702 guide](https://docs.metamask.io/smart-accounts-kit/get-started/smart-account-quickstart/eip7702/)
  and [browser upgrade guide](https://docs.metamask.io/tutorials/upgrade-eoa-to-smart-account/):
  embedded-wallet signing and browser-managed upgrade are different integrations.
- Installed Viem **2.57.6**, `toSimple7702SmartAccount`: implementation address,
  EntryPoint v0.8 and UserOperation typed signing.

Code and raw observations: `src/AuthorizationDeposit.sol`, `run.ts`, `results.json`.
