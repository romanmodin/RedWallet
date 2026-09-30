import {
  PROVIDER_EVENT,
  providerGeneration,
} from "@/services/networkGeneration";
import {
  BUILTIN_BACKUPS,
  CHECKPOINT_HASH,
  type CustomProvider,
  HOME_ADAPTER,
  PROVIDER_STORAGE_KEY,
  type ProviderActor,
  type ProviderConnection,
  type ProviderInfo,
  ProviderRouter,
  type ProviderSelection,
  readProviderSelection,
  saveProviderSelection,
  validateCustomProvider,
  validateProviderInfo,
} from "@/services/providerService";
import { beforeEach, describe, expect, it, vi } from "vitest";
const custom: CustomProvider = {
  host: "127.0.0.1",
  port: 55001,
  tls: false,
  endpoint: HOME_ADAPTER.endpoint,
  canisterId: HOME_ADAPTER.id,
  allowBuiltinFallback: false,
};
const now = Date.now();
function connection(id: string, height = 974900n): ProviderConnection {
  const info: ProviderInfo = {
    host: custom.host,
    port: BigInt(custom.port),
    tls: custom.tls,
    endpoint: custom.endpoint,
    tipTimestamp: BigInt(Math.floor(now / 1000)),
    height,
    checkpointHeight: 961640n,
    checkpointHash: CHECKPOINT_HASH,
  };
  const result = { __kind__: "ok", ok: {} };
  const actor = {
    getBridgeStatus: vi.fn(async () => ({
      configured: true,
      checkpointConfigured: true,
    })),
    getServerStatus: vi.fn(async () => ({
      __kind__: "ok",
      ok: {
        height,
        checkpointConfigured: true,
        checkpointHeight: 961640n,
        checkpointHash: CHECKPOINT_HASH,
      },
    })),
    getAddressBalance: vi.fn(async () => result),
    getAddressHistory: vi.fn(async () => result),
    getAddressUtxos: vi.fn(async () => result),
    getFeeEstimate: vi.fn(async () => result),
    getRawTransaction: vi.fn(async () => result),
    broadcastSignedTransaction: vi.fn(async () => result),
  } as unknown as ProviderActor;
  return { id, actor, info: vi.fn(async () => ({ ...info })) };
}
function fixture() {
  let selection: ProviderSelection = { mode: "builtin" };
  const primary = connection("primary");
  const mine = connection(custom.canisterId);
  const backup = connection("backup");
  const backupInfo = backup.info;
  backup.info = vi.fn(async () => ({
    ...(await backupInfo()),
    endpoint: "https://backup.example",
  }));
  const load = vi.fn(async (id?: string) =>
    id === custom.canisterId ? mine : id === "backup" ? backup : primary,
  );
  const router = new ProviderRouter(
    () => selection,
    load,
    [{ id: "backup", name: "independent", endpoint: "https://backup.example" }],
    () => now,
  );
  return {
    router,
    primary,
    mine,
    backup,
    load,
    select: (value: ProviderSelection) => {
      selection = value;
      router.sync();
    },
  };
}
beforeEach(() => localStorage.clear());
describe("actual provider routes", () => {
  it("defaults built-in and sends every route to the explicitly selected adapter", async () => {
    const f = fixture();
    const builtin = await f.router.resolve();
    await builtin.getAddressBalance("public");
    f.select({ mode: "custom", config: custom });
    const selected = await f.router.resolve();
    await selected.getAddressBalance("address");
    await selected.getAddressHistory("address");
    await selected.getAddressUtxos("address");
    await selected.getFeeEstimate();
    await selected.getRawTransaction("a".repeat(64));
    await selected.broadcastSignedTransaction("00", "a".repeat(64));
    for (const method of [
      "getAddressBalance",
      "getAddressHistory",
      "getAddressUtxos",
      "getFeeEstimate",
      "getRawTransaction",
      "broadcastSignedTransaction",
    ] as const)
      expect(f.mine.actor[method]).toHaveBeenCalledTimes(1);
    expect(f.primary.actor.getAddressBalance).toHaveBeenCalledTimes(1);
    expect(f.primary.actor.broadcastSignedTransaction).not.toHaveBeenCalled();
    expect(f.router.current()?.name).toBe("My own Fulcrum");
  });
  it("test checks entered server identity, not the shared bridge; mismatch is rejected", async () => {
    const f = fixture();
    await f.router.test(custom);
    expect(f.load).toHaveBeenCalledWith(custom.canisterId);
    await expect(
      f.router.test({ ...custom, host: "another.example" }),
    ).rejects.toThrow(/does not reach/);
    await expect(f.router.test({ ...custom, port: 50002 })).rejects.toThrow(
      /does not reach/,
    );
    await expect(f.router.test({ ...custom, tls: true })).rejects.toThrow(
      /does not reach/,
    );
    await expect(
      f.router.test({ ...custom, endpoint: "https://another.example" }),
    ).rejects.toThrow(/does not reach/);
    expect(f.primary.info).not.toHaveBeenCalled();
  });
  it("failed custom connection does not fall back; returning built-in works", async () => {
    const f = fixture();
    f.select({ mode: "custom", config: custom });
    vi.mocked(f.mine.info).mockRejectedValue(Error("offline"));
    await expect(f.router.resolve()).rejects.toThrow(/offline/);
    expect(f.primary.info).not.toHaveBeenCalled();
    expect(f.backup.info).not.toHaveBeenCalled();
    f.select({ mode: "builtin" });
    await (await f.router.resolve()).getFeeEstimate();
    expect(f.primary.actor.getFeeEstimate).toHaveBeenCalledTimes(1);
  });
  it("persists custom selection and opt-in after reload without modifying pricing or wallets", () => {
    localStorage.setItem(
      "redwallet.settings.v1",
      '{"priceMode":"manual","manualUsdPerXbt":123}',
    );
    localStorage.setItem("redwallet.vault.v1.public-fixture", "fixture");
    saveProviderSelection({ mode: "custom", config: custom });
    expect(readProviderSelection()).toEqual({ mode: "custom", config: custom });
    expect(localStorage.getItem("redwallet.settings.v1")).toContain("123");
    expect(localStorage.getItem("redwallet.vault.v1.public-fixture")).toBe(
      "fixture",
    );
    saveProviderSelection({ mode: "builtin" });
    expect(readProviderSelection()).toEqual({ mode: "builtin" });
  });
  it("malformed saved custom selection fails closed instead of selecting public service", () => {
    localStorage.setItem(PROVIDER_STORAGE_KEY, "broken");
    expect(readProviderSelection().mode).toBe("custom");
    localStorage.setItem(
      PROVIDER_STORAGE_KEY,
      JSON.stringify({ mode: "custom", config: {} }),
    );
    expect(readProviderSelection().mode).toBe("custom");
  });
  it("rejects wrong chain and stale tips before any balance or payment route", async () => {
    const f = fixture();
    f.select({ mode: "custom", config: custom });
    const info = await f.mine.info();
    vi.mocked(f.mine.info).mockResolvedValue({
      ...info,
      checkpointHash: "b".repeat(64),
    });
    await expect(f.router.resolve()).rejects.toThrow(/checkpoint/);
    vi.mocked(f.mine.info).mockResolvedValue({
      ...info,
      tipTimestamp: BigInt(Math.floor(now / 1000) - 7201),
    });
    await expect(f.router.resolve()).rejects.toThrow(/stale/);
    expect(f.mine.actor.getAddressBalance).not.toHaveBeenCalled();
    expect(f.mine.actor.broadcastSignedTransaction).not.toHaveBeenCalled();
  });
  it("built-in initial outage accepts only a verified fresh independent backup", async () => {
    const f = fixture();
    vi.mocked(f.primary.info).mockRejectedValue(Error("offline"));
    const a = await f.router.resolve();
    await a.getAddressBalance("address");
    expect(f.backup.actor.getAddressBalance).toHaveBeenCalledTimes(1);
    expect(f.router.current()?.backup).toBe(true);
    expect(BUILTIN_BACKUPS).toEqual([]); // No live redundancy claim until an independent deployment is verified.
  });
  it("rejects a backup behind the last healthy height or with wrong checkpoint", async () => {
    const f = fixture();
    const a = await f.router.resolve();
    vi.mocked(f.primary.actor.getAddressHistory).mockRejectedValue(
      Error("offline"),
    );
    const info = await f.backup.info();
    vi.mocked(f.backup.info).mockResolvedValue({ ...info, height: 974800n });
    await expect(a.getAddressHistory("address")).rejects.toThrow();
    expect(f.backup.actor.getAddressHistory).not.toHaveBeenCalled();
    expect(() =>
      validateProviderInfo({ ...info, checkpointHeight: 1n }, undefined, now),
    ).toThrow(/checkpoint/);
  });
  it("runtime failover cancels old actor/review and requires fresh reads; no broadcast replay", async () => {
    const f = fixture();
    const a = await f.router.resolve();
    const generation = providerGeneration();
    vi.mocked(f.primary.actor.getAddressHistory).mockRejectedValue(
      Error("offline"),
    );
    await expect(a.getAddressHistory("address")).rejects.toThrow();
    expect(providerGeneration()).toBeGreaterThan(generation);
    await expect(a.getFeeEstimate()).rejects.toThrow(/Provider changed/);
    await (await f.router.resolve()).getFeeEstimate();
    expect(f.backup.actor.getFeeEstimate).toHaveBeenCalledTimes(1);
    expect(f.backup.actor.broadcastSignedTransaction).not.toHaveBeenCalled();
  });
  it("custom fallback happens only when explicitly opted in and is clearly identified", async () => {
    const f = fixture();
    f.select({
      mode: "custom",
      config: { ...custom, allowBuiltinFallback: true },
    });
    vi.mocked(f.mine.info).mockRejectedValue(Error("offline"));
    await f.router.resolve();
    expect(f.router.current()?.name).toContain("custom fallback");
    expect(f.primary.info).toHaveBeenCalledTimes(1);
  });
  it("provider change while a read is pending discards the late result", async () => {
    const f = fixture();
    const a = await f.router.resolve();
    let finish: (value: any) => void = () => {};
    vi.mocked(f.primary.actor.getAddressBalance).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const reading = a.getAddressBalance("address");
    await Promise.resolve();
    f.select({ mode: "custom", config: custom });
    finish({ __kind__: "ok", ok: { confirmed: 1n, unconfirmed: 0n } });
    await expect(reading).rejects.toThrow(/Provider changed/);
  });
  it("does not proxy arbitrary URLs, credentials or upstream methods", () => {
    for (const endpoint of ["", "   "]) {
      expect(() => validateCustomProvider({ ...custom, endpoint })).toThrow(
        /Enter the HTTPS bridge URL/,
      );
    }
    expect(() =>
      validateCustomProvider({ ...custom, endpoint: "not a URL" }),
    ).toThrow(/complete HTTPS bridge URL/);
    expect(
      validateCustomProvider({
        ...custom,
        endpoint: `  ${HOME_ADAPTER.endpoint}  `,
      }).endpoint,
    ).toBe(HOME_ADAPTER.endpoint);
    expect(() =>
      validateCustomProvider({ ...custom, endpoint: "http://localhost" }),
    ).toThrow();
    expect(() =>
      validateCustomProvider({
        ...custom,
        endpoint: "https://user:secret@example.com",
      }),
    ).toThrow();
    expect(() =>
      validateCustomProvider({
        ...custom,
        endpoint: "https://example.com?token=x",
      }),
    ).toThrow();
    expect(() =>
      validateCustomProvider({ ...custom, canisterId: "aaaaa-aa" }),
    ).toThrow();
  });
});
