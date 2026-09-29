/**
 * Test-only render helpers for the RedWallet frontend suite.
 *
 * These helpers mount real production components with the same providers the
 * app uses, so journeys exercise component + context + service integration
 * rather than isolated units. No production module is modified.
 */

import { ConnectionTest } from "@/components/settings/ConnectionTest";
import { ServerSetting } from "@/components/settings/ServerSetting";
import { ThemeProvider } from "@/context/ThemeContext";
import { WalletProvider } from "@/context/WalletContext";
import { settingsService } from "@/services/settingsService";
import { type RenderResult, render } from "@testing-library/react";
import { type ReactElement, type ReactNode, useState } from "react";

/** Wrap a subtree in the app's theme and wallet providers. */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <WalletProvider>{children}</WalletProvider>
    </ThemeProvider>
  );
}

/** Render a component inside the app's providers. */
export function renderWithProviders(ui: ReactElement): RenderResult {
  return render(<AppProviders>{ui}</AppProviders>);
}

/** Isolated legacy server form: it does not configure the live bridge. */
export function ServerSettingsFixture() {
  const [config, setConfig] = useState({ host: "", port: 50002, tls: true });
  return (
    <>
      <ServerSetting
        {...config}
        onSave={(next) => {
          setConfig(next);
          settingsService.updateSettings({
            serverHost: next.host,
            serverPort: next.port,
            serverTls: next.tls,
          });
        }}
      />
      <ConnectionTest config={{ ...config, network: "unconfigured" }} />
    </>
  );
}
