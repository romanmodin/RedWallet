/** Same-origin worker keeps arbitrary WSS out of the key-bearing document's CSP. */
import {
  DIRECT_METHODS,
  type DirectMethod,
  directConnection,
} from "./directFulcrum";
import { validateWebsocketProvider } from "./websocketConfig";
export async function loadWebsocketConnection(value: string) {
  const { endpoint } = validateWebsocketProvider({ endpoint: value });
  const worker = new Worker(new URL("./fulcrum.worker.ts", import.meta.url), {
    type: "module",
  });
  let nextId = 0;
  let stopped = false;
  const pending = new Map<
    number,
    {
      resolve(value: unknown): void;
      reject(error: Error): void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  const close = () => {
    if (stopped) return;
    stopped = true;
    worker.terminate();
    for (const item of pending.values()) {
      clearTimeout(item.timer);
      item.reject(
        Error("Direct connection closed; no shared relay fallback was used."),
      );
    }
    pending.clear();
  };
  worker.onmessage = (event) => {
    const item = pending.get(event.data?.id);
    if (!item) return;
    pending.delete(event.data.id);
    clearTimeout(item.timer);
    if (typeof event.data.error === "string")
      item.reject(Error(event.data.error));
    else item.resolve(event.data.result);
  };
  worker.onerror = close;
  const call = (method: DirectMethod, args: unknown[]) => {
    if (stopped || !DIRECT_METHODS.includes(method) || pending.size >= 16)
      return Promise.reject(Error("Direct connection unavailable or busy."));
    const id = ++nextId;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(
          Error(
            "Direct connection timed out; any submission outcome remains unknown.",
          ),
        );
        close();
      }, 35000);
      pending.set(id, { resolve, reject, timer });
      try {
        worker.postMessage({ id, endpoint, method, args });
      } catch {
        close();
      }
    });
  };
  return directConnection(endpoint, call, close);
}
