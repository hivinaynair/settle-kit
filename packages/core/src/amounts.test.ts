import { describe, expect, it } from "bun:test";
import { parseBaseUnits, toBaseUnits } from "./amounts";
import { DepositError } from "./errors";

function expectInvalidConfig(run: () => unknown) {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(DepositError);
    if (!(error instanceof DepositError)) throw error;
    expect(error.code).toBe("invalid_config");
    return;
  }
  throw new Error("expected DepositError invalid_config");
}

describe("base units", () => {
  it("round-trips a 60-digit integer exactly", () => {
    const text = "1234567890".repeat(6);
    expect(text).toHaveLength(60);
    expect(toBaseUnits(parseBaseUnits(text))).toBe(text);
    expect(parseBaseUnits(toBaseUnits(1150000n))).toBe(1150000n);
    expect(toBaseUnits(0n)).toBe("0");
    expect(parseBaseUnits("0")).toBe(0n);
  });

  it("rejects strings that are not canonical base units", () => {
    for (const text of ["1.5", "-1", "01", " 1", "1e6", ""]) {
      expectInvalidConfig(() => parseBaseUnits(text));
    }
  });

  it("rejects a negative bigint", () => {
    expectInvalidConfig(() => toBaseUnits(-1n));
  });
});
