/**
 * Characterization baseline for the Settings screen and the Receive QR/copy
 * surface, captured before the collapsed Support/Donate disclosure is added at
 * the bottom of Settings.
 *
 * The accepted change only appends a new disclosure. Everything asserted here
 * is existing behavior that must remain unchanged: the Settings sections and
 * their controls, the operator-managed server copy, the reset action, and the
 * Receive address/QR/copy contract. These tests deliberately do not assert the
 * new disclosure, which does not exist yet.
 *
 * All data is device-local demo data; no network is touched.
 */

import App from "@/App";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

/** Mount the app and navigate to Settings, waiting past its loading pass. */
async function openSettings() {
  const user = userEvent.setup();
  render(<App />);
  await screen.findByTestId("dashboard.balance_card");
  await user.click(screen.getByTestId("app_shell.nav.settings"));
  await screen.findByTestId("settings.display_unit");
  return user;
}

/** Mount the app and navigate to Receive via the dashboard quick action. */
async function openReceive() {
  const user = userEvent.setup({ writeToClipboard: false });
  render(<App />);
  await screen.findByTestId("dashboard.balance_card");
  await user.click(screen.getByTestId("dashboard.quick_actions.receive"));
  await screen.findByTestId("receive.qr_card");
  return user;
}

describe("Settings baseline before the Support/Donate addition", () => {
  it("keeps every existing settings section and its controls", async () => {
    await openSettings();

    // The four preference sections the page has always rendered.
    expect(screen.getByTestId("settings.section.display")).toBeInTheDocument();
    expect(screen.getByTestId("settings.section.price")).toBeInTheDocument();
    expect(screen.getByTestId("settings.section.theme")).toBeInTheDocument();
    expect(screen.getByTestId("settings.section.network")).toBeInTheDocument();
    expect(screen.getByTestId("settings.section.server")).toBeInTheDocument();

    // Their interactive controls remain present and reachable.
    expect(screen.getByTestId("settings.display_unit.xbt")).toBeInTheDocument();
    expect(screen.getByTestId("settings.display_unit.btc")).toBeInTheDocument();
    expect(screen.getByTestId("settings.theme.light")).toBeInTheDocument();
    expect(screen.getByTestId("settings.theme.dark")).toBeInTheDocument();
    expect(screen.getByTestId("settings.theme.system")).toBeInTheDocument();
    expect(screen.getByLabelText("USD per XBT")).toBeInTheDocument();
    expect(screen.getByTestId("settings.reset_button")).toBeInTheDocument();
  });

  it("keeps the operator-managed server copy and stores no credentials", async () => {
    await openSettings();

    expect(screen.getByTestId("settings.section.server")).toHaveTextContent(
      "never stored in your browser",
    );
    // No host/port/secret inputs exist on this screen.
    expect(screen.queryByTestId("settings.server.host_input")).toBeNull();
    expect(screen.queryByTestId("settings.server.port_input")).toBeNull();
  });

  it("keeps the manual price validation for a non-positive value", async () => {
    const user = await openSettings();
    const price = screen.getByLabelText("USD per XBT");

    await user.type(price, "-5");
    await user.click(screen.getByRole("button", { name: "Save price" }));

    expect(screen.getByRole("alert")).toHaveTextContent(/positive USD price/i);
  });

  it("keeps the reset action restoring the default display unit", async () => {
    const user = await openSettings();

    await user.click(screen.getByTestId("settings.display_unit.btc"));
    expect(screen.getByTestId("settings.display_unit.btc")).toBeChecked();

    await user.click(screen.getByTestId("settings.reset_button"));
    await waitFor(() => {
      expect(screen.getByTestId("settings.display_unit.xbt")).toBeChecked();
    });
  });
});

describe("Receive baseline before the Support/Donate addition", () => {
  it("keeps the demo address, QR code, and demo warning", async () => {
    await openReceive();

    expect(screen.getByTestId("receive.address_text")).toHaveTextContent(
      "xbt-demo-address-not-valid",
    );
    expect(
      screen.getByTestId("receive.qr_card").querySelector("svg"),
    ).not.toBeNull();
    expect(screen.getByTestId("receive.demo_warning")).toHaveTextContent(
      /not a real wallet address/i,
    );
  });

  it("keeps copy success feedback and the copied value", async () => {
    const user = await openReceive();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const address = screen.getByTestId("receive.address_text").textContent;

    await user.click(screen.getByTestId("receive.copy_button"));

    await waitFor(() => {
      expect(screen.getByTestId("receive.copy_feedback")).toHaveTextContent(
        "Copied to clipboard.",
      );
    });
    expect(writeText).toHaveBeenCalledWith(address);
  });

  it("keeps the recoverable copy-failure message", async () => {
    const user = await openReceive();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });

    await user.click(screen.getByTestId("receive.copy_button"));

    await waitFor(() => {
      expect(screen.getByTestId("receive.copy_feedback")).toHaveTextContent(
        /Couldn't copy automatically/,
      );
    });
  });
});
