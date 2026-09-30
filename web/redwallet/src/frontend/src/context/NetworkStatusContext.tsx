/**
 * Network status context.
 *
 * Owns the single latest network-status read for the whole app. Every
 * `NetworkIndicator` instance and the Network page subscribe to this one
 * source, so a later read updates all of them together instead of each
 * indicator fetching independently at mount.
 *
 * The context never issues its own reads: it delegates to
 * `bridgeWalletService.getNetworkStatus()`, which already deduplicates
 * concurrent calls behind a single in-flight promise. There is no polling and
 * no retry loop — a read happens once at mount and again only when a consumer
 * calls `refresh()`.
 *
 * Failures are propagated honestly: a failed read surfaces as the `error`
 * connection state to every consumer, and a successful read reports exactly
 * the state the service returned. No connected state is ever fabricated.
 */

import { bridgeWalletService } from "@/services/bridgeService";
import {
  PROVIDER_EVENT,
  providerGeneration,
} from "@/services/networkGeneration";
import type {
  ConnectionState,
  NetworkStatus,
  ServiceError,
} from "@/services/types";
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

export interface NetworkStatusContextValue {
  /** The latest status read, or null before the first read resolves. */
  status: NetworkStatus | null;
  /** The effective connection state every consumer renders. */
  connectionState: ConnectionState;
  /** True while the initial read is in flight. */
  isLoading: boolean;
  /** True while a manual refresh is in flight. */
  isRefreshing: boolean;
  /** The failure from the latest read, or null when it succeeded. */
  error: ServiceError | null;
  /** Re-read the network status and broadcast the result to all consumers. */
  refresh: () => Promise<void>;
}

const NetworkStatusContext = createContext<NetworkStatusContextValue | null>(
  null,
);

export function NetworkStatusProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<NetworkStatus | null>(null);
  const [error, setError] = useState<ServiceError | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const mounted = useRef(true);
  const request = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    const sequence = ++request.current;
    const generation = providerGeneration();
    setIsRefreshing(true);
    const result = await bridgeWalletService.getNetworkStatus();
    if (
      !mounted.current ||
      sequence !== request.current ||
      generation !== providerGeneration()
    )
      return;
    if (result.ok) {
      setStatus(result.value);
      setError(null);
    } else {
      // A failed read is surfaced as the error state; the last known status is
      // cleared so no stale "connected" reading survives a failure.
      setStatus(null);
      setError(result.error);
    }
    setIsLoading(false);
    setIsRefreshing(false);
  }, []);

  useEffect(() => {
    void refresh();
    const changed = () => {
      request.current++;
      setStatus(null);
      setError(null);
      void refresh();
    };
    window.addEventListener(PROVIDER_EVENT, changed);
    return () => window.removeEventListener(PROVIDER_EVENT, changed);
  }, [refresh]);

  const connectionState: ConnectionState = isRefreshing
    ? "connecting"
    : error
      ? "error"
      : (status?.state ?? "offline");

  const value = useMemo<NetworkStatusContextValue>(
    () => ({
      status,
      connectionState,
      isLoading,
      isRefreshing,
      error,
      refresh,
    }),
    [status, connectionState, isLoading, isRefreshing, error, refresh],
  );

  return (
    <NetworkStatusContext.Provider value={value}>
      {children}
    </NetworkStatusContext.Provider>
  );
}

export function useNetworkStatusContext(): NetworkStatusContextValue {
  const context = useContext(NetworkStatusContext);
  if (!context) {
    throw new Error(
      "useNetworkStatusContext must be used within a NetworkStatusProvider.",
    );
  }
  return context;
}
