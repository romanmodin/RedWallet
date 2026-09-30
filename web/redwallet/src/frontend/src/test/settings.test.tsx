/**
 * Settings journey tests.
 *
 * Covers display-unit, theme, network, and server preferences, the connection
 * test states, and persistence across a remount (the reload contract). All
 * persistence is device-local `localStorage`; no network is touched.
 */

import App from "@/App";
import { settingsService } from "@/services/settingsService";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

async function openSettings() {
  const user = userEvent.setup();
  render(<App />);
  await screen.findByTestId("dashboard.balance_card");
  await user.click(screen.getByTestId("app_shell.nav.settings"));
  // The page holds a brief loading pass before rendering the sections.
  await screen.findByTestId("settings.display_unit");
  return user;
}

describe("Settings", () => {
  it("switches the display unit and applies it to the dashboard", async () => {
    const user = await openSettings();

    await user.click(screen.getByTestId("settings.display_unit.btc"));
    expect(screen.getByTestId("settings.display_unit.btc")).toBeChecked();

    // Navigate home; the balance card now labels the amount in BTC.
    await user.click(screen.getByTestId("app_shell.nav.home"));
    await screen.findByTestId("dashboard.balance_card");
    expect(
      screen.getByTestId("dashboard.balance_card.amount"),
    ).toHaveTextContent("BTC");
  });

  it("selects a theme and persists it across a remount", async () => {
    const user = await openSettings();

    await user.click(screen.getByTestId("settings.theme.dark"));
    expect(screen.getByTestId("settings.theme.dark")).toBeChecked();

    // A fresh mount reads the persisted preference back. The router keeps
    // the current URL, so the remount lands on the settings route again.
    cleanup();
    render(<App />);
    await screen.findByTestId("settings.theme");
    expect(screen.getByTestId("settings.theme.dark")).toBeChecked();
  });

  it("explains the operator managed server and stores no bridge credentials", async () => {
    await openSettings();
    expect(screen.getByTestId("settings.network")).toHaveTextContent(
      "XBT network",
    );
    expect(screen.queryByTestId("settings.server.host_input")).toBeNull();
    expect(screen.getByTestId("settings.section.server")).toHaveTextContent(
      "never stored in your browser",
    );
  });

  it("saves a manual XBT price and clears it without inventing a fallback", async () => {
    const user = await openSettings();
    await user.click(screen.getByRole("radio", { name: /^Manual$/ }));
    const price = screen.getByLabelText("USD per XBT");
    await user.type(price, "375.25");
    await user.click(screen.getByRole("button", { name: "Save price" }));
    expect(settingsService.getSettings()).toMatchObject({
      ok: true,
      value: { manualUsdPerXbt: 375.25 },
    });
    await user.clear(price);
    await user.click(screen.getByRole("button", { name: "Save price" }));
    const result = settingsService.getSettings();
    if (result.ok) expect(result.value.manualUsdPerXbt).toBeUndefined();
  });

  it("opens real connection status without a simulated success", async () => {
    const user = await openSettings();
    await user.click(screen.getByRole("link", { name: "Check connection" }));
    expect(
      await screen.findByTestId("status.connection_card"),
    ).toHaveTextContent("Offline");
  });

  it("resets preferences back to defaults", async () => {
    const user = await openSettings();

    await user.click(screen.getByTestId("settings.display_unit.btc"));
    expect(screen.getByTestId("settings.display_unit.btc")).toBeChecked();

    await user.click(screen.getByTestId("settings.reset_button"));

    await waitFor(() => {
      expect(screen.getByTestId("settings.display_unit.xbt")).toBeChecked();
    });
  });
});
