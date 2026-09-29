import { describe, expect, it, vi } from "vitest";
import type { PaymentActor } from "./payment-network";
import { submitOriginal } from "./payment-network";
function actor(enabled = true) {
  return {
    getServerStatus: vi.fn(async () => ({
      __kind__: "ok",
      ok: {
        height: 974750n,
        checkpointConfigured: true,
        checkpointHeight: 961640n,
        checkpointHash:
          "0000000000000050c1e5f69672f459293be14f46e5a494e7a8c8541396f18eeb",
        broadcastEnabled: enabled,
      },
    })),
    broadcastSignedTransaction: vi.fn(async (_hex: string, txid: string) => ({
      __kind__: "ok",
      ok: { txid, outcome: "acknowledged" },
    })),
  };
}
describe("explicit original-byte dispatch", () => {
  it("blocks disabled status and cancelled views before dispatch", async () => {
    const a = actor(false);
    await expect(
      submitOriginal(
        a as unknown as PaymentActor,
        "00",
        "a".repeat(64),
        () => true,
      ),
    ).rejects.toThrow(/disabled/);
    expect(a.broadcastSignedTransaction).not.toHaveBeenCalled();
    const b = actor();
    await expect(
      submitOriginal(
        b as unknown as PaymentActor,
        "00",
        "a".repeat(64),
        () => false,
      ),
    ).rejects.toThrow(/cancelled/);
    expect(b.broadcastSignedTransaction).not.toHaveBeenCalled();
  });
  it("dispatches exactly once and rejects a mismatching acknowledgment", async () => {
    const a = actor();
    expect(
      (
        await submitOriginal(
          a as unknown as PaymentActor,
          "00",
          "a".repeat(64),
          () => true,
        )
      ).txid,
    ).toBe("a".repeat(64));
    expect(a.broadcastSignedTransaction).toHaveBeenCalledTimes(1);
    a.broadcastSignedTransaction.mockResolvedValue({
      __kind__: "ok",
      ok: { txid: "b".repeat(64), outcome: "acknowledged" },
    });
    await expect(
      submitOriginal(
        a as unknown as PaymentActor,
        "00",
        "a".repeat(64),
        () => true,
      ),
    ).rejects.toThrow(/does not match/);
  });
});
