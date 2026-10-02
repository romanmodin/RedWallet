import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { XbtPriceQuote } from '../blue_modules/xbt-price';

/** Refresh quote-age labels without making any network requests. */
export function useXbtPriceClock(quote: XbtPriceQuote | null | undefined): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    setNow(Date.now());
    if (quote?.source !== 'neoxex') return;
    const timer = setInterval(() => setNow(Date.now()), 60000);
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') setNow(Date.now());
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [quote?.source, quote?.updatedAt]);
  return now;
}
