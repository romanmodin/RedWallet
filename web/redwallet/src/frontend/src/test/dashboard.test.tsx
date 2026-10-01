/**
 * Dashboard journey tests.
 *
 * Renders the real app at the default route and asserts the accepted
 * dashboard behavior: an XBT balance with a fiat equivalent, a working
 * hide/show toggle, and a wallet selector that updates the balance shown.
 */

import App from "@/App";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

describe("Dashboard", () => {
  it("hides demo accounts, offers empty onboarding, and restores them", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByTestId("dashboard.balance_card");
    await user.click(screen.getByTestId("app_shell.nav.wallets"));
    await user.click(
      await screen.findByRole("button", { name: "Hide demo accounts" }),
    );
    await screen.findByText("No wallets yet");
    await user.click(screen.getByTestId("app_shell.nav.home"));
    expect(await screen.findByText("No wallet selected")).toBeInTheDocument();
    expect(
      screen.queryByTestId("dashboard.balance_card"),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "Open wallets" }));
    await user.click(
      await screen.findByRole("button", { name: "Restore demo accounts" }),
    );
    await screen.findByText("Primary Vault");
  });
  it("shows the active wallet's XBT balance and fiat equivalent", async () => {
    render(<App />);

    const card = await screen.findByTestId("dashboard.balance_card");
    expect(within(card).getByText("Primary Vault")).toBeInTheDocument();

    const amount = within(card).getByTestId("dashboard.balance_card.amount");
    expect(amount).toHaveTextContent("1.24850000 XBT");
    expect(within(card).getByText(/≈ \$80,216\.13/)).toBeInTheDocument();
  });

  it("hides and shows the balance with the visibility toggle", async () => {
    const user = userEvent.setup();
    render(<App />);

    const card = await screen.findByTestId("dashboard.balance_card");
    const amount = within(card).getByTestId("dashboard.balance_card.amount");
    expect(amount).toHaveTextContent("1.24850000 XBT");

    await user.click(
      within(card).getByTestId("dashboard.balance_card.visibility_toggle"),
    );
    expect(amount).toHaveTextContent("••••••••");
    expect(amount).not.toHaveTextContent("1.24850000");

    await user.click(
      within(card).getByTestId("dashboard.balance_card.visibility_toggle"),
    );
    expect(amount).toHaveTextContent("1.24850000 XBT");
  });

  it("updates the dashboard balance when the active wallet changes", async () => {
    const user = userEvent.setup();
    render(<App />);

    const card = await screen.findByTestId("dashboard.balance_card");
    expect(
      within(card).getByTestId("dashboard.balance_card.amount"),
    ).toHaveTextContent("1.24850000 XBT");

    // Navigate to the wallet selector via the balance card link.
    await user.click(
      within(card).getByTestId("dashboard.balance_card.wallets_link"),
    );

    const list = await screen.findByTestId("wallets.list");
    const savings = within(list).getByText("Cold Savings");
    await user.click(savings);

    // The selector navigates home; the dashboard now shows the new balance.
    await waitFor(() => {
      expect(
        screen.getByTestId("dashboard.balance_card.amount"),
      ).toHaveTextContent("4.60210000 XBT");
    });
  });

  it("renders the persistent demo label on the dashboard", async () => {
    render(<App />);
    await screen.findByTestId("dashboard.balance_card");
    expect(screen.getAllByTestId("demo_banner").length).toBeGreaterThan(0);
    expect(
      screen.getByTestId("dashboard.balance_card.demo_pill"),
    ).toHaveTextContent("Demo");
  });
});
