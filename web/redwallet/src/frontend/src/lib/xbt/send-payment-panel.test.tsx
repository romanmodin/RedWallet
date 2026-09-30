import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { backendInterface } from "@/backend";
import { SendPaymentPanel } from "@/components/vault/SendPaymentPanel";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AccountSnapshot } from "./account-reader";
import { IssuedAddresses } from "./issued-addresses";
import { XbtKeySession } from "./key-material";
import { SpendPreparation } from "./spend-preparation";
import { SpendReview } from "./spend-review";
import type { VaultController } from "./vault-controller";
const fixture = JSON.parse(
  readFileSync(
    resolve(process.cwd(), "../../test/regtest/xbt-web-signed-20260929.json"),
    "utf8",
  ),
);
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});
function setup() {
  localStorage.clear();
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: {
      request: async (
        _name: string,
        _options: unknown,
        fn: () => Promise<unknown>,
      ) => await fn(),
    },
  });
  const keys = new XbtKeySession(
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
  );
  const signed = vi.fn((operation: (k: XbtKeySession) => unknown) =>
    operation(keys),
  );
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
    broadcastSignedTransaction: vi.fn(async (_hex: string, txid: string) => ({
      __kind__: "ok",
      ok: { txid, outcome: "acknowledged" },
    })),
  };
  vi.spyOn(SpendPreparation.prototype, "prepare").mockImplementation(
    async () => ({
      review: new SpendReview(fixture.plan),
      suggestedFeeRate: 1,
    }),
  );
  const props = {
    account: keys.account,
    actor: actor as unknown as backendInterface,
    addressBook: new IssuedAddresses(keys.account.accountXpub, localStorage),
    snapshot: { observedAt: Date.now() } as AccountSnapshot,
    controller: { withUnlocked: signed } as unknown as VaultController,
    locked: false,
  };
  return { keys, signed, actor, props };
}
describe("explicit local sign then network submission", () => {
  it("signs only after review acknowledgment, persists bytes, and requires separate send acknowledgment", async () => {
    const f = setup();
    try {
      render(<SendPaymentPanel {...f.props} />);
      fireEvent.click(
        screen.getByRole("button", { name: "Prepare transaction review" }),
      );
      await screen.findByText("Review before signing");
      expect(
        screen.getByRole("button", {
          name: "Sign reviewed transaction locally",
        }),
      ).toBeDisabled();
      fireEvent.click(
        screen.getByRole("checkbox", { name: /I checked the XBT recipient/ }),
      );
      fireEvent.click(
        screen.getByRole("button", {
          name: "Sign reviewed transaction locally",
        }),
      );
      await screen.findByText("Saved signed payment");
      expect(f.signed).toHaveBeenCalledTimes(1);
      expect(f.actor.broadcastSignedTransaction).not.toHaveBeenCalled();
      expect(
        screen.getByRole("button", { name: "Send signed transaction" }),
      ).toBeDisabled();
      fireEvent.click(screen.getByRole("checkbox", { name: /want to submit/ }));
      fireEvent.click(
        screen.getByRole("button", { name: "Send signed transaction" }),
      );
      await waitFor(() =>
        expect(f.actor.broadcastSignedTransaction).toHaveBeenCalledWith(
          fixture.hex,
          fixture.txid,
        ),
      );
      await screen.findByText(/Node acknowledged/);
      expect(f.actor.broadcastSignedTransaction).toHaveBeenCalledTimes(1);
      expect(
        screen.getByText("Sent — awaiting confirmation"),
      ).toBeInTheDocument();
      expect(screen.queryByRole("checkbox")).toBeNull();
      expect(
        screen.queryByRole("button", {
          name: /Send signed|Retry original|Submit the same/,
        }),
      ).toBeNull();
      expect(
        screen.getByRole("button", { name: "Check confirmation" }),
      ).toBeEnabled();
      cleanup();
      render(<SendPaymentPanel {...f.props} locked />);
      await screen.findByText("Sent — awaiting confirmation");
      expect(screen.queryByRole("checkbox")).toBeNull();
      expect(
        screen.queryByRole("button", {
          name: /Send signed|Retry original|Submit the same/,
        }),
      ).toBeNull();
      expect(f.actor.broadcastSignedTransaction).toHaveBeenCalledTimes(1);
      fireEvent.click(
        screen.getByRole("button", { name: "Check confirmation" }),
      );
      await screen.findByRole("button", {
        name: "Send another to this recipient",
      });
      fireEvent.click(
        screen.getByRole("button", { name: "Send another to this recipient" }),
      );
      expect(screen.getByLabelText("XBT recipient")).toHaveValue(
        fixture.plan.destination,
      );
      expect(screen.getByLabelText("Amount in XBT")).toHaveValue("");
      expect(
        screen.getByText("Sent · Confirmation recorded"),
      ).toBeInTheDocument();
      cleanup();
      render(<SendPaymentPanel {...f.props} locked />);
      await screen.findByText("Sent · Confirmation recorded");
      expect(
        screen.getByText(`Transaction ID: ${fixture.txid}`),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Send another to this recipient" }),
      ).toBeEnabled();
      expect(screen.queryByRole("checkbox")).toBeNull();
      expect(f.signed).toHaveBeenCalledTimes(1);
      expect(f.actor.broadcastSignedTransaction).toHaveBeenCalledTimes(1);
    } finally {
      f.keys.destroy();
    }
  });
  it("restores the editable draft after background and remount, but not consent or review", async () => {
    const f = setup();
    try {
      const view = render(<SendPaymentPanel {...f.props} />);
      fireEvent.change(screen.getByLabelText("XBT recipient"), {
        target: { value: fixture.plan.destination },
      });
      fireEvent.change(screen.getByLabelText("Amount in XBT"), {
        target: { value: "0.005" },
      });
      fireEvent.click(
        screen.getByRole("button", { name: "Prepare transaction review" }),
      );
      await screen.findByText("Review before signing");
      fireEvent.click(
        screen.getByRole("checkbox", { name: /I checked the XBT recipient/ }),
      );
      fireEvent(window, new Event("pagehide"));
      expect(screen.queryByText("Review before signing")).toBeNull();
      view.unmount();
      render(<SendPaymentPanel {...f.props} locked />);
      expect(screen.getByLabelText("XBT recipient")).toHaveValue(
        fixture.plan.destination,
      );
      expect(screen.getByLabelText("Amount in XBT")).toHaveValue("0.005");
      expect(
        screen.getByRole("button", { name: "Prepare transaction review" }),
      ).toBeDisabled();
      fireEvent.change(screen.getByLabelText("XBT recipient"), {
        target: { value: "" },
      });
      fireEvent.change(screen.getByLabelText("XBT recipient"), {
        target: { value: fixture.plan.destination },
      });
      expect(screen.getByLabelText("XBT recipient")).toHaveValue(
        fixture.plan.destination,
      );
      expect(screen.queryByRole("checkbox")).toBeNull();
      expect(f.signed).not.toHaveBeenCalled();
      expect(f.actor.broadcastSignedTransaction).not.toHaveBeenCalled();
    } finally {
      f.keys.destroy();
    }
  });
  it("invalidates a prepared review on edits and locking", async () => {
    const f = setup();
    try {
      const view = render(<SendPaymentPanel {...f.props} />);
      fireEvent.click(
        screen.getByRole("button", { name: "Prepare transaction review" }),
      );
      await screen.findByText("Review before signing");
      fireEvent.change(screen.getByLabelText("Amount in XBT"), {
        target: { value: "1" },
      });
      expect(screen.queryByText("Review before signing")).toBeNull();
      fireEvent.click(
        screen.getByRole("button", { name: "Prepare transaction review" }),
      );
      await screen.findByText("Review before signing");
      view.rerender(<SendPaymentPanel {...f.props} locked />);
      expect(screen.queryByText("Review before signing")).toBeNull();
      expect(f.signed).not.toHaveBeenCalled();
      expect(f.actor.broadcastSignedTransaction).not.toHaveBeenCalled();
    } finally {
      f.keys.destroy();
    }
  });
});
