import { NativeModules } from 'react-native';
import { validateSeparationRequest } from './separation-http-policy';
import type { SeparationHTTPResponse } from './separation-http';

type ProofHTTP = {
  get(id: string, url: string, limit: number): Promise<{ status: number; url: string; body: string; serverTime: number }>;
  cancel(id: string): void;
};
let serial = 0;

// Metro uses this adapter on all mobile platforms. Never silently use RN fetch:
// its redirect option cannot stop a redirected request before disclosure.
export async function getSeparationHTTPResponse(url: string, limit: number, signal: AbortSignal): Promise<SeparationHTTPResponse> {
  validateSeparationRequest(url, limit);
  const native = NativeModules.RedWalletSeparationHTTP as ProofHTTP | undefined;
  if (!native?.get || !native.cancel) throw new Error('Native separation evidence transport is unavailable');
  if (signal.aborted) throw new Error('Separation evidence request canceled');
  const id = 'proof-' + Date.now().toString(36) + '-' + (++serial).toString(36);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error, response?: SeparationHTTPResponse) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', abort);
      if (error) reject(error);
      else resolve(response!);
    };
    const abort = () => {
      finish(new Error('Separation evidence request canceled'));
      try {
        native.cancel(id);
      } catch {
        /* Native timer still bounds the request. */
      }
    };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) {
      abort();
      return;
    }
    try {
      native.get(id, url, limit).then(
        (result) => {
          if (
            !result ||
            result.status !== 200 ||
            result.url !== url ||
            typeof result.body !== 'string' ||
            !Number.isInteger(result.serverTime) ||
            result.serverTime < 0 ||
            result.serverTime > 0xffffffff ||
            Buffer.byteLength(result.body, 'utf8') > limit
          ) {
            finish(new Error('Invalid separation evidence response'));
          } else finish(undefined, result);
        },
        () => finish(new Error('Separation evidence request failed')),
      );
    } catch {
      finish(new Error('Separation evidence request failed'));
    }
  });
}

export async function getSeparationHTTP(url: string, limit: number, signal: AbortSignal): Promise<string> {
  return (await getSeparationHTTPResponse(url, limit, signal)).body;
}
