/**
 * Send flow journey tests.
 *
 * Drives the real two-step demo send flow: validation, a live fee estimate,
 * the review summary, and the intentionally disabled demo-only confirm.
 * Nothing here broadcasts — the assertions protect that guarantee.
 */

import App from "@/App";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

/**
 * The accepted change replaces the old bc1-prefixed example with an
 * unmistakably invalid XBT demo string. The Send flow must accept it without
 * applying any BTC address rules.
 */
const DEMO_ADDRESS = "xbt-demo-address-not-valid";

async function openSend() {
  const user = userEvent.setup();
  render(<App />);
  await screen.findByTestId("dashboard.balance_card");
  await user.click(screen.getByTestId("dashboard.quick_actions.send"));
  await screen.findByTestId("send.form");
  return user;
}

describe("Send flow", () => {
  it("labels the recipient field as an XBT demo recipient", async () => {
    await openSend();

    // The accepted change renames the field and its helper to XBT demo copy.
    expect(screen.getByLabelText("XBT recipient address (demo)")).toBe(
      screen.getByTestId("send.recipient_input"),
    );
    expect(screen.getByText(/XBT demo recipient/i)).toBeInTheDocument();
    // No BTC/Bitcoin compatibility claim remains on the field.
    expect(screen.queryByText(/bitcoin/i)).not.toBeInTheDocument();
  });

  it("accepts the invalid XBT demo address without BTC address validation", async () => {
    const user = await openSend();

    // A string that is not a valid BTC address (no bc1/1/3 prefix) must pass
    // the demo recipient check, proving no BTC address rules are applied.
    await user.type(screen.getByTestId("send.recipient_input"), DEMO_ADDRESS);
    await user.type(screen.getByTestId("send.amount_input"), "0.1");
    await user.click(screen.getByTestId("send.review_button"));

    expect(await screen.findByTestId("send.review")).toBeInTheDocument();
    expect(
      screen.queryByTestId("send.recipient_error"),
    ).not.toBeInTheDocument();
  });

  it("shows a fee estimate once a valid amount is entered", async () => {
    const user = await openSend();

    await user.type(screen.getByTestId("send.amount_input"), "0.5");

    await waitFor(
      () => {
        const fee = screen.getByTestId("send.fee_estimate");
        expect(fee).toHaveTextContent("Estimated network fee");
        expect(fee).toHaveTextContent(/sat\/vB/);
      },
      { timeout: 3000 },
    );
  });

  it("validates the recipient and amount before review", async () => {
    const user = await openSend();

    await user.click(screen.getByTestId("send.review_button"));

    expect(screen.getByTestId("send.recipient_error")).toHaveTextContent(
      "Enter a recipient address.",
    );
    expect(screen.getByTestId("send.amount_error")).toHaveTextContent(
      "Enter an amount to send.",
    );
    // Still on step one.
    expect(screen.getByTestId("send.form")).toBeInTheDocument();
  });

  it("rejects an amount above the demo balance", async () => {
    const user = await openSend();

    await user.type(screen.getByTestId("send.recipient_input"), DEMO_ADDRESS);
    await user.type(screen.getByTestId("send.amount_input"), "999");
    await user.click(screen.getByTestId("send.review_button"));

    expect(screen.getByTestId("send.amount_error")).toHaveTextContent(
      /exceeds your available balance/,
    );
  });

  it("reviews the payment and disables the demo-only confirm", async () => {
    const user = await openSend();

    await user.type(screen.getByTestId("send.recipient_input"), DEMO_ADDRESS);
    await user.type(screen.getByTestId("send.amount_input"), "0.25");
    await user.type(screen.getByTestId("send.note_input"), "Test payment");

    // Wait for the fee estimate so the review can include it.
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
    expect(within(review).getByText("Review payment")).toBeInTheDocument();
    expect(within(review).getByText("Recipient")).toBeInTheDocument();
    expect(within(review).getByText("Estimated fee")).toBeInTheDocument();
    expect(within(review).getByText("Total")).toBeInTheDocument();
    expect(within(review).getByText("Test payment")).toBeInTheDocument();

    const confirm = within(review).getByTestId("send.confirm_button");
    expect(confirm).toBeDisabled();
    expect(confirm).toHaveAttribute("aria-disabled", "true");

    expect(screen.getByTestId("send.demo_notice")).toHaveTextContent(
      /No real transaction is created, signed, or broadcast/,
    );
  });

  it("returns to the form from the review step", async () => {
    const user = await openSend();

    await user.type(screen.getByTestId("send.recipient_input"), DEMO_ADDRESS);
    await user.type(screen.getByTestId("send.amount_input"), "0.1");
    await user.click(screen.getByTestId("send.review_button"));

    await screen.findByTestId("send.review");
    await user.click(screen.getByTestId("send.back_button"));

    expect(await screen.findByTestId("send.form")).toBeInTheDocument();
  });
});
