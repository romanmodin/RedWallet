import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { fetchNeoxexBtcPrice } from '../blue_modules/neoxex-price';
import { BtcUsdcPriceQuote, loadBtcUsdcPriceQuote, saveBtcUsdcPriceQuote } from '../blue_modules/btc-usdc-price';

/** One shared quote for SHA-256 cards and totals; launch/foreground refresh, no per-card polling. */
export function useBtcDisplayPrice(enabled: boolean) {
  const [btcUsdcPriceQuote, setQuote] = useState<BtcUsdcPriceQuote | null>(null);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const revision = useRef(0);
  const mounted = useRef(true);
  const pending = useRef<{ revision: number; promise: Promise<void> } | null>(null);
  const refreshNeoxexBtcPriceQuote = useCallback((): Promise<void> => {
    if (!enabledRef.current || !mounted.current) return Promise.resolve();
    if (pending.current?.revision === revision.current) return pending.current.promise;
    const current = ++revision.current;
    const promise = (async () => {
      const quote = await fetchNeoxexBtcPrice();
      if (!mounted.current || !enabledRef.current || current !== revision.current) return;
      await saveBtcUsdcPriceQuote(quote);
      if (mounted.current && enabledRef.current && current === revision.current) setQuote(quote);
    })().finally(() => {
      if (pending.current?.revision === current) pending.current = null;
    });
    pending.current = { revision: current, promise };
    return promise;
  }, []);
  useEffect(() => {
    mounted.current = true;
    const lifecycleRevision = revision;
    let active = true;
    let ready = false;
    let appState = AppState.currentState;
    const refresh = () => {
      if (ready && enabledRef.current) refreshNeoxexBtcPriceQuote().catch(() => {});
    };
    if (enabled) {
      const initialRevision = revision.current;
      loadBtcUsdcPriceQuote().then(quote => {
        if (!active) return;
        const unchanged = initialRevision === revision.current;
        if (unchanged) setQuote(quote);
        ready = true;
        if (unchanged && (appState === 'active' || appState == null)) refresh();
      });
    } else {
      setQuote(null);
    }
    const subscription = AppState.addEventListener('change', state => {
      const foreground = state === 'active' && appState !== 'active';
      appState = state;
      if (foreground) refresh();
    });
    return () => {
      active = false;
      mounted.current = false;
      ++lifecycleRevision.current;
      subscription.remove();
    };
  }, [enabled, refreshNeoxexBtcPriceQuote]);
  return { btcUsdcPriceQuote, refreshNeoxexBtcPriceQuote };
}
