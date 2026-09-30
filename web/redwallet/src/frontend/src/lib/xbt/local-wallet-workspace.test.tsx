import { webcrypto } from "node:crypto";
import { LocalWalletWorkspace } from "@/components/vault/LocalWalletWorkspace";
import { resolveBridgeActor } from "@/services/bridgeService";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/bridgeService", () => ({
  resolveBridgeActor: vi.fn(async () => null),
}));
afterEach(() => {
  delete document.documentElement.dataset.remoteScriptProtection;
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("gated local wallet workspace", () => {
  it("does not expose recovery or creation until the browser block is observed", () => {
    render(<LocalWalletWorkspace />);
    expect(screen.getByText(/setup is unavailable/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Recover wallet" }),
    ).not.toBeInTheDocument();
    expect(resolveBridgeActor).not.toHaveBeenCalled();
  });
  it("saves encrypted recovery, unlocks its authenticated account and clears on storage invalidation", async () => {
    vi.stubGlobal("crypto", webcrypto);
    document.documentElement.dataset.remoteScriptProtection = "blocked";
    const user = userEvent.setup();
    render(<LocalWalletWorkspace />);
    await user.click(screen.getByRole("button", { name: "Recover wallet" }));
    await user.type(
      screen.getByLabelText("Wallet name"),
      "Public recovery fixture",
    );
    await user.type(
      screen.getByLabelText("Browser wallet password"),
      "public fixture password",
    );
    await user.type(
      screen.getByLabelText("Confirm password"),
      "public fixture password",
    );
    const phrase =
      "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
    await user.type(screen.getByLabelText("Recovery phrase"), phrase);
    await user.click(screen.getByRole("checkbox"));
    await user.click(
      screen.getByRole("button", { name: "Save encrypted wallet" }),
    );
    await screen.findByText(/Encrypted wallet saved in this browser/);
    expect(resolveBridgeActor).not.toHaveBeenCalled();
    const stored = Object.values(localStorage).join(" ");
    expect(stored).not.toContain(phrase);
    expect(stored).not.toContain("public fixture password");
    await user.click(screen.getByRole("button", { name: /^Unlock$/ }));
    await user.type(
      screen.getByLabelText("Wallet password"),
      "public fixture password",
    );
    await user.click(screen.getByRole("button", { name: "Unlock wallet" }));
    await screen.findByText("bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu");
    await waitFor(() => expect(resolveBridgeActor).toHaveBeenCalledWith());
    await screen.findByText(/configured account backend is unavailable/);
    await user.click(screen.getByRole("button", { name: "Lock wallet" }));
    await user.click(screen.getByRole("button", { name: /^Unlock$/ }));
    await user.type(
      screen.getByLabelText("Wallet password"),
      "public fixture password",
    );
    await user.click(screen.getByRole("button", { name: "Unlock wallet" }));
    await waitFor(() => expect(resolveBridgeActor).toHaveBeenCalledTimes(2));

    // Safari background/pagehide locks keys without discarding the authenticated public selection.
    await act(async () => window.dispatchEvent(new Event("pagehide")));
    expect(screen.getByText(/Public account:/)).toBeInTheDocument();
    expect(screen.getByText("Locked", { exact: true })).toBeInTheDocument();

    await act(async () =>
      window.dispatchEvent(new StorageEvent("storage", { key: null })),
    );
    expect(
      screen.queryByText("bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Locked", { exact: true })).toBeInTheDocument();
  });
});
