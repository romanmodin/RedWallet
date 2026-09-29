import { Button } from "@/components/ui/button";
import { checkWalletCompatibility } from "@/lib/xbt/compatibility-check";
import { useEffect, useRef, useState } from "react";
export function WalletCompatibilityCheck() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  async function run() {
    if (busy) return;
    setBusy(true);
    setResult("");
    try {
      const message = await checkWalletCompatibility();
      if (mounted.current) setResult(message);
    } catch {
      if (mounted.current)
        setResult(
          "Self-test failed in this browser. Keep using the native wallet and report this result.",
        );
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <section
      aria-label="Wallet compatibility check"
      className="space-y-3 rounded-2xl border border-border bg-card p-5"
    >
      <h2 className="font-semibold">Browser compatibility</h2>
      <p className="text-sm text-muted-foreground">
        Check local encryption and XBT signing using a published, disposable
        test fixture. This does not access your saved wallets or send funds. Run
        this check on each device before using local wallet signing.
      </p>
      <Button variant="outline" disabled={busy} onClick={() => void run()}>
        {busy ? "Running local self-test…" : "Run wallet self-test"}
      </Button>
      {result && <output className="block text-sm">{result}</output>}
    </section>
  );
}
