export type DepositErrorCode =
  | "amount_too_low"
  | "quote_unavailable"
  | "route_unavailable"
  | "address_blocked"
  | "router_unavailable"
  | "invalid_config"
  // The wallet path (T7). No payment row exists yet, so these are not payment statuses.
  | "wallet_rejected"
  | "wrong_network"
  | "insufficient_balance"
  | "insufficient_gas";

export class DepositError extends Error {
  readonly code: DepositErrorCode;

  constructor(code: DepositErrorCode, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "DepositError";
    this.code = code;
  }
}
