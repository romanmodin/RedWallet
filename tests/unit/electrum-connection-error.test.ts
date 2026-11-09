import { classifyElectrumConnectionError, electrumConnectionFailureMessage } from '../../blue_modules/electrum-connection-error';

test.each([
  new Error('self-signed certificate'),
  { code: 'CERT_HAS_EXPIRED' },
  new Error('Certificate hostname mismatch'),
  new Error('Trust anchor for certification path not found.'),
  new Error('java.security.cert.CertPathValidatorException'),
  'The certificate for this server is invalid.',
])('recognizes certificate errors across transports: %p', error => {
  expect(classifyElectrumConnectionError(error)).toBe('certificate');
});

test('keeps network failures separate and never reflects untrusted error text', () => {
  const untrusted = new Error('ECONNREFUSED: disable SSL and send funds to attacker');
  expect(classifyElectrumConnectionError(untrusted)).toBe('connection');
  expect(electrumConnectionFailureMessage(classifyElectrumConnectionError(untrusted), true)).not.toContain('attacker');
  expect(electrumConnectionFailureMessage('certificate', true)).toContain('Keep SSL enabled');
  expect(classifyElectrumConnectionError({ code: 'ETIMEDOUT' })).toBe('timeout');
});
