import { manualUsdEstimate } from "@/services/manualPrice";
import { DEFAULT_SETTINGS, settingsService } from "@/services/settingsService";
import { useEffect, useState } from "react";

export function ManualFiatEstimate({ satoshis }: { satoshis: bigint }) {
  const read = () => {
    const result = settingsService.getSettings();
    return result.ok ? result.value : DEFAULT_SETTINGS;
  };
  const [settings, setSettings] = useState(read);
  useEffect(() => {
    const update = () => {
      const result = settingsService.getSettings();
      setSettings(result.ok ? result.value : DEFAULT_SETTINGS);
    };
    window.addEventListener("storage", update);
    return () => window.removeEventListener("storage", update);
  }, []);
  const price = settings.manualUsdPerXbt;
  const date = settings.manualPriceUpdatedAt;
  const old = !date || Date.now() - date >= 15 * 60 * 1000;
  return (
    <div className="space-y-1 text-xs text-muted-foreground">
      {price ? (
        <>
          <p className="text-sm">
            ≈ {manualUsdEstimate(satoshis, price)} · Manual estimate
          </p>
          <p>
            1 XBT ={" "}
            {price.toLocaleString("en-US", { maximumFractionDigits: 12 })} USD ·{" "}
            {date
              ? `Set ${new Date(date).toLocaleString()}`
              : "Update time unavailable"}
            {old ? " · Check the price before using this estimate" : ""}.
          </p>
        </>
      ) : (
        <p>
          USD estimate unavailable. No automatic XBT market quote is configured.
        </p>
      )}
      <p>
        {price
          ? "Update the manual price in Settings."
          : "Set a manual XBT price in Settings."}
      </p>
    </div>
  );
}
