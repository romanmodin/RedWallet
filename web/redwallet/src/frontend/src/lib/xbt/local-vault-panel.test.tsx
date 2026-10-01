import { webcrypto } from "node:crypto";
import { LocalVaultPanel } from "@/components/vault/LocalVaultPanel";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { VaultCatalog } from "./vault-catalog";

const cryptoApi = webcrypto as unknown as Crypto;
const phrase =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const password = "public fixture local UI password";
function fillDetails() {
  fireEvent.change(screen.getByLabelText("Wallet name"), {
    target: { value: "Public test fixture" },
  });
  fireEvent.change(screen.getByLabelText("Browser wallet password"), {
    target: { value: password },
  });
  fireEvent.change(screen.getByLabelText("Confirm password"), {
    target: { value: password },
  });
}
describe("local-only encrypted vault form", () => {
  it("guards Safari before password focus, keeps the guard after a wrong password, and restores on exit", async () => {
    const ua = vi
      .spyOn(navigator, "userAgent", "get")
      .mockReturnValue(
        "Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Version/26.0 Mobile/15E148 Safari/604.1",
      );
    const viewport = document.createElement("meta");
    viewport.name = "viewport";
    viewport.content = "width=device-width, initial-scale=1.0";
    document.head.append(viewport);
    const catalog = new VaultCatalog(localStorage, cryptoApi);
    await catalog.create(
      "Fixture",
      { mnemonic: phrase, passphrase: "" },
      password,
    );
    const view = render(
      <LocalVaultPanel catalog={catalog} cryptoApi={cryptoApi} />,
    );
    try {
      fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
      expect(viewport.content).toContain("maximum-scale=1");
      expect(screen.getByLabelText("Wallet password")).not.toHaveFocus();
      fireEvent.change(screen.getByLabelText("Wallet password"), {
        target: { value: "wrong fixture password" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Unlock wallet" }));
      await screen.findByText(/Could not unlock/);
      expect(viewport.content).toContain("maximum-scale=1");
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(viewport.content).toBe("width=device-width, initial-scale=1.0");
      fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
      expect(viewport.content).toContain("maximum-scale=1");
      view.unmount();
      expect(viewport.content).toBe("width=device-width, initial-scale=1.0");
    } finally {
      view.unmount();
      viewport.remove();
      ua.mockRestore();
    }
  });
  it("rejects an expired recovery form even when the timer has not run", () => {
    let now = 1000;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
    try {
      const catalog = new VaultCatalog(localStorage, cryptoApi);
      const create = vi.spyOn(catalog, "create");
      render(<LocalVaultPanel catalog={catalog} cryptoApi={cryptoApi} />);
      fireEvent.click(screen.getByRole("button", { name: "Recover wallet" }));
      fillDetails();
      fireEvent.change(screen.getByLabelText("Recovery phrase"), {
        target: { value: phrase },
      });
      fireEvent.click(screen.getByRole("checkbox"));
      now += 300001;
      fireEvent.click(
        screen.getByRole("button", { name: "Save encrypted wallet" }),
      );
      expect(create).not.toHaveBeenCalled();
      expect(
        screen.queryByLabelText("Recovery phrase"),
      ).not.toBeInTheDocument();
      expect(screen.getByText(/Setup timed out/)).toBeInTheDocument();
    } finally {
      clock.mockRestore();
    }
  });
  it("cancels an in-flight encryption without saving a hidden wallet", async () => {
    const catalog = new VaultCatalog(localStorage, cryptoApi);
    const create = vi.spyOn(catalog, "create");
    render(<LocalVaultPanel catalog={catalog} cryptoApi={cryptoApi} />);
    fireEvent.click(screen.getByRole("button", { name: "Recover wallet" }));
    fillDetails();
    fireEvent.change(screen.getByLabelText("Recovery phrase"), {
      target: { value: phrase },
    });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(
      screen.getByRole("button", { name: "Save encrypted wallet" }),
    );
    expect(create).toHaveBeenCalledTimes(1);
    const pending = create.mock.results[0]!.value;
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await expect(pending).rejects.toThrow("cancelled");
    expect(catalog.list()).toHaveLength(0);
    expect(screen.queryByLabelText("Recovery phrase")).toBeNull();
    create.mockRestore();
  });
  it("recovers only into ciphertext, authenticates before displaying an address, and locks on pagehide", async () => {
    const catalog = new VaultCatalog(localStorage, cryptoApi);
    const network = vi.spyOn(globalThis, "fetch");
    const unlocked = vi.fn();
    const locked = vi.fn();
    render(
      <LocalVaultPanel
        catalog={catalog}
        cryptoApi={cryptoApi}
        onUnlocked={unlocked}
        onLocked={locked}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Recover wallet" }));
    fillDetails();
    fireEvent.change(screen.getByLabelText("Recovery phrase"), {
      target: { value: phrase },
    });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(
      screen.getByRole("button", { name: "Save encrypted wallet" }),
    );
    await screen.findByText(
      "Encrypted wallet saved in this browser. Unlock it to verify its address.",
    );
    expect(
      screen.queryByText("bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu"),
    ).toBeNull();
    const persisted = Array.from({ length: localStorage.length }, (_, i) =>
      localStorage.getItem(localStorage.key(i)!),
    ).join();
    expect(persisted).not.toContain(phrase);
    expect(persisted).not.toContain(password);
    fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
    fireEvent.change(screen.getByLabelText("Wallet password"), {
      target: { value: password },
    });
    const passwordField = screen.getByLabelText("Wallet password");
    passwordField.focus();
    expect(passwordField).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Unlock wallet" }));
    expect(passwordField).not.toHaveFocus();
    await screen.findByText("bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu");
    expect(unlocked).toHaveBeenCalledTimes(1);
    fireEvent(window, new Event("pagehide"));
    expect(
      screen.queryByText("bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu"),
    ).toBeNull();
    expect(catalog.controller(catalog.list()[0]!.id).locked).toBe(true);
    expect(locked).toHaveBeenCalled();
    expect(network).not.toHaveBeenCalled();
    network.mockRestore();
  });
  it("requires backup verification before saving a generated wallet", async () => {
    const catalog = new VaultCatalog(localStorage, cryptoApi);
    render(<LocalVaultPanel catalog={catalog} cryptoApi={cryptoApi} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Create encrypted wallet" }),
    );
    fillDetails();
    fireEvent.click(
      screen.getByRole("button", { name: "Generate recovery phrase" }),
    );
    const words = screen
      .getAllByRole("listitem")
      .map((item) => item.textContent!.replace(/^\d+\. /, ""));
    expect(words).toHaveLength(24);
    expect(localStorage.length).toBe(0);
    expect(
      screen.getByRole("button", { name: "Verify backup" }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Verify backup" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Save encrypted wallet" }),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Those words do not match",
    );
    expect(localStorage.length).toBe(0);
    for (const input of screen.getAllByRole("textbox")) {
      const text = document.querySelector(`label[for="${input.id}"]`)!
        .textContent!;
      const position = Number(text.replace("Word ", "")) - 1;
      fireEvent.change(input, { target: { value: words[position] } });
    }
    fireEvent.click(
      screen.getByRole("button", { name: "Save encrypted wallet" }),
    );
    await screen.findByText(
      "Encrypted wallet saved in this browser. Unlock it to verify its address.",
    );
    expect(catalog.list()).toHaveLength(1);
    expect(
      localStorage.getItem(`redwallet.vault.v1.${catalog.list()[0]!.id}`),
    ).not.toContain(words.join(" "));
  });
  it("clears unsaved phrase/password/passphrase on backgrounding and never saves invalid recovery", async () => {
    const catalog = new VaultCatalog(localStorage, cryptoApi);
    render(<LocalVaultPanel catalog={catalog} cryptoApi={cryptoApi} />);
    fireEvent.click(screen.getByRole("button", { name: "Recover wallet" }));
    fillDetails();
    fireEvent.change(screen.getByLabelText("Recovery phrase"), {
      target: { value: "invalid recovery words" },
    });
    fireEvent.change(screen.getByLabelText("Optional BIP39 passphrase"), {
      target: { value: "public fixture passphrase" },
    });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(
      screen.getByRole("button", { name: "Save encrypted wallet" }),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Invalid English BIP39 recovery phrase",
    );
    expect(catalog.list()).toHaveLength(0);
    fireEvent(window, new Event("pagehide"));
    fireEvent.click(screen.getByRole("button", { name: "Recover wallet" }));
    for (const name of [
      "Recovery phrase",
      "Browser wallet password",
      "Confirm password",
      "Optional BIP39 passphrase",
    ])
      expect(screen.getByLabelText(name)).toHaveValue("");
    await waitFor(() => expect(catalog.list()).toHaveLength(0));
  });
});
