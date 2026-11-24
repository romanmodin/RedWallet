import { validateSeparationRequest } from './separation-http-policy';

export type SeparationHTTPResponse = { body: string; serverTime: number };

// Node/diagnostic adapter. Metro resolves separation-http.native.ts on devices.
export async function getSeparationHTTPResponse(url: string, limit: number, signal: AbortSignal): Promise<SeparationHTTPResponse> {
  validateSeparationRequest(url, limit);
  const response = await fetch(url, {
    method: 'GET',
    redirect: 'error',
    credentials: 'omit',
    headers: {
      'Cache-Control': 'no-cache, no-store, max-age=0',
      Pragma: 'no-cache',
    },
    signal,
  });
  if (!response.ok || response.redirected || (response.url && response.url !== url)) throw new Error('Invalid separation evidence response');
  const length = response.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > limit)) throw new Error('Separation evidence response too large');
  const date = response.headers.get('date');
  const milliseconds = date === null ? NaN : Date.parse(date);
  const serverTime = milliseconds / 1000;
  if (!Number.isInteger(serverTime) || serverTime < 0 || serverTime > 0xffffffff) throw new Error('Invalid separation evidence time');
  if (response.body?.getReader) {
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > limit || signal.aborted) throw new Error('Separation evidence response too large or canceled');
        chunks.push(value);
      }
      return { body: Buffer.concat(chunks).toString('utf8'), serverTime };
    } finally {
      await reader.cancel();
    }
  }
  const body = await response.text();
  if (signal.aborted || Buffer.byteLength(body, 'utf8') > limit) throw new Error('Separation evidence response too large or canceled');
  return { body, serverTime };
}

export async function getSeparationHTTP(url: string, limit: number, signal: AbortSignal): Promise<string> {
  return (await getSeparationHTTPResponse(url, limit, signal)).body;
}
