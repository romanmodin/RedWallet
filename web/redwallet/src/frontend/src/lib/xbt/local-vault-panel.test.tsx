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
  it("keeps recovery fields across app switches and pagehide, then saves only ciphertext", async () => {
    const catalog = new VaultCatalog(localStorage, cryptoApi);
    const network = vi.spyOn(globalThis, "fetch");
    const visibility = vi.spyOn(document, "visibilityState", "get");
    try {
      render(<LocalVaultPanel catalog={catalog} cryptoApi={cryptoApi} />);
      fireEvent.click(screen.getByRole("button", { name: "Recover wallet" }));
      fillDetails();
      fireEvent.change(screen.getByLabelText("Recovery phrase"), {
        target: { value: phrase },
      });
      fireEvent.change(screen.getByLabelText("Optional BIP39 passphrase"), {
        target: { value: "public resume fixture" },
      });
      fireEvent.click(screen.getByRole("checkbox"));
      for (let i = 0; i < 2; i++) {
        visibility.mockReturnValue("hidden");
        fireEvent(document, new Event("visibilitychange"));
        fireEvent(window, new Event("pagehide"));
        visibility.mockReturnValue("visible");
        fireEvent(document, new Event("visibilitychange"));
        fireEvent(window, new Event("pageshow"));
        expect(screen.getByLabelText("Wallet name")).toHaveValue(
          "Public test fixture",
        );
        expect(screen.getByLabelText("Recovery phrase")).toHaveValue(phrase);
        expect(screen.getByLabelText("Optional BIP39 passphrase")).toHaveValue(
          "public resume fixture",
        );
        expect(screen.getByLabelText("Browser wallet password")).toHaveValue(
          password,
        );
        expect(screen.getByLabelText("Confirm password")).toHaveValue(password);
        expect(screen.getByRole("checkbox")).toBeChecked();
      }
      expect(localStorage.length).toBe(0);
      expect(network).not.toHaveBeenCalled();
      fireEvent.click(
        screen.getByRole("button", { name: "Save encrypted wallet" }),
      );
      await screen.findByText(
        "Encrypted wallet saved in this browser. Unlock it to verify its address.",
      );
      expect(catalog.list()).toHaveLength(1);
      const stored = Array.from({ length: localStorage.length }, (_, i) =>
        localStorage.getItem(localStorage.key(i)!),
      ).join();
      expect(stored).not.toContain(phrase);
      expect(stored).not.toContain(password);
      expect(stored).not.toContain("public resume fixture");
      expect(screen.queryByLabelText("Recovery phrase")).toBeNull();
    } finally {
      visibility.mockRestore();
      network.mockRestore();
    }
  });

  it.each(["wall", "monotonic"])(
    "clears recovery on return when the %s deadline expired while timers were suspended",
    (expiredClock) => {
      let wall = 1000;
      let monotonic = 1000;
      const wallClock = vi.spyOn(Date, "now").mockImplementation(() => wall);
      const monoClock = vi
        .spyOn(performance, "now")
        .mockImplementation(() => monotonic);
      const visibility = vi.spyOn(document, "visibilityState", "get");
      try {
        const catalog = new VaultCatalog(localStorage, cryptoApi);
        render(<LocalVaultPanel catalog={catalog} cryptoApi={cryptoApi} />);
        fireEvent.click(screen.getByRole("button", { name: "Recover wallet" }));
        fillDetails();
        fireEvent.change(screen.getByLabelText("Recovery phrase"), {
          target: { value: phrase },
        });
        visibility.mockReturnValue("hidden");
        fireEvent(document, new Event("visibilitychange"));
        if (expiredClock === "wall") wall += 300001;
        else {
          monotonic += 300001;
          wall -= 60000;
        }
        visibility.mockReturnValue("visible");
        fireEvent(document, new Event("visibilitychange"));
        expect(screen.queryByLabelText("Recovery phrase")).toBeNull();
        expect(screen.getByText(/Recovery entry expired/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Recover wallet" }));
        expect(screen.getByLabelText("Recovery phrase")).toHaveValue("");
        expect(screen.getByLabelText("Browser wallet password")).toHaveValue(
          "",
        );
        expect(localStorage.length).toBe(0);
      } finally {
        visibility.mockRestore();
        monoClock.mockRestore();
        wallClock.mockRestore();
      }
    },
  );

  it("discards recovery on navigation unmount or vault storage invalidation", () => {
    const catalog = new VaultCatalog(localStorage, cryptoApi);
    const view = render(
      <LocalVaultPanel catalog={catalog} cryptoApi={cryptoApi} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Recover wallet" }));
    fillDetails();
    fireEvent.change(screen.getByLabelText("Recovery phrase"), {
      target: { value: phrase },
    });
    fireEvent(window, new Event("pagehide"));
    view.unmount();
    render(<LocalVaultPanel catalog={catalog} cryptoApi={cryptoApi} />);
    fireEvent.click(screen.getByRole("button", { name: "Recover wallet" }));
    expect(screen.getByLabelText("Recovery phrase")).toHaveValue("");
    expect(screen.getByLabelText("Browser wallet password")).toHaveValue("");
    fillDetails();
    fireEvent.change(screen.getByLabelText("Recovery phrase"), {
      target: { value: phrase },
    });
    fireEvent(
      window,
      new StorageEvent("storage", { key: "redwallet.vault.v1.other" }),
    );
    expect(screen.queryByLabelText("Recovery phrase")).toBeNull();
    expect(localStorage.length).toBe(0);
  });

  it("still cancels encryption on backgrounding instead of saving a hidden wallet", async () => {
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
    const pending = create.mock.results[0]!.value;
    fireEvent(window, new Event("pagehide"));
    await expect(pending).rejects.toThrow("cancelled");
    expect(screen.queryByLabelText("Recovery phrase")).toBeNull();
    expect(catalog.list()).toHaveLength(0);
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
  it("preserves invalid recovery entry on backgrounding, rejects it, and clears it on cancel", async () => {
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
    expect(screen.getByLabelText("Recovery phrase")).toHaveValue(
      "invalid recovery words",
    );
    expect(screen.getByLabelText("Browser wallet password")).toHaveValue(
      password,
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
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

it("requires backup acknowledgment and exact wallet name, and cancellation preserves the vault", async () => {
  const catalog = new VaultCatalog(localStorage, cryptoApi);
  const { id } = await catalog.create(
    "Public removal fixture",
    { mnemonic: phrase, passphrase: "" },
    password,
  );
  const removed = vi.fn();
  render(
    <LocalVaultPanel
      catalog={catalog}
      cryptoApi={cryptoApi}
      onRemoved={removed}
    />,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Remove Public removal fixture" }),
  );
  expect(
    screen.getByRole("button", { name: "Remove encrypted wallet" }),
  ).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Cancel removal" }));
  expect(catalog.list()).toHaveLength(1);
  fireEvent.click(
    screen.getByRole("button", { name: "Remove Public removal fixture" }),
  );
  fireEvent.click(
    screen.getByLabelText(
      "I have my recovery backup, or this is a disposable test wallet.",
    ),
  );
  fireEvent.change(screen.getByLabelText("Type the wallet name to confirm"), {
    target: { value: "wrong" },
  });
  expect(
    screen.getByRole("button", { name: "Remove encrypted wallet" }),
  ).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Type the wallet name to confirm"), {
    target: { value: "Public removal fixture" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Remove encrypted wallet" }),
  );
  expect(catalog.list()).toHaveLength(0);
  expect(removed).toHaveBeenCalledWith(id);
  expect(
    screen.getByText("Encrypted wallet removed from this browser."),
  ).toBeInTheDocument();
});
