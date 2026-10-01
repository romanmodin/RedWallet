import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import App from "@/App";
import { resolveBridgeActor } from "@/services/bridgeService";
import { providerChanged } from "@/services/networkGeneration";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import type { AccountSnapshot } from "./account-reader";
import { clearAccountViewSessions } from "./account-view-session";
import { XbtKeySession, publicAddress } from "./key-material";
import { PendingPayments } from "./pending-payment";
import {
  publicStorageKey,
  savePaymentDraft,
  savePublicSnapshot,
} from "./public-wallet-storage";
import { VaultCatalog } from "./vault-catalog";

vi.mock("@/services/bridgeService", async (original) => ({
  ...(await original<typeof import("@/services/bridgeService")>()),
  resolveBridgeActor: vi.fn(),
}));
afterEach(() => {
  clearAccountViewSessions();
  delete document.documentElement.dataset.remoteScriptProtection;
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it("keeps the authenticated account, history and draft across real tabs; navigation locks keys and no tab rescans", async () => {
  vi.stubGlobal("crypto", webcrypto);
  localStorage.setItem("redwallet.intro.seen", "1");
  document.documentElement.dataset.remoteScriptProtection = "blocked";
  const password = "public disposable navigation fixture";
  const catalog = new VaultCatalog(localStorage);
  await catalog.create(
    "Public navigation fixture",
    {
      passphrase: "",
      mnemonic:
        "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
    },
    password,
  );
  const keys = new XbtKeySession(
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
  );
  const account = keys.account;
  keys.destroy();
  const txid = "c".repeat(64);
  const snapshot = {
    confirmed: 1000000n,
    unconfirmed: 0n,
    height: 974888,
    observedAt: 1790788000000,
    history: [{ txid, height: 974772n }],
    branches: [0, 1].map((branch) => ({
      used: [],
      scanned: 21,
      next: {
        branch,
        index: 0,
        address: publicAddress(account.accountXpub, branch as 0 | 1, 0),
      },
    })),
  } as unknown as AccountSnapshot;
  savePublicSnapshot(account.accountXpub, snapshot);
  const fixture = JSON.parse(
    readFileSync(
      resolve(process.cwd(), "../../test/regtest/xbt-web-signed-20260929.json"),
      "utf8",
    ),
  );
  const payments = new PendingPayments(account.accountXpub, localStorage);
  localStorage.setItem(
    `${payments.key}.confirmed.${fixture.txid}`,
    JSON.stringify({
      version: 1,
      accountXpub: account.accountXpub,
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
      state: "confirmed",
    }),
  );
  localStorage.setItem(
    `${payments.key}.confirmed.${"d".repeat(64)}`,
    "damaged disposable fixture",
  );
  savePaymentDraft(account.accountXpub, {
    destination: publicAddress(account.accountXpub, 0, 1),
    amount: "0.005",
    rate: "1",
  });
  const raw = localStorage.getItem(
    publicStorageKey(account.accountXpub, "scan"),
  );
  const actor = {
    getAddressBalance: vi.fn(),
    getAddressHistory: vi.fn(),
    getServerStatus: vi.fn(),
    getAddressUtxos: vi.fn(),
    broadcastSignedTransaction: vi.fn(),
  };
  vi.mocked(resolveBridgeActor).mockResolvedValue(actor as any);
  const user = userEvent.setup();
  render(<App />);
  await user.click(await screen.findByTestId("app_shell.nav.wallets"));
  await user.click(await screen.findByRole("button", { name: /^Unlock$/ }));
  await user.type(screen.getByLabelText("Wallet password"), password);
  await user.click(screen.getByRole("button", { name: "Unlock wallet" }));
  await screen.findByRole("button", { name: "Lock wallet" });
  await screen.findByText(txid);
  await user.click(screen.getByTestId("app_shell.nav.home"));
  const home = await screen.findByTestId("local.home");
  expect(home).toHaveTextContent("Public navigation fixture");
  expect(home).toHaveTextContent("0.01000000 XBT");
  expect(home).toHaveTextContent("42 addresses checked");
  expect(home).toHaveTextContent(txid);
  expect(home).toHaveTextContent("Sent · Confirmation recorded");
  expect(home).toHaveTextContent(fixture.txid);
  expect(home).toHaveTextContent(
    "Some saved payment records could not be read",
  );
  expect(
    screen.queryByTestId("dashboard.balance_card"),
  ).not.toBeInTheDocument();
  await user.click(screen.getByTestId("app_shell.nav.activity"));
  expect(await screen.findByTestId("local.activity")).toHaveTextContent(txid);
  await user.click(screen.getByTestId("app_shell.nav.send"));
  await screen.findByLabelText("XBT recipient");
  expect(screen.getByLabelText("Amount in XBT")).toHaveValue("0.005");
  expect(
    screen.getByRole("button", { name: "Prepare transaction review" }),
  ).toBeDisabled();
  expect(
    screen.queryByRole("button", { name: "Lock wallet" }),
  ).not.toBeInTheDocument();
  expect(screen.getByText("Locked", { exact: true })).toBeInTheDocument();
  expect(screen.queryByTestId("send.form")).not.toBeInTheDocument();
  // Provider handoff discards the bound actor but restores completed discovery
  // and drafts without requesting another recovery scan.
  const replacement = {
    ...actor,
    getAddressHistory: vi.fn(),
    getAddressBalance: vi.fn(),
    getServerStatus: vi.fn(),
  };
  vi.mocked(resolveBridgeActor).mockResolvedValue(replacement as any);
  await act(async () => providerChanged());
  await screen.findByRole("button", { name: "Refresh account" });
  expect(screen.getByText("42 addresses checked")).toBeInTheDocument();
  expect(screen.getByText("0.01000000 XBT")).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Resume scan" }),
  ).not.toBeInTheDocument();
  expect(screen.getByLabelText("Amount in XBT")).toHaveValue("0.005");
  for (const fn of Object.values(replacement))
    expect(fn).not.toHaveBeenCalled();
  await user.click(screen.getByTestId("app_shell.nav.receive"));
  await screen.findByRole("button", { name: "Get a new receive address" });
  expect(screen.queryByLabelText("Local XBT payment")).not.toBeInTheDocument();
  expect(
    localStorage.getItem(publicStorageKey(account.accountXpub, "scan")),
  ).toBe(raw);
  for (const fn of Object.values(actor)) expect(fn).not.toHaveBeenCalled();
  await user.click(screen.getByTestId("app_shell.nav.home"));
  await screen.findByTestId("local.home");
  await act(async () => {
    window.dispatchEvent(new Event("pagehide"));
  });
  expect(screen.getByTestId("local.home")).toHaveTextContent(txid);
  await act(async () => {
    window.dispatchEvent(new StorageEvent("storage", { key: null }));
  });
  expect(screen.queryByTestId("local.home")).not.toBeInTheDocument();
});
