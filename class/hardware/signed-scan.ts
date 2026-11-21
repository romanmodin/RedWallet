import { Psbt } from 'bitcoinjs-lib';

type SignedScan = { kind: 'psbt'; psbt: Psbt | string } | { kind: 'transaction'; hex: string };

/** ScanQRCode assembles UR fragments before delivering the complete payload. */
export function parseSignedScan(text: string): SignedScan {
  const trimmed = text.trim();
  if (/^ur/i.test(trimmed)) throw new Error('Finish scanning all QR fragments before importing the signature.');
  if (/^(?:[0-9a-fA-F]{2})+$/.test(trimmed)) {
    if (/^70736274ff/i.test(trimmed)) return { kind: 'psbt', psbt: Psbt.fromHex(trimmed) };
    return { kind: 'transaction', hex: trimmed };
  }
  return { kind: 'psbt', psbt: trimmed };
}
