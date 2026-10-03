import { normalizeCertificatePem } from '../../blue_modules/tls-certificate';

it('restores iOS smart-dash PEM armor without changing certificate data', () => {
  const data = 'MIIDAb+/123=\nAbCdEf';
  expect(normalizeCertificatePem(`——BEGIN CERTIFICATE——\n${data}\n——END CERTIFICATE——`)).toBe(
    `-----BEGIN CERTIFICATE-----\n${data}\n-----END CERTIFICATE-----`,
  );
  expect(normalizeCertificatePem(`——BEGIN CERTIFICATE——\r\n${data}\r\n——END CERTIFICATE——`)).toBe(
    `-----BEGIN CERTIFICATE-----\r\n${data}\r\n-----END CERTIFICATE-----`,
  );
});

it('preserves normal PEM and does not repair altered certificate data or other labels', () => {
  const pem = '-----BEGIN CERTIFICATE-----\nAb—Cd\n-----END CERTIFICATE-----';
  expect(normalizeCertificatePem(pem)).toBe(pem);
  expect(normalizeCertificatePem('——BEGIN PRIVATE KEY——')).toBe('——BEGIN PRIVATE KEY——');
});
