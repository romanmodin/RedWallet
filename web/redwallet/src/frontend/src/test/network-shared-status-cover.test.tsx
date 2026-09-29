/**
 * Cover tests for the shared network-status source and the watch-only
 * dashboard hints.
 *
 * These pin the accepted behavior of the current change:
 *   - every connection indicator and the Network page read one shared latest
 *     result, so a later successful read updates all of them together;
 *   - a failed read surfaces as the error state to every consumer and never as
 *     a fabricated connected state;
 *   - the dashboard Send hint states sending is unavailable and the Receive
 *     hint asks to share the public address for a watch-only active wallet;
 *   - the service still deduplicates concurrent status reads behind one call.
 *
 * The backend actor is mocked at the service seam; no network is touched.
 */

import App from "@/App";
import { BridgeWalletService } from "@/services/bridgeService";
import type { BridgeActor } from "@/services/bridgeService";
import { bridgeWalletService } from "@/services/bridgeService";
import type { NetworkStatus, ServiceResult, Wallet } from "@/services/types";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const ADDRESS = "bc1q86uhqahctvu7ygjenrcpp9c6dmxu6s8wzktfd4";

function connectedStatus(blockHeight: number): NetworkStatus {
  return {
    network: "unconfigured",
    host: "",
    port: 50002,
    tls: true,
    state: "connected",
    blockHeight,
    lastSyncedAt: Date.now(),
    peers: Number.NaN,
    checkpointConfigured: true,
  };
}

const OFFLINE_STATUS: NetworkStatus = {
  network: "unconfigured",
  host: "",
  port: 0,
  tls: true,
  state: "offline",
  blockHeight: Number.NaN,
  lastSyncedAt: Number.NaN,
  peers: Number.NaN,
  checkpointConfigured: false,
};

/** A watch-only (non-demo) active wallet, as the bridge service reports it. */
const WATCH_WALLET: Wallet = {
  id: "watch-cover",
  name: "My XBT",
  address: ADDRESS,
  shortId: "bc1q86…ktfd4",
  isDemo: false,
  balanceXbt: 0.75,
  fiatValueUsd: Number.NaN,
};

/** Every indicator on screen, plus the Network page's connection card. */
function indicatorNames(): string[] {
  return screen
    .getAllByTestId("network_indicator.link")
    .map((el) => el.getAttribute("aria-label") ?? "");
}

async function openStatus() {
  const user = userEvent.setup();
  render(<App />);
  await screen.findByTestId("dashboard.balance_card");
  await user.click(screen.getByTestId("app_shell.nav.network"));
  await screen.findByTestId("status.page");
  return user;
}

