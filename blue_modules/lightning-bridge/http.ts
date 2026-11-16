import { NativeModules } from 'react-native';

export type BridgeResponse = Pick<Response, 'ok' | 'status' | 'url' | 'text'>;
export type BridgeRequest = (url: string, options: RequestInit) => Promise<BridgeResponse>;
let sequence = 0;

// React Native's XHR-backed fetch follows redirects despite redirect: 'error'.
// Use the isolated native transport; never fall back to the shared cookie session.
export const nativeBridgeRequest: BridgeRequest = (url, options) => {
  const bridge = NativeModules.XBTLightningBridge;
  if (typeof bridge?.bridgeRequest !== 'function' || typeof bridge?.cancelBridgeRequest !== 'function')
    return Promise.reject(new Error('Cross-chain quotes need the updated secure iPhone transport.'));
  if (options.signal?.aborted) return Promise.reject(new Error('Quote canceled.'));
  const id = Date.now() + '-' + ++sequence;
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (action: () => void) => {
      if (done) return;
      done = true;
      options.signal?.removeEventListener('abort', abort);
      action();
    };
    const abort = () => {
      try {
        bridge.cancelBridgeRequest(id);
      } catch {
        // A lost native bridge still leaves this request canceled locally.
      }
      finish(() => reject(new Error('Quote canceled.')));
    };
    options.signal?.addEventListener('abort', abort);
    if (options.signal?.aborted) {
      abort();
      return;
    }
    try {
      Promise.resolve(bridge.bridgeRequest(id, url, options.method ?? 'GET', options.body ?? '')).then(
        result =>
          finish(() => {
            if (
              !result ||
              !Number.isInteger(result.status) ||
              result.status < 100 ||
              result.status > 599 ||
              result.url !== url ||
              typeof result.body !== 'string' ||
              result.body.length > 32768
            ) {
              reject(new Error('Invalid secure bridge response.'));
              return;
            }
            resolve({ ok: result.status >= 200 && result.status < 300, status: result.status, url, text: async () => result.body });
          }),
        error => finish(() => reject(error)),
      );
    } catch (error) {
      finish(() => reject(error));
    }
  });
};
