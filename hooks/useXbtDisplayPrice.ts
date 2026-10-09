import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { fetchNeoxexPrice } from '../blue_modules/neoxex-price';
import {
  XbtPriceQuote,
  createManualXbtPriceQuote,
  loadXbtPriceQuote,
  saveXbtPriceQuote,
  clearSavedXbtPriceQuote,
} from '../blue_modules/xbt-price';

/** Display-only quotes; never change wallet balances or transaction amounts. */
export function useXbtDisplayPrice() {
  const [xbtPriceQuote, setQuote] = useState<XbtPriceQuote | null>(null);
  const quoteRef = useRef<XbtPriceQuote | null>(null);
  const revision = useRef(0);
  const mounted = useRef(true);
  const pending = useRef<{ revision: number; promise: Promise<void> } | null>(null);

  const applyQuote = useCallback((quote: XbtPriceQuote | null) => {
    quoteRef.current = quote;
    if (mounted.current) setQuote(quote);
  }, []);

  const saveManualXbtPriceQuote = useCallback(
    async (price: string, currency: string): Promise<void> => {
      const quote = createManualXbtPriceQuote(price, currency);
      const current = ++revision.current;
      const previous = quoteRef.current;
      // A foreground event must not replace a manual edit while its save is pending.
      quoteRef.current = quote;
      try {
        await saveXbtPriceQuote(quote);
        if (current === revision.current) applyQuote(quote);
      } catch (error) {
        if (current === revision.current) quoteRef.current = previous;
        throw error;
      }
    },
    [applyQuote],
  );

  const refreshNeoxexXbtPriceQuote = useCallback((): Promise<void> => {
    if (pending.current?.revision === revision.current) return pending.current.promise;
    const current = ++revision.current;
    const promise = (async () => {
      const quote = await fetchNeoxexPrice();
      if (!mounted.current || current !== revision.current) return;
      await saveXbtPriceQuote(quote);
      if (mounted.current && current === revision.current) applyQuote(quote);
    })().finally(() => {
      if (pending.current?.revision === current) pending.current = null;
    });
    pending.current = { revision: current, promise };
    return promise;
  }, [applyQuote]);

  const clearXbtPriceQuote = useCallback(async (): Promise<void> => {
    const current = ++revision.current;
    const previous = quoteRef.current;
    quoteRef.current = null;
    try {
      await clearSavedXbtPriceQuote();
      if (current === revision.current) applyQuote(null);
    } catch (error) {
      if (current === revision.current) quoteRef.current = previous;
      throw error;
    }
  }, [applyQuote]);

  useEffect(() => {
    mounted.current = true;
    const lifecycleRevision = revision;
    let ready = false;
    let active = true;
    let appState = AppState.currentState;
    const refreshAutomatically = () => {
      if (ready && quoteRef.current?.source === 'neoxex') {
        // Offline/exchange failures retain the last valid quote and its trade time.
        refreshNeoxexXbtPriceQuote().catch(() => {});
      }
    };
    const initialRevision = revision.current;
    loadXbtPriceQuote().then(quote => {
      if (!active) return;
      if (revision.current === initialRevision) applyQuote(quote);
      ready = true;
      if (appState === 'active' || appState == null) refreshAutomatically();
    });
    const subscription = AppState.addEventListener('change', nextState => {
      const returnedToApp = nextState === 'active' && appState !== 'active';
      appState = nextState;
      if (returnedToApp) refreshAutomatically();
    });
    return () => {
      active = false;
      mounted.current = false;
      ++lifecycleRevision.current;
      subscription.remove();
    };
  }, [applyQuote, refreshNeoxexXbtPriceQuote]);

  return { xbtPriceQuote, saveManualXbtPriceQuote, clearXbtPriceQuote, refreshNeoxexXbtPriceQuote };
}
