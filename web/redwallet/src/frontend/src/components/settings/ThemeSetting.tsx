/**
 * ThemeSetting — light / dark / system theme selection.
 *
 * Applies immediately through the theme context (via the settings hook), so
 * the document root updates the moment a preference is chosen. `system`
 * follows the operating-system preference.
 */

import { cn } from "@/lib/utils";
import type { ThemePreference } from "@/services/types";
import { Monitor, Moon, Sun } from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface ThemeSettingProps {
  value: ThemePreference;
  onChange: (theme: ThemePreference) => void;
}

const THEMES: {
  value: ThemePreference;
  label: string;
  icon: LucideIcon;
}[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

export function ThemeSetting({ value, onChange }: ThemeSettingProps) {
  return (
    <fieldset data-ocid="settings.theme" className="flex flex-col gap-3">
      <legend className="sr-only">Theme</legend>
      <div className="grid grid-cols-3 gap-2">
        {THEMES.map((theme) => {
          const active = value === theme.value;
          const Icon = theme.icon;
          return (
            <label
              key={theme.value}
              className={cn(
                "flex min-h-[72px] cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border px-2 py-3 transition-smooth has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
                active
                  ? "border-primary/60 bg-primary/10 text-primary"
                  : "border-border bg-secondary/40 text-muted-foreground hover:bg-secondary/70",
              )}
            >
              <input
                type="radio"
                name="settings-theme"
                value={theme.value}
                checked={active}
                onChange={() => onChange(theme.value)}
                data-ocid={`settings.theme.${theme.value}`}
                className="sr-only"
              />
              <Icon className="size-5" aria-hidden="true" />
              <span className="text-xs font-medium">{theme.label}</span>
            </label>
          );
        })}
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        System follows your device appearance setting and updates automatically.
      </p>
    </fieldset>
  );
}
