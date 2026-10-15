# S16: real browser wallet, zero payer ETH

Standalone Base Sepolia experiment for D50/D57 and J8. Uses S14's isolated
`AuthorizationDeposit` adapter, not the production SDK or deposit contract.

## Try it

Requires Bun, installed workspace dependencies and Forge. From the repository
root, complete the one-time setup below if `.local/config.json` does not exist:

```sh
bun scripts/spikes/s16-browser-wallet/server.ts
```

Open http://localhost:3004 in the browser containing your wallet extension.
Unlock your wallet yourself. Connect an ordinary wallet account with exactly zero
**Base Sepolia** ETH. Accept the network switch. Click **Get test USDC**, wait for
the faucet transfer, and refresh balances. Do not use an exchange on-ramp or send
ETH to this payer account.

Review and sign the **1.00 test-USDC** authorization. The operator submits the
transaction and pays ETH gas; the adapter sends 0.99 USDC to the treasury and 0.01
to the operator. This experimental amount does not implement production pricing
or the product deposit minimum. The page verifies receipt transfers, payer ETH,
canonical block hash and Base's `safe` block separately. The replay button makes
a read-only simulation, not another transaction.

Record the wallet name/version, signature display, payment hash, safe evidence,
replay result, cancellation and account/network-switch behavior. The successful
MetaMask run below establishes a real browser signature; cancellation and
account/network-switch cases remain untested.

## Live result on 2026-10-15

MetaMask in Chrome successfully authorized
[this payment](https://sepolia.basescan.org/tx/0x9b2a8e601638aa2031324dab2e25216b2028d61d1f63f0b1342dc015adac0cf3).
The operator submitted it in block 48146110; independent RPC checks confirmed
that block was canonical and safe when the safe head reached 48146148. Native
USDC transfers matched 1.00 from payer to adapter, 0.99 to treasury and 0.01 to
operator. Payer `0xbe9DfE65e820f2634b28Ddd7469416c13987DCa0` had zero ETH in the
preceding block and receipt block. Saved status is `verified`, with
`replayRejected: true`: the authorization was consumed and its exact replay
reverted in a read-only simulation. No second payment was broadcast.

Receipt execution gas cost was 826830000000 wei, excluding any separately
reported L1 data fee. Wallet version and signature-screen presentation were
not captured. This is one live wallet session, not a wallet compatibility matrix
or production readiness result.

## Prepared on 2026-10-15

- Chain: Base Sepolia, 84532.
- Native USDC: `0x036CbD53842c5426634e7929541eC2318f3dCF7e`.
- Operator: `0x14A4a770b2561E18d42Af50513b8e9C7ce88A01D`.
- Treasury: `0xfc0080eF85459bADE2133BE2F7cA5DCef73E1ABd`.
- Adapter: `0xa0154e13dc5de32be413a3e530605f9264be05df`.
- [Operator ETH faucet transaction](https://sepolia.basescan.org/tx/0x5b127a2ad202a82693419653499e11f8c101b99e9121e04024bfe940eac6ab69).
- [Successful deployment](https://sepolia.basescan.org/tx/0x448e4df8191ab6ff3d25c0d8e61811cddfdd1e75ee112909f4d5972cc1c0f60d), block 48145649.

The setup recovered this same successful deployment after a receipt timeout.
It did not create another contract. Strict standalone TypeScript checks and six
HTTP checks passed: private file inaccessible, missing authorization rejected,
foreign origin rejected, invalid payer rejected, unknown payment rejected, public
configuration excludes private fields. The page was visually inspected. These
preparation checks alone do not prove browser compatibility; the separate live
result above records the successful user payment.

## Faucet and private state

`faucet.ts` reuses the installed Coinbase CDP SDK and local credentials from
a sibling `lycoris` checkout. Set `SETTLE_SPIKE_LYCORIS_DIR` to an absolute path
when it lives elsewhere (also adjust the CLI `--env-file` path). It does not copy
credentials into this repository. Both that checkout
and its existing configuration must remain available for the faucet button.

```sh
bun --env-file=../lycoris/scripts/.env.local scripts/spikes/s16-browser-wallet/faucet.ts PUBLIC_ADDRESS usdc
# Only the operator needs test ETH:
bun --env-file=../lycoris/scripts/.env.local scripts/spikes/s16-browser-wallet/faucet.ts OPERATOR_ADDRESS eth
```

`setup.ts` generates separate random accounts when absent, builds S14 with Forge,
and deploys with a funded operator. It preserves signed deployment bytes before
broadcast. For a fresh checkout, generate the accounts and print only the public
operator address:

```sh
bun -e 'const { accounts } = await import("./scripts/spikes/s16-browser-wallet/shared.ts"); console.log((await accounts()).operator.address)'
```

Fund that operator with the ETH faucet command above, then run setup. Existing
setup can be recovered with the same command:

```sh
bun scripts/spikes/s16-browser-wallet/setup.ts
```

Keys, signatures, signed transactions and local evidence stay in gitignored
`.local/` (directory mode 0700; files 0600). Do not publish that directory, delete
pending state or fund these experimental accounts on mainnet.

## Intentional limits

- Loopback only, same-origin POST requests and a per-process page token. Reload
  the page if the server restarts. One server process only; no multi-worker lock.
- Three payment broadcasts and three faucet requests maximum per local state;
  one faucet request per address, including failed requests. The UI stops repeat
  payments for an account after a transaction hash exists.
- Ordinary EOA only. Default injected provider only; no smart-account support,
  wallet selection library or wallet compatibility claim yet.
- Fixed destination and quote; fifteen-minute authorization window. The split is
  committed into the authorization nonce and is not human-readable in wallets.
- Payment gas ceiling 500,000 and max fee ceiling 1 gwei; operator balance checked
  before signing. These are experiment limits, not a production fee estimate.
- An uncertain broadcast stays attached to its original signed transaction and
  hash. Status reads do not create another payment. There is no automatic
  rebroadcast/replacement or complete failed-authorization closure in this spike.
- Gas evidence reports receipt gas used times effective gas price, excluding any
  separately reported L1 data fee.
- No CCTP, durable DBOS workflow, webhooks, host crediting or production release
  readiness is established here.
