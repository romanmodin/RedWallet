/**
 * Characterization tests for behavior adjacent to the planned safety-copy
 * correction.
 *
 * The upcoming change intentionally rewrites the Send recipient label/helper
 * copy and its address-shape rule, replaces the Receive demo address literal,
 * swaps transaction counterparty address literals, and rewords Bitcoin/BTC
 * references. None of those intentionally-changing values are frozen here.
 *
 * Instead these tests pin the surrounding behavior that must survive the
 * change: the amount-validation branches, the fee estimate, the review
 * structure and its disabled demo-only confirm, the back navigation, the
 * Receive copy feedback and QR rendering, the service-layer contract, and the
 * pure formatting helpers. Everything runs against the in-memory demo service
 * and jsdom; no network is touched.
 */

import App from "@/App";
import { formatAmount, formatFiat, truncateAddress } from "@/lib/format";
import {
  DEFAULT_SETTINGS,
  LocalSettingsService,
} from "@/services/settingsService";
import { MockWalletService } from "@/services/walletService";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

/** A syntactically plausible recipient used only to reach the amount checks. */
const RECIPIENT = "xbt-demo-address-not-valid";

async function openSend() {
  const user = userEvent.setup();
  render(<App />);
  await screen.findByTestId("dashboard.balance_card");
  await user.click(screen.getByTestId("dashboard.quick_actions.send"));
  await screen.findByTestId("send.form");
  return user;
}

async function openReceive() {
  const user = userEvent.setup({ writeToClipboard: false });
  render(<App />);
  await screen.findByTestId("dashboard.balance_card");
  await user.click(screen.getByTestId("dashboard.quick_actions.receive"));
  await screen.findByTestId("receive.qr_card");
  return user;
}

describe("Send amount validation (adjacent to the recipient-copy change)", () => {
  it("rejects a non-numeric amount", async () => {
    const user = await openSend();

    await user.type(screen.getByTestId("send.recipient_input"), RECIPIENT);
    await user.type(screen.getByTestId("send.amount_input"), "abc");
    await user.click(screen.getByTestId("send.review_button"));

    expect(screen.getByTestId("send.amount_error")).toHaveTextContent(
      "Enter a valid number.",
    );
    // Still on step one.
    expect(screen.getByTestId("send.form")).toBeInTheDocument();
  });

  it("rejects a zero amount", async () => {
    const user = await openSend();

    await user.type(screen.getByTestId("send.recipient_input"), RECIPIENT);
    await user.type(screen.getByTestId("send.amount_input"), "0");
    await user.click(screen.getByTestId("send.review_button"));

    expect(screen.getByTestId("send.amount_error")).toHaveTextContent(
      "Amount must be greater than zero.",
    );
  });

  it("clears the amount error once the user edits the amount", async () => {
    const user = await openSend();

    await user.type(screen.getByTestId("send.recipient_input"), RECIPIENT);
    await user.click(screen.getByTestId("send.review_button"));
    expect(screen.getByTestId("send.amount_error")).toBeInTheDocument();

    await user.type(screen.getByTestId("send.amount_input"), "0.1");
    expect(screen.queryByTestId("send.amount_error")).not.toBeInTheDocument();
  });

  it("fills the amount from the Use max control", async () => {
    const user = await openSend();

    await user.click(screen.getByTestId("send.max_button"));

    expect(screen.getByTestId("send.amount_input")).toHaveValue("1.2485");
  });
});

describe("Send review structure (adjacent to the recipient-copy change)", () => {
  it("shows the amount, fee, and total rows and keeps confirm disabled", async () => {
    const user = await openSend();

    await user.type(screen.getByTestId("send.recipient_input"), RECIPIENT);
    await user.type(screen.getByTestId("send.amount_input"), "0.25");

    await waitFor(
      () => {
        expect(screen.getByTestId("send.fee_estimate")).toHaveTextContent(
          /sat\/vB/,
        );
      },
      { timeout: 3000 },
    );

    await user.click(screen.getByTestId("send.review_button"));

    const review = await screen.findByTestId("send.review");
    expect(within(review).getByText("Amount")).toBeInTheDocument();
    expect(within(review).getByText("Estimated fee")).toBeInTheDocument();
    expect(within(review).getByText("Total")).toBeInTheDocument();
    expect(within(review).getByText("0.25000000 XBT")).toBeInTheDocument();

    const confirm = within(review).getByTestId("send.confirm_button");
    expect(confirm).toBeDisabled();
    expect(confirm).toHaveAttribute("aria-disabled", "true");
  });

  it("omits the note block when no note is entered", async () => {
    const user = await openSend();

    await user.type(screen.getByTestId("send.recipient_input"), RECIPIENT);
    await user.type(screen.getByTestId("send.amount_input"), "0.1");
    await user.click(screen.getByTestId("send.review_button"));

    const review = await screen.findByTestId("send.review");
    expect(within(review).queryByText("Note")).not.toBeInTheDocument();
  });

  it("preserves the entered values when returning to the form", async () => {
    const user = await openSend();

    await user.type(screen.getByTestId("send.recipient_input"), RECIPIENT);
    await user.type(screen.getByTestId("send.amount_input"), "0.1");
    await user.click(screen.getByTestId("send.review_button"));
    await screen.findByTestId("send.review");

    await user.click(screen.getByTestId("send.back_button"));

    expect(await screen.findByTestId("send.form")).toBeInTheDocument();
    expect(screen.getByTestId("send.recipient_input")).toHaveValue(RECIPIENT);
    expect(screen.getByTestId("send.amount_input")).toHaveValue("0.1");
  });
});

