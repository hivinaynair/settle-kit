import type { Address, Hex } from "viem";

/** A token contract on a chain. V1 routes are USDC only, so there is no native coin. */
export type Asset = { chainId: number; token: Address; decimals: number };

export type Route = {
  from: Asset;
  to: Asset;
  /**
   * Smallest accepted payment in route.from base units, set by the route manifest.
   * Also the sample amount Relay needs to issue a deposit address.
   */
  minimum: bigint;
};

/** What every address request shares: the route and where money goes. */
export type AddressRequest = {
  route: Route;
  recipient: Address; // the merchant's own wallet (the app's treasury)
  refundTo: Address; // app-controlled refund address
};

/** Only the address. The wallet path builds its own transfer to it (design §1). */
export type DepositAddress = { address: Address };

/** payAmount: what the payer must send, in route.from's token, fee included. */
export type OrderAddress = { address: Address; payAmount: bigint };

/**
 * The router's view of a payment. Not the deposit state machine (that's T2).
 * "unknown": the router reported a status we don't recognise; the workflow sends it to
 * needs_attention instead of blocking the other payments at the address.
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
  id: string; // Relay requestId of the actual payment
  status: FillStatus;
  depositTx: Hex | null; // payer's transfer into the address
  destination: { chainId: number; txHash: Hex } | null; // set once filled
  updatedAt: Date;
};

/** Get an address, then watch what arrives at it. */
export type PaymentRouter = {
  id: string; // "relay"
  /** Reusable address for this route; any amount sent to it is processed. */
  depositAddress(input: AddressRequest): Promise<DepositAddress>;
  /** amount: exact USDC base units the merchant must receive (the order price). */
  orderAddress(input: AddressRequest & { amount: bigint }): Promise<OrderAddress>;
  /** Every payment that reached the address, with its current status. */
  fills(address: Address): Promise<Fill[]>;
};
