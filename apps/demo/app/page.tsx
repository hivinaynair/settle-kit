import { Button } from "@repo/ui/components/button";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-6 px-4">
      <h1 className="text-section">Settle Kit</h1>
      <p className="text-muted-foreground">
        Native USDC deposits on Base and Arbitrum, settled to your business treasury on Base.
      </p>
      <Button className="self-start">Deposit</Button>
    </main>
  );
}