describe("Receive copy feedback and QR (adjacent to the address-literal change)", () => {
  it("renders a QR SVG for the displayed address", async () => {
    await openReceive();

    const qr = screen.getByTestId("receive.qr_card");
    expect(qr.querySelector("svg")).not.toBeNull();
    expect(screen.getByTestId("receive.address_text").textContent).not.toBe("");
  });

  it("copies the displayed address and reports success", async () => {
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
});

describe("Service contract (adjacent to the address-literal change)", () => {
  it("keeps the demo-only send result shape", async () => {
    const service = new MockWalletService();
    const result = await service.sendDemoTransaction({
      walletId: "wlt-primary",
      recipientAddress: RECIPIENT,
      amountXbt: 0.01,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.broadcast).toBe(false);
    expect(result.value.demo).toBe(true);
    expect(result.value.transaction.status).toBe("pending");
    expect(result.value.transaction.direction).toBe("send");
  });

  it("filters transactions by status and direction", async () => {
    const service = new MockWalletService();

    const pending = await service.listTransactions("wlt-primary", {
      status: "pending",
    });
    if (!pending.ok) throw new Error("expected pending");
    expect(pending.value.every((tx) => tx.status === "pending")).toBe(true);

    const received = await service.listTransactions("wlt-primary", {
      direction: "receive",
    });
    if (!received.ok) throw new Error("expected received");
    expect(received.value.every((tx) => tx.direction === "receive")).toBe(true);
  });

  it("returns transactions newest-first", async () => {
    const service = new MockWalletService();
    const result = await service.listTransactions("wlt-primary");
    if (!result.ok) throw new Error("expected transactions");
    const timestamps = result.value.map((tx) => tx.timestamp);
    expect(timestamps).toEqual([...timestamps].sort((a, b) => b - a));
  });

  it("estimates a positive fee and rejects a zero amount", async () => {
    const service = new MockWalletService();

    const estimate = await service.estimateFee(0.5);
    expect(estimate.ok).toBe(true);
    if (!estimate.ok) return;
    expect(estimate.value.feeXbt).toBeGreaterThan(0);
    expect(estimate.value.satPerVbyte).toBeGreaterThan(0);

    const invalid = await service.estimateFee(0);
    expect(invalid.ok).toBe(false);
  });

  it("keeps settings defaults with no silent server host", () => {
    const service = new LocalSettingsService();
    const result = service.getSettings();
    if (!result.ok) throw new Error("expected settings");
    expect(result.value).toEqual(DEFAULT_SETTINGS);
    expect(result.value.serverHost).toBe("");
  });

  it("normalizes corrupt stored settings back to defaults", () => {
    window.localStorage.setItem(
      "redwallet.settings.v1",
      JSON.stringify({ displayUnit: "DOGE", serverPort: -5, theme: "neon" }),
    );
    const service = new LocalSettingsService();
    const result = service.getSettings();
    if (!result.ok) throw new Error("expected settings");
    expect(result.value.displayUnit).toBe(DEFAULT_SETTINGS.displayUnit);
    expect(result.value.theme).toBe(DEFAULT_SETTINGS.theme);
    expect(result.value.serverPort).toBe(DEFAULT_SETTINGS.serverPort);
  });
});

describe("Format helpers (unaffected by the copy change)", () => {
  it("formats amounts in the requested display unit", () => {
    expect(formatAmount(0.5, "XBT")).toBe("0.50000000 XBT");
    expect(formatAmount(0.5, "BTC")).toBe("0.50000000 BTC");
  });

  it("formats fiat as USD currency", () => {
    expect(formatFiat(48120.55)).toBe("$48,120.55");
  });

  it("truncates long values with a head and tail", () => {
    expect(truncateAddress("xbt-demo-address-not-valid")).toBe("xbt-demo…alid");
    expect(truncateAddress("")).toBe("—");
  });
});
