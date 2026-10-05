export type XbtServer = { host: string; tcp?: number; ssl?: number; tlsCa?: string };

export const serverKey = (peer: XbtServer): string => `${peer.host.toLowerCase()}:${peer.ssl ? 'ssl' : 'tcp'}:${peer.ssl || peer.tcp}`;

/** Backups require TLS. No certificate-error fallback to plaintext is permitted. */
export function validateBackupServers(value: unknown): XbtServer[] {
  if (!Array.isArray(value) || value.length > 5) throw new Error('At most five backup servers are allowed');
  const keys = new Set<string>();
  return value.map(peer => {
    if (
      !peer ||
      typeof peer.host !== 'string' ||
      !peer.host ||
      peer.host !== peer.host.trim() ||
      /[\s/:]/.test(peer.host) ||
      peer.host.length > 253 ||
      !Number.isSafeInteger(peer.ssl) ||
      peer.ssl < 1 ||
      peer.ssl > 65535 ||
      peer.tcp ||
      (peer.tlsCa !== undefined &&
        (typeof peer.tlsCa !== 'string' ||
          peer.tlsCa.length > 16384 ||
          !/^-----BEGIN CERTIFICATE-----\s+[A-Za-z0-9+/=\s]+-----END CERTIFICATE-----$/.test(peer.tlsCa)))
    ) {
      throw new Error('Backup servers require a valid hostname, TLS port and optional trusted PEM certificate');
    }
    const normalized: XbtServer = { host: peer.host.toLowerCase(), ssl: peer.ssl, ...(peer.tlsCa ? { tlsCa: peer.tlsCa } : {}) };
    const key = serverKey(normalized);
    if (keys.has(key)) throw new Error('Duplicate backup server');
    keys.add(key);
    return normalized;
  });
}
