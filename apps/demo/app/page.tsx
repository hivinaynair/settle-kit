import { Button } from "@repo/ui/components/button";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-6 px-4">
      <h1 className="text-section">Settle Kit</h1>
      <p className="text-muted-foreground">
        Deposits from any token, any chain, any exchange — settled as USDC.
      </p>
      <Button className="self-start">Deposit</Button>
    </main>
  );
}
