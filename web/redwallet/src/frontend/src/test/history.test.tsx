/**
 * History journey tests.
 *
 * Covers the activity list for the active wallet, URL-backed filters, the
 * empty-filter state, and navigation into a transaction detail view. All data
 * is the in-memory demo dataset behind the typed service seam.
 */

import App from "@/App";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

async function openHistory() {
  const user = userEvent.setup();
  render(<App />);
  await screen.findByTestId("dashboard.balance_card");
  await user.click(screen.getByTestId("app_shell.nav.activity"));
  await screen.findByTestId("history.list");
  return user;
}

describe("History", () => {
  it("lists the active wallet's demo transactions", async () => {
    await openHistory();

    // Primary Vault has five seeded transactions.
    expect(screen.getByTestId("history.item.1")).toBeInTheDocument();
    expect(screen.getByTestId("history.item.5")).toBeInTheDocument();
    expect(screen.queryByTestId("history.item.6")).not.toBeInTheDocument();

    // The most recent primary transaction is the 2h-old receive.
    expect(screen.getByTestId("history.item.1")).toHaveTextContent(
      "Invoice #2041 settlement",
    );
  });

  it("filters by status and reflects the filter in the URL", async () => {
    const user = await openHistory();

    await user.click(screen.getByTestId("history.status_filter.pending"));

    await waitFor(() => {
      expect(screen.getByTestId("history.item.1")).toHaveTextContent(
        "Hardware wallet top-up",
      );
    });
    expect(screen.queryByTestId("history.item.2")).not.toBeInTheDocument();
    expect(window.location.search).toContain("status=pending");
  });

  it("filters by direction", async () => {
    const user = await openHistory();

    await user.click(screen.getByTestId("history.direction_filter.receive"));

    await waitFor(() => {
      expect(screen.getByTestId("history.item.1")).toHaveTextContent(
        "Invoice #2041 settlement",
      );
    });
    // The pending send is excluded from a receive-only view.
    expect(
      screen.queryByText("Hardware wallet top-up"),
    ).not.toBeInTheDocument();
  });

  it("searches by note and shows the filtered empty state", async () => {
    const user = await openHistory();

    await user.type(screen.getByTestId("history.search_input"), "zzz-no-match");

    await waitFor(() => {
      expect(
        screen.getByTestId("history.empty_state.clear_filters_button"),
      ).toBeInTheDocument();
    });
    expect(screen.queryByTestId("history.item.1")).not.toBeInTheDocument();
  });

  it("opens a transaction detail view from the list", async () => {
    const user = await openHistory();

    await user.click(screen.getByTestId("history.item.1"));

    await screen.findByTestId("history.detail.page");
    await waitFor(() => {
      expect(screen.getByTestId("history.detail.amount")).toHaveTextContent(
        "+0.42000000 XBT",
      );
    });
    const detail = screen.getByTestId("history.detail.page");
    expect(
      within(detail).getByText("Invoice #2041 settlement"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("history.detail.back_to_list_button"),
    ).toBeInTheDocument();
  });
});
