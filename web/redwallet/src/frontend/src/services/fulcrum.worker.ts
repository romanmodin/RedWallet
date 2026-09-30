/** Dedicated public-network worker: no vault, key, DOM, storage or ICP imports. */
import { DirectFulcrum, type DirectMethod } from "./directFulcrum";
const scope = globalThis as unknown as {
  onmessage: (event: MessageEvent) => void;
  postMessage(message: unknown): void;
};
let client: DirectFulcrum | null = null;
scope.onmessage = (event) => {
  const { id, endpoint, method, args } = event.data ?? {};
  if (!Number.isSafeInteger(id) || id < 1) return;
  void (async () => {
    try {
      client ??= new DirectFulcrum(endpoint);
      if (endpoint !== client.endpoint)
        throw Error("Direct connection address changed.");
      const result = await client.call(method as DirectMethod, args);
      scope.postMessage({ id, result });
    } catch (error) {
      scope.postMessage({
        id,
        error:
          error instanceof Error
            ? error.message
            : "Direct Fulcrum unavailable.",
      });
    }
  })();
};
