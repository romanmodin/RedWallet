/** Persist derivation advancement before any address is disclosed to a pool. */
export async function reserveOutputAddresses(
  wallet: { next_free_address_index: number; _getExternalAddressByIndex(index: number): string },
  count: number,
  history: (addresses: string[]) => Promise<Record<string, unknown[]>>,
  persist: () => Promise<void>,
): Promise<string[]> {
  if (!Number.isSafeInteger(count) || count < 1 || count > 5) throw new Error('Invalid mixed output count');
  const start = wallet.next_free_address_index;
  if (!Number.isSafeInteger(start) || start < 0 || start + count >= 0x80000000) throw new Error('Invalid address index');
  const addresses = Array.from({ length: count }, (_, i) => wallet._getExternalAddressByIndex(start + i));
  if (new Set(addresses).size !== count) throw new Error('Duplicate mixed address');
  wallet.next_free_address_index = start + count;
  // Do not roll back on an uncertain write: these indices must not be reused in this session.
  await persist();
  const result = await history(addresses);
  if (addresses.some(a => !Array.isArray(result[a]) || result[a].length !== 0)) throw new Error('Mixed address is used or unverified');
  return addresses;
}
