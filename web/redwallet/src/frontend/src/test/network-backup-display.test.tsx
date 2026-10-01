import { NetworkSetting } from "@/components/settings/NetworkSetting";
import {
  BUILTIN_BACKUPS,
  HOME_ADAPTER,
  PROVIDER_STORAGE_KEY,
  providerRouter,
} from "@/services/providerService";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useNetworkStatus", () => ({
  useNetworkStatus: () => ({
    connectionState: "connected",
    error: null,
    refresh: vi.fn(),
  }),
}));

describe("shared-service backup visibility", () => {
  it("does not describe a custom adapter as using the public backup when fallback is disabled", () => {
    localStorage.setItem(
      PROVIDER_STORAGE_KEY,
      JSON.stringify({
        mode: "custom",
        config: {
          host: "127.0.0.1",
          port: 55001,
          tls: false,
          endpoint: HOME_ADAPTER.endpoint,
          canisterId: HOME_ADAPTER.id,
          allowBuiltinFallback: false,
        },
      }),
    );
    vi.spyOn(providerRouter, "current").mockReturnValue(null);
    render(<NetworkSetting />);
    expect(screen.getByText(/Your adapter is primary/)).toHaveTextContent(
      /Public fallback is disabled/,
    );
    expect(screen.queryByText(/Primary: home Umbrel/)).toBeNull();
  });
  it("identifies Umbrel as primary and explains the public backup's privacy and payment behavior", () => {
    vi.spyOn(providerRouter, "current").mockReturnValue({
      name: "Built-in RedWallet service",
      id: HOME_ADAPTER.id,
      endpoint: HOME_ADAPTER.endpoint,
      host: "127.0.0.1",
      port: 55001,
      tls: false,
      backup: false,
    });
    render(<NetworkSetting />);
    expect(screen.getByText(/Primary: home Umbrel/)).toHaveTextContent(
      /Backup: mempool.guide over WSS/,
    );
    expect(screen.getByText(/Primary: home Umbrel/)).toHaveTextContent(
      /device’s IP address/,
    );
    expect(screen.getByText(/Primary: home Umbrel/)).toHaveTextContent(
      /never automatically retried/,
    );
    expect(screen.getByText(/Active HTTPS bridge/)).toHaveTextContent(
      HOME_ADAPTER.endpoint,
    );
  });
  it("shows the actual WSS service as backup without describing it as an ICP adapter", () => {
    const backup = BUILTIN_BACKUPS[0];
    vi.spyOn(providerRouter, "current").mockReturnValue({
      name: backup.name,
      id: backup.id,
      endpoint: backup.endpoint,
      host: "mempool.guide",
      port: 443,
      tls: true,
      backup: true,
    });
    render(<NetworkSetting />);
    expect(screen.getByText(/mempool.guide · backup/)).toBeInTheDocument();
    expect(screen.getByText(/Direct WSS endpoint/)).toHaveTextContent(
      backup.endpoint,
    );
    expect(
      screen.getByText(/Browser connects directly to mempool.guide/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Adapter:/)).toBeNull();
  });
});
