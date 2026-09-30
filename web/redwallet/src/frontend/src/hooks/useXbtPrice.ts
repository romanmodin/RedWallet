import { neoxexPrices } from "@/services/neoxexPrice";
import { DEFAULT_SETTINGS, settingsService } from "@/services/settingsService";
import { useEffect, useState, useSyncExternalStore } from "react";

const read = () => {
  const r = settingsService.getSettings();
  return r.ok ? r.value : DEFAULT_SETTINGS;
};

export function useXbtPrice() {
  const [settings, setSettings] = useState(read);
  const state = useSyncExternalStore(
    neoxexPrices.subscribe,
    neoxexPrices.getSnapshot,
  );
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const update = () => setSettings(read());
    window.addEventListener("storage", update);
    window.addEventListener("redwallet-settings", update);
    return () => {
      window.removeEventListener("storage", update);
      window.removeEventListener("redwallet-settings", update);
    };
  }, []);
  useEffect(() => {
    neoxexPrices.restore();
    const tick = () => {
      setNow(Date.now());
      if (
        settings.priceMode === "auto" &&
        document.visibilityState !== "hidden" &&
        navigator.onLine
      )
        void neoxexPrices.refresh();
    };
    tick();
    const timer = window.setInterval(tick, 60000);
    document.addEventListener("visibilitychange", tick);
    window.addEventListener("online", tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
      window.removeEventListener("online", tick);
    };
  }, [settings.priceMode]);
  return { settings, ...state, now, refresh: () => neoxexPrices.refresh(true) };
}
