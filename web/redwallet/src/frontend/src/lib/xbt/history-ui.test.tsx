import { Buffer } from "buffer";
import { AccountHistory } from "@/components/vault/AccountHistory";
import type { BridgeActor } from "@/services/bridgeService";
import { fireEvent, render, screen } from "@testing-library/react";
import { Transaction, address, networks } from "bitcoinjs-lib";
import { afterEach, expect, it, vi } from "vitest";
import type { AccountSnapshot } from "./account-reader";
import { XbtKeySession, publicAddress } from "./key-material";
import { publicStorageKey, savePublicSnapshot } from "./public-wallet-storage";

afterEach(() => vi.restoreAllMocks());
it("loads signed outcomes, excludes change, keeps saved scan bytes and restores amounts without network calls", async () => {
  const keys = new XbtKeySession(
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
  );
  const xpub = keys.account.accountXpub;
  keys.destroy();
  const script = (branch: 0 | 1, index: number) =>
    address.toOutputScript(
      publicAddress(xpub, branch, index),
      networks.bitcoin,
    );
  const outside = Buffer.from(`0014${"33".repeat(20)}`, "hex");
  const parent = new Transaction();
  parent.addInput(Buffer.from("a".repeat(64), "hex"), 0);
  parent.addOutput(outside, 2000000n);
  const receive = new Transaction();
  receive.addInput(Buffer.from(parent.getId(), "hex").reverse(), 0);
  receive.addOutput(script(0, 0), 1000000n);
  receive.addOutput(outside, 999800n);
  const send = new Transaction();
  send.addInput(Buffer.from(receive.getId(), "hex").reverse(), 0);
  send.addOutput(outside, 500000n);
  send.addOutput(script(1, 0), 499858n);
  const raw = new Map(
    [parent, receive, send].map((tx) => [tx.getId(), tx.toHex()]),
  );
  const snapshot = {
    branches: ([0, 1] as const).map((branch) => ({
      used: [{ branch, index: 0, address: publicAddress(xpub, branch, 0) }],
      next: { branch, index: 1, address: publicAddress(xpub, branch, 1) },
      scanned: 22,
    })),
    confirmed: 499858n,
    unconfirmed: 0n,
    history: [
      { txid: receive.getId(), height: 974772n },
      { txid: send.getId(), height: 974798n },
    ],
    height: 974890,
    observedAt: Date.now(),
  } as unknown as AccountSnapshot;
  savePublicSnapshot(xpub, snapshot);
  const savedScan = localStorage.getItem(publicStorageKey(xpub, "scan"));
  const actor = {
    getServerStatus: vi.fn(async () => ({
      __kind__: "ok",
      ok: {
        height: 974890n,
        checkpointConfigured: true,
        checkpointHeight: 961640n,
        checkpointHash:
          "0000000000000050c1e5f69672f459293be14f46e5a494e7a8c8541396f18eeb",
      },
    })),
    getRawTransaction: vi.fn(async (id: string) => ({
      __kind__: "ok",
      ok: { hex: raw.get(id) },
    })),
    getAddressHistory: vi.fn(),
    broadcastSignedTransaction: vi.fn(),
  } as unknown as BridgeActor;
  let time = 0;
  vi.spyOn(performance, "now").mockImplementation(() => {
    time += 4000;
    return time;
  });
  const view = render(
    <AccountHistory xpub={xpub} snapshot={snapshot} actor={actor} />,
  );
  expect(actor.getRawTransaction).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: "Load transaction amounts" }),
  );
  await screen.findByText("+0.01 XBT");
  expect(screen.getByText("−0.005 XBT")).toBeInTheDocument();
  expect(
    screen.getByText(/Fee 0.00000142 XBT · Balance change −0.00500142 XBT/),
  ).toBeInTheDocument();
  expect(actor.getRawTransaction).toHaveBeenCalledTimes(3);
  expect(actor.getAddressHistory).not.toHaveBeenCalled();
  expect((actor as any).broadcastSignedTransaction).not.toHaveBeenCalled();
  expect(localStorage.getItem(publicStorageKey(xpub, "scan"))).toBe(savedScan);
  view.unmount();
  vi.mocked(actor.getRawTransaction).mockClear();
  render(<AccountHistory xpub={xpub} snapshot={snapshot} actor={actor} />);
  expect(screen.getByText("+0.01 XBT")).toBeInTheDocument();
  expect(screen.getByText("−0.005 XBT")).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Load transaction amounts" }),
  ).not.toBeInTheDocument();
  expect(actor.getRawTransaction).not.toHaveBeenCalled();
});
