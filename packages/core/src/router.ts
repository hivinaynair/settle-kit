import type { Address, Hex } from "viem";

/** "native" means the chain's own coin (ETH). Relay writes it as the zero address. */
export type Asset = { chainId: number; token: Address | "native" };
export type Route = { from: Asset; to: Asset };

export type Source = {
  chainId: number;
  name: string; // "arbitrum"
  tokens: { token: Address | "native"; symbol: string; decimals: number }[];
};

export type Quote = {
  amountIn: bigint; // base units of route.from
  amountOut: bigint; // expected base units of route.to (display only)
  minimumOut: bigint; // worst case after slippage
  etaSeconds: number;
};

/** Only the address. The wallet path builds its own transfer to it (design §1). */
export type DepositAddress = { address: Address };

/** Checkout (design §6a): single-use strict address that delivers exactly amountOut. */
export type OrderAddress = { address: Address; amountIn: bigint; amountOut: bigint };

/** The router's view of a fill. Not the deposit state machine (that's T2). */
export type FillStatus = "waiting" | "processing" | "delayed" | "filled" | "refunded" | "failed";

export type Fill = {
  id: string; // Relay requestId of the actual fill
  status: FillStatus;
  depositTx: Hex | null; // payer's transfer into the address
  destination: { chainId: number; txHash: Hex } | null; // set once filled
  updatedAt: Date;
};

export type PaymentRouter = {
  id: string; // "relay"
  sources(): Promise<Source[]>;
  depositAddress(input: {
    route: Route;
    amountIn: bigint; // nominal amount to quote with (the route minimum)
    recipient: Address; // treasury
    refundTo: Address; // app-controlled refund address
    recoveryAddress: Address; // app-controlled EOA
  }): Promise<DepositAddress>;
  orderAddress(input: {
    route: Route;
    amountOut: bigint; // exact base units the treasury must receive
    recipient: Address;
    refundTo: Address;
    recoveryAddress: Address;
  }): Promise<OrderAddress>;
  quote(input: { route: Route; amountIn: bigint }): Promise<Quote>;
  fills(address: Address): Promise<Fill[]>;
  status(fillId: string): Promise<FillStatus>;
};
