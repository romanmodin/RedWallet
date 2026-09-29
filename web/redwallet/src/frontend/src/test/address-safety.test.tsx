/**
 * Address-safety contract tests.
 *
 * The accepted change removes every address-like identifier from the dashboard
 * and wallet/account selector surfaces: each shows the wallet name plus the
 * neutral literal "Demo address — not real" instead of an xbt1-prefixed or
 * otherwise address-like string. The Receive screen keeps its unmistakably
 * invalid placeholder and its prominent warning.
 *
 * These tests assert the observable contract on the real components, and the
 * service-layer value that feeds them. Everything runs against the in-memory
 * demo service and jsdom; no network is touched.
 */

import App from "@/App";
import { MockWalletService } from "@/services/walletService";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

/** The neutral label the accepted change substitutes for any address-like id. */
const NEUTRAL_DEMO_LABEL = "Demo address — not real";

/** The unmistakably invalid placeholder the Receive screen must keep. */
const DEMO_RECEIVE_ADDRESS = "xbt-demo-address-not-valid";

/**
 * A conservative address-like detector: any xbt1/bitcoin-style prefix, or a
 * long unbroken alphanumeric run that could be mistaken for an address.
 */
function looksAddressLike(value: string): boolean {
  if (/\b(?:xbt1|bc1|tb1|bcrt1)[a-z0-9]+/i.test(value)) return true;
  return /[a-z0-9]{20,}/i.test(value);
}

async function openWallets() {
  const user = userEvent.setup();
  render(<App />);
  await screen.findByTestId("dashboard.balance_card");
  await user.click(screen.getByTestId("app_shell.nav.wallets"));
  await screen.findByTestId("wallets.list");
  return user;
}

describe("Dashboard balance card address safety", () => {
  it("shows the wallet name and the neutral demo label, not an address", async () => {
    render(<App />);
    const card = await screen.findByTestId("dashboard.balance_card");

    expect(within(card).getByText("Primary Vault")).toBeInTheDocument();
    expect(within(card).getByText(NEUTRAL_DEMO_LABEL)).toBeInTheDocument();
    expect(card.textContent ?? "").not.toMatch(/xbt1/i);
    expect(looksAddressLike(card.textContent ?? "")).toBe(false);
  });
});

describe("Wallet selector address safety", () => {
  it("shows each wallet's name and the neutral demo label, never an address", async () => {
    await openWallets();

    const list = screen.getByTestId("wallets.list");
    expect(
      within(list).getAllByText(NEUTRAL_DEMO_LABEL).length,
    ).toBeGreaterThan(0);
    expect(list.textContent ?? "").not.toMatch(/xbt1/i);
    expect(looksAddressLike(list.textContent ?? "")).toBe(false);

    // Each seeded wallet row pairs its name with the neutral label.
    for (const name of ["Primary Vault", "Cold Savings", "Daily Spending"]) {
      const row = within(list).getByText(name).closest("button");
      expect(row).not.toBeNull();
      expect(
        within(row as HTMLElement).getByText(NEUTRAL_DEMO_LABEL),
      ).toBeInTheDocument();
    }
  });

  it("labels a newly added demo wallet with the neutral demo label", async () => {
    const user = await openWallets();

    await user.click(screen.getByTestId("wallets.add_button"));
    await screen.findByTestId("wallets.add_dialog");
    await user.selectOptions(screen.getByLabelText("Wallet type"), "demo");
    await user.type(screen.getByTestId("wallets.name_input"), "Travel Fund");
    await user.click(screen.getByTestId("wallets.submit_button"));

    const row = await screen.findByTestId("wallets.item.4");
    expect(within(row).getByText("Travel Fund")).toBeInTheDocument();
    expect(within(row).getByText(NEUTRAL_DEMO_LABEL)).toBeInTheDocument();
    expect(row.textContent ?? "").not.toMatch(/xbt1/i);
  });
});

describe("Wallet service identifier contract", () => {
  it("serves the neutral demo label as every wallet's shortId", async () => {
    const service = new MockWalletService();
    const list = await service.listWallets();
    if (!list.ok) throw new Error("expected demo wallets");

    expect(list.value.length).toBeGreaterThan(0);
    for (const wallet of list.value) {
      expect(wallet.shortId).toBe(NEUTRAL_DEMO_LABEL);
      expect(wallet.shortId).not.toMatch(/xbt1/i);
      expect(looksAddressLike(wallet.shortId)).toBe(false);
    }
  });

  it("assigns the neutral demo label to a newly added wallet", async () => {
    const service = new MockWalletService();
    const created = await service.addDemoWallet("Travel Fund");
    if (!created.ok) throw new Error("expected created wallet");
    expect(created.value.shortId).toBe(NEUTRAL_DEMO_LABEL);
    expect(created.value.shortId).not.toMatch(/xbt1/i);
  });
});

describe("Receive screen keeps its invalid placeholder", () => {
  it("shows the invalid placeholder and warning, and never the neutral label", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByTestId("dashboard.balance_card");
    await user.click(screen.getByTestId("dashboard.quick_actions.receive"));
    await screen.findByTestId("receive.qr_card");

    expect(screen.getByTestId("receive.address_text").textContent).toBe(
      DEMO_RECEIVE_ADDRESS,
    );
    expect(screen.getByTestId("receive.demo_warning")).toHaveTextContent(
      /not a real wallet address/i,
    );
    // The neutral dashboard label is not substituted on the Receive screen.
    expect(screen.queryByText(NEUTRAL_DEMO_LABEL)).not.toBeInTheDocument();
  });
});
