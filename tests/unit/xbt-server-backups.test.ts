import { validateBackupServers } from '../../class/xbt/server-backups';

test('validates and normalizes explicit TLS endpoints', () => {
  expect(validateBackupServers([{ host: 'Backup.Xbt.Test', ssl: 50002 }])).toEqual([{ host: 'backup.xbt.test', ssl: 50002 }]);
});
const invalid: unknown[] = [
  [{ host: 'backup.test', tcp: 50001 }],
  [{ host: 'backup.test', ssl: 50002, tcp: 50001 }],
  [{ host: 'backup.test', ssl: 70000 }],
  [{ host: 'https://backup.test', ssl: 50002 }],
  [{ host: 'backup.test', ssl: 50002, tlsCa: 'untrusted text' }],
  [
    { host: 'backup.test', ssl: 50002 },
    { host: 'BACKUP.TEST', ssl: 50002 },
  ],
  Array.from({ length: 6 }, (_, i) => ({ host: `backup${i}.test`, ssl: 50002 })),
];
test.each(invalid.map(peers => ({ peers })))('rejects unsafe backup configuration %#', ({ peers }) => {
  expect(() => validateBackupServers(peers)).toThrow();
});
