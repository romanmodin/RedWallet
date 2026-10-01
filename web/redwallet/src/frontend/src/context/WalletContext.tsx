/**
 * Wallet context.
 *
 * Exposes the active wallet, the wallet list, and refresh/selection actions
 * backed by the typed service layer. Screens consume this context instead of
 * importing the mock service directly, so a real adapter can be swapped in
 * without touching any component.
 */

import { bridgeWalletService } from "@/services/bridgeService";
import {
  PROVIDER_EVENT,
  providerGeneration,
} from "@/services/networkGeneration";
import type { ServiceError, Wallet } from "@/services/types";
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

export interface WalletContextValue {
  wallets: Wallet[];
  activeWallet: Wallet | null;
  isLoading: boolean;
  error: ServiceError | null;
  refresh: () => Promise<void>;
  selectWallet: (walletId: string) => Promise<void>;
  addWallet: (name: string, address?: string) => Promise<Wallet | null>;
  removeWallet: (id: string) => Promise<boolean>;
  hideDemoWallets: () => Promise<boolean>;
  restoreDemoWallets: () => Promise<boolean>;
}

const WalletContext = createContext<WalletContextValue | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [activeWallet, setActiveWallet] = useState<Wallet | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<ServiceError | null>(null);
  const request = useRef(0);

  const refresh = useCallback(async () => {
    const sequence = ++request.current;
    const generation = providerGeneration();
    setIsLoading(true);
    const [listResult, activeResult] = await Promise.all([
      bridgeWalletService.listWallets(),
      bridgeWalletService.getActiveWallet(),
    ]);

    if (sequence !== request.current || generation !== providerGeneration())
      return;
    if (!listResult.ok) {
      setError(listResult.error);
      setIsLoading(false);
      return;
    }

    setWallets(
      listResult.value.map((w) =>
        activeResult.ok && w.id === activeResult.value.id
          ? activeResult.value
          : w,
      ),
    );
    setActiveWallet(activeResult.ok ? activeResult.value : null);
    setError(
      activeResult.ok || listResult.value.length === 0
        ? null
        : activeResult.error,
    );
    setIsLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
    const changed = () => {
      request.current++;
      const clear = (wallet: Wallet) =>
        wallet.isDemo
          ? wallet
          : {
              ...wallet,
              balanceXbt: Number.NaN,
              fiatValueUsd: Number.NaN,
              balanceError: "Provider changed; refreshing network data.",
            };
      setWallets((current) => current.map(clear));
      setActiveWallet((current) => (current ? clear(current) : null));
      void refresh();
    };
    const storageChanged = (event: StorageEvent) => {
      if (
        event.key === null ||
        [
          "redwallet.watch-wallets.v1",
          "redwallet.hidden-demos.v1",
          "redwallet.active-wallet.v1",
        ].includes(event.key)
      )
        void refresh();
    };
    window.addEventListener("storage", storageChanged);
    window.addEventListener(PROVIDER_EVENT, changed);
    return () => {
      request.current++;
      window.removeEventListener("storage", storageChanged);
      window.removeEventListener(PROVIDER_EVENT, changed);
    };
  }, [refresh]);

  const selectWallet = useCallback(async (walletId: string) => {
    const generation = providerGeneration();
    const result = await bridgeWalletService.setActiveWallet(walletId);
    if (generation !== providerGeneration()) return;
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setActiveWallet(result.value);
    setWallets((current) =>
      current.map((w) => (w.id === result.value.id ? result.value : w)),
    );
    setError(null);
  }, []);

  const addWallet = useCallback(async (name: string, address?: string) => {
    const result =
      address !== undefined && bridgeWalletService.addWatchWallet
        ? await bridgeWalletService.addWatchWallet(name, address)
        : await bridgeWalletService.addDemoWallet(name);
    if (!result.ok) {
      setError(result.error);
      return null;
    }
    setWallets((current) => [...current, result.value]);
    setError(null);
    return result.value;
  }, []);

  const mutateWallets = useCallback(
    async (
      action: () => Promise<import("@/services/types").ServiceResult<boolean>>,
    ) => {
      request.current++;
      const result = await action();
      if (!result.ok) {
        setError(result.error);
        return false;
      }
      await refresh();
      return true;
    },
    [refresh],
  );
  const removeWallet = useCallback(
    (id: string) => mutateWallets(() => bridgeWalletService.removeWallet(id)),
    [mutateWallets],
  );
  const hideDemoWallets = useCallback(
    () => mutateWallets(() => bridgeWalletService.hideDemoWallets()),
    [mutateWallets],
  );
  const restoreDemoWallets = useCallback(
    () => mutateWallets(() => bridgeWalletService.restoreDemoWallets()),
    [mutateWallets],
  );

  const value = useMemo<WalletContextValue>(
    () => ({
      wallets,
      activeWallet,
      isLoading,
      error,
      refresh,
      selectWallet,
      addWallet,
      removeWallet,
      hideDemoWallets,
      restoreDemoWallets,
    }),
    [
      wallets,
      activeWallet,
      isLoading,
      error,
      refresh,
      selectWallet,
      addWallet,
      removeWallet,
      hideDemoWallets,
      restoreDemoWallets,
    ],
  );

  return (
    <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
  );
}

export function useWalletContext(): WalletContextValue {
  const context = useContext(WalletContext);
  if (!context) {
    throw new Error("useWalletContext must be used within a WalletProvider.");
  }
  return context;
}
