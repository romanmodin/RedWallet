import { useEffect, useState } from "react";

/** Narrow observation, not a claim that the origin or an unlocked wallet is safe. */
export function BrowserProtection() {
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    const root = document.documentElement;
    const update = () =>
      setBlocked(root.dataset.remoteScriptProtection === "blocked");
    update();
    const observer = new MutationObserver(update);
    observer.observe(root, {
      attributes: true,
      attributeFilter: ["data-remote-script-protection"],
    });
    return () => observer.disconnect();
  }, []);
  return (
    <section
      aria-label="Browser protection"
      className="space-y-2 rounded-2xl border border-border bg-card p-5"
    >
      <h2 className="font-display font-semibold">Browser protection</h2>
      <output className="block text-sm">
        {blocked
          ? "External analytics script blocked by this browser."
          : "Script restriction loaded; a browser block has not been observed."}
      </output>
      <p className="text-xs text-muted-foreground">
        This check covers external scripts on this page. It does not verify
        every dependency or protect against a compromised site.
      </p>
    </section>
  );
}
