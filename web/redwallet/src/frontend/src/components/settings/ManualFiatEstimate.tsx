import { useXbtPrice } from "@/hooks/useXbtPrice";
import { manualUsdEstimate } from "@/services/manualPrice";

/** Display estimates only. Neither a price nor its cache authorizes spending. */
export function ManualFiatEstimate({
  satoshis,
  compact = false,
}: { satoshis: bigint; compact?: boolean }) {
  const { settings, quote, loading, error, now } = useXbtPrice();
  const auto = settings.priceMode === "auto";
  const price = auto ? quote?.price : settings.manualUsdPerXbt;
  const date = auto ? quote?.tradeAt : settings.manualPriceUpdatedAt;
  const currency = auto ? "USDC" : "USD";
  const old = !date || now - date >= 15 * 60 * 1000;
  if (compact)
    return (
      <span className="text-xs tabular-nums">
        {price
          ? `≈ ${manualUsdEstimate(satoshis, price).replace("USD", currency)} · ${auto ? "NeoxEX" : "Manual"}${old ? " · Stale" : ""}`
          : "Price unavailable"}
      </span>
    );
  return (
    <div className="space-y-1 text-xs text-muted-foreground" aria-live="polite">
      {price ? (
        <>
          <p className="font-mono text-sm tabular-nums">
            ≈ {manualUsdEstimate(satoshis, price).replace("USD", currency)} ·{" "}
            {auto ? "NeoxEX estimate" : "Manual estimate"}
          </p>
          <p>
            1 XBT ={" "}
            {price.toLocaleString("en-US", { maximumFractionDigits: 12 })}{" "}
            {currency} ·{" "}
            {date
              ? `${auto ? "Last trade" : "Set"} ${new Date(date).toLocaleString()}`
              : "Update time unavailable"}
            {old ? " · Stale price — check before using this estimate" : ""}.
          </p>
          {auto && quote ? (
            <p>
              Checked {new Date(quote.checkedAt).toLocaleString()}. USDC is the
              exchange quote currency, not an exact USD conversion.
            </p>
          ) : null}
        </>
      ) : (
        <p>
          {auto
            ? "NeoxEX estimate unavailable."
            : "USD estimate unavailable. Set a manual XBT price in Settings."}
        </p>
      )}
      {auto ? (
        <p>
          {loading
            ? "Refreshing NeoxEX…"
            : (error ??
              "Auto refresh every 5 minutes while open. Price mode is in Settings.")}
        </p>
      ) : (
        <p>Update the manual price in Settings.</p>
      )}
    </div>
  );
}
