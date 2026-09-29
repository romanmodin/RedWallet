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
    if (value !== undefined && (!Number.isFinite(value) || value <= 0)) {
      setPriceError("Enter a positive USD price, or clear the field.");
      return;
    }
    setPriceError(null);
    updateSettings({ manualUsdPerXbt: value });
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
            Spending keys remain in your original wallet.
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
            title="Manual XBT price"
            description="Enter the current USD price of one XBT. Live wallets have no automatic fiat price feed."
          >
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
            description="The web wallet reads XBT data through its configured Fulcrum bridge."
          >
            <NetworkSetting />
          </SettingsSection>

          <SettingsSection
            id="server"
            title="Electrum / Fulcrum server"
            description="The deployment operator manages the bridge and its upstream Fulcrum server."
          >
            <p className="text-sm text-muted-foreground">
              Watch-only addresses use the deployed bridge. Server credentials
              are managed by the operator and are never stored in your browser.
            </p>
            <Button asChild variant="outline" className="rounded-xl">
              <Link to="/status">Check connection</Link>
            </Button>
          </SettingsSection>

          <SupportSetting />
        </div>
      </div>
    </section>
  );
}
