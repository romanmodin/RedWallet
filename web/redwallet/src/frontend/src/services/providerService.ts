/** Separate HTTPS-to-Fulcrum canister adapters. No arbitrary outcall proxy or shared reconfiguration. */
import { createActor } from "@/backend";
import type { backendInterface } from "@/backend";
import {
  type createActorFunction,
  createActorWithConfig,
} from "@caffeineai/core-infrastructure";
import { Actor, HttpAgent } from "@icp-sdk/core/agent";
import { IDL } from "@icp-sdk/core/candid";
import { Principal } from "@icp-sdk/core/principal";
import { providerChanged, providerGeneration } from "./networkGeneration";
import {
  type WebsocketProvider,
  validateWebsocketProvider,
} from "./websocketConfig";
import { loadWebsocketConnection } from "./websocketService";

export const PROVIDER_STORAGE_KEY = "redwallet.provider.v1";
export const CHECKPOINT_HASH =
  "0000000000000050c1e5f69672f459293be14f46e5a494e7a8c8541396f18eeb";
/** Fixed, live-tested public backups. User-owned WSS never uses this registry. */
export const BUILTIN_BACKUPS: readonly {
  id: string;
  name: string;
  endpoint: string;
  transport?: "websocket";
}[] = [
  {
    id: "wss:wss://mempool.guide/electrum-websocket/",
    name: "mempool.guide · backup",
    endpoint: "wss://mempool.guide/electrum-websocket/",
    transport: "websocket",
  },
];
export const HOME_ADAPTER = {
  id: "7gylz-gyaaa-aaaab-qhjrq-cai",
  endpoint: "https://umbrel-3.tailaa2bb4.ts.net:10000",
};
export interface CustomProvider {
  host: string;
  port: number;
  tls: boolean;
  endpoint: string;
  canisterId: string;
  allowBuiltinFallback?: boolean;
}
export type ProviderSelection =
  | { mode: "builtin" }
  | { mode: "custom"; config: CustomProvider }
  | { mode: "websocket"; config: WebsocketProvider };
export interface ProviderInfo {
  host: string;
  port: bigint;
  tls: boolean;
  endpoint: string;
  tipTimestamp: bigint;
  height: bigint;
  checkpointHeight: bigint;
  checkpointHash: string;
}
export type ProviderActor = Pick<
  backendInterface,
  | "getBridgeStatus"
  | "getServerStatus"
  | "getAddressBalance"
  | "getAddressHistory"
  | "getAddressUtxos"
  | "getFeeEstimate"
  | "getRawTransaction"
  | "broadcastSignedTransaction"
