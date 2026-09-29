/**
 * Characterization tests for service-layer and settings-validation behavior
 * that must survive the planned HTTPS-to-Fulcrum bridge work.
 *
 * The request keeps the existing read-only demo service layer's observable
 * behavior for balance, history, fee estimate, network status, and server
 * connection test, and keeps server host/port/TLS validation with no
 * auto-filled public server. These tests pin the branches the existing suite
 * does not already exercise directly:
 *
 *   - `getBalance` success and unknown-wallet paths;
 *   - `getFiatRate` served only from the local fallback constant;
 *   - `testServerConnection`'s empty-host branch (offline, not error);
 *   - `addDemoWallet`'s empty-name rejection;
 *   - `getTransaction`'s success path;
 *   - settings partial-merge and save normalization;
 *   - the ServerSetting host-empty inline validation;
 *   - the transaction detail's signed amount for a send.
 *
 * Everything runs against the in-memory demo service and jsdom; no network is
 * touched.
 */

import App from "@/App";
import { fetchFiatRate } from "@/services/fiatRate";
import { LocalSettingsService } from "@/services/settingsService";
import {
  FALLBACK_USD_PER_XBT,
  MockWalletService,
} from "@/services/walletService";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ServerSettingsFixture } from "./render";

describe("MockWalletService balance reads", () => {
  it("returns the seeded balance for a known wallet", async () => {
    const service = new MockWalletService();
    const result = await service.getBalance("wlt-primary");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBe(1.2485);
  });

  it("returns a not_found error for an unknown wallet", async () => {
    const service = new MockWalletService();
    const result = await service.getBalance("wlt-nope");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("not_found");
  });
});

describe("MockWalletService fiat rate", () => {
  it("serves the fixed local fallback rate with no network source", async () => {
    const service = new MockWalletService();
    const result = await service.getFiatRate();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.usdPerXbt).toBe(FALLBACK_USD_PER_XBT);
    expect(result.value.source).toBe("fallback");
  });

  it("resolves the module-level fetchFiatRate to the same local fallback", async () => {
    const result = await fetchFiatRate();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.usdPerXbt).toBe(FALLBACK_USD_PER_XBT);
    expect(result.value.source).toBe("fallback");
  });
});

describe("MockWalletService server connection test branches", () => {
  it("reports offline (not error) when the host is empty", async () => {
    const service = new MockWalletService();
    const result = await service.testServerConnection({
      network: "unconfigured",
      host: "",
      port: 50002,
      tls: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.ok).toBe(false);
    expect(result.value.state).toBe("offline");
    expect(result.value.latencyMs).toBeNull();
  });

  it("treats a whitespace-only host as empty", async () => {
    const service = new MockWalletService();
    const result = await service.testServerConnection({
      network: "unconfigured",
      host: "   ",
      port: 50002,
      tls: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.state).toBe("offline");
  });

  it("reports connected for a valid host and port", async () => {
    const service = new MockWalletService();
    const result = await service.testServerConnection({
      network: "unconfigured",
      host: "electrum.example.org",
      port: 50002,
      tls: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.ok).toBe(true);
    expect(result.value.state).toBe("connected");
    expect(result.value.latencyMs).not.toBeNull();
  });
});

describe("MockWalletService wallet creation", () => {
  it("rejects an empty or whitespace-only name", async () => {
    const service = new MockWalletService();
    const empty = await service.addDemoWallet("");
    expect(empty.ok).toBe(false);
    if (empty.ok) return;
    expect(empty.error.code).toBe("invalid_input");

    const blank = await service.addDemoWallet("   ");
    expect(blank.ok).toBe(false);
    if (blank.ok) return;
    expect(blank.error.code).toBe("invalid_input");
  });

  it("trims the name and starts the new wallet at a zero balance", async () => {
    const service = new MockWalletService();
    const created = await service.addDemoWallet("  Travel Fund  ");
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value.name).toBe("Travel Fund");
    expect(created.value.balanceXbt).toBe(0);
    expect(created.value.isDemo).toBe(true);
  });
});

describe("MockWalletService transaction reads", () => {
  it("returns a seeded transaction by id", async () => {
    const service = new MockWalletService();
    const result = await service.getTransaction("tx-001");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.id).toBe("tx-001");
    expect(result.value.walletId).toBe("wlt-primary");
  });
});

describe("LocalSettingsService partial updates", () => {
  it("merges a patch over the current settings without dropping other fields", () => {
    const service = new LocalSettingsService();
    service.updateSettings({ displayUnit: "BTC" });
    const result = service.updateSettings({
      serverHost: "electrum.example.org",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.displayUnit).toBe("BTC");
    expect(result.value.serverHost).toBe("electrum.example.org");
    // Untouched fields keep their defaults.
    expect(result.value.serverPort).toBe(50002);
    expect(result.value.serverTls).toBe(true);
    expect(result.value.network).toBe("unconfigured");
  });

  it("normalizes an out-of-range port on save", () => {
    const service = new LocalSettingsService();
    const result = service.saveSettings({
      displayUnit: "XBT",
      theme: "system",
      network: "unconfigured",
      serverHost: "electrum.example.org",
      serverPort: 70000,
      serverTls: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.serverPort).toBe(50002);
  });
});

describe("ServerSetting host validation", () => {
  async function openSettings() {
    const user = userEvent.setup();
    render(<ServerSettingsFixture />);
    return user;
  }

  it("rejects an empty host with an inline error and does not persist", async () => {
    const user = await openSettings();

    // Persist a host first so clearing it makes the form dirty (the save
    // button is disabled while the draft matches the persisted config).
    const hostInput = screen.getByTestId("settings.server.host_input");
    await user.type(hostInput, "electrum.example.org");
    await user.click(screen.getByTestId("settings.server.save_button"));
    await waitFor(() => {
      expect(
        screen.getByTestId("settings.server.saved_state"),
      ).toBeInTheDocument();
    });

    // Clear the host and try to save: the inline error appears and the
    // previously saved state is not re-asserted.
    await user.clear(hostInput);
    await user.click(screen.getByTestId("settings.server.save_button"));

    expect(screen.getByTestId("settings.server.host_error")).toHaveTextContent(
      "Enter a server host to connect to.",
    );
    expect(
      screen.queryByTestId("settings.server.saved_state"),
    ).not.toBeInTheDocument();
  });

  it("keeps the host empty by default and never auto-fills a server", async () => {
    await openSettings();
    expect(screen.getByTestId("settings.server.host_input")).toHaveValue("");
  });
});

describe("Transaction detail signed amount", () => {
  it("shows a negative signed amount for a send", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByTestId("dashboard.balance_card");
    await user.click(screen.getByTestId("app_shell.nav.activity"));
    await screen.findByTestId("history.list");

    // Filter to the pending send, then open it.
    await user.click(screen.getByTestId("history.status_filter.pending"));
    await waitFor(() => {
      expect(screen.getByTestId("history.item.1")).toHaveTextContent(
        "Hardware wallet top-up",
      );
    });
    await user.click(screen.getByTestId("history.item.1"));

    await screen.findByTestId("history.detail.page");
    await waitFor(() => {
      expect(screen.getByTestId("history.detail.amount")).toHaveTextContent(
        "−0.07500000 XBT",
      );
    });
    const detail = screen.getByTestId("history.detail.page");
    expect(within(detail).getAllByText("Sent").length).toBeGreaterThan(0);
    expect(
      within(detail).getByText("Awaiting confirmation"),
    ).toBeInTheDocument();
  });
});
