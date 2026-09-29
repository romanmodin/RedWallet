/**
 * Characterization tests for the server TLS control.
 *
 * The request keeps server host/port/TLS validation and the no-auto-fill
 * guarantee. The existing suite pins host and port validation and the empty
 * host default, but not the TLS switch itself. These tests pin the observable
 * TLS behavior that must survive the planned HTTPS-to-Fulcrum bridge work:
 *
 *   - TLS defaults to on and the switch reflects the persisted value;
 *   - toggling TLS makes the form dirty and persists `serverTls` on save;
 *   - the connection-test summary reflects the persisted TLS state;
 *   - the service-layer connection test accepts a TLS-off config.
 *
 * Everything runs against the in-memory demo service and jsdom; no network is
 * touched.
 */

import { LocalSettingsService } from "@/services/settingsService";
import { MockWalletService } from "@/services/walletService";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ServerSettingsFixture } from "./render";

async function openSettings() {
  const user = userEvent.setup();
  render(<ServerSettingsFixture />);
  return user;
}

describe("Server TLS control", () => {
  it("defaults to TLS on and reflects the persisted value", async () => {
    await openSettings();

    expect(screen.getByTestId("settings.server.tls_switch")).toBeChecked();
    expect(screen.getByText("TLS on")).toBeInTheDocument();
  });

  it("toggling TLS makes the form dirty and persists the value on save", async () => {
    const user = await openSettings();

    // The save button is disabled while the draft matches the persisted config.
    const save = screen.getByTestId("settings.server.save_button");
    expect(save).toBeDisabled();

    await user.click(screen.getByTestId("settings.server.tls_switch"));
    expect(screen.getByTestId("settings.server.tls_switch")).not.toBeChecked();
    expect(screen.getByText("TLS off")).toBeInTheDocument();
    expect(save).toBeEnabled();

    await user.type(
      screen.getByTestId("settings.server.host_input"),
      "electrum.example.org",
    );
    await user.click(save);
    await waitFor(() => {
      expect(
        screen.getByTestId("settings.server.saved_state"),
      ).toBeInTheDocument();
    });

    // The persisted settings carry the TLS-off choice.
    const persisted = new LocalSettingsService().getSettings();
    if (!persisted.ok) throw new Error("expected settings");
    expect(persisted.value.serverTls).toBe(false);
    expect(persisted.value.serverHost).toBe("electrum.example.org");
  });

  it("reflects the persisted TLS state in the connection-test summary", async () => {
    const user = await openSettings();

    await user.type(
      screen.getByTestId("settings.server.host_input"),
      "electrum.example.org",
    );
    await user.click(screen.getByTestId("settings.server.save_button"));
    await waitFor(() => {
      expect(
        screen.getByTestId("settings.server.saved_state"),
      ).toBeInTheDocument();
    });

    // TLS on by default: the summary carries the TLS marker.
    expect(screen.getByTestId("settings.connection_test")).toHaveTextContent(
      "electrum.example.org:50002 · TLS",
    );

    // Turn TLS off and save; the summary drops the marker.
    await user.click(screen.getByTestId("settings.server.tls_switch"));
    await user.click(screen.getByTestId("settings.server.save_button"));
    await waitFor(() => {
      expect(screen.getByTestId("settings.connection_test")).toHaveTextContent(
        "electrum.example.org:50002",
      );
    });
    expect(
      screen.getByTestId("settings.connection_test"),
    ).not.toHaveTextContent("· TLS");
  });
});

describe("Service connection test with TLS off", () => {
  it("accepts a TLS-off config and still reports connected", async () => {
    const service = new MockWalletService();
    const result = await service.testServerConnection({
      network: "unconfigured",
      host: "electrum.example.org",
      port: 50001,
      tls: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.ok).toBe(true);
    expect(result.value.state).toBe("connected");
  });
});
