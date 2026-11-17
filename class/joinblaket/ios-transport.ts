// Native Tor-only adapter. Merely importing this file opens no connection.
// The native destination is also pinned; it cannot proxy arbitrary hosts.
import { NativeModules, Platform } from 'react-native';
import { randomBytes } from '../rng';
import { DirectoryClient, DIRECTORY_HOST, DIRECTORY_PORT } from './directory';
import type { DirectoryTransport } from './directory';
import type { NickIdentity } from './nick';

export const IOS_DIRECTORY_HOST = DIRECTORY_HOST;
export const IOS_DIRECTORY_PORT = DIRECTORY_PORT;
const MAX_LINE = 65_536;
const OPEN_TIMEOUT = 120_000;

export interface DirectoryNativeBridge {
  joinblaket(action: 'open' | 'read' | 'write' | 'close', id: string, value: string): Promise<unknown>;
}
export interface IosDirectoryLineStream {
  readLine(): Promise<string | null>;
  /** One line without LF, with its CR already supplied by DirectoryClient. */
  writeLine(line: string): Promise<void>;
  close(): void;
}

function failure(): Error {
  return new Error('JoinBlaket Tor connection unavailable');
}

/** Tor provenance is established by the pinned native SOCKS implementation, not this boolean alone. */
export function createIosDirectoryTransport(
  bridge: DirectoryNativeBridge | undefined = NativeModules.XBTLightningBridge,
  platform: string = Platform.OS,
): DirectoryTransport {
  return {
    viaTor: true,
    async open(host, port, signal) {
      if (
        platform !== 'ios' ||
        !bridge ||
        typeof bridge.joinblaket !== 'function' ||
        host !== IOS_DIRECTORY_HOST ||
        port !== IOS_DIRECTORY_PORT ||
        !signal ||
        signal.aborted
      )
        throw failure();
      let id: string | undefined;
      let started = false,
        closed = false,
        reading = false,
        writing = false;
      // Each completed operation removes its abort handler. A shared never-settling
      // Promise.race signal would retain one reaction for every received frame.
      const waiters = new Set<() => void>();
      const cancellable = <T>(operation: Promise<T>): Promise<T> =>
        new Promise((resolve, reject) => {
          let settled = false;
          const finish = (error: unknown, value?: T) => {
            if (settled) return;
            settled = true;
            waiters.delete(abort);
            if (error !== undefined) reject(error);
            else resolve(value as T);
          };
          const abort = () => finish(failure());
          waiters.add(abort);
          operation.then(
            value => finish(undefined, value),
            error => finish(error ?? failure()),
          );
          if (closed) abort();
        });
      const nativeClose = () => {
        if (!started || !id) return;
        try {
          Promise.resolve(bridge.joinblaket('close', id, '')).catch(() => {});
        } catch {}
      };
      const close = () => {
        if (closed) return;
        closed = true;
        signal.removeEventListener('abort', close);
        for (const abort of [...waiters]) abort();
        nativeClose();
      };
      signal.addEventListener('abort', close, { once: true });
      // Account for adapters whose abort event arrives between the earlier check and listener installation.
      if (signal.aborted) close();
      if (closed) throw failure();
      const timer = setTimeout(close, OPEN_TIMEOUT);
      try {
        const entropy = await cancellable(randomBytes(16));
        if (closed || !(entropy instanceof Uint8Array) || entropy.length !== 16) throw failure();
        id = Buffer.from(entropy).toString('hex');
        started = true;
        const opening = Promise.resolve(bridge.joinblaket('open', id, ''));
        // Even a native implementation that finishes opening after cancellation is explicitly closed.
        opening.then(
          () => {
            if (closed) nativeClose();
          },
          () => {},
        );
        await cancellable(opening);
        if (closed) throw failure();
      } catch {
        close();
        throw failure();
      } finally {
        clearTimeout(timer);
      }

      const call = async (action: 'read' | 'write', value: string): Promise<unknown> => {
        if (closed || !id) throw failure();
        try {
          const result = await cancellable(bridge.joinblaket(action, id, value));
          if (closed) throw failure();
          return result;
        } catch {
          close();
          throw failure();
        }
      };
      return {
        close,
        async readLine() {
          if (reading) throw new Error('Directory read already pending');
          reading = true;
          try {
            const line = await call('read', '');
            if (line === null) {
              close();
              return null;
            }
            if (typeof line !== 'string' || line.includes('\n') || Buffer.byteLength(line, 'utf8') + 1 > MAX_LINE) {
              close();
              throw failure();
            }
            return line;
          } finally {
            reading = false;
          }
        },
        async writeLine(line) {
          if (writing) throw new Error('Directory write already pending');
          if (
            typeof line !== 'string' ||
            !line.endsWith('\r') ||
            /[\r\n]/.test(line.slice(0, -1)) ||
            Buffer.byteLength(line, 'utf8') + 1 > MAX_LINE
          )
            throw new Error('Invalid directory line');
          writing = true;
          try {
            await call('write', line);
          } finally {
            writing = false;
          }
        },
      };
    },
  };
}

/** Dormant factory: the caller explicitly connects and owns the ephemeral identity. */
export function createIosDirectoryClient(identity: NickIdentity): DirectoryClient {
  return new DirectoryClient({ identity, transport: createIosDirectoryTransport() });
}
