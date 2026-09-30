/**
 * Characterization tests for behavior adjacent to the planned safety
 * correction.
 *
 * The upcoming change intentionally rewrites the wallet short-ID prefix shown
 * on the dashboard and wallet cards, the default network selection, the
 * Mainnet/Testnet labels, and some network claims. None of those
 * intentionally-changing values are frozen here.
 *
 * Instead these tests pin the surrounding behavior that must survive the
 * change:
 *   - the wallet identifier is still rendered on the dashboard card and on
 *     every wallet row, whatever prefix it carries (asserted against the
 *     service's own value, not a literal);
 *   - the network choice is still explicit, persisted, and never auto-fills a
 *     server host;
 *   - the app still reports offline-by-design with no configured host and
 *     never substitutes a public server.
 *
 * Everything runs against the in-memory demo service and jsdom; no network is
 * touched.
 */

import App from "@/App";
import { settingsService } from "@/services/settingsService";
import { MockWalletService } from "@/services/walletService";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

/** The service's own demo wallets, used to assert rendering without freezing a prefix. */
async function demoWallets() {
  const service = new MockWalletService();
  const result = await service.listWallets();
  if (!result.ok) throw new Error("expected demo wallets");
  return result.value;
}

async function openWallets() {
  const user = userEvent.setup();
  render(<App />);
  await screen.findByTestId("dashboard.balance_card");
  await user.click(screen.getByTestId("app_shell.nav.wallets"));
  await screen.findByTestId("wallets.list");
  return user;
}

async function openSettings() {
  const user = userEvent.setup();
  render(<App />);
  await screen.findByTestId("dashboard.balance_card");
  await user.click(screen.getByTestId("app_shell.nav.settings"));
  await screen.findByTestId("settings.display_unit");
  return user;
}

describe("Wallet identifier rendering (adjacent to the short-ID prefix change)", () => {
  it("renders the active wallet's service-provided identifier on the dashboard card", async () => {
    const wallets = await demoWallets();
    const primary = wallets[0];
    expect(primary.shortId.length).toBeGreaterThan(0);

    render(<App />);
    const card = await screen.findByTestId("dashboard.balance_card");

    // The identifier is shown next to the wallet name, whatever its prefix.
    expect(within(card).getByText(primary.name)).toBeInTheDocument();
    expect(within(card).getByText(primary.shortId)).toBeInTheDocument();
  });

  it("renders each wallet's service-provided identifier on its wallet row", async () => {
    const wallets = await demoWallets();
    await openWallets();

    wallets.forEach((wallet, index) => {
      const row = screen.getByTestId(`wallets.item.${index + 1}`);
      expect(within(row).getByText(wallet.name)).toBeInTheDocument();
      expect(within(row).getByText(wallet.shortId)).toBeInTheDocument();
    });
  });

  it("keeps the identifier distinct from the wallet name", async () => {
    const wallets = await demoWallets();
    const primary = wallets[0];

    render(<App />);
    const card = await screen.findByTestId("dashboard.balance_card");

    expect(primary.shortId).not.toBe(primary.name);
    expect(within(card).getByText(primary.shortId)).not.toHaveTextContent(
      primary.name,
    );
  });
});

describe("Operator managed network", () => {
  it("does not offer unsupported chain switching or per-browser server changes", async () => {
    await openSettings();
    expect(screen.getByTestId("settings.network")).toHaveTextContent(
      "XBT network",
    );
    expect(screen.queryByTestId("settings.network.mainnet")).toBeNull();
    expect(screen.queryByTestId("settings.network.testnet")).toBeNull();
    expect(screen.queryByTestId("settings.server.host_input")).toBeNull();
  });
  it("does not let an old locally configured host create a live-network claim", async () => {
    settingsService.updateSettings({ serverHost: "electrum.example.org" });
    render(<App />);
    await screen.findByTestId("dashboard.balance_card");
    expect(
      screen.getByText(/XBT network — demo, not configured/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/electrum\.example\.org/)).toBeNull();
    for (const indicator of screen.getAllByTestId("network_indicator.link"))
      expect(indicator).toHaveAccessibleName(/Offline/);
  });
});
