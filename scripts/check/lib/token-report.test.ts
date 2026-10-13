import { describe, expect, it } from "bun:test";
import { isTokenSourcePath, rawTokenHits } from "./token-report.mjs";

describe("rawTokenHits", () => {
  it("flags a Tailwind palette utility, including variants", () => {
    const hits = rawTokenHits(`<div className="hover:bg-red-500 text-primary" />`);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.text).toContain("bg-red-500");
  });

  it("allows semantic tokens", () => {
    expect(
      rawTokenHits(`<Button className="bg-primary text-muted-foreground border-border" />`),
    ).toHaveLength(0);
  });

  it("flags arbitrary hex", () => {
    expect(rawTokenHits(`className="bg-[#ff0000]"`)).toHaveLength(1);
  });
});

describe("isTokenSourcePath", () => {
  it("checks app sources — shadcn in packages/ui is out of scope", () => {
    expect(isTokenSourcePath("apps/web/src/app/page.tsx")).toBe(true);
    expect(isTokenSourcePath("apps/demo/app/page.tsx")).toBe(true);
    expect(isTokenSourcePath("apps/demo/features/deposits/components/deposit-widget.tsx")).toBe(
      true,
    );
    expect(isTokenSourcePath("packages/ui/src/components/button.tsx")).toBe(false);
    expect(isTokenSourcePath("packages/ui/src/styles/globals.css")).toBe(false);
    expect(isTokenSourcePath("apps/web/src/app/page.test.tsx")).toBe(false);
  });
});
