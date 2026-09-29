/**
 * Receive screen journey tests.
 *
 * Asserts the demo receive address, the QR code, and the copy action's
 * success feedback. The address is display-only demo data — no key material
 * is involved anywhere.
 */

import App from "@/App";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

async function openReceive() {
  // `writeToClipboard: false` keeps userEvent from installing its own
  // clipboard stub, so each test controls `navigator.clipboard` directly.
  const user = userEvent.setup({ writeToClipboard: false });
  render(<App />);
  await screen.findByTestId("dashboard.balance_card");
  await user.click(screen.getByTestId("dashboard.quick_actions.receive"));
  await screen.findByTestId("receive.qr_card");
  return user;
}

describe("Receive screen", () => {
  it("shows the invalid XBT demo address and a QR code", async () => {
    await openReceive();

    const address = screen.getByTestId("receive.address_text");
    // The accepted change replaces the old bc1-prefixed example with an
    // unmistakably invalid demo string that carries no real address prefix.
    expect(address.textContent).toBe("xbt-demo-address-not-valid");
    expect(address.textContent).not.toMatch(/^bc1/);

    // The QR card renders an SVG encoding the address.
    const qr = screen.getByTestId("receive.qr_card");
    expect(qr.querySelector("svg")).not.toBeNull();
    expect(screen.getByTestId("receive.demo_warning")).toHaveTextContent(
      /not a real wallet address/i,
    );
  });

  it("reports success after copying the address", async () => {
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

  it("shows a recoverable message when copying fails", async () => {
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

  it("shows the receiving wallet name", async () => {
    await openReceive();
    expect(screen.getByTestId("receive.wallet_name")).toHaveTextContent(
      "Primary Vault",
    );
  });
});
