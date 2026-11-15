// Native Tor-only adapter. Merely importing this file opens no connection.
// The native destination is also pinned; it cannot proxy arbitrary hosts.
import { NativeModules, Platform } from 'react-native';
import { randomBytes } from '../rng';

export const IOS_DIRECTORY_HOST = 'f3tfzgk5ilwfapx427yx5ckeh7ptuvskfxnfnicfo747jyq5mgzdtvad.onion';
export const IOS_DIRECTORY_PORT = 5222;
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
): {
  readonly viaTor: true;
  open(host: string, port: number, signal: AbortSignal): Promise<IosDirectoryLineStream>;
} {
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
      const id = Buffer.from(await randomBytes(16)).toString('hex');
      if (signal.aborted) throw failure();
      let closed = false,
        reading = false,
        writing = false;
      let rejectClosed: (reason: Error) => void = () => {};
      const cancelled = new Promise<never>((_resolve, reject) => {
        rejectClosed = reject;
      });
      // A stream can close while no operation is awaiting this signal.
      cancelled.catch(() => {});
      const nativeClose = () => {
        try {
          Promise.resolve(bridge.joinblaket('close', id, '')).catch(() => {});
        } catch {}
      };
      const close = () => {
        if (closed) return;
        closed = true;
        signal.removeEventListener('abort', close);
        rejectClosed(failure());
        nativeClose();
      };
      signal.addEventListener('abort', close, { once: true });
      // Account for adapters whose abort event arrives between the earlier check and listener installation.
      if (signal.aborted) close();
      if (closed) throw failure();
      const timer = setTimeout(close, OPEN_TIMEOUT);
      try {
        const opening = Promise.resolve(bridge.joinblaket('open', id, ''));
        // Even a native implementation that finishes opening after cancellation is explicitly closed.
        opening.then(
          () => {
            if (closed) nativeClose();
          },
          () => {},
        );
        await Promise.race([opening, cancelled]);
        if (closed) throw failure();
      } catch {
        close();
        throw failure();
      } finally {
        clearTimeout(timer);
      }

      const call = async (action: 'read' | 'write', value: string): Promise<unknown> => {
        if (closed) throw failure();
        try {
          const result = await Promise.race([bridge.joinblaket(action, id, value), cancelled]);
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
