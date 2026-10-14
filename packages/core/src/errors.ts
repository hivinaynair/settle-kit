export type DepositErrorCode =
  | "amount_too_low"
  | "quote_unavailable"
  | "route_unavailable"
  | "address_blocked"
  | "router_unavailable"
  | "invalid_config";

export class DepositError extends Error {
  readonly code: DepositErrorCode;

  constructor(code: DepositErrorCode, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "DepositError";
    this.code = code;
  }
}
