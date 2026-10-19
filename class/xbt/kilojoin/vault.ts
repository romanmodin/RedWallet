/** Authenticated encrypted session storage; encryption keys remain in native Keychain. */
import AsyncStorage from '@react-native-async-storage/async-storage';
import Keychain from 'react-native-keychain';
import { xchacha20poly1305 } from '@noble/ciphers/chacha';
import { hex, utf8Hash } from './crypto';
import { nativeEntropy } from './wallet-adapter';
import { SessionState } from './session';
const busy = new Set<string>();
export class SessionVault {
  private readonly service: string;
  constructor(walletId: string, poolId: string) {
    if (!walletId || !/^[0-9a-f]{16,64}$/.test(poolId)) throw new Error('Invalid session vault identity');
    this.service = 'redwallet.kilojoin.v1.' + utf8Hash(JSON.stringify([walletId, poolId])).toString('hex');
  }

  private async exclusive<T>(action: () => Promise<T>): Promise<T> {
    if (busy.has(this.service)) throw new Error('Session vault operation pending');
    busy.add(this.service);
    try {
      return await action();
    } finally {
      busy.delete(this.service);
    }
  }

  private async key(create: boolean): Promise<Buffer> {
    const found = await Keychain.getGenericPassword({ service: this.service });
    if (found) return hex(found.password, 32);
    if (!create || (await AsyncStorage.getItem(this.service))) throw new Error('Session encryption key missing');
    const key = Buffer.from(nativeEntropy(32));
    const level = await Keychain.getSecurityLevel();
    const options: Parameters<typeof Keychain.setGenericPassword>[2] = {
      service: this.service,
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      ...(level === Keychain.SECURITY_LEVEL.SECURE_HARDWARE ? { securityLevel: level } : {}),
    };
    if (!(await Keychain.setGenericPassword(this.service, key.toString('hex'), options))) {
      key.fill(0);
      throw new Error('Unable to persist session encryption key');
    }
    return key;
  }

  async save(state: SessionState): Promise<void> {
    return this.exclusive(async () => {
      const plaintext = Buffer.from(JSON.stringify(state));
      if (plaintext.length > 262144) throw new Error('Session exceeds storage limit');
      const key = await this.key(true);
      try {
        const nonce = nativeEntropy(24),
          ciphertext = xchacha20poly1305(key, nonce, Buffer.from(this.service)).encrypt(plaintext);
        await AsyncStorage.setItem(
          this.service,
          JSON.stringify({ v: 1, nonce: Buffer.from(nonce).toString('hex'), ciphertext: Buffer.from(ciphertext).toString('hex') }),
        );
      } finally {
        key.fill(0);
        plaintext.fill(0);
      }
    });
  }

  // Returns untrusted decoded data for a recovery validator, never automatic signing resumption.
  async load(): Promise<unknown | null> {
    return this.exclusive(async () => {
      const encoded = await AsyncStorage.getItem(this.service);
      if (encoded === null) return null;
      if (encoded.length > 525000) throw new Error('Invalid session envelope');
      const envelope = JSON.parse(encoded);
      if (envelope?.v !== 1) throw new Error('Unsupported session envelope');
      const nonce = hex(envelope.nonce, 24),
        ciphertext = hex(envelope.ciphertext),
        key = await this.key(false);
      try {
        const plaintext = xchacha20poly1305(key, nonce, Buffer.from(this.service)).decrypt(ciphertext);
        try {
          return JSON.parse(Buffer.from(plaintext).toString('utf8'));
        } finally {
          plaintext.fill(0);
        }
      } finally {
        key.fill(0);
      }
    });
  }
}
