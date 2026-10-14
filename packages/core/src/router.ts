import type { Address, Hex } from "viem";

/** "native" means the chain's own coin (ETH). Relay writes it as the zero address. */
export type Token = { token: Address | "native"; decimals: number };
export type Asset = Token & { chainId: number };

export type Route = {
  from: Asset;
  to: Asset;
  /**
   * Smallest accepted payAmount in route.from base units, set by the route manifest.
   * Also the sample amount Relay needs to issue a deposit address.
   */
  minimum: bigint;
};

/** What every address request shares: the route and where money goes. */
export type AddressRequest = {
  route: Route;
  recipient: Address; // treasury
  refundTo: Address; // app-controlled refund address
};

export type Source = {
  chainId: number;
  name: string; // "arbitrum"
  tokens: (Token & { symbol: string })[];
};

export type Quote = {
  payAmount: bigint; // what the payer sends
  receiveAmount: bigint; // expected arrival in USDC, display only
  minimumReceiveAmount: bigint; // worst case after slippage
  etaSeconds: number;
};

/** Only the address. The wallet path builds its own transfer to it (design §1). */
export type DepositAddress = { address: Address };

/** payAmount: what the payer must send, in route.from's token, fee included. */
export type OrderAddress = { address: Address; payAmount: bigint };

/**
 * The router's view of a fill. Not the deposit state machine (that's T2).
 * "unknown": the router reported a status we don't recognise; the workflow sends it to
 * needs_attention instead of blocking the other fills at the address.
 */
export type FillStatus =
  | "waiting"
  | "processing"
  | "delayed"
  | "filled"
  | "refunded"
  | "failed"
  | "unknown";

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
  /** Reusable address for this route; any amount sent to it is processed. */
  depositAddress(input: AddressRequest): Promise<DepositAddress>;
  /** amount: exact USDC base units the treasury must receive (the order price). */
  orderAddress(input: AddressRequest & { amount: bigint }): Promise<OrderAddress>;
  quote(input: { route: Route; payAmount: bigint }): Promise<Quote>;
  fills(address: Address): Promise<Fill[]>;
  status(fillId: string): Promise<FillStatus>;
};
