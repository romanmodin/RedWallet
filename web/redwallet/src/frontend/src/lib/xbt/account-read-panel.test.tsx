import { AccountReadPanel } from "@/components/vault/AccountReadPanel";
import type { BridgeActor } from "@/services/bridgeService";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearAccountViewSessions } from "./account-view-session";
import { type AddressMutex, IssuedAddresses } from "./issued-addresses";
import { XbtKeySession, publicAddress } from "./key-material";

const fixture = vi.hoisted(() => ({ scan: vi.fn() }));
vi.mock("@/lib/xbt/account-reader", () => ({
  AccountReader: class {
    scan = fixture.scan;
  },
}));

afterEach(() => {
  clearAccountViewSessions();
  vi.clearAllMocks();
});

describe("public account receive UI", () => {
  it("does not show a new receive address unless its index is durably reserved", async () => {
    const keys = new XbtKeySession(
      "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
    );
    const account = keys.account;
    keys.destroy();
    let writeFails = true;
    const data = new Map<string, string>();
    const mutex: AddressMutex = async (_name, action) => await action();
    const book = new IssuedAddresses(
      account.accountXpub,
      {
        getItem: (key) => data.get(key) ?? null,
        setItem: (key, value) => {
          if (writeFails) throw Error("Storage full");
          data.set(key, value);
        },
      },
      mutex,
    );
    fixture.scan.mockResolvedValue({
      confirmed: 0n,
      unconfirmed: 0n,
      height: 974742,
      observedAt: Date.now(),
      history: [],
      branches: [0, 1].map((branch) => ({
        used: [],
        scanned: 20,
        next: {
          branch,
          index: 0,
          address: publicAddress(account.accountXpub, branch as 0 | 1, 0),
        },
      })),
    });
    const actor = {} as BridgeActor;
    const onSnapshot = vi.fn();
    const view = render(
      <AccountReadPanel
        account={account}
        actor={actor}
        onSnapshot={onSnapshot}
        addressBook={book}
      />,
    );
    expect(
      screen.queryByText("Confirmed balance at last scan"),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Scan account$/ }));
    await screen.findByText("Confirmed balance at last scan");
    fireEvent.click(
      screen.getByRole("button", { name: "Get a new receive address" }),
    );
    await screen.findByText("Storage full");
    expect(
      screen.queryByRole("button", { name: "Copy receive address" }),
    ).not.toBeInTheDocument();
    writeFails = false;
    fireEvent.click(
      screen.getByRole("button", { name: "Get a new receive address" }),
    );
    await screen.findByText(publicAddress(account.accountXpub, 0, 1));
    expect(book.read()).toEqual([1, -1]);
    const originalSnapshot = onSnapshot.mock.calls.at(-1)?.[0];
    const calls = fixture.scan.mock.calls.length;
    view.unmount();
    const restored = render(
      <AccountReadPanel
        account={{ ...account }}
        actor={actor}
        addressBook={book}
        onSnapshot={onSnapshot}
      />,
    );
    await screen.findByText("Confirmed balance at last scan");
    expect(
      screen.getByText(publicAddress(account.accountXpub, 0, 1)),
    ).toBeInTheDocument();
    expect(fixture.scan).toHaveBeenCalledTimes(calls);
    expect(onSnapshot.mock.calls.at(-1)?.[0]).toBe(originalSnapshot);
    expect(
      screen.getByRole("button", { name: "Refresh account" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Resume scan" }),
    ).not.toBeInTheDocument();
    fixture.scan.mockRejectedValueOnce(Error("Bridge unavailable"));
    fireEvent.click(screen.getByRole("button", { name: "Refresh account" }));
    await screen.findByText("Bridge unavailable");
    expect(onSnapshot.mock.calls.at(-1)?.[0]).toBeNull();
    restored.unmount();
    render(
      <AccountReadPanel
        account={account}
        actor={actor}
        addressBook={book}
        onSnapshot={onSnapshot}
      />,
    );
    expect(
      screen.getByText("Confirmed balance at last scan"),
    ).toBeInTheDocument();
    expect(onSnapshot.mock.calls.at(-1)?.[0]).toBeNull();
  });
});

it("preserves partial progress across unmount and resumes without restarting; actors stay isolated", async () => {
  const keys = new XbtKeySession(
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
  );
  const account = keys.account;
  keys.destroy();
  const actor = {} as BridgeActor;
  const book = new IssuedAddresses(
    account.accountXpub,
    { getItem: () => null, setItem: () => {} },
    async (_name, action) => action(),
  );
  fixture.scan.mockImplementationOnce(async (_signal, progress) => {
    progress({ checked: 22, reused: 0 });
    throw Error("Account read cancelled");
  });
  let view = render(
    <AccountReadPanel account={account} actor={actor} addressBook={book} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Scan account" }));
  await screen.findByText("Account read cancelled");
  view.unmount();
  view = render(
    <AccountReadPanel account={account} actor={actor} addressBook={book} />,
  );
  expect(screen.getByText("22 addresses checked")).toBeInTheDocument();
  fixture.scan.mockRejectedValueOnce(Error("Resume reached retained reader"));
  fireEvent.click(screen.getByRole("button", { name: "Resume scan" }));
  await screen.findByText("Resume reached retained reader");
  expect(fixture.scan).toHaveBeenCalledTimes(2);
  view.unmount();
  render(
    <AccountReadPanel
      account={account}
      actor={{} as BridgeActor}
      addressBook={book}
    />,
  );
  expect(
    screen.queryByRole("button", { name: "Resume scan" }),
  ).not.toBeInTheDocument();
  expect(screen.getByText("0 addresses checked")).toBeInTheDocument();
});
