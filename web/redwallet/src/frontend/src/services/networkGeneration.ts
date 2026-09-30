/** Public provider session generation. No keys, reviews or receipts are stored here. */
export const PROVIDER_EVENT = "redwallet-provider";
let generation = 0;
export function providerGeneration() {
  return generation;
}
export function providerChanged() {
  generation++;
  if (typeof window !== "undefined")
    window.dispatchEvent(new Event(PROVIDER_EVENT));
}
