import Realm from 'realm';
import { scryptSync } from 'crypto';
import Keychain from 'react-native-keychain';
import { openSecureRealm } from '../../blue_modules/secure-realm';
const schema = [{ name: 'Record', properties: { text: 'string' } }];
const legacy = (name: string) => ({ path: `${name}.realm`, schema, encryptionKey: new Int8Array(64) });
async function mappedPath(path: string) {
  const credentials = await Keychain.getGenericPassword({ service: 'redwallet-cache-paths-v3' });
  if (!credentials) throw new Error('Missing mapping');
  const record = JSON.parse(credentials.password);
  const index = scryptSync(`RedWallet cache index v3:${path.split('/').pop()!}`, Buffer.from(record.salt, 'hex'), 32, {
    N: 32768,
    r: 8,
    p: 3,
    maxmem: 40 * 1024 * 1024,
  }).toString('hex');
  return `redwallet-cache-${record.paths[index]}.realm`;
}
describe('random-key cache migration', () => {
  it('copies records, reopens with a stable random Keychain key and filename, then deletes the old file', async () => {
    const config = legacy('migration-success');
    const previous = await Realm.open(config);
    previous.write(() => previous.create('Record', { text: 'existing wallet history' }));
    previous.close();
    const migrated = await openSecureRealm(config);
    expect(Array.from(migrated.objects<any>('Record'))[0].text).toBe('existing wallet history');
    expect(Realm.exists({ path: config.path })).toBe(false);
    expect(migrated.path).toMatch(/^redwallet-cache-[a-f0-9]{32}\.realm$/);
    const saved = await Keychain.getGenericPassword({ service: `redwallet-realm:${migrated.path}` });
    expect(saved && saved.password).toMatch(/^[a-f0-9]{128}$/);
    expect(saved && saved.password).not.toBe('0'.repeat(128));
    const path = migrated.path;
    migrated.close();
    const reopened = await openSecureRealm(config);
    expect(reopened.path).toBe(path);
    expect(Array.from(reopened.objects<any>('Record'))[0].text).toBe('existing wallet history');
    reopened.close();
  });
  it('preserves the original file if the encrypted copy fails', async () => {
    const config = legacy('migration-failure');
    const previous = await Realm.open(config);
    previous.write(() => previous.create('Record', { text: 'preserve this record' }));
    jest.spyOn(previous, 'writeCopyTo').mockImplementation(() => {
      throw new Error('disk full');
    });
    await expect(openSecureRealm(config)).rejects.toThrow('disk full');
    expect(Realm.exists({ path: config.path })).toBe(true);
    const reopened = await Realm.open(config);
    expect(Array.from(reopened.objects<any>('Record'))[0].text).toBe('preserve this record');
    expect(Realm.exists({ path: await mappedPath(config.path) })).toBe(false);
  });
  it('does not replace an existing cache when its Keychain key is missing', async () => {
    const config = legacy('missing-key');
    const cache = await openSecureRealm(config);
    const path = cache.path;
    cache.close();
    await Keychain.resetGenericPassword({ service: `redwallet-realm:${path}` });
    await expect(openSecureRealm(config)).rejects.toThrow('existing data was preserved');
    expect(Realm.exists({ path })).toBe(true);
  });
  it('separates decoy caches without putting the legacy password fingerprint in filenames', async () => {
    const [first, second] = await Promise.all([
      openSecureRealm(legacy('password-fingerprint-one')),
      openSecureRealm(legacy('password-fingerprint-two')),
    ]);
    expect(first.path).not.toBe(second.path);
    expect(first.path).not.toContain('password-fingerprint');
    expect(second.path).not.toContain('password-fingerprint');
    first.close();
    second.close();
  });
});

it('keeps cache identity stable when iOS changes the app container directory', async () => {
  const first = await openSecureRealm({ ...legacy('stable-bucket'), path: '/old-container/stable-bucket.realm' });
  const second = await openSecureRealm({ ...legacy('stable-bucket'), path: '/new-container/stable-bucket.realm' });
  expect(first.path.split('/').pop()).toBe(second.path.split('/').pop());
  first.close();
  second.close();
});

