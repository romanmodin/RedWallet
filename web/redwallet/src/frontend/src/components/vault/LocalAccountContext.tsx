import type { PublicXbtAccount } from "@/lib/xbt/key-material";
import {
  type ReactNode,
  createContext,
  useContext,
  useEffect,
  useState,
} from "react";

export interface LocalAccountSelection {
  id: string;
  account: PublicXbtAccount;
  name: string;
}
const LocalAccountContext = createContext<{
  selected: LocalAccountSelection | null;
  select: (value: LocalAccountSelection | null) => void;
} | null>(null);

/** Same-tab authenticated public selection only. Never owns keys or controllers,
 * never restores xpubs from a locked envelope, and never persists this selection.
 */
export function LocalAccountProvider({ children }: { children: ReactNode }) {
  const [selected, select] = useState<LocalAccountSelection | null>(null);
  useEffect(() => {
    const invalidate = (event: StorageEvent) => {
      if (event.key === null || event.key.startsWith("redwallet.vault.v1."))
        select(null);
    };
    window.addEventListener("storage", invalidate);
    return () => window.removeEventListener("storage", invalidate);
  }, []);
  return (
    <LocalAccountContext.Provider value={{ selected, select }}>
      {children}
    </LocalAccountContext.Provider>
  );
}
export function useLocalAccount() {
  return useContext(LocalAccountContext);
}
