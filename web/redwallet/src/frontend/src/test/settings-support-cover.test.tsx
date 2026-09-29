/**
 * Cover tests for the collapsed Support RedWallet / Donate disclosure added to
 * the bottom of the Settings page.
 *
 * These assert the accepted observable behavior: a collapsed-by-default
 * accessible trigger whose `aria-expanded` reflects state, the free/voluntary
 * copy, the exact XBT (BLAKE2b) address, a raw-address QR rendered by the
 * existing QR component, and copy success/failure feedback. They also assert
 * the exclusions: no banner/popup/amount/URI/redirect, and watch-only sending
 * stays unavailable.
 *
 * All data is device-local demo data; no network is touched.
 */

import App from "@/App";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const SUPPORT_ADDRESS = "bc1q86uhqahctvu7ygjenrcpp9c6dmxu6s8wzktfd4";

/** Mount the app and navigate to Settings, waiting past its loading pass. */
async function openSettings() {
  const user = userEvent.setup({ writeToClipboard: false });
  render(<App />);
  await screen.findByTestId("dashboard.balance_card");
  await user.click(screen.getByTestId("app_shell.nav.settings"));
  await screen.findByTestId("settings.display_unit");
  return user;
}

/** Expand the Support disclosure and return the user for further interaction. */
async function expandSupport() {
  const user = await openSettings();
  await user.click(screen.getByTestId("settings.support.toggle"));
  await screen.findByTestId("settings.support.address_text");
  return user;
}

describe("Settings Support RedWallet disclosure", () => {
  it("renders collapsed by default with an accessible trigger", async () => {
    await openSettings();

    const trigger = screen.getByTestId("settings.support.toggle");
    // The trigger is a real button, not a div with a click handler.
    expect(trigger.tagName).toBe("BUTTON");
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    // Collapsed: the donation details are not in the accessibility tree.
    expect(screen.queryByTestId("settings.support.address_text")).toBeNull();
    expect(screen.queryByTestId("settings.support.copy_button")).toBeNull();
  });

  it("reflects expanded state on the trigger and reveals the details", async () => {
    const user = await openSettings();
    const trigger = screen.getByTestId("settings.support.toggle");

    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");

    const address = await screen.findByTestId("settings.support.address_text");
    expect(address).toHaveTextContent(SUPPORT_ADDRESS);

    // The free / voluntary-donation explanation is present.
    const section = screen.getByTestId("settings.section.support");
    expect(section).toHaveTextContent(/RedWallet is free/i);
    expect(section).toHaveTextContent(/voluntary XBT donations/i);
    expect(section).toHaveTextContent(/development and testing/i);

    // Collapsing again hides the details and flips aria-expanded back.
    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    await waitFor(() => {
      expect(screen.queryByTestId("settings.support.address_text")).toBeNull();
    });
  });

  it("shows XBT (BLAKE2b) only, the exact address, and a raw-address QR", async () => {
    await expandSupport();

    const section = screen.getByTestId("settings.section.support");
    expect(section).toHaveTextContent("XBT (BLAKE2b)");
    // No other ticker is offered on this surface.
    expect(section).not.toHaveTextContent(/\bBTC\b/);

    expect(
      screen.getByTestId("settings.support.address_text"),
    ).toHaveTextContent(SUPPORT_ADDRESS);

    // The existing QR component renders an SVG encoding the raw address.
    const qr = section.querySelector("svg");
    expect(qr).not.toBeNull();
    expect(qr?.querySelector("path")).not.toBeNull();
  });

  it("reports copy success and writes the exact address to the clipboard", async () => {
    const user = await expandSupport();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    await user.click(screen.getByTestId("settings.support.copy_button"));

    await waitFor(() => {
      expect(
        screen.getByTestId("settings.support.copy_feedback"),
      ).toHaveTextContent("Copied to clipboard.");
    });
    expect(writeText).toHaveBeenCalledWith(SUPPORT_ADDRESS);
  });

  it("reports a clear failure when the clipboard rejects", async () => {
    const user = await expandSupport();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });

    await user.click(screen.getByTestId("settings.support.copy_button"));

    await waitFor(() => {
      expect(
        screen.getByTestId("settings.support.copy_feedback"),
      ).toHaveTextContent(/Couldn't copy automatically/);
    });
  });

  it("offers no banner, suggested amount, payment URI, or external redirect", async () => {
    await expandSupport();

    const section = screen.getByTestId("settings.section.support");
    // No bitcoin URI or suggested amount anywhere in the disclosure.
    expect(section.textContent ?? "").not.toMatch(/bitcoin:/i);
    expect(section.textContent ?? "").not.toMatch(
      /\b\d+(\.\d+)?\s*(XBT|BTC|sats?)\b/i,
    );

    // No anchor/redirect out of the app from the support surface.
    expect(within(section).queryAllByRole("link")).toHaveLength(0);
  });

  it("keeps watch-only sending unavailable", async () => {
    // Seed a watch-only wallet and make it active. The bridge service reads
    // this device-local list; no backend call is needed to select it.
    const watchId = "watch-cover-test";
    window.localStorage.setItem(
      "redwallet.watch-wallets.v1",
      JSON.stringify([
        { id: watchId, name: "Watched", address: SUPPORT_ADDRESS },
      ]),
    );
    window.localStorage.setItem("redwallet.active-wallet.v1", watchId);

    const user = userEvent.setup();
    render(<App />);
    await screen.findByTestId("dashboard.balance_card");

    await user.click(screen.getByTestId("app_shell.nav.send"));
    await screen.findByTestId("send.page");
    expect(screen.getByTestId("send.page")).toHaveTextContent(
      /Sending is unavailable/i,
    );
  });
});
