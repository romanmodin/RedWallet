import App from "@/App";
import { bridgeWalletService } from "@/services/bridgeService";
import { settingsService } from "@/services/settingsService";
import type { Transaction, Wallet } from "@/services/types";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
const ADDRESS = "bc1q86uhqahctvu7ygjenrcpp9c6dmxu6s8wzktfd4";
const wallet: Wallet = {
  id: "watch-live",
  name: "My XBT",
  address: ADDRESS,
  shortId: "bc1q86…ktfd4",
  isDemo: false,
  balanceXbt: 0.75,
  fiatValueUsd: Number.NaN,
};
const transaction: Transaction = {
  id: `watch-live:${"a".repeat(64)}`,
  walletId: wallet.id,
  txid: "a".repeat(64),
  isLive: true,
  blockHeight: 974000,
  direction: "unknown",
  status: "confirmed",
  amountXbt: Number.NaN,
  fiatUsd: Number.NaN,
  feeXbt: Number.NaN,
  timestamp: Number.NaN,
  confirmations: Number.NaN,
  counterpartyAddress: "",
  note: "Block 974000",
};
function liveState() {
  vi.spyOn(bridgeWalletService, "getActiveWallet").mockResolvedValue({
    ok: true,
    value: wallet,
  });
  vi.spyOn(bridgeWalletService, "listWallets").mockResolvedValue({
    ok: true,
    value: [wallet],
  });
  vi.spyOn(bridgeWalletService, "listTransactions").mockResolvedValue({
    ok: true,
    value: [transaction],
  });
  vi.spyOn(bridgeWalletService, "getTransaction").mockResolvedValue({
    ok: true,
    value: transaction,
  });
}
it("shows real address data, unknown fiat, copies only the user's address and blocks sending", async () => {
  liveState();
  settingsService.updateSettings({ displayUnit: "BTC" });
  const user = userEvent.setup({ writeToClipboard: false });
  render(<App />);
  expect(await screen.findByTestId("dashboard.balance_card")).toHaveTextContent(
    "Watch only",
  );
  expect(screen.getByTestId("dashboard.balance_card.amount")).toHaveTextContent(
    "0.75000000 XBT",
  );
  expect(screen.getByTestId("dashboard.balance_card")).toHaveTextContent(
    "Price unavailable",
  );
  await user.click(screen.getByTestId("dashboard.quick_actions.receive"));
  expect(await screen.findByTestId("receive.address_text")).toHaveTextContent(
    ADDRESS,
  );
  const copy = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: copy },
  });
  await user.click(screen.getByTestId("receive.copy_button"));
  await waitFor(() => expect(copy).toHaveBeenCalledWith(ADDRESS));
  await user.click(screen.getByTestId("app_shell.nav.send"));
  expect(await screen.findByText("Sending is unavailable")).toBeVisible();
  expect(screen.queryByTestId("send.recipient_input")).toBeNull();
});
it("shows block/txid without inventing amount, direction, time or counterparty", async () => {
  liveState();
  const user = userEvent.setup();
  render(<App />);
  await screen.findByTestId("dashboard.balance_card");
  await user.click(
    await screen.findByTestId("dashboard.recent_transactions.item.1"),
  );
  const page = await screen.findByTestId("history.detail.page");
  await waitFor(() => expect(page).toHaveTextContent("Amount unavailable"));
  expect(page).toHaveTextContent("Included in block 974000");
  expect(page).not.toHaveTextContent("Sent");
  expect(page).not.toHaveTextContent("Received");
  expect(screen.queryByTestId("history.detail.copy_address_button")).toBeNull();
});
