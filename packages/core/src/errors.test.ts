import { describe, expect, it } from "bun:test";
import { DepositError, type DepositErrorCode } from "./errors";

const WALLET_CODES = [
  "wallet_rejected",
  "wrong_network",
  "insufficient_balance",
  "insufficient_gas",
] as const satisfies readonly DepositErrorCode[];

describe("wallet error codes", () => {
  it("are deposit errors, not payment statuses", () => {
    for (const code of WALLET_CODES) {
      const error = new DepositError(code, "The wallet did not send");
      expect(error.code).toBe(code);
      expect(error).toBeInstanceOf(DepositError);
    }
  });
});
