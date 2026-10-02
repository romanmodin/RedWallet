import Realm, { Configuration } from 'realm';
import Keychain from 'react-native-keychain';
import { randomBytes } from '../class/rng';
import { hexToUint8Array, uint8ArrayToHex } from './uint8array-extras';

const opening = new Map<string, Promise<Configuration>>();
let assigningPath: Promise<void> = Promise.resolve();
const PATH_SERVICE = 'redwallet-cache-paths-v2';

/** Keep legacy password fingerprints inside Keychain, never in new filenames or service names. */
function secureCachePath(legacyPath: string): Promise<string> {
  // iOS may change the container directory on update; the cache's basename stays stable.
  const cacheName = legacyPath.split('/').pop()!;
  const task = assigningPath.then(async () => {
    const credentials = await Keychain.getGenericPassword({ service: PATH_SERVICE });
    const paths: Record<string, string> = credentials ? JSON.parse(credentials.password) : {};
    if (!paths[cacheName]) {
      paths[cacheName] = uint8ArrayToHex(await randomBytes(16));
      if (
        !(await Keychain.setGenericPassword(PATH_SERVICE, JSON.stringify(paths), {
          service: PATH_SERVICE,
          accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        }))
      )
        throw new Error('Could not save secure cache path');
    }
    if (!/^[a-f0-9]{32}$/.test(paths[cacheName])) throw new Error('Invalid secure cache path');
    const directory = legacyPath.slice(0, legacyPath.lastIndexOf('/') + 1);
    return `${directory}redwallet-cache-${paths[cacheName]}.realm`;
  });
  assigningPath = task.then(
    () => {},
    () => {},
  );
  return task;
}

/** Migrate a cache once; retain the old file until the new encrypted copy opens successfully. */
export async function openSecureRealm(legacy: Configuration): Promise<Realm> {
  const legacyPath = legacy.path!;
  const pending = opening.get(legacyPath);
  if (pending) return Realm.open(await pending);
  const task = (async () => {
    const path = await secureCachePath(legacyPath);
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
  opening.set(legacyPath, task);
  try {
    return Realm.open(await task);
  } finally {
    opening.delete(legacyPath);
  }
}