>;
export interface ProviderConnection {
  id: string;
  actor: ProviderActor;
  info(): Promise<ProviderInfo>;
  close?(): void;
}
export interface ActiveProvider {
  name: string;
  id: string;
  endpoint: string;
  host: string;
  port: number;
  tls: boolean;
  backup: boolean;
}
function invalidCustom(): ProviderSelection {
  return {
    mode: "custom",
    config: { host: "", port: 0, tls: true, endpoint: "", canisterId: "" },
  };
}
export function readProviderSelection(
  storage: Storage = window.localStorage,
): ProviderSelection {
  let parsed: any;
  try {
    const raw = storage.getItem(PROVIDER_STORAGE_KEY);
    if (!raw) return { mode: "builtin" };
    parsed = JSON.parse(raw);
    if (parsed?.mode === "builtin") return { mode: "builtin" };
    if (parsed?.mode === "websocket")
      return {
        mode: "websocket",
        config: validateWebsocketProvider(parsed.config),
      };
    if (parsed?.mode === "custom")
      return { mode: "custom", config: validateCustomProvider(parsed.config) };
    return invalidCustom();
  } catch {
    if (parsed?.mode === "websocket")
      return { mode: "websocket", config: { endpoint: "" } };
    return invalidCustom();
  }
}
export function validateCustomProvider(raw: CustomProvider): CustomProvider {
  if (
    !raw ||
    typeof raw.host !== "string" ||
    !/^[a-zA-Z0-9.:[\]-]{1,253}$/.test(raw.host) ||
    !Number.isInteger(raw.port) ||
    raw.port < 1 ||
    raw.port > 65535 ||
    typeof raw.tls !== "boolean"
  )
    throw Error(
      "Enter the Fulcrum host, a port from 1 to 65535, and TLS setting.",
    );
  if (typeof raw.endpoint !== "string" || !raw.endpoint.trim())
    throw Error(
      "Enter the HTTPS bridge URL. Gray example text is not a saved address.",
    );
  let url: URL;
  try {
    url = new URL(raw.endpoint.trim());
  } catch {
    throw Error(
      "Enter a complete HTTPS bridge URL, including the HTTPS prefix.",
    );
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    raw.endpoint.length > 2000
  )
    throw Error(
      "Use an HTTPS bridge endpoint without credentials, query or fragment.",
    );
  const endpoint = url.href.replace(/\/$/, "");
  const canisterId =
    raw.canisterId?.trim() ||
    (endpoint === HOME_ADAPTER.endpoint ? HOME_ADAPTER.id : "");
  if (
    !canisterId ||
    ["aaaaa-aa", "2vxsx-fae"].includes(canisterId) ||
    Principal.fromText(canisterId).toText() !== canisterId
  )
    throw Error(
      "Enter this bridge’s ICP adapter canister ID. A raw Fulcrum hostname cannot connect from a web browser.",
    );
  return {
    host: raw.host.toLowerCase(),
    port: raw.port,
    tls: raw.tls,
    endpoint,
    canisterId,
    allowBuiltinFallback: raw.allowBuiltinFallback === true,
  };
}
export function validateProviderInfo(
  info: ProviderInfo,
  custom?: CustomProvider,
  now = Date.now(),
): ProviderInfo {
  if (
    !info ||
    info.checkpointHeight !== 961640n ||
    info.checkpointHash !== CHECKPOINT_HASH ||
    typeof info.height !== "bigint" ||
    info.height < 961640n ||
    info.height > 100000000n
  )
    throw Error(
      "XBT checkpoint verification failed; this provider was rejected.",
    );
  const time = Number(info.tipTimestamp) * 1000;
  if (
    !Number.isSafeInteger(time) ||
    time <= 0 ||
    time > now + 2 * 60 * 60 * 1000 ||
    now - time > 2 * 60 * 60 * 1000
  )
    throw Error(
      "Provider chain tip is stale or has an invalid time; refresh or choose another provider.",
    );
  if (
    typeof info.host !== "string" ||
    !info.host ||
    info.host.length > 253 ||
    typeof info.port !== "bigint" ||
    info.port < 1n ||
    info.port > 65535n ||
    typeof info.tls !== "boolean" ||
    typeof info.endpoint !== "string"
  )
    throw Error("Provider metadata is invalid.");
  if (
    custom &&
    (info.host.toLowerCase() !== custom.host ||
      Number(info.port) !== custom.port ||
      info.tls !== custom.tls ||
      info.endpoint !== custom.endpoint)
  )
    throw Error(
      "This adapter does not reach the entered Fulcrum host, port, TLS and HTTPS endpoint. Configure your own adapter; no shared server was changed.",
    );
  return info;
}
function infoFactory(
  idOverride?: string,
): createActorFunction<ProviderConnection> {
  return (configuredId, upload, download, options) => {
    const id = idOverride || configuredId;
    const agent = options.agent ?? HttpAgent.createSync(options.agentOptions);
    const error = IDL.Variant({
      not_configured: IDL.Null,
      backend_unavailable: IDL.Text,
      invalid_input: IDL.Text,
      malformed_response: IDL.Text,
    });
    const infoActor = Actor.createActor<{
      getProviderInfo(): Promise<{ ok: ProviderInfo } | { err: unknown }>;
    }>(
      () =>
        IDL.Service({
          getProviderInfo: IDL.Func(
            [],
            [
              IDL.Variant({
                ok: IDL.Record({
                  host: IDL.Text,
                  port: IDL.Nat,
                  tls: IDL.Bool,
                  endpoint: IDL.Text,
                  tipTimestamp: IDL.Nat,
                  height: IDL.Int,
                  checkpointHeight: IDL.Nat,
                  checkpointHash: IDL.Text,
                }),
                err: error,
              }),
            ],
            [],
          ),
        }),
      { agent, canisterId: id },
    );
    return {
      id,
      actor: createActor(id, upload, download, { agent }),
      info: async () => {
        const result = await infoActor.getProviderInfo();
        if (!("ok" in result))
          throw Error(
            "Adapter unavailable or not configured. Custom connections never fall back to the built-in service.",
          );
        return result.ok;
      },
    };
  };
}
const connections = new Map<string, Promise<ProviderConnection>>();
export function loadProviderConnection(id?: string) {
  const key = id || "builtin";
  let pending = connections.get(key);
  if (!pending) {
    pending = createActorWithConfig(infoFactory(id)).catch((error) => {
      connections.delete(key);
      throw error;
    });
    connections.set(key, pending);
  }
  return pending;
}
function timeout<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(
            Error(
              "Provider request timed out. Any broadcast outcome remains unknown.",
            ),
          ),
        35000,
      );
    }),
  ]).finally(() => clearTimeout(timer));
}
/** Injectable router tests real dispatch identities, failure isolation, and provider generation barriers. */
export class ProviderRouter {
  private active: ProviderConnection | null = null;
  private boundActor: {
    connection: ProviderConnection;
    generation: number;
    actor: ProviderActor;
  } | null = null;
  private metadata: ProviderInfo | null = null;
  private checkedAt = 0;
  private fingerprint = "";
  private backup = false;
  private pending: Promise<ProviderActor> | null = null;
  private selection: ProviderSelection = { mode: "builtin" };
  private healthyHeight = 0n;
  private unavailable = new Map<string, number>();
  constructor(
    private read = readProviderSelection,
    private load = loadProviderConnection,
    private backups = BUILTIN_BACKUPS,
    private clock = () => Date.now(),
    private loadDirect = loadWebsocketConnection,
  ) {}
  sync() {
    const selected = this.read();
    const key = JSON.stringify(selected);
    if (key !== this.fingerprint) {
      const changed = !!this.fingerprint;
      this.fingerprint = key;
      this.selection = selected;
      this.active?.close?.();
      this.active = null;
      this.metadata = null;
      this.pending = null;
      this.checkedAt = 0;
      this.backup = false;
      if (changed) providerChanged();
    }
  }
  current(): ActiveProvider | null {
    if (!this.active || !this.metadata) return null;
    const registered = this.backups.find((b) => b.id === this.active?.id);
    return {
      name:
        this.selection.mode === "websocket"
          ? "My home Fulcrum · direct WSS"
          : this.selection.mode === "custom"
            ? this.backup
              ? registered
                ? `${registered.name} · custom fallback`
                : "Built-in RedWallet service · custom fallback"
              : "My own Fulcrum"
            : this.backup
              ? (registered?.name ?? "RedWallet backup service")
              : "Built-in RedWallet service",
      id: this.active.id,
      endpoint: this.metadata.endpoint,
      host: this.metadata.host,
      port: Number(this.metadata.port),
      tls: this.metadata.tls,
      backup: this.backup,
    };
  }
  /** Explicit user reconnect; invalidate old reads/reviews without rediscovering addresses. */
  reconnect() {
    this.active?.close?.();
    this.active = null;
    this.metadata = null;
    this.checkedAt = 0;
    this.pending = null;
    this.unavailable.clear();
    providerChanged();
  }
  private async check(connection: ProviderConnection, custom?: CustomProvider) {
    const info = validateProviderInfo(
      await timeout(connection.info()),
      custom,
      this.clock(),
    );
    if (this.healthyHeight && info.height + 6n < this.healthyHeight)
      throw Error("Provider is behind the last verified chain tip; rejected.");
    return info;
  }
  async test(config: CustomProvider) {
    const valid = validateCustomProvider(config);
    const connection = await timeout(this.load(valid.canisterId));
    return this.check(connection, valid);
  }
  async testWebsocket(config: WebsocketProvider) {
    const valid = validateWebsocketProvider(config);
    const connection = await this.loadDirect(valid.endpoint);
    try {
      const info = await this.check(connection);
      if (info.endpoint !== valid.endpoint)
        throw Error("Direct WebSocket identity mismatch.");
      return info;
    } finally {
      connection.close?.();
    }
  }
  private async choose() {
    const generation = providerGeneration();
    const fingerprint = this.fingerprint;
    const selected = this.selection;
    if (selected.mode === "websocket") {
      const valid = validateWebsocketProvider(selected.config);
      const connection = this.active ?? (await this.loadDirect(valid.endpoint));
      try {
        const info = await this.check(connection);
        if (info.endpoint !== valid.endpoint)
          throw Error("Direct WebSocket identity mismatch.");
        this.sync();
        if (
          generation !== providerGeneration() ||
          fingerprint !== this.fingerprint
        )
          throw Error("Provider changed; request fresh network data.");
        this.active = connection;
        this.metadata = info;
        this.checkedAt = this.clock();
        this.healthyHeight =
          info.height > this.healthyHeight ? info.height : this.healthyHeight;
        this.backup = false;
        return;
      } catch (error) {
        connection.close?.();
        if (
          generation === providerGeneration() &&
          fingerprint === this.fingerprint
        ) {
          this.active = null;
          this.metadata = null;
        }
        throw error;
      }
    }
    const ids =
      selected.mode === "custom"
        ? [
            selected.config.canisterId,
            ...(selected.config.allowBuiltinFallback
              ? [undefined, ...this.backups.map((b) => b.id)]
              : []),
          ]
        : [undefined, ...this.backups.map((b) => b.id)];
    let last: unknown;
    for (const id of ids) {
      const registered = this.backups.find((backup) => backup.id === id);
      let connection: ProviderConnection | undefined;
      try {
        const custom =
          selected.mode === "custom" && id === selected.config.canisterId
            ? validateCustomProvider(selected.config)
            : undefined;
        if (id && (this.unavailable.get(id) ?? 0) > this.clock())
          throw Error("Provider is temporarily unavailable.");
        connection =
          registered?.transport === "websocket"
            ? this.active && this.active.id === id && this.metadata
              ? this.active
              : await this.loadDirect(registered.endpoint)
            : await timeout(this.load(id));
        if ((this.unavailable.get(connection.id) ?? 0) > this.clock())
          throw Error("Provider is temporarily unavailable.");
        const info = await this.check(connection, custom);
        if (registered && info.endpoint !== registered.endpoint)
          throw Error(
            "Backup identity does not match the registered endpoint.",
          );
        if (registered && connection.id !== registered.id)
          throw Error("Backup connection identity mismatch.");
        this.sync();
        if (
          fingerprint !== this.fingerprint ||
          generation !== providerGeneration()
        )
          throw Error("Provider changed; request fresh network data.");
        const switched = this.active && this.active.id !== connection.id;
        if (this.active !== connection) this.active?.close?.();
        this.active = connection;
        this.metadata = info;
        this.checkedAt = this.clock();
        this.healthyHeight =
          info.height > this.healthyHeight ? info.height : this.healthyHeight;
        this.backup =
          selected.mode === "builtin"
            ? id !== undefined
            : id !== selected.config.canisterId;
        if (switched) {
          providerChanged();
          throw Error(
            "Provider changed; prepare a new review with fresh reads.",
          );
        }
        return;
      } catch (error) {
        if (
          connection &&
          (this.active !== connection ||
            (generation === providerGeneration() &&
              fingerprint === this.fingerprint))
        )
          connection.close?.();
        last = error;
        if (
          generation !== providerGeneration() ||
          fingerprint !== this.fingerprint
        )
          throw error;
      }
    }
    this.metadata = null;
    throw last || Error("No verified provider is available.");
  }
  resolve(): Promise<ProviderActor> {
    this.sync();
    if (!this.pending) {
      const gen = providerGeneration();
      const pending = (async () => {
        if (
          !this.active ||
          !this.metadata ||
          this.clock() < this.checkedAt ||
          this.clock() - this.checkedAt >= 60000
        )
          await this.choose();
        if (gen !== providerGeneration())
          throw Error("Provider changed; refresh.");
        const connection = this.active!;
        // Stable identity lets public account jobs survive route remounts.
        // Reuse only after normal resolution/checks, for the same connection
        // and generation; every call retains its existing freshness barriers.
        if (
          this.boundActor?.connection === connection &&
          this.boundActor.generation === gen
        )
          return this.boundActor.actor;
        const router = this;
        const actor = new Proxy(connection.actor, {
          get(target, method) {
            const value = Reflect.get(target, method);
            if (typeof value !== "function") return value;
            return async (...args: unknown[]) => {
              router.sync();
              if (gen !== providerGeneration() || router.active !== connection)
                throw Error("Provider changed; fresh network reads required.");
              try {
                if (
                  method === "getServerStatus" ||
                  router.clock() < router.checkedAt ||
                  router.clock() - router.checkedAt >= 60000
                ) {
                  router.metadata = await router.check(
                    connection,
                    router.selection.mode === "custom" && !router.backup
                      ? router.selection.config
                      : undefined,
                  );
                  router.checkedAt = router.clock();
                }
                router.sync();
                if (
                  gen !== providerGeneration() ||
                  router.active !== connection
                )
                  throw Error(
                    "Provider changed; fresh network reads required.",
                  );
                const result = await timeout(value.apply(target, args));
                router.sync();
                if (
                  gen !== providerGeneration() ||
                  router.active !== connection
                )
                  throw Error(
                    "Provider changed during request; discard this result.",
                  );
                // Never automatically retry broadcasts, including on another built-in provider.
                if (
                  result &&
                  (result as { __kind__?: string }).__kind__ === "err" &&
                  method !== "broadcastSignedTransaction" &&
                  (result as { err?: { __kind__?: string } }).err?.__kind__ ===
                    "backend_unavailable"
                )
                  throw Error("Selected provider is unavailable.");
                return result;
              } catch (error) {
                if (
                  connection.close &&
                  gen === providerGeneration() &&
                  router.active === connection
                ) {
                  connection.close?.();
                  // Keep identity until choose() so a fallback invalidates old reads/reviews.
                  if (router.selection.mode === "websocket")
                    router.active = null;
                  router.metadata = null;
                  router.checkedAt = 0;
                }
                if (
                  method !== "broadcastSignedTransaction" &&
                  gen === providerGeneration() &&
                  ((router.selection.mode === "builtin" &&
                    router.backups.length) ||
                    (router.selection.mode === "custom" &&
                      router.selection.config.allowBuiltinFallback))
                ) {
                  router.checkedAt = 0;
                  router.unavailable.set(connection.id, router.clock() + 60000);
                  try {
                    await router.choose();
                  } catch {
                    /* original operation stays failed; fresh reads use new provider */
                  }
                }
                throw error;
              }
            };
          },
        });
        this.boundActor = { connection, generation: gen, actor };
        return actor;
      })();
      this.pending = pending;
      void pending
        .finally(() => {
          if (this.pending === pending) this.pending = null;
        })
        .catch(() => {});
    }
    return this.pending;
  }
}
export const providerRouter = new ProviderRouter();
export function saveProviderSelection(
  selection: ProviderSelection,
  storage: Storage = window.localStorage,
) {
  const value =
    selection.mode === "websocket"
      ? {
          mode: "websocket",
          config: validateWebsocketProvider(selection.config),
        }
      : selection.mode === "custom"
        ? { mode: "custom", config: validateCustomProvider(selection.config) }
        : { mode: "builtin" };
  storage.setItem(PROVIDER_STORAGE_KEY, JSON.stringify(value));
  providerRouter.sync();
}
if (typeof window !== "undefined")
  window.addEventListener("storage", (event) => {
    if (event.key === PROVIDER_STORAGE_KEY || event.key === null)
      providerRouter.sync();
  });
