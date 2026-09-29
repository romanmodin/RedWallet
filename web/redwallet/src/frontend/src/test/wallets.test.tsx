/**
 * Wallets journey tests.
 *
 * Covers listing demo wallets, switching the active wallet (and the dashboard
 * reflecting it), and adding a new clearly-labeled demo wallet. No keys or
 * real balances are involved anywhere.
 */

import App from "@/App";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

async function openWallets() {
  const user = userEvent.setup();
  render(<App />);
  await screen.findByTestId("dashboard.balance_card");
  await user.click(screen.getByTestId("app_shell.nav.wallets"));
  await screen.findByTestId("wallets.list");
  return user;
}

describe("Wallets", () => {
  it("lists the demo wallets with the active one marked", async () => {
    await openWallets();

    expect(screen.getByTestId("wallets.item.1")).toHaveTextContent(
      "Primary Vault",
    );
    expect(screen.getByTestId("wallets.item.2")).toHaveTextContent(
      "Cold Savings",
    );
    expect(screen.getByTestId("wallets.item.1")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("switches the active wallet and reflects it on the dashboard", async () => {
    const user = await openWallets();

    await user.click(screen.getByTestId("wallets.item.2"));

    // Selecting navigates home with the new wallet active.
    await screen.findByTestId("dashboard.balance_card");
    await waitFor(() => {
      expect(
        screen.getByTestId("dashboard.balance_card.amount"),
      ).toHaveTextContent("4.60210000 XBT");
    });
  });

  it("adds a new demo wallet by name", async () => {
    const user = await openWallets();

    await user.click(screen.getByTestId("wallets.add_button"));
    await screen.findByTestId("wallets.add_dialog");
    await user.selectOptions(screen.getByLabelText("Wallet type"), "demo");

    await user.type(screen.getByTestId("wallets.name_input"), "Travel Fund");
    await user.click(screen.getByTestId("wallets.submit_button"));

    await waitFor(() => {
      expect(screen.getByTestId("wallets.item.4")).toHaveTextContent(
        "Travel Fund",
      );
    });
  });
});
