import { DepositError } from "./errors";

/** Digits only. No sign, decimal point, exponent, space, or leading zero. */
const BASE_UNITS = /^(0|[1-9][0-9]*)$/;

/** Decimal string of base units for JSON and Postgres. Rejects a negative. */
export function toBaseUnits(value: bigint): string {
  if (value < 0n) {
    throw new DepositError("invalid_config", "Amount must be a non-negative base-unit integer");
  }
  return value.toString();
}

/** Inverse of `toBaseUnits`. Anything that is not a canonical integer string is rejected. */
export function parseBaseUnits(text: string): bigint {
  if (!BASE_UNITS.test(text)) {
    throw new DepositError("invalid_config", "Amount must be a base-unit integer string");
  }
  return BigInt(text);
}
