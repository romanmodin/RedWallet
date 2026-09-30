import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { LocalWalletWorkspace } from "@/components/vault/LocalWalletWorkspace";
import { resolveBridgeActor } from "@/services/bridgeService";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { AccountSnapshot } from "./account-reader";
import { clearAccountViewSessions } from "./account-view-session";
import { XbtKeySession, publicAddress } from "./key-material";
import { PendingPayments } from "./pending-payment";
import { publicStorageKey, savePublicSnapshot } from "./public-wallet-storage";
const fixture = JSON.parse(
  readFileSync(
    resolve(process.cwd(), "../../test/regtest/xbt-web-signed-20260929.json"),
    "utf8",
  ),
);
const selected = vi.hoisted(() => ({ account: null as any }));
vi.mock("@/services/bridgeService", () => ({ resolveBridgeActor: vi.fn() }));
vi.mock("@/components/vault/WalletCompatibilityCheck", () => ({
  WalletCompatibilityCheck: () => null,
}));
vi.mock("@/components/vault/LocalVaultPanel", () => ({
  LocalVaultPanel: ({ onUnlocked }: any) => (
    <button
      type="button"
      onClick={() => onUnlocked("fixture-wallet", selected.account)}
    >
      Unlock public fixture
    </button>
  ),
}));
afterEach(() => {
  cleanup();
  clearAccountViewSessions();
  localStorage.clear();
  delete document.documentElement.dataset.remoteScriptProtection;
  vi.restoreAllMocks();
});
it("confirmation keeps incoming history and the original scan across remount, and restores the sent receipt without scanning", async () => {
  document.documentElement.dataset.remoteScriptProtection = "blocked";
  const keys = new XbtKeySession(
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
  );
  selected.account = keys.account;
  keys.destroy();
  const xpub = selected.account.accountXpub;
  const incoming = "c".repeat(64);
  const snapshot = {
    confirmed: 1000000n,
    unconfirmed: 0n,
    height: 974740,
    observedAt: 1790740000000,
    history: [{ txid: incoming, height: 974739n }],
    branches: [0, 1].map((branch) => ({
      used: [],
      scanned: 20,
      next: {
        branch,
        index: 0,
        address: publicAddress(xpub, branch as 0 | 1, 0),
      },
    })),
  } as unknown as AccountSnapshot;
  savePublicSnapshot(xpub, snapshot);
  const rawScan = localStorage.getItem(publicStorageKey(xpub, "scan"));
  const store = new PendingPayments(xpub, localStorage, async (_key, fn) =>
    fn(),
  );
  // Published unfunded regtest fixture only; no signing or broadcast in this test.
  localStorage.setItem(
    store.key,
    JSON.stringify({
      version: 1,
      accountXpub: xpub,
      hex: fixture.hex,
      txid: fixture.txid,
      inputs: fixture.plan.inputs.map(({ branch, index, value }: any) => ({
        branch,
        index,
        value,
      })),
      destination: fixture.plan.destination,
      amount: fixture.plan.amount,
      fee: fixture.plan.fee,
      change: fixture.plan.change,
      changeIndex: fixture.plan.changeIndex,
      state: "acknowledged",
    }),
  );
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: {
      request: async (_key: string, _options: unknown, fn: () => unknown) =>
        fn(),
    },
  });
  const actor = {
    getServerStatus: vi.fn(async () => ({
      __kind__: "ok",
      ok: {
        height: 974750n,
        checkpointConfigured: true,
        checkpointHeight: 961640n,
        checkpointHash:
          "0000000000000050c1e5f69672f459293be14f46e5a494e7a8c8541396f18eeb",
        broadcastEnabled: true,
      },
    })),
    getRawTransaction: vi.fn(async () => ({
      __kind__: "ok",
      ok: { hex: fixture.hex },
    })),
    getAddressHistory: vi.fn(async () => ({
      __kind__: "ok",
      ok: { entries: [{ txid: fixture.txid, height: 974749n }] },
    })),
    getAddressBalance: vi.fn(),
    broadcastSignedTransaction: vi.fn(),
  };
  vi.mocked(resolveBridgeActor).mockResolvedValue(actor as any);
  render(<LocalWalletWorkspace />);
  fireEvent.click(
    screen.getByRole("button", { name: "Unlock public fixture" }),
  );
  await screen.findByText(incoming);
  fireEvent.click(
    await screen.findByRole("button", { name: "Check confirmation" }),
  );
  await screen.findByText("Sent · Confirmation recorded");
  expect(screen.getByText(incoming)).toBeInTheDocument();
  expect(screen.getByText("40 addresses checked")).toBeInTheDocument();
  expect(localStorage.getItem(publicStorageKey(xpub, "scan"))).toBe(rawScan);
  cleanup();
  render(<LocalWalletWorkspace />);
  fireEvent.click(
    screen.getByRole("button", { name: "Unlock public fixture" }),
  );
  await screen.findByText("Sent · Confirmation recorded");
  expect(screen.getByText(incoming)).toBeInTheDocument();
  expect(
    screen.getByText(`Transaction ID: ${fixture.txid}`),
  ).toBeInTheDocument();
  expect(actor.getAddressBalance).not.toHaveBeenCalled();
  expect(actor.broadcastSignedTransaction).not.toHaveBeenCalled();
});
