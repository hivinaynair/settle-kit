# T7 · Pay from a browser wallet (EIP-6963)

**Read first:** design doc §1 (wallet path paragraph), §8 (Wallet confirm, "No second
send", wallet errors). **Depends on:** T6.
**Time box:** ~3 hours. **Branch:** `vinay/t7-wallet`.
**Done when:** on the `pay` screen, a buyer with a browser-extension wallet (MetaMask,
Rabby, Coinbase Wallet) can pay the exact amount in one confirmation, every wallet
error has a clear message, and a timeout or reload never offers a second send.

---

## Goal

Paying by QR means copying an address and typing an amount. With a browser wallet the
widget builds the transfer itself and the buyer only confirms, so the amount and
address can't be wrong. No server changes: the wallet pays the same order address, and
the server finds the payment exactly as it does for a QR payment.

---

## Files

| File | What |
|---|---|
| `packages/react/src/wallet/discover.ts` | EIP-6963 discovery: `useWallets()` → `{ info: { name, icon, rdns }, provider }[]` |
| `packages/react/src/wallet/pay.ts` | `payWithWallet({ provider, order })`: the sequence below, returns a tx hash or a typed error |
| `packages/react/src/wallet/attempt.ts` | The "send attempt" record in `localStorage` |
| `packages/react/src/parts/PayWithWallet.tsx` | Wallet list, confirm panel, states |
| `packages/core/src/errors.ts` | Wallet codes already added in T2 |

viem only (`createWalletClient`/`createPublicClient` with `custom(provider)`); no wagmi,
no WalletConnect. Reads go through the wallet's own provider after the network switch,
so the widget needs no RPC URLs.

---

## 1. Discovery

Listen for `eip6963:announceProvider`, then dispatch `eip6963:requestProvider`.
Deduplicate by `rdns`. Show each wallet with its announced name and icon (the icon is a
data URI from the extension; render it as an `<img>`, never as HTML). No wallets found →
the section shows "No browser wallet found; scan the QR with your phone wallet".

## 2. `payWithWallet` sequence

1. `eth_requestAccounts` → account. User rejects (4001) → `wallet_rejected`.
2. Chain ≠ `route.from.chainId` → `wallet_switchEthereumChain`; 4902 (unknown chain) →
   `wallet_addEthereumChain` with the viem chain definition, then switch again. User
   rejects → `wrong_network`.
3. USDC `balanceOf(account) < payAmount` → `insufficient_balance` (show "You have
   0.80 USDC on Arbitrum; this needs 1.184248").
4. Estimate gas for `transfer(order.address, payAmount)`; native balance < gas × fee →
   `insufficient_gas` ("You need a little ETH on Arbitrum for the network fee").
5. **Record the send attempt** (below), then `writeContract` ERC-20
   `transfer(order.address, payAmount)`. The address and amount come from the server's
   `OrderView`, never from a fresh quote (every quote makes a new address).
6. Rejected in the wallet → clear the attempt, `wallet_rejected` (safe to retry).
   Returns a hash → store it on the attempt. Times out or the page closes → keep the
   attempt.

The confirm panel shows: wallet + account (shortened), "You send 1.184248 USDC on
Arbitrum", "Merchant receives 1.00 USDC on Base", the network-fee note, one **Pay**
button.

## 3. No second send

`attempt.ts` keeps `settle-kit:attempt:<orderId> = { at, txHash? }` in `localStorage`
(wrapped in try/catch; storage can be unavailable).

- While an attempt exists and the order is still `pending`, the wallet section shows
  "Checking for your payment…" (with the tx link if there is a hash) instead of a Pay
  button, and the QR section is hidden behind "I haven't paid yet" (a deliberate second
  click with a warning).
- The order leaving `pending` (payment seen) clears the attempt.
- Only an explicit wallet rejection clears it immediately.

The server never trusts the attempt or its hash: it's a UI hint. Payment still only
counts when Relay reports it and T4 verifies it on Base.

Why local and not the server table in design §4: an order address is single-use and
the server already watches it; the only job left is stopping the buyer's own browser
from sending twice. The `settle_kit_send_attempts` table returns with deposit mode,
where addresses are reused.

---

## Acceptance tests

1. Discovery with two fake announced providers (one duplicated) → two wallets.
2. `payWithWallet` with a fake EIP-1193 provider, one test per branch: rejected
   accounts, switch rejected, 4902 then add then switch, low USDC, low gas, wallet
   rejects the transfer (attempt cleared), success (attempt has the hash), transfer
   call hangs (attempt kept).
3. The transfer sent is exactly `transfer(order.address, order.payAmount)` on the
   route's USDC contract (decode the fake provider's `eth_sendTransaction` data).
4. With an attempt stored and the order `pending`, no Pay button renders; once the
   order is `processing`, the attempt is gone.
5. Manual (recorded in the PR): MetaMask or Rabby on a real page in test mode up to the
   confirm dialog, then reject → retry works; reload after confirming → "Checking for
   your payment…". The real paid transfer happens in T8.

---

## Out of scope

WalletConnect and mobile pairing (mobile wallets scan the QR), smart-contract wallets
and batching, native-ETH payment, server-side send attempts.

## Questions to answer in the PR description

- Why build the transfer ourselves instead of sending Relay's prepared transaction?
- What exactly prevents a double payment after a wallet timeout?
- Why do balance and gas checks use the wallet's provider rather than our RPC?
