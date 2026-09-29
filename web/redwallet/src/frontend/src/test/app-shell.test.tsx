/**
 * App shell and routing smoke tests.
 *
 * Renders the real `App` (router + providers) and asserts the default route
 * resolves to the dashboard without a blank screen, that the persistent demo
 * label is present, and that the responsive navigation exposes both the
 * desktop sidebar and the mobile bottom tab bar.
 */

import App from "@/App";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

describe("App shell", () => {
  it("renders the dashboard on the default route without a blank screen", async () => {
    render(<App />);

    expect(
      await screen.findByRole("heading", { name: "Dashboard" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("dashboard.page")).toBeInTheDocument();
  });

  it("shows the persistent demo-data label", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "Dashboard" });
    expect(screen.getAllByTestId("demo_banner").length).toBeGreaterThan(0);
  });

  it("exposes desktop sidebar navigation and mobile bottom tabs", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "Dashboard" });

    const navs = screen.getAllByRole("navigation", { name: "Primary" });
    expect(navs.length).toBeGreaterThanOrEqual(2);

    // Desktop sidebar carries the full nav set.
    const sidebar = navs[0];
    expect(within(sidebar).getByText("Wallets")).toBeInTheDocument();
    expect(within(sidebar).getByText("Receive")).toBeInTheDocument();
    expect(within(sidebar).getByText("Network")).toBeInTheDocument();

    // Mobile bottom bar carries the primary tabs.
    const bottomBar = navs[1];
    expect(within(bottomBar).getByText("Home")).toBeInTheDocument();
    expect(within(bottomBar).getByText("Activity")).toBeInTheDocument();
    expect(within(bottomBar).getByText("Send")).toBeInTheDocument();
    expect(within(bottomBar).getByText("Settings")).toBeInTheDocument();
  });

  it("marks the active route in navigation", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "Dashboard" });

    const homeLinks = screen.getAllByRole("link", { name: /Home/ });
    expect(
      homeLinks.some((link) => link.getAttribute("aria-current") === "page"),
    ).toBe(true);
  });
});
