/**
 * SettingsPage — display, theme, network, and server preferences.
 *
 * Every change is applied immediately and persisted through the settings
 * service, so preferences survive a reload. The screen is mobile-first with
 * stacked sections and moves to a comfortable two-column layout at lg.
 *
 * This build is demo-only: no keys, seed phrases, address books, or price
 * data exist anywhere on this screen.
 */

import { PageHeader } from "@/components/layout/PageHeader";
import { BrowserProtection } from "@/components/settings/BrowserProtection";
import { DisplayUnitSetting } from "@/components/settings/DisplayUnitSetting";
import { NetworkSetting } from "@/components/settings/NetworkSetting";
import { SupportSetting } from "@/components/settings/SupportSetting";
import { ThemeSetting } from "@/components/settings/ThemeSetting";
import { ErrorState } from "@/components/states/ErrorState";
import { LoadingState } from "@/components/states/LoadingState";
import { OfflineState } from "@/components/states/OfflineState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSettings } from "@/hooks/useSettings";
import { useXbtPrice } from "@/hooks/useXbtPrice";
import { Link } from "@tanstack/react-router";
import { RotateCcw, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";

/** Section wrapper: a titled card with a consistent header and body. */
function SettingsSection({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section
      data-ocid={`settings.section.${id}`}
      className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 shadow-subtle"
    >
      <div className="flex flex-col gap-1">
        <h2 className="font-display text-base font-semibold tracking-tight text-foreground">
          {title}
        </h2>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {description}
        </p>
      </div>
      {children}
    </section>
  );
}

export function SettingsPage() {
  const { settings, error, updateSettings, resetSettings } = useSettings();
  const market = useXbtPrice();
  const [isLoading, setIsLoading] = useState(true);
  const [draftPrice, setDraftPrice] = useState(
    String(settings.manualUsdPerXbt ?? ""),
  );
  const [priceError, setPriceError] = useState<string | null>(null);
  useEffect(
    () => setDraftPrice(String(settings.manualUsdPerXbt ?? "")),
    [settings.manualUsdPerXbt],
  );
  const savePrice = () => {
    const value = draftPrice.trim() ? Number(draftPrice) : undefined;
    if (
      value !== undefined &&
      (!Number.isFinite(value) || value <= 0 || value > 1e12)
    ) {
      setPriceError("Enter a positive USD price, or clear the field.");
      return;
    }
    setPriceError(null);
    updateSettings({
      manualUsdPerXbt: value,
      manualPriceUpdatedAt: value === undefined ? undefined : Date.now(),
    });
  };
  const [isOffline, setIsOffline] = useState(false);

  // Settings are read synchronously from the service; a brief loading pass
  // keeps the state contract explicit and avoids a flash of default values.
  useEffect(() => {
    const timer = window.setTimeout(() => setIsLoading(false), 120);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const update = () => setIsOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  const header = (
    <PageHeader
      title="Settings"
      description="Display, network, and security preferences"
      action={
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={resetSettings}
          data-ocid="settings.reset_button"
          className="rounded-xl text-muted-foreground"
        >
          <RotateCcw className="size-4" aria-hidden="true" />
          Reset
        </Button>
      }
    />
  );

  if (isLoading) {
    return (
      <section data-ocid="settings.page" className="flex flex-col">
        {header}
        <LoadingState rows={4} label="Loading settings" />
      </section>
    );
  }

  if (error) {
    return (
      <section data-ocid="settings.page" className="flex flex-col">
        {header}
        <ErrorState
          title="We couldn't load your settings"
          description={error.message}
          onRetry={resetSettings}
          retryLabel="Restore defaults"
        />
      </section>
    );
  }

  if (isOffline) {
    return (
      <section data-ocid="settings.page" className="flex flex-col">
        {header}
        <OfflineState
          title="You're offline"
          description="Settings are stored on this device, but the connection test needs a network. Reconnect to test your server."
          onRetry={() => setIsOffline(!navigator.onLine)}
        />
      </section>
    );
  }

  return (
    <section data-ocid="settings.page" className="flex flex-col">
      {header}

      <div className="mb-5 flex items-start gap-3 rounded-2xl border border-accent/30 bg-accent/[0.07] p-4">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
          <ShieldCheck className="size-4" aria-hidden="true" />
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="font-display text-sm font-semibold tracking-tight text-foreground">
            Device preferences
          </p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Preferences and watched public addresses are saved in this browser.
            Local encrypted wallets are managed in Wallets. Watched addresses
            remain public-only.
          </p>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2 lg:items-start">
        <div className="flex flex-col gap-5">
          <SettingsSection
            id="display"
            title="Display unit"
            description="Choose the amount label for demo accounts. Live XBT addresses always use XBT; changing a label does not switch networks."
          >
            <DisplayUnitSetting
              value={settings.displayUnit}
              onChange={(displayUnit) => updateSettings({ displayUnit })}
            />
          </SettingsSection>

          <SettingsSection
            id="price"
            title="XBT price"
            description="Auto uses NeoxEX’s last XBT/USDC trade. Manual uses your USD estimate. Prices affect display only; demo accounts keep their fixed example prices."
          >
            <fieldset className="grid grid-cols-2 gap-3">
              <legend className="sr-only">Price source</legend>
              {(["auto", "manual"] as const).map((mode) => (
                <label
                  key={mode}
                  className={`flex cursor-pointer items-center gap-2 rounded-xl border p-3 text-sm ${settings.priceMode === mode ? "border-primary bg-primary/10" : "border-border"}`}
                >
                  <input
                    type="radio"
                    name="price-mode"
                    value={mode}
                    checked={settings.priceMode === mode}
                    onChange={() => updateSettings({ priceMode: mode })}
                    className="accent-red-600"
                  />
                  {mode === "auto" ? "Auto (NeoxEX)" : "Manual"}
                </label>
              ))}
            </fieldset>
            {settings.priceMode === "auto" ? (
              <div
                className="space-y-3 rounded-xl bg-secondary/40 p-4"
                aria-live="polite"
              >
                {market.quote ? (
                  <>
                    <p className="font-mono text-xl font-semibold tabular-nums">
                      {market.quote.price.toLocaleString("en-US", {
                        maximumFractionDigits: 12,
                      })}{" "}
                      <span className="text-xs text-muted-foreground">
                        USDC / XBT
                      </span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Last trade:{" "}
                      {new Date(market.quote.tradeAt).toLocaleString()}
                      {market.now - market.quote.tradeAt >= 900000
                        ? " · Stale quote"
                        : ""}
                      . Checked{" "}
                      {new Date(market.quote.checkedAt).toLocaleString()}.
                    </p>
                  </>
                ) : (
                  <p className="text-sm">
                    {market.loading
                      ? "Discovering XBT price…"
                      : "NeoxEX quote unavailable."}
                  </p>
                )}
                {market.error ? (
                  <p className="text-xs text-muted-foreground">
                    {market.error}
                  </p>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  disabled={market.loading}
                  onClick={() => void market.refresh()}
                >
                  Refresh price
                </Button>
                <p className="text-xs text-muted-foreground">
                  Refreshes every 5 minutes while open; pauses in the
                  background. The last valid quote stays saved if NeoxEX is
                  unavailable. USDC is the exchange quote currency, not an exact
                  USD conversion.
                </p>
              </div>
            ) : (
              <>
                <Label htmlFor="manual-price">USD per XBT</Label>
                <Input
                  id="manual-price"
                  inputMode="decimal"
                  placeholder="Unavailable until configured"
                  value={draftPrice}
                  onChange={(e) => setDraftPrice(e.target.value)}
                  aria-invalid={!!priceError}
                />
                {priceError ? (
                  <p role="alert" className="text-sm text-destructive">
                    {priceError}
                  </p>
                ) : null}
                <Button type="button" variant="outline" onClick={savePrice}>
                  Save price
                </Button>
                <p className="text-xs text-muted-foreground">
                  {settings.manualUsdPerXbt
                    ? `Saved price: ${settings.manualUsdPerXbt.toLocaleString("en-US", { maximumFractionDigits: 12 })} USD per XBT. ${settings.manualPriceUpdatedAt ? `Set ${new Date(settings.manualPriceUpdatedAt).toLocaleString()}.` : "Update time unavailable; save a fresh quote."}`
                    : "No manual price saved. Your XBT balance does not depend on a fiat price."}{" "}
                  Manual prices do not refresh automatically.
                </p>
              </>
            )}
          </SettingsSection>

          <SettingsSection
            id="theme"
            title="Appearance"
            description="Pick a theme or follow your device setting."
          >
            <ThemeSetting
              value={settings.theme}
              onChange={(theme) => updateSettings({ theme })}
            />
          </SettingsSection>
        </div>

        <div className="flex flex-col gap-5">
          <SettingsSection
            id="network"
            title="Network"
            description="Use the shared service or connect directly to your home Fulcrum."
          >
            <NetworkSetting />
          </SettingsSection>

          <SettingsSection
            id="server"
            title="Home connection"
            description="Direct WebSockets keep wallet requests off the shared relay."
          >
            <p className="text-xs text-muted-foreground">
              Select My home Fulcrum above and enter its secure WebSocket
              address. No personal canister is required. Enable WSS on your
              Fulcrum with a browser-trusted certificate, then Test connection
              and Save. The built-in shared service remains the default for new
              devices. Operator credentials are never stored in your browser.
            </p>
            <Button asChild variant="outline">
              <Link to="/status">Check connection</Link>
            </Button>
          </SettingsSection>
          <BrowserProtection />
          <SupportSetting />
          <SettingsSection
            id="about"
            title="RedWallet 0.38"
            description="Preview release · XBT (BLAKE2b)"
          >
            <p className="text-sm text-muted-foreground">
              Version 1.0 is reserved for the first working, full-featured
              release. This preview supports native SegWit account 0; Taproot,
              legacy spending and coinbase inputs are not supported.
            </p>
          </SettingsSection>
        </div>
      </div>
    </section>
  );
}
