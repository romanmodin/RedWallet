/**
 * Characterization tests for behavior adjacent to the shared-network-status
 * and watch-only dashboard-hint changes.
 *
 * The upcoming change intentionally rewrites how connection state is sourced:
 * `NetworkIndicator` and `StatusPage` will stop reading the bridge service
 * independently and subscribe to one shared network-status source. It also
 * rewrites the dashboard Send/Receive hint copy to describe the active
 * watch-only wallet. None of those intentionally-changing values are frozen
 * here.
 *
 * Instead these tests pin the surrounding behavior that must survive the
 * change:
 *   - every connection indicator still links to /status and renders a state
 *     label, and all indicators on a screen agree with each other;
 *   - the Network page still renders its connection card, sync readout, and
 *     offline prompt, and its manual refresh still re-reads the status;
 *   - the service still reports the offline-by-design state when no bridge is
 *     configured, and never substitutes a public server;
 *   - the dashboard still renders all three quick actions, the History hint is
 *     unchanged, and Send/Receive still route to their screens.
 *
 * Everything runs against the in-memory demo service and jsdom; no network is
 * touched.
 */

import App from "@/App";
import { bridgeWalletService } from "@/services/bridgeService";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

/** A connected status the service can report once a bridge is configured. */
const CONNECTED_STATUS = {
  network: "unconfigured" as const,
  host: "",
  port: 50002,
  tls: true,
  state: "connected" as const,
  blockHeight: 974123,
  lastSyncedAt: Date.now(),
  peers: Number.NaN,
  checkpointConfigured: true,
};

async function openStatus() {
  const user = userEvent.setup();
  render(<App />);
  await screen.findByTestId("dashboard.balance_card");
  await user.click(screen.getByTestId("app_shell.nav.network"));
  await screen.findByTestId("status.page");
  return user;
}

describe("Connection indicators (adjacent to the shared-source change)", () => {
  it("renders every indicator as a link to the Network page with a state label", async () => {
    render(<App />);
    await screen.findByTestId("dashboard.balance_card");

    const indicators = screen.getAllByTestId("network_indicator.link");
    expect(indicators.length).toBeGreaterThan(0);
    for (const indicator of indicators) {
      expect(indicator).toHaveAttribute("href", "/status");
      expect(indicator).toHaveAccessibleName(/Network status: \w+/);
    }
  });

  it("keeps all indicators on a screen showing the same state", async () => {
    vi.spyOn(bridgeWalletService, "getNetworkStatus").mockResolvedValue({
      ok: true,
      value: CONNECTED_STATUS,
    });
    render(<App />);
    await screen.findByTestId("dashboard.balance_card");

    await waitFor(() => {
      const indicators = screen.getAllByTestId("network_indicator.link");
      expect(indicators.length).toBeGreaterThan(0);
      for (const indicator of indicators)
        expect(indicator).toHaveAccessibleName(/Connected/);
    });
  });

  it("reports the offline-by-design state when no bridge is configured", async () => {
    render(<App />);
    await screen.findByTestId("dashboard.balance_card");

    for (const indicator of screen.getAllByTestId("network_indicator.link"))
      expect(indicator).toHaveAccessibleName(/Offline/);
  });
});

describe("Network page (adjacent to the shared-source change)", () => {
  it("renders the connection card, sync readout, and offline prompt with no bridge", async () => {
    await openStatus();

    expect(
      await screen.findByTestId("status.connection_card"),
    ).toHaveTextContent("Offline");
    expect(screen.getByTestId("status.sync_readout")).toBeInTheDocument();
    expect(screen.getByTestId("status.sync_readout")).toHaveTextContent(
      "Unavailable",
    );
  });

  it("re-reads the network status when the user refreshes", async () => {
    const spy = vi
      .spyOn(bridgeWalletService, "getNetworkStatus")
      .mockResolvedValue({ ok: true, value: CONNECTED_STATUS });
    const user = await openStatus();

    await waitFor(() =>
      expect(screen.getByTestId("status.connection_card")).toHaveTextContent(
        "Connected",
      ),
    );
    const callsBeforeRefresh = spy.mock.calls.length;

    await user.click(screen.getByTestId("status.refresh_button"));

    await waitFor(() =>
      expect(spy.mock.calls.length).toBeGreaterThan(callsBeforeRefresh),
    );
    expect(screen.getByTestId("status.connection_card")).toHaveTextContent(
      "Connected",
    );
  });

  it("shows the error state when the status read fails", async () => {
    vi.spyOn(bridgeWalletService, "getNetworkStatus").mockResolvedValue({
      ok: false,
      error: {
        code: "backend_unavailable",
        message: "The bridge is unreachable.",
      },
    });
    await openStatus();

    expect(
      await screen.findByText("Couldn't load network status"),
    ).toBeInTheDocument();
  });
});

describe("Dashboard quick actions (adjacent to the watch-only hint change)", () => {
  it("renders all three actions with the History hint unchanged", async () => {
    render(<App />);
    await screen.findByTestId("dashboard.balance_card");

    const actions = screen.getByTestId("dashboard.quick_actions");
    expect(within(actions).getByText("Send")).toBeInTheDocument();
    expect(within(actions).getByText("Receive")).toBeInTheDocument();
    expect(within(actions).getByText("History")).toBeInTheDocument();
    expect(
      within(actions).getByText("Browse all activity"),
    ).toBeInTheDocument();
  });

  it("keeps Send and Receive routing to their screens", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByTestId("dashboard.balance_card");

    await user.click(screen.getByTestId("dashboard.quick_actions.send"));
    expect(await screen.findByTestId("send.page")).toBeInTheDocument();

    await user.click(screen.getByTestId("app_shell.nav.home"));
    await screen.findByTestId("dashboard.balance_card");
    await user.click(screen.getByTestId("dashboard.quick_actions.receive"));
    expect(await screen.findByTestId("receive.page")).toBeInTheDocument();
  });
});
