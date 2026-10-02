import Realm from 'realm';
import Keychain from 'react-native-keychain';
import { openSecureRealm } from '../../blue_modules/secure-realm';
const schema = [{ name: 'Record', properties: { text: 'string' } }];
const legacy = (name: string) => ({ path: `${name}.realm`, schema, encryptionKey: new Int8Array(64) });
async function mappedPath(path: string) {
  const credentials = await Keychain.getGenericPassword({ service: 'redwallet-cache-paths-v2' });
  if (!credentials) throw new Error('Missing mapping');
  return `redwallet-cache-${JSON.parse(credentials.password)[path.split('/').pop()!]}.realm`;
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
