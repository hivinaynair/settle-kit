const el = (id) => document.getElementById(id);
const csrf = document.querySelector('meta[name="spike-token"]').content;
let payer, provider, current, poll;
const status = (text) => {
  el("status").textContent = text;
};
async function api(path, body) {
  const response = await fetch(`/api/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Spike-Token": csrf },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw Error(result.error);
  return result;
}
async function network() {
  const chain = await provider.request({ method: "eth_chainId" });
  if (chain === "0x14a34") return;
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: "0x14a34" }],
    });
  } catch (error) {
    if (error.code !== 4902) throw error;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: "0x14a34",
          chainName: "Base Sepolia",
          nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
          rpcUrls: ["https://sepolia.base.org"],
          blockExplorerUrls: ["https://sepolia.basescan.org"],
        },
      ],
    });
  }
  if ((await provider.request({ method: "eth_chainId" })) !== "0x14a34")
    throw Error("Select Base Sepolia before continuing.");
}
function show(payment) {
  current = payment;
  if (payment.hash) {
    el("transaction").hidden = false;
    el("transaction").href = `https://sepolia.basescan.org/tx/${payment.hash}`;
  }
  if (payment.evidence) {
    el("evidence").hidden = false;
    el("evidence").textContent = JSON.stringify(payment.evidence, null, 2);
  }
  const text = {
    broadcast: "Submitted by the operator. Waiting for a receipt. Do not pay again.",
    included:
      "Payment included. Transfer amounts and zero payer ETH checked; waiting for Base safe.",
    verified: "Verified at Base safe: 1.00 USDC paid, 0.99 received, 0.01 fee, zero payer ETH.",
    reverted:
      "Source transaction reverted. Keep the original payment ID; do not create another payment while its authorization can still execute.",
  };
  status(
    payment.replayRejected
      ? "Verified. Reusing the exact authorization was rejected by USDC in a read-only call."
      : (text[payment.status] ?? "Ready for wallet review."),
  );
  el("replay").disabled = payment.status !== "verified";
  el("pay").disabled = true;
  if (["broadcast", "included"].includes(payment.status)) {
    clearTimeout(poll);
    poll = setTimeout(check, 5000);
  }
}
async function check() {
  try {
    show(await api("status", { id: current.id }));
  } catch (error) {
    status(error.message);
    poll = setTimeout(check, 8000);
  }
}
async function refresh() {
  const data = await api("balances", { payer });
  el("eth").textContent = data.eth;
  el("usdc").textContent = data.usdc;
  const pending = data.payments.find((p) => ["broadcast", "included"].includes(p.status));
  el("fund").disabled = data.eth !== "0";
  el("pay").disabled =
    data.eth !== "0" || Number(data.usdc) < 1 || data.payments.some((p) => p.hash);
  el("refresh").disabled = false;
  if (pending) {
    current = pending;
    await check();
  } else if (!current && data.payments.length) {
    current = data.payments.at(-1);
    if (current.hash) show(current);
  }
  return data;
}
async function action(button, run) {
  el(button).disabled = true;
  try {
    await run();
  } catch (error) {
    status(
      error.code === 4001
        ? "Wallet request cancelled. No new payment was submitted."
        : (error.message ?? "Wallet request failed."),
    );
  } finally {
    if (button === "connect") el(button).disabled = false;
    else if (payer) await refresh().catch(() => undefined);
  }
}
el("connect").onclick = () =>
  action("connect", async () => {
    provider = window.ethereum;
    if (!provider)
      throw Error(
        "No browser wallet found. Open this URL in your wallet’s browser, such as Chrome with MetaMask installed.",
      );
    const accounts = await provider.request({ method: "eth_requestAccounts" });
    payer = accounts[0];
    await network();
    el("wallet").textContent = payer;
    el("refresh").disabled = false;
    provider.removeListener?.("accountsChanged", reset);
    provider.removeListener?.("chainChanged", reset);
    provider.on?.("accountsChanged", reset);
    provider.on?.("chainChanged", reset);
    status("Wallet connected. Check that ETH is zero, then request test USDC if needed.");
    await refresh();
  });
function reset() {
  payer = undefined;
  current = undefined;
  clearTimeout(poll);
  for (const id of ["pay", "fund", "refresh", "replay"]) el(id).disabled = true;
  el("wallet").textContent = "Wallet account or network changed. Connect again before signing.";
  el("transaction").hidden = true;
  el("evidence").hidden = true;
  el("eth").textContent = "—";
  el("usdc").textContent = "—";
  status("Previous submitted payments remain on the server. Reconnect to restore them.");
}
el("refresh").onclick = () =>
  action("refresh", async () => {
    await refresh();
  });
el("fund").onclick = () =>
  action("fund", async () => {
    const result = await api("faucet", { payer });
    status(
      `Test USDC requested. Wait for confirmation, then refresh balances. Faucet transaction: ${result.hash}`,
    );
  });
el("pay").onclick = () =>
  action("pay", async () => {
    await network();
    const selected = await provider.request({ method: "eth_accounts" });
    if (selected[0]?.toLowerCase() !== payer.toLowerCase())
      throw Error("Account changed. Reconnect.");
    const quote = await api("prepare", { payer });
    current = quote;
    el("expiry").textContent =
      `Authorization deadline: ${new Date(Number(quote.validBefore) * 1000).toLocaleTimeString()}. Review the 1.00 test-USDC debit in your wallet.`;
    status("Review the signature in your wallet. This is not an ETH transaction.");
    const signature = await provider.request({
      method: "eth_signTypedData_v4",
      params: [payer, JSON.stringify(quote.typedData)],
    });
    const stillSelected = await provider.request({ method: "eth_accounts" });
    if (
      !payer ||
      stillSelected[0]?.toLowerCase() !== quote.payer.toLowerCase() ||
      (await provider.request({ method: "eth_chainId" })) !== "0x14a34"
    )
      throw Error("Account or chain changed. Signature was not submitted.");
    show(await api("submit", { id: quote.id, signature }));
  });
el("replay").onclick = () =>
  action("replay", async () => show(await api("replay", { id: current.id })));
fetch("/api/config")
  .then((r) => r.json())
  .then((config) => {
    el("addresses").textContent =
      `Operator: ${config.operator}\nTreasury: ${config.treasury}\nAdapter: ${config.contract}\nUSDC: ${config.usdc}`;
  })
  .catch(() => status("Local setup is unavailable."));
