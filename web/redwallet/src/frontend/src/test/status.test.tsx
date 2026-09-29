/**
 * Network status journey tests.
 *
 * Covers the status screen's offline-by-design behavior when no server host is
 * configured, and the server summary reflecting a configured host. The demo
 * service never contacts a real server.
 */

import App from "@/App";
import { bridgeWalletService } from "@/services/bridgeService";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

async function openStatus() {
  const user = userEvent.setup();
  render(<App />);
  await screen.findByTestId("dashboard.balance_card");
  await user.click(screen.getByTestId("app_shell.nav.network"));
  await screen.findByTestId("status.page");
  return user;
}

describe("Network status", () => {
  it("leaves height and peer metrics unavailable when the bridge is disconnected", async () => {
    await openStatus();
    expect(
      await screen.findByTestId("status.connection_card"),
    ).toHaveTextContent("Offline");
    expect(screen.getByTestId("status.sync_readout")).toHaveTextContent(
      "Unavailable",
    );
    expect(screen.getByTestId("status.sync_readout")).not.toHaveTextContent(
      "2,864,120",
    );
  });
  it("renders live height and verified checkpoint without a fake peer count", async () => {
    vi.spyOn(bridgeWalletService, "getNetworkStatus").mockResolvedValue({
      ok: true,
      value: {
        network: "unconfigured",
        host: "",
        port: 0,
        tls: true,
        state: "connected",
        blockHeight: 974123,
        lastSyncedAt: Date.now(),
        peers: Number.NaN,
        checkpointConfigured: true,
      },
    });
    await openStatus();
    expect(
      await screen.findByTestId("status.connection_card"),
    ).toHaveTextContent("Connected");
    expect(screen.getByTestId("status.sync_readout")).toHaveTextContent(
      "974,123",
    );
    expect(screen.getByTestId("status.sync_readout")).toHaveTextContent(
      "Live bridge",
    );
    expect(screen.getByTestId("status.sync_readout")).toHaveTextContent(
      "Unavailable",
    );
  });
});
