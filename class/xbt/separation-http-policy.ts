export const SEPARATION_EVIDENCE = 'https://blockstream.info/api';
export const SEPARATION_ANCHOR = 'https://mempool.space/api';

export function validateSeparationRequest(url: string, limit: number): void {
  const evidence = url.startsWith(SEPARATION_EVIDENCE + '/');
  const base = evidence ? SEPARATION_EVIDENCE : SEPARATION_ANCHOR;
  if (!url.startsWith(base + '/') || url.length > 256) throw new Error('Invalid separation evidence URL');
  const path = url.slice(base.length);
  // Full-match comparison also rejects trailing newlines ($ alone permits them).
  const matches = (pattern: RegExp) => pattern.exec(path)?.[0] === path;
  let maximum = 0;
  if (path === '/blocks/tip/height' || matches(/^\/block-height\/[1-9][0-9]{0,8}$/) || matches(/^\/block\/[0-9a-f]{64}$/)) maximum = 16384;
  else if (evidence) {
    if (matches(/^\/block\/[0-9a-f]{64}\/header$/)) maximum = 160;
    else if (matches(/^\/block\/[0-9a-f]{64}\/txid\/0$/)) maximum = 64;
    else if (matches(/^\/tx\/[0-9a-f]{64}\/hex$/)) maximum = 2000000;
    else if (matches(/^\/tx\/[0-9a-f]{64}\/merkle-proof$/)) maximum = 16384;
    else if (matches(/^\/tx\/[0-9a-f]{64}\/outspend\/(0|[1-9][0-9]{0,9})$/) && Number(path.split('/').pop()) <= 0xffffffff) maximum = 16384;
  }
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > maximum) throw new Error('Invalid separation evidence request');
}
