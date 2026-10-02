import Realm from 'realm';
import Keychain from 'react-native-keychain';
import { openSecureRealm } from '../../blue_modules/secure-realm';

const schema = [{ name: 'Record', properties: { text: 'string' } }];
const legacy = (name: string) => ({
  path: `${name}.realm`,
  schema,
  encryptionKey: new Int8Array(64),
});

describe('random-key cache migration', () => {
  it('copies records, reopens with a stable random Keychain key, then deletes the old file', async () => {
    const config = legacy('migration-success');
    const previous = await Realm.open(config);
    previous.write(() => previous.create('Record', { text: 'existing wallet history' }));
    previous.close();
    const migrated = await openSecureRealm(config);
    expect(Array.from(migrated.objects<any>('Record'))[0].text).toBe('existing wallet history');
    expect(Realm.exists({ path: config.path })).toBe(false);
    const saved = await Keychain.getGenericPassword({
      service: 'redwallet-realm:migration-success-v2.realm',
    });
    expect(saved && saved.password).toMatch(/^[a-f0-9]{128}$/);
    expect(saved && saved.password).not.toBe('0'.repeat(128));
    migrated.close();
    const reopened = await openSecureRealm(config);
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
    expect(Realm.exists({ path: 'migration-failure-v2.realm' })).toBe(false);
  });
  it('does not replace an existing cache when its Keychain key is missing', async () => {
    const config = legacy('missing-key');
    await Realm.open({ ...config, path: 'missing-key-v2.realm' });
    await expect(openSecureRealm(config)).rejects.toThrow('existing data was preserved');
    expect(Realm.exists({ path: 'missing-key-v2.realm' })).toBe(true);
  });
});
