export type ElectrumConnectionFailure = 'certificate' | 'timeout' | 'checkpoint' | 'connection';
export type ElectrumConnectionResult = { ok: true } | { ok: false; reason: ElectrumConnectionFailure };

// Native platforms return different TLS errors. Only classify them here; never
// display an untrusted server's raw error text or treat a failure as permission
// to downgrade to TCP or install a certificate fetched from that connection.
export function classifyElectrumConnectionError(error: unknown): ElectrumConnectionFailure {
  const detail =
    typeof error === 'string'
      ? error
      : error && typeof error === 'object'
        ? `${'code' in error ? String(error.code) : ''} ${'message' in error ? String(error.message) : ''}`
        : '';
  if (/certificate|cert_|self[ -]signed|trust anchor|hostname mismatch|peer not authenticated|certpath/i.test(detail)) {
    return 'certificate';
  }
  if (/timed? ?out|etimedout/i.test(detail)) return 'timeout';
  return 'connection';
}

export function electrumConnectionFailureMessage(reason: ElectrumConnectionFailure, useTls: boolean, onion = false): string {
  switch (reason) {
    case 'certificate':
      return 'The server certificate could not be verified. It may be self-signed, expired, or issued for a different hostname. Ask the operator for a valid certificate, or obtain their CA/server certificate through a trusted channel and enter it below. Keep SSL enabled.';
    case 'checkpoint':
      return 'This server did not match the XBT BLAKE2b mainnet checkpoint. Check that this is an XBT Electrum server; a Bitcoin SHA-256 server cannot be used here.';
    case 'timeout':
      return onion
        ? 'The connection timed out. Check that Tor is ready and the onion service is online.'
        : 'The connection timed out. Check the server hostname, port, and network connection.';
    default:
      return onion
        ? 'Could not connect to the onion server. Check Tor, the hostname, and the port.'
        : useTls
          ? 'Could not establish a verified SSL connection to this Electrum server. Check the hostname and TLS port. The operator must provide a trusted, valid certificate matching the hostname.'
          : 'Could not connect to this Electrum server. Check the hostname, TCP port, and network connection.';
  }
}
