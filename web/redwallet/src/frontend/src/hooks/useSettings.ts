/**
 * Thin typed hook over the settings service and theme context.
 *
 * Exposes the persisted settings plus a patch helper so screens can update
 * display unit, network, and server configuration without touching the
 * service module directly.
 */

import { useThemeContext } from "@/context/ThemeContext";
import { DEFAULT_SETTINGS, settingsService } from "@/services/settingsService";
import type { ServiceError, UserSettings } from "@/services/types";
import { useCallback, useState } from "react";

export interface UseSettingsResult {
  settings: UserSettings;
  error: ServiceError | null;
  updateSettings: (patch: Partial<UserSettings>) => void;
  resetSettings: () => void;
}

export function useSettings(): UseSettingsResult {
  const { setTheme } = useThemeContext();
  const [settings, setSettings] = useState<UserSettings>(() => {
    const result = settingsService.getSettings();
    return result.ok ? result.value : { ...DEFAULT_SETTINGS };
  });
  const [error, setError] = useState<ServiceError | null>(null);

  const updateSettings = useCallback(
    (patch: Partial<UserSettings>) => {
      const result = settingsService.updateSettings(patch);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSettings(result.value);
      setError(null);
      if (patch.theme) setTheme(patch.theme);
    },
    [setTheme],
  );

  const resetSettings = useCallback(() => {
    const result = settingsService.resetSettings();
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSettings(result.value);
    setError(null);
    setTheme(result.value.theme);
  }, [setTheme]);

  return { settings, error, updateSettings, resetSettings };
}
