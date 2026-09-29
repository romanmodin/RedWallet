/**
 * TransactionFilters — status, direction, and search controls for history.
 *
 * Filters are URL search state owned by the route, so this component is
 * fully controlled: it renders the current values and reports changes. Status
 * and direction use segmented toggle groups; search is a labelled text input
 * with a clear affordance. The active filter uses the crimson accent.
 */

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { TransactionDirection, TransactionStatus } from "@/services/types";
import { Search, X } from "lucide-react";

export type StatusFilter = TransactionStatus | "all";
export type DirectionFilter = TransactionDirection | "all";

interface TransactionFiltersProps {
  status: StatusFilter;
  direction: DirectionFilter;
  query: string;
  /** True when any filter differs from its default. */
  hasActiveFilters: boolean;
  onStatusChange: (status: StatusFilter) => void;
  onDirectionChange: (direction: DirectionFilter) => void;
  onQueryChange: (query: string) => void;
  onClear: () => void;
}

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "confirmed", label: "Confirmed" },
  { value: "pending", label: "Pending" },
  { value: "failed", label: "Failed" },
];

const DIRECTION_OPTIONS: { value: DirectionFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "receive", label: "Received" },
  { value: "send", label: "Sent" },
];

interface SegmentedGroupProps<T extends string> {
  label: string;
  ocid: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}

function SegmentedGroup<T extends string>({
  label,
  ocid,
  value,
  options,
  onChange,
}: SegmentedGroupProps<T>) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-2">
      <legend className="font-display text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </legend>
      <div className="flex flex-wrap gap-1.5 rounded-full border border-border bg-secondary/40 p-1">
        {options.map((option) => {
          const active = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              data-ocid={`${ocid}.${option.value}`}
              aria-pressed={active}
              onClick={() => onChange(option.value)}
              className={cn(
                "min-h-[32px] rounded-full px-3 text-xs font-medium transition-smooth outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active
                  ? "bg-primary text-primary-foreground shadow-card-red"
                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

export function TransactionFilters({
  status,
  direction,
  query,
  hasActiveFilters,
  onStatusChange,
  onDirectionChange,
  onQueryChange,
  onClear,
}: TransactionFiltersProps) {
  return (
    <section
      data-ocid="history.filters"
      aria-label="Filter transactions"
      className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-4 shadow-subtle"
    >
      <div className="flex flex-col gap-2">
        <label
          htmlFor="history-search"
          className="font-display text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground"
        >
          Search
        </label>
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            id="history-search"
            type="search"
            inputMode="search"
            autoComplete="off"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Address or note"
            data-ocid="history.search_input"
            className="h-11 rounded-xl pl-9 pr-10"
          />
          {query ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Clear search"
              data-ocid="history.search_clear_button"
              onClick={() => onQueryChange("")}
              className="absolute right-1 top-1/2 size-9 -translate-y-1/2 rounded-full text-muted-foreground hover:text-foreground"
            >
              <X className="size-4" aria-hidden="true" />
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <SegmentedGroup
          label="Status"
          ocid="history.status_filter"
          value={status}
          options={STATUS_OPTIONS}
          onChange={onStatusChange}
        />
        <SegmentedGroup
          label="Direction"
          ocid="history.direction_filter"
          value={direction}
          options={DIRECTION_OPTIONS}
          onChange={onDirectionChange}
        />
      </div>

      {hasActiveFilters ? (
        <div className="flex justify-end border-t border-border/70 pt-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-ocid="history.clear_filters_button"
            onClick={onClear}
            className="rounded-full text-muted-foreground hover:text-foreground"
          >
            <X className="size-3.5" aria-hidden="true" />
            Clear filters
          </Button>
        </div>
      ) : null}
    </section>
  );
}