it('migrates a v2 mapping without moving its cache, removes only the active fast fingerprint, and preserves other buckets', async () => {
  const config = legacy('active-password-fingerprint');
  const path = `redwallet-cache-${'a'.repeat(32)}.realm`;
  await Keychain.setGenericPassword(
    'redwallet-cache-paths-v2',
    JSON.stringify({
      [config.path]: 'a'.repeat(32),
      'other-password-fingerprint.realm': 'b'.repeat(32),
    }),
    { service: 'redwallet-cache-paths-v2' },
  );
  await Keychain.setGenericPassword(`redwallet-realm:${path}`, '01'.repeat(64), { service: `redwallet-realm:${path}` });
  const previous = await Realm.open({ ...config, path, encryptionKey: new Int8Array(64).fill(1) });
  previous.write(() => previous.create('Record', { text: 'existing v2 cache' }));
  previous.close();
  const migrated = await openSecureRealm(config);
  expect(migrated.path).toBe(path);
  expect(Array.from(migrated.objects<any>('Record'))[0].text).toBe('existing v2 cache');
  const old = await Keychain.getGenericPassword({ service: 'redwallet-cache-paths-v2' });
  expect(old && JSON.parse(old.password)).toEqual({ 'other-password-fingerprint.realm': 'b'.repeat(32) });
  const current = await Keychain.getGenericPassword({ service: 'redwallet-cache-paths-v3' });
  expect(current && current.password).not.toContain(config.path);
  expect(await mappedPath(config.path)).toBe(path);
  migrated.close();
});

it('retains the v2 mapping and cache if writing the new mapping fails', async () => {
  const config = legacy('mapping-save-failure');
  const path = `redwallet-cache-${'c'.repeat(32)}.realm`;
  const original = JSON.stringify({ [config.path]: 'c'.repeat(32) });
  await Keychain.setGenericPassword('redwallet-cache-paths-v2', original, { service: 'redwallet-cache-paths-v2' });
  const cache = await Realm.open({ ...config, path });
  cache.close();
  const originalImplementation = (Keychain.setGenericPassword as jest.Mock).getMockImplementation();
  const spy = jest.spyOn(Keychain, 'setGenericPassword').mockResolvedValueOnce(false);
  await expect(openSecureRealm(config)).rejects.toThrow('Could not save secure cache path');
  spy.mockImplementation(originalImplementation!);
  const old = await Keychain.getGenericPassword({ service: 'redwallet-cache-paths-v2' });
  expect(old && old.password).toBe(original);
  expect(Realm.exists({ path })).toBe(true);
});

it('preserves the existing cache and retries if removing the old fingerprint fails', async () => {
  const config = legacy('mapping-cleanup-failure');
  const path = `redwallet-cache-${'d'.repeat(32)}.realm`;
  await Keychain.setGenericPassword('redwallet-cache-paths-v2', JSON.stringify({ [config.path]: 'd'.repeat(32) }), {
    service: 'redwallet-cache-paths-v2',
  });
  await Keychain.setGenericPassword(`redwallet-realm:${path}`, '02'.repeat(64), { service: `redwallet-realm:${path}` });
  const cache = await Realm.open({ ...config, path, encryptionKey: new Int8Array(64).fill(2) });
  cache.write(() => cache.create('Record', { text: 'retry without losing history' }));
  cache.close();
  const originalImplementation = (Keychain.resetGenericPassword as jest.Mock).getMockImplementation();
  const spy = jest.spyOn(Keychain, 'resetGenericPassword').mockResolvedValueOnce(false);
  await expect(openSecureRealm(config)).rejects.toThrow('Could not remove legacy cache fingerprint');
  spy.mockImplementation(originalImplementation!);
  expect(Realm.exists({ path })).toBe(true);
  const reopened = await openSecureRealm(config);
  expect(reopened.path).toBe(path);
  expect(Array.from(reopened.objects<any>('Record'))[0].text).toBe('retry without losing history');
  expect(await Keychain.getGenericPassword({ service: 'redwallet-cache-paths-v2' })).toBe(false);
  reopened.close();
});
