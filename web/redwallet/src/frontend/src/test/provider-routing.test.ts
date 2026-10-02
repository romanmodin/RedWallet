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
  const direct = connection("wss:home");
  const directInfo = direct.info;
  direct.info = vi.fn(async () => ({
    ...(await directInfo()),
    host: "home.example",
    port: 50004n,
    tls: true,
    endpoint: "wss://home.example:50004/",
  }));
  const loadDirect = vi.fn(async () => direct);
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
    loadDirect,
  );
  return {
    router,
    direct,
    loadDirect,
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
function websocketBackupFixture() {
  let selection: ProviderSelection = { mode: "builtin" };
  let time = now;
  const registered = BUILTIN_BACKUPS[0];
  const primary = connection("primary");
  const backup = connection(registered.id);
  const original = backup.info;
  backup.info = vi.fn(async () => ({
    ...(await original()),
    endpoint: registered.endpoint,
    host: "mempool.guide",
    port: 443n,
    tls: true,
  }));
  backup.close = vi.fn();
  const load = vi.fn(async () => primary);
  const loadDirect = vi.fn(async () => backup);
  const router = new ProviderRouter(
    () => selection,
    load,
    BUILTIN_BACKUPS,
    () => time,
    loadDirect,
  );
  return {
    router,
    primary,
    backup,
    load,
    loadDirect,
    advance: (ms: number) => {
      time += ms;
    },
    select: (value: ProviderSelection) => {
      selection = value;
      router.sync();
    },
  };
}
describe("registered mempool.guide WSS backup", () => {
  it("keeps Umbrel first and contacts no public backup while the primary is healthy", async () => {
    const f = websocketBackupFixture();
    await (await f.router.resolve()).getFeeEstimate();
    expect(f.load).toHaveBeenCalledWith(undefined);
    expect(f.loadDirect).not.toHaveBeenCalled();
    expect(f.router.current()?.backup).toBe(false);
  });
  it("initial primary outage routes every wallet read to the named WSS backup", async () => {
    const f = websocketBackupFixture();
    vi.mocked(f.primary.info).mockRejectedValue(Error("offline"));
    const actor = await f.router.resolve();
    await actor.getAddressBalance("public");
    await actor.getAddressHistory("public");
    await actor.getAddressUtxos("public");
    await actor.getFeeEstimate();
    await actor.getRawTransaction("public-id");
    expect(f.loadDirect).toHaveBeenCalledWith(BUILTIN_BACKUPS[0].endpoint);
    expect(f.load).toHaveBeenCalledTimes(1);
    for (const method of [
      "getAddressBalance",
      "getAddressHistory",
      "getAddressUtxos",
      "getFeeEstimate",
      "getRawTransaction",
    ] as const)
      expect(f.backup.actor[method]).toHaveBeenCalledTimes(1);
    expect(f.router.current()).toMatchObject({
      name: "mempool.guide · backup",
      backup: true,
      endpoint: BUILTIN_BACKUPS[0].endpoint,
    });
  });
  it("runtime outage invalidates the old actor and never replays the failed read or a payment", async () => {
    const f = websocketBackupFixture();
    const old = await f.router.resolve();
    const generation = providerGeneration();
    vi.mocked(f.primary.actor.getAddressBalance).mockRejectedValue(
      Error("offline"),
    );
    await expect(old.getAddressBalance("public")).rejects.toThrow();
    expect(providerGeneration()).toBeGreaterThan(generation);
    expect(f.backup.actor.getAddressBalance).not.toHaveBeenCalled();
    await expect(old.getFeeEstimate()).rejects.toThrow(/Provider changed/);
    await (await f.router.resolve()).getAddressBalance("public");
    expect(f.backup.actor.getAddressBalance).toHaveBeenCalledTimes(1);
    expect(f.backup.actor.broadcastSignedTransaction).not.toHaveBeenCalled();
  });
  it("reuses a healthy backup worker and restores Umbrel priority after a later check", async () => {
    const f = websocketBackupFixture();
    vi.mocked(f.primary.info).mockRejectedValue(Error("offline"));
    await f.router.resolve();
    f.advance(60001);
    await f.router.resolve();
    expect(f.loadDirect).toHaveBeenCalledTimes(1);
    vi.mocked(f.primary.info).mockResolvedValue(
      await connection("primary").info(),
    );
    f.advance(60001);
    await expect(f.router.resolve()).rejects.toThrow(/Provider changed/);
    expect(f.backup.close).toHaveBeenCalledTimes(1);
    expect(await f.router.resolve()).toBeTruthy();
    expect(f.router.current()?.backup).toBe(false);
  });
  it("retires failed WSS workers and recreates them after the cooldown", async () => {
    const f = websocketBackupFixture();
    vi.mocked(f.primary.info).mockRejectedValue(Error("offline"));
    const actor = await f.router.resolve();
    vi.mocked(f.backup.actor.getAddressHistory).mockRejectedValue(
      Error("closed"),
    );
    await expect(actor.getAddressHistory("public")).rejects.toThrow();
    expect(f.backup.close).toHaveBeenCalled();
    const replacement = { ...f.backup, close: vi.fn() };
    f.loadDirect.mockResolvedValue(replacement);
    f.advance(60001);
    await f.router.resolve();
    expect(f.loadDirect).toHaveBeenCalledTimes(2);
  });
  it("rejects stale, wrong-chain, wrong-endpoint and wrong-identity backups before wallet reads", async () => {
    for (const patch of [
      { checkpointHash: "wrong" },
      { height: 1n },
      { tipTimestamp: 1n },
      { endpoint: "wss://other.example/" },
    ]) {
      const f = websocketBackupFixture();
      vi.mocked(f.primary.info).mockRejectedValue(Error("offline"));
      vi.mocked(f.backup.info).mockResolvedValue({
        ...(await f.backup.info()),
        ...patch,
      });
      await expect(f.router.resolve()).rejects.toThrow();
      expect(f.backup.close).toHaveBeenCalled();
      expect(f.backup.actor.getAddressBalance).not.toHaveBeenCalled();
    }
    const f = websocketBackupFixture();
    vi.mocked(f.primary.info).mockRejectedValue(Error("offline"));
    f.loadDirect.mockResolvedValue({ ...f.backup, id: "unregistered" });
    await expect(f.router.resolve()).rejects.toThrow(/identity/);
  });
  it("a failed explicit broadcast is not retried or switched to another service", async () => {
    const f = websocketBackupFixture();
    vi.mocked(f.primary.info).mockRejectedValue(Error("offline"));
    const actor = await f.router.resolve();
    const calls = f.load.mock.calls.length;
    vi.mocked(f.backup.actor.broadcastSignedTransaction).mockRejectedValue(
      Error("unknown outcome"),
    );
    await expect(
      actor.broadcastSignedTransaction("signed", "id"),
    ).rejects.toThrow(/unknown/);
    expect(f.backup.actor.broadcastSignedTransaction).toHaveBeenCalledTimes(1);
    expect(f.primary.actor.broadcastSignedTransaction).not.toHaveBeenCalled();
    expect(f.load).toHaveBeenCalledTimes(calls);
  });
  it("user-owned WSS and custom HTTPS without opt-in never use the registered backup", async () => {
    for (const selection of [
      { mode: "websocket", config: { endpoint: BUILTIN_BACKUPS[0].endpoint } },
      { mode: "custom", config: custom },
    ] as ProviderSelection[]) {
      const f = websocketBackupFixture();
      f.select(selection);
      vi.mocked(f.primary.info).mockRejectedValue(Error("offline"));
      vi.mocked(f.backup.info).mockRejectedValue(Error("offline"));
      await expect(f.router.resolve()).rejects.toThrow();
      expect(f.loadDirect.mock.calls.length).toBe(
        selection.mode === "websocket" ? 1 : 0,
      );
      expect(f.load.mock.calls.length).toBe(
        selection.mode === "custom" ? 1 : 0,
      );
    }
  });
});
describe("actual provider routes", () => {
  it("a late connection check cannot clear a successfully reconnected WSS session", async () => {
    const f = fixture();
    f.select({
      mode: "websocket",
      config: { endpoint: "wss://home.example:50004/" },
    });
    let finish: (value: ProviderInfo) => void = () => {};
    const info = await f.direct.info();
    const stale = {
      ...f.direct,
      close: vi.fn(),
      info: vi.fn(
        () =>
          new Promise<ProviderInfo>((resolve) => {
            finish = resolve;
          }),
      ),
    };
    f.loadDirect.mockResolvedValueOnce(stale);
    const pending = f.router.resolve();
    await vi.waitFor(() => expect(stale.info).toHaveBeenCalled());
    f.router.reconnect();
    const actor = await f.router.resolve();
    finish(info);
    await expect(pending).rejects.toThrow(/Provider changed/);
    expect(f.router.current()?.name).toBe("My home Fulcrum · direct WSS");
    await actor.getAddressBalance("address");
    expect(f.direct.actor.getAddressBalance).toHaveBeenCalledOnce();
  });
  it("explicit reconnect replaces the connection and rejects old reads without retrying submissions", async () => {
    const f = fixture();
    f.direct.close = vi.fn();
    f.select({
      mode: "websocket",
      config: { endpoint: "wss://home.example:50004/" },
    });
    const oldActor = await f.router.resolve();
    let finish: (value: any) => void = () => {};
    vi.mocked(f.direct.actor.getAddressHistory).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = oldActor.getAddressHistory("address");
    await Promise.resolve();
    const generation = providerGeneration();
    f.router.reconnect();
    expect(providerGeneration()).toBe(generation + 1);
    expect(f.direct.close).toHaveBeenCalledOnce();
    expect(f.loadDirect).toHaveBeenCalledTimes(1);
    const newActor = await f.router.resolve();
    finish({ __kind__: "ok", ok: {} });
    await expect(pending).rejects.toThrow(/Provider changed/);
    await expect(oldActor.getAddressBalance("address")).rejects.toThrow(
      /Provider changed/,
    );
    await newActor.getAddressBalance("address");
    expect(f.loadDirect).toHaveBeenCalledTimes(2);
    expect(f.direct.actor.broadcastSignedTransaction).not.toHaveBeenCalled();
    expect(f.load).not.toHaveBeenCalled();
  });
  it("direct WSS routes all wallet operations without loading any canister and never falls back", async () => {
    const f = fixture();
    f.select({
      mode: "websocket",
      config: { endpoint: "wss://home.example:50004/" },
    });
    const actor = await f.router.resolve();
    await actor.getAddressBalance("address");
    await actor.getAddressHistory("address");
    await actor.getAddressUtxos("address");
    await actor.getFeeEstimate();
    await actor.getRawTransaction("a".repeat(64));
    await actor.broadcastSignedTransaction("00", "a".repeat(64));
    expect(f.load).not.toHaveBeenCalled();
    expect(f.router.current()?.name).toBe("My home Fulcrum · direct WSS");
    vi.mocked(f.direct.actor.getAddressHistory).mockRejectedValue(
      Error("disconnected"),
    );
    await expect(actor.getAddressHistory("address")).rejects.toThrow();
    expect(f.primary.info).not.toHaveBeenCalled();
    expect(f.backup.info).not.toHaveBeenCalled();
  });
  it("persists direct selection without canister IDs or fallback and keeps unrelated settings", () => {
    localStorage.setItem("redwallet.settings.v1", "price fixture");
    saveProviderSelection({
      mode: "websocket",
      config: { endpoint: "wss://home.example:50004" },
    });
    expect(readProviderSelection()).toEqual({
      mode: "websocket",
      config: { endpoint: "wss://home.example:50004/" },
    });
    expect(localStorage.getItem("redwallet.settings.v1")).toBe("price fixture");
    expect(localStorage.getItem(PROVIDER_STORAGE_KEY)).not.toContain(
      "canisterId",
    );
  });
  it("closes a direct connection on provider change and discards late responses", async () => {
    const f = fixture();
    f.direct.close = vi.fn();
    f.select({
      mode: "websocket",
      config: { endpoint: "wss://home.example:50004/" },
    });
    const actor = await f.router.resolve();
    let finish: (value: any) => void = () => {};
    vi.mocked(f.direct.actor.getAddressBalance).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = actor.getAddressBalance("address");
    await Promise.resolve();
    f.select({ mode: "builtin" });
    finish({ __kind__: "ok", ok: {} });
    await expect(pending).rejects.toThrow(/Provider changed/);
    expect(f.direct.close).toHaveBeenCalled();
  });
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
    expect(BUILTIN_BACKUPS[0]).toMatchObject({
      endpoint: "wss://mempool.guide/electrum-websocket/",
      transport: "websocket",
    });
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

it("retains actor identity across route resolutions, replacing it after reconnect", async () => {
  const f = fixture();
  const first = await f.router.resolve();
  expect(await f.router.resolve()).toBe(first);
  await first.getAddressBalance("public");
  expect(await f.router.resolve()).toBe(first);
  f.router.reconnect();
  const next = await f.router.resolve();
  expect(next).not.toBe(first);
  await expect(first.getAddressBalance("public")).rejects.toThrow(
    /Provider changed/,
  );
  expect(await f.router.resolve()).toBe(next);
});
