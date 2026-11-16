// BOLT12's checksum-free bech32 encoding is validated cryptographically by
// the native XBT engine. This only classifies scanner/paste input.
export const isBolt12Offer = (value: string): boolean => /^lno1/i.test(value.trim().replace(/^lightning:/i, ''));

export function normalizeLightningRequest(value: string, offersAvailable: boolean): string {
  let text = value.trim().replace(/^lightning:/i, '');
  if (text !== text.toLowerCase() && text !== text.toUpperCase()) throw new Error('Use an unmixed-case Lightning request.');
  text = text.toLowerCase();
  if (offersAvailable && text.length <= 32768 && /^lno1[02-9ac-hj-np-z]+$/.test(text)) return text;
  if (text.length <= 8192 && /^lnbc[0-9]*[munp]?1[02-9ac-hj-np-z]+$/.test(text)) return text;
  throw new Error('Scan an XBT Lightning invoice or a supported BOLT12 offer.');
}
