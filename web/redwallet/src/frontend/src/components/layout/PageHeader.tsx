/**
 * PageHeader — reusable page title header with optional back navigation.
 *
 * Renders a sticky, translucent bar so long scrolling pages keep their
 * context. The back control is a real button so it works with keyboard and
 * screen readers.
 */

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useNavigate } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  description?: string;
  /** Show a back control that returns to the previous route. */
  showBack?: boolean;
  /** Optional trailing content, e.g. an action button. */
  action?: ReactNode;
  className?: string;
}

export function PageHeader({
  title,
  description,
  showBack = false,
  action,
  className,
}: PageHeaderProps) {
  const navigate = useNavigate();

  return (
    <header
      data-ocid="page_header"
      className={cn(
        "sticky top-0 z-20 -mx-4 mb-5 border-b border-border/70 bg-background/85 px-4 py-3 backdrop-blur-md sm:-mx-6 sm:px-6",
        className,
      )}
    >
      <div className="flex items-center gap-3">
        {showBack ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Go back"
            data-ocid="page_header.back_button"
            onClick={() => navigate({ to: ".." })}
            className="-ml-2 shrink-0 rounded-full"
          >
            <ArrowLeft className="size-5" aria-hidden="true" />
          </Button>
        ) : null}
        <div className="flex min-w-0 flex-1 flex-col">
          <h1 className="truncate font-display text-xl font-semibold tracking-tight text-foreground">
            {title}
          </h1>
          {description ? (
            <p className="truncate text-sm text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
    </header>
  );
}
