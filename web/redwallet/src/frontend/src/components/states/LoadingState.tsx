/**
 * LoadingState — layout-stable loading placeholder.
 *
 * Renders skeleton rows that match the shape of the content they replace so
 * the page does not jump when data arrives. Announced politely to assistive
 * technology.
 */

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface LoadingStateProps {
  /** Number of skeleton rows to render. */
  rows?: number;
  /** Optional label announced to screen readers. */
  label?: string;
  className?: string;
}

export function LoadingState({
  rows = 4,
  label = "Loading",
  className,
}: LoadingStateProps) {
  const rowIds = Array.from(
    { length: rows },
    (_, index) => `loading-row-${index}`,
  );

  return (
    <output
      data-ocid="loading_state"
      aria-live="polite"
      aria-label={label}
      className={cn("flex flex-col gap-3", className)}
    >
      <span className="sr-only">{label}</span>
      {rowIds.map((id) => (
        <div
          key={id}
          className="flex items-center gap-4 rounded-2xl border border-border/60 bg-card/60 p-4"
        >
          <Skeleton className="size-11 shrink-0 rounded-full" />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Skeleton className="h-3.5 w-1/3 rounded-full" />
            <Skeleton className="h-3 w-1/2 rounded-full" />
          </div>
          <Skeleton className="h-4 w-20 shrink-0 rounded-full" />
        </div>
      ))}
    </output>
  );
}
