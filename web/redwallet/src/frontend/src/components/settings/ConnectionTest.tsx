/**
 * ConnectionTest — connection-test action with full status feedback.
 *
 * Calls the wallet service's `testServerConnection` with the currently
 * persisted server config and renders one of four states: idle, testing,
 * success, or failure. When no host is configured it explains what is
 * missing instead of attempting a request.
 */

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { bridgeWalletService } from "@/services/bridgeService";
import type { NetworkConfig, ServerTestResult } from "@/services/types";
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  PlugZap,
  ServerOff,
} from "lucide-react";
import { useState } from "react";

interface ConnectionTestProps {
  config: NetworkConfig;
}

type TestState =
  | { status: "idle" }
  | { status: "testing" }
  | { status: "success"; result: ServerTestResult }
  | { status: "failure"; result: ServerTestResult };

export function ConnectionTest({ config }: ConnectionTestProps) {
  const [state, setState] = useState<TestState>({ status: "idle" });

  const hasHost = config.host.trim().length > 0;

  const runTest = async () => {
    setState({ status: "testing" });
    const result = await bridgeWalletService.testServerConnection(config);
    if (!result.ok) {
      setState({
        status: "failure",
        result: {
          ok: false,
          state: "error",
          message: result.error.message,
          latencyMs: null,
        },
      });
      return;
    }
    setState({
      status: result.value.ok ? "success" : "failure",
      result: result.value,
    });
  };

  return (
    <div data-ocid="settings.connection_test" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={() => void runTest()}
          disabled={state.status === "testing"}
          data-ocid="settings.connection_test.button"
          className="rounded-xl"
        >
          {state.status === "testing" ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <PlugZap className="size-4" aria-hidden="true" />
          )}
          {state.status === "testing" ? "Testing…" : "Test connection"}
        </Button>
        <span className="font-mono text-xs text-muted-foreground">
          {hasHost
            ? `${config.host}:${config.port}${config.tls ? " · TLS" : ""}`
            : "No server configured"}
        </span>
      </div>

      {state.status === "idle" ? (
        <output
          data-ocid="settings.connection_test.idle_state"
          className="flex items-start gap-2 rounded-xl border border-border bg-secondary/40 px-4 py-3 text-xs leading-relaxed text-muted-foreground"
        >
          <ServerOff className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {hasHost
            ? "Run a test to check whether this server responds."
            : "Add a server host above, then run a test to check the connection."}
        </output>
      ) : null}

      {state.status === "testing" ? (
        <output
          data-ocid="settings.connection_test.testing_state"
          aria-live="polite"
          className="flex items-center gap-2 rounded-xl border border-border bg-secondary/40 px-4 py-3 text-xs font-medium text-muted-foreground"
        >
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Contacting {config.host || "the server"}…
        </output>
      ) : null}

      {state.status === "success" ? (
        <output
          data-ocid="settings.connection_test.success_state"
          aria-live="polite"
          className={cn(
            "flex items-start gap-2 rounded-xl border border-success/40 bg-success/10 px-4 py-3 text-xs leading-relaxed text-success",
          )}
        >
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>
            {state.result.message}
            {state.result.latencyMs !== null
              ? ` Latency ${state.result.latencyMs} ms.`
              : ""}
          </span>
        </output>
      ) : null}

      {state.status === "failure" ? (
        <output
          data-ocid="settings.connection_test.failure_state"
          aria-live="polite"
          className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-xs leading-relaxed text-destructive"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>{state.result.message}</span>
        </output>
      ) : null}
    </div>
  );
}
