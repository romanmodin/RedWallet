import { AccountReadPanel } from "@/components/vault/AccountReadPanel";
import type { BridgeActor } from "@/services/bridgeService";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { type AddressMutex, IssuedAddresses } from "./issued-addresses";
import { XbtKeySession, publicAddress } from "./key-material";

const fixture = vi.hoisted(() => ({ scan: vi.fn() }));
vi.mock("@/lib/xbt/account-reader", () => ({
  AccountReader: class {
    scan = fixture.scan;
  },
}));

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
    render(
      <AccountReadPanel
        account={account}
        actor={{} as BridgeActor}
        addressBook={book}
      />,
    );
    expect(screen.queryByText("Confirmed balance")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Scan account$/ }));
    await screen.findByText("Confirmed balance");
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
    expect(
      screen.getByText("Sending is not enabled in this revision."),
    ).toBeInTheDocument();
  });
});
