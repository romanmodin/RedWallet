/**
 * DisplayUnitSetting — XBT / BTC display unit toggle.
 *
 * The choice is applied immediately through the settings service, so every
 * amount rendered elsewhere in the app switches unit as soon as the user
 * picks one. XBT is the ISO-style code for the unit; both labels show the
 * same underlying value.
 */

import { cn } from "@/lib/utils";
import type { DisplayUnit } from "@/services/types";

interface DisplayUnitSettingProps {
  value: DisplayUnit;
  onChange: (unit: DisplayUnit) => void;
}

const UNITS: { value: DisplayUnit; label: string; hint: string }[] = [
  { value: "XBT", label: "XBT", hint: "ISO-style code" },
  { value: "BTC", label: "BTC", hint: "Common ticker" },
];

export function DisplayUnitSetting({
  value,
  onChange,
}: DisplayUnitSettingProps) {
  return (
    <fieldset data-ocid="settings.display_unit" className="flex flex-col gap-3">
      <legend className="sr-only">Display unit</legend>
      <div className="grid grid-cols-2 gap-2">
        {UNITS.map((unit) => {
          const active = value === unit.value;
          return (
            <label
              key={unit.value}
              className={cn(
                "flex min-h-[64px] cursor-pointer flex-col items-start justify-center gap-0.5 rounded-xl border px-4 py-3 text-left transition-smooth has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
                active
                  ? "border-primary/60 bg-primary/10"
                  : "border-border bg-secondary/40 hover:bg-secondary/70",
              )}
            >
              <input
                type="radio"
                name="settings-display-unit"
                value={unit.value}
                checked={active}
                onChange={() => onChange(unit.value)}
                data-ocid={`settings.display_unit.${unit.value.toLowerCase()}`}
                className="sr-only"
              />
              <span
                className={cn(
                  "font-mono text-base font-semibold tracking-tight",
                  active ? "text-primary" : "text-foreground",
                )}
              >
                {unit.label}
              </span>
              <span className="text-xs text-muted-foreground">{unit.hint}</span>
            </label>
          );
        })}
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        Applies to every balance and amount across the app. Both labels describe
        the same value.
      </p>
    </fieldset>
  );
}
