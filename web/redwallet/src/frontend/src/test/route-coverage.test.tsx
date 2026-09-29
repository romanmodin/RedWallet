/**
 * Route-coverage journey tests.
 *
 * The bridge work touched every RedWallet screen's data path (the service
 * singleton moved behind `BridgeWalletService`). These tests mount the real
 * `App` and walk every route, asserting each renders its page marker rather
 * than a blank screen. They complement the per-screen journey suites by
 * proving the whole route table still resolves after the service swap.
 *
 * Everything runs against the in-memory demo service and jsdom; no network is
 * touched.
 */

import App from "@/App";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

/** Each route's nav test id and the page marker it must render. */
const ROUTES: Array<{ nav: string; page: string }> = [
  { nav: "app_shell.nav.home", page: "dashboard.page" },
  { nav: "app_shell.nav.activity", page: "history.page" },
  { nav: "app_shell.nav.send", page: "send.page" },
  { nav: "app_shell.nav.wallets", page: "wallets.page" },
  { nav: "app_shell.nav.receive", page: "receive.page" },
  { nav: "app_shell.nav.network", page: "status.page" },
  { nav: "app_shell.nav.settings", page: "settings.page" },
];

describe("Route coverage after the bridge service swap", () => {
  it("renders every RedWallet route without a blank screen", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByTestId("dashboard.page");

    for (const route of ROUTES) {
      await user.click(screen.getByTestId(route.nav));
      expect(await screen.findByTestId(route.page)).toBeInTheDocument();
    }
  });

  it("keeps the demo-data label on every route", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByTestId("dashboard.page");

    for (const route of ROUTES) {
      await user.click(screen.getByTestId(route.nav));
      await screen.findByTestId(route.page);
      expect(screen.getAllByTestId("demo_banner").length).toBeGreaterThan(0);
    }
  });
});