describe("Shared network status transitions", () => {
  it("updates every indicator and the Network page together on a later successful read", async () => {
    const spy = vi
      .spyOn(bridgeWalletService, "getNetworkStatus")
      .mockResolvedValueOnce({ ok: true, value: connectedStatus(974123) })
      .mockResolvedValueOnce({ ok: true, value: connectedStatus(975000) });

    const user = await openStatus();

    // Initial read: all indicators and the page agree on the first result.
    await waitFor(() => {
      expect(indicatorNames().length).toBeGreaterThan(0);
      for (const name of indicatorNames()) expect(name).toMatch(/Connected/);
    });
    expect(screen.getByTestId("status.connection_card")).toHaveTextContent(
      "Connected",
    );
    expect(screen.getByTestId("status.sync_readout")).toHaveTextContent(
      "974,123",
    );

    // A later successful read must reach every consumer together.
    await user.click(screen.getByTestId("status.refresh_button"));

    await waitFor(() =>
      expect(screen.getByTestId("status.sync_readout")).toHaveTextContent(
        "975,000",
      ),
    );
    for (const name of indicatorNames()) expect(name).toMatch(/Connected/);
    expect(screen.getByTestId("status.connection_card")).toHaveTextContent(
      "Connected",
    );
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("surfaces a failed read as the error state to every consumer, never connected", async () => {
    vi.spyOn(bridgeWalletService, "getNetworkStatus").mockResolvedValue({
      ok: false,
      error: {
        code: "backend_unavailable",
        message: "The bridge is unreachable.",
      },
    });

    await openStatus();

    // The Network page shows the error state, not a fabricated connection.
    expect(
      await screen.findByText("Couldn't load network status"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("status.connection_card")).toBeNull();

    // Every indicator reports Error, and none reports Connected.
    const names = indicatorNames();
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(name).toMatch(/Error/);
      expect(name).not.toMatch(/Connected/);
    }
  });

  it("clears a previously connected reading when a later read fails", async () => {
    vi.spyOn(bridgeWalletService, "getNetworkStatus")
      .mockResolvedValueOnce({ ok: true, value: connectedStatus(974123) })
      .mockResolvedValueOnce({
        ok: false,
        error: {
          code: "backend_unavailable",
          message: "The bridge is unreachable.",
        },
      });

    const user = await openStatus();
    await waitFor(() =>
      expect(screen.getByTestId("status.connection_card")).toHaveTextContent(
        "Connected",
      ),
    );

    await user.click(screen.getByTestId("status.refresh_button"));

    expect(
      await screen.findByText("Couldn't load network status"),
    ).toBeInTheDocument();
    for (const name of indicatorNames()) {
      expect(name).toMatch(/Error/);
      expect(name).not.toMatch(/Connected/);
    }
  });

  it("reports the offline-by-design state to every consumer when no bridge is configured", async () => {
    vi.spyOn(bridgeWalletService, "getNetworkStatus").mockResolvedValue({
      ok: true,
      value: OFFLINE_STATUS,
    });

    await openStatus();

    await waitFor(() => {
      expect(indicatorNames().length).toBeGreaterThan(0);
      for (const name of indicatorNames()) expect(name).toMatch(/Offline/);
    });
    expect(screen.getByTestId("status.connection_card")).toHaveTextContent(
      "Offline",
    );
  });
});

describe("Watch-only dashboard hints", () => {
  it("states sending is unavailable and asks to share the public address", async () => {
    vi.spyOn(bridgeWalletService, "getActiveWallet").mockResolvedValue({
      ok: true,
      value: WATCH_WALLET,
    });
    vi.spyOn(bridgeWalletService, "listWallets").mockResolvedValue({
      ok: true,
      value: [WATCH_WALLET],
    });

    render(<App />);
    await screen.findByTestId("dashboard.balance_card");

    const actions = screen.getByTestId("dashboard.quick_actions");
    const send = within(actions).getByTestId("dashboard.quick_actions.send");
    const receive = within(actions).getByTestId(
      "dashboard.quick_actions.receive",
    );

    expect(send).toHaveTextContent("Sending unavailable — watch-only");
    expect(receive).toHaveTextContent("Share your public address");
    // The demo copy must not survive for a watch-only wallet.
    expect(send).not.toHaveTextContent("Create a demo transfer");
    expect(receive).not.toHaveTextContent("Share a demo address");
  });

  it("shows the watch-only hints for a demo active wallet too", async () => {
    render(<App />);
    await screen.findByTestId("dashboard.balance_card");

    const actions = screen.getByTestId("dashboard.quick_actions");
    const send = within(actions).getByTestId("dashboard.quick_actions.send");
    const receive = within(actions).getByTestId(
      "dashboard.quick_actions.receive",
    );

    // The hints are unconditional watch-only copy, even for demo wallets.
    expect(send).toHaveTextContent("Sending unavailable — watch-only");
    expect(receive).toHaveTextContent("Share your public address");
    // The old demo copy must not survive for any wallet.
    expect(send).not.toHaveTextContent("Create a demo transfer");
    expect(receive).not.toHaveTextContent("Share a demo address");
  });
});

describe("In-flight status deduplication", () => {
  it("shares one service call across concurrent reads and starts a fresh read after it settles", async () => {
    let resolveStatus: (value: ServiceResult<NetworkStatus>) => void = () => {};
    const pending = new Promise<ServiceResult<NetworkStatus>>((resolve) => {
      resolveStatus = resolve;
    });
    const serverStatusReply = {
      __kind__: "ok" as const,
      ok: {
        serverVersion: "Fulcrum",
        protocolVersion: "1.4",
        height: 974001n,
        checkpointConfigured: true,
        checkpointHeight: 973440n,
        checkpointHash: "b".repeat(64),
      },
    };
    // The first read stays in flight until `resolveStatus` is called; later
    // reads resolve immediately so the post-settle read can complete.
    const getServerStatus = vi
      .fn<() => Promise<typeof serverStatusReply>>()
      .mockImplementationOnce(() => pending.then(() => serverStatusReply))
      .mockImplementation(async () => serverStatusReply);
    const actor: BridgeActor = {
      getBridgeStatus: vi.fn(async () => ({
        configured: true,
        checkpointConfigured: true,
      })),
      getAddressBalance: vi.fn(),
      getAddressHistory: vi.fn(),
      getAddressUtxos: vi.fn(),
      getRawTransaction: vi.fn(),
      getFeeEstimate: vi.fn(),
      getServerStatus,
    };
    const service = new BridgeWalletService(async () => actor);

    // Hold the first read open, then issue a second concurrent read.
    const first = service.getNetworkStatus();
    const second = service.getNetworkStatus();
    expect(second).toBe(first);

    resolveStatus({ ok: true, value: connectedStatus(974001) });
    await Promise.all([first, second]);
    expect(getServerStatus).toHaveBeenCalledTimes(1);

    // Once settled, a later read starts fresh rather than reusing the promise.
    const third = service.getNetworkStatus();
    expect(third).not.toBe(first);
    await third;
    expect(getServerStatus).toHaveBeenCalledTimes(2);
  });
});
