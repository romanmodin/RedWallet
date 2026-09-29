/**
 * Settings service.
 *
 * Typed read/write of user preferences persisted to `localStorage`. This is
 * the one place where browser storage is the correct primary persistence:
 * settings are device-local UI preferences, not backend-owned data.
 *
 * The default network is explicitly unconfigured. There is NO silent
 * public-server default and no Mainnet/Testnet claim — the shipped host is an
 * empty placeholder the user must fill in themselves.
 */

import {
  type DisplayUnit,
  type NetworkName,
  type ServiceResult,
  type ThemePreference,
  type UserSettings,
  err,
  ok,
} from "./types";

const STORAGE_KEY = "redwallet.settings.v1";

/** Safe defaults. `serverHost` is intentionally empty — no silent default. */
export const DEFAULT_SETTINGS: UserSettings = {
  displayUnit: "XBT",
  theme: "system",
  network: "unconfigured",
  serverHost: "",
  serverPort: 50002,
  serverTls: true,
};

const DISPLAY_UNITS: DisplayUnit[] = ["XBT", "BTC"];
const THEMES: ThemePreference[] = ["light", "dark", "system"];
const NETWORKS: NetworkName[] = ["unconfigured"];

function isDisplayUnit(value: unknown): value is DisplayUnit {
  return (
    typeof value === "string" && DISPLAY_UNITS.includes(value as DisplayUnit)
  );
}

function isTheme(value: unknown): value is ThemePreference {
  return typeof value === "string" && THEMES.includes(value as ThemePreference);
}

function isNetwork(value: unknown): value is NetworkName {
  return typeof value === "string" && NETWORKS.includes(value as NetworkName);
}

function hasStorage(): boolean {
  return typeof window !== "undefined" && !!window.localStorage;
}

/** Coerce an unknown parsed object into a valid `UserSettings`. */
function normalize(raw: unknown): UserSettings {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_SETTINGS };
  const record = raw as Record<string, unknown>;
  const port =
    typeof record.serverPort === "number" &&
    Number.isInteger(record.serverPort) &&
    record.serverPort > 0 &&
    record.serverPort <= 65535
      ? record.serverPort
      : DEFAULT_SETTINGS.serverPort;

  return {
    displayUnit: isDisplayUnit(record.displayUnit)
      ? record.displayUnit
      : DEFAULT_SETTINGS.displayUnit,
    theme: isTheme(record.theme) ? record.theme : DEFAULT_SETTINGS.theme,
    network: isNetwork(record.network)
      ? record.network
      : DEFAULT_SETTINGS.network,
    serverHost:
      typeof record.serverHost === "string"
        ? record.serverHost
        : DEFAULT_SETTINGS.serverHost,
    serverPort: port,
    manualUsdPerXbt:
      typeof record.manualUsdPerXbt === "number" &&
      Number.isFinite(record.manualUsdPerXbt) &&
      record.manualUsdPerXbt > 0
        ? record.manualUsdPerXbt
        : undefined,
    serverTls:
      typeof record.serverTls === "boolean"
        ? record.serverTls
        : DEFAULT_SETTINGS.serverTls,
  };
}

/** The typed contract for settings persistence. */
export interface SettingsService {
  getSettings(): ServiceResult<UserSettings>;
  saveSettings(settings: UserSettings): ServiceResult<UserSettings>;
  updateSettings(patch: Partial<UserSettings>): ServiceResult<UserSettings>;
  resetSettings(): ServiceResult<UserSettings>;
}

/** localStorage-backed implementation of `SettingsService`. */
export class LocalSettingsService implements SettingsService {
  getSettings(): ServiceResult<UserSettings> {
    if (!hasStorage()) return ok({ ...DEFAULT_SETTINGS });
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return ok({ ...DEFAULT_SETTINGS });
      return ok(normalize(JSON.parse(raw)));
    } catch {
      return ok({ ...DEFAULT_SETTINGS });
    }
  }

  saveSettings(settings: UserSettings): ServiceResult<UserSettings> {
    const normalized = normalize(settings);
    if (!hasStorage()) {
      return err("unknown", "Settings storage is unavailable in this browser.");
    }
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
      return ok(normalized);
    } catch {
      return err("unknown", "Could not save settings to this browser.");
    }
  }

  updateSettings(patch: Partial<UserSettings>): ServiceResult<UserSettings> {
    const current = this.getSettings();
    const base = current.ok ? current.value : { ...DEFAULT_SETTINGS };
    return this.saveSettings({ ...base, ...patch });
  }

  resetSettings(): ServiceResult<UserSettings> {
    if (hasStorage()) {
      try {
        window.localStorage.removeItem(STORAGE_KEY);
      } catch {
        // Ignore removal failures and fall through to defaults.
      }
    }
    return ok({ ...DEFAULT_SETTINGS });
  }
}

/** Shared singleton used by the app. */
export const settingsService: SettingsService = new LocalSettingsService();
