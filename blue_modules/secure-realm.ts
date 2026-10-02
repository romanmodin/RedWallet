import Realm, { Configuration } from 'realm';
import Keychain from 'react-native-keychain';
import { randomBytes } from '../class/rng';
import { hexToUint8Array, uint8ArrayToHex } from './uint8array-extras';

const opening = new Map<string, Promise<Configuration>>();

/** Migrate a cache once; retain the old file until the new encrypted copy opens successfully. */
export async function openSecureRealm(legacy: Configuration): Promise<Realm> {
  const legacyPath = legacy.path!;
  const path = legacyPath.replace(/\.realm$/, '-v2.realm');
  const pending = opening.get(path);
  if (pending) return Realm.open(await pending);
  const task = (async () => {
    const service = `redwallet-realm:${path.split('/').pop()}`;
    const credentials = await Keychain.getGenericPassword({ service });
    let key: Uint8Array;
    if (credentials) {
      key = hexToUint8Array(credentials.password);
      if (key.length !== 64) throw new Error('Invalid secure cache key');
    } else {
      if (Realm.exists({ path })) throw new Error('Secure cache key is unavailable; existing data was preserved');
      key = await randomBytes(64);
      const saved = await Keychain.setGenericPassword(service, uint8ArrayToHex(key), {
        service,
        accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
      if (!saved) throw new Error('Could not save secure cache key');
    }
    const config = {
      ...legacy,
      path,
      encryptionKey: Int8Array.from(key),
      excludeFromIcloudBackup: true,
    };
    key.fill(0);
    if (!Realm.exists({ path }) && Realm.exists({ path: legacyPath })) {
      const previous = await Realm.open(legacy);
      try {
        previous.writeCopyTo(config);
        const migrated = await Realm.open(config);
        migrated.close();
      } catch (error) {
        // A failed migration never replaces or deletes the original cache.
        Realm.deleteFile({ path });
        throw error;
      } finally {
        previous.close();
      }
    }
    const realm = await Realm.open(config);
    if (Realm.exists({ path: legacyPath })) Realm.deleteFile({ path: legacyPath });
    realm.close();
    return config;
  })();
  opening.set(path, task);
  try {
    return Realm.open(await task);
  } finally {
    opening.delete(path);
  }
}
