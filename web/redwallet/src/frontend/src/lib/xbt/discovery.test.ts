import { describe, expect, it, vi } from "vitest";
import { discoverAccount } from "./discovery";
import { XbtKeySession } from "./key-material";

// Published BIP84 vector only. Never deposit funds to this public test wallet.
const session = new XbtKeySession(
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
);
const xpub = session.account.accountXpub;
session.destroy();

describe("bounded public HD discovery", () => {
  it("checks both native branches and returns published first addresses", async () => {
    const probe = vi.fn(async () => false);
    const [receive, change] = await discoverAccount(xpub, probe);
    expect(probe).toHaveBeenCalledTimes(40);
    expect(receive.next.address).toBe(
      "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu",
    );
    expect(change.next.address).toBe(
      "bc1q8c6fshw2dlwun7ekn9qwf37cu2rn755upcp6el",
    );
    expect(receive.used).toEqual([]);
  });
  it("resets the gap on activity, including a fully spent address", async () => {
    let n = 0;
    const [receive, change] = await discoverAccount(
      xpub,
      async () => n++ === 19,
    );
    expect(receive.used.map((a) => a.index)).toEqual([19]);
    expect(receive.next.index).toBe(20);
    expect(receive.scanned).toBe(40);
    expect(change.scanned).toBe(20);
  });
  it("does not reuse locally issued but unused receive or change addresses", async () => {
    const [receive, change] = await discoverAccount(xpub, async () => false, {
      issuedThrough: [25, 2],
    });
    expect(receive.scanned).toBe(46);
    expect(receive.next.index).toBe(26);
    expect(change.scanned).toBe(23);
    expect(change.next.index).toBe(3);
  });
  it("rejects truncated recovery rather than returning a misleading empty wallet", async () => {
    await expect(
      discoverAccount(xpub, async () => true, { maxAddressesPerBranch: 20 }),
    ).rejects.toThrow("incomplete");
  });
  it("propagates failed and malformed history observations", async () => {
    await expect(
      discoverAccount(xpub, async () => {
        throw Error("offline");
      }),
    ).rejects.toThrow("offline");
    await expect(
      discoverAccount(xpub, async () => undefined as unknown as boolean),
    ).rejects.toThrow("Invalid history");
  });
  it("cancels before another probe when aborted during an outstanding read", async () => {
    const controller = new AbortController();
    const probe = vi.fn(async () => {
      controller.abort();
      return false;
    });
    await expect(
      discoverAccount(xpub, probe, { signal: controller.signal }),
    ).rejects.toThrow("cancelled");
    expect(probe).toHaveBeenCalledTimes(1);
  });
  it("rejects invalid or impossible bounds before any backend contact", async () => {
    const probe = vi.fn(async () => false);
    for (const options of [
      { gapLimit: 0 },
      { maxAddressesPerBranch: 2001 },
      { issuedThrough: [999, -1] as const },
    ]) {
      await expect(discoverAccount(xpub, probe, options)).rejects.toThrow(
        "bounds",
      );
    }
    expect(probe).not.toHaveBeenCalled();
    await expect(discoverAccount("invalid", probe)).rejects.toThrow();
    expect(probe).not.toHaveBeenCalled();
  });
});
