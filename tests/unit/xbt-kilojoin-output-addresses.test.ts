import { reserveOutputAddresses } from '../../class/xbt/kilojoin/output-addresses';
test('advances and durably saves all indices before checking or disclosing fresh addresses', async () => {
  const wallet = { next_free_address_index: 7, _getExternalAddressByIndex: (i: number) => `address-${i}` };
  const order: string[] = [];
  const result = await reserveOutputAddresses(
    wallet,
    5,
    async addresses => {
      expect(wallet.next_free_address_index).toBe(12);
      expect(order).toEqual(['saved']);
      return Object.fromEntries(addresses.map(a => [a, []]));
    },
    async () => {
      order.push('saved');
    },
  );
  expect(result).toEqual(['address-7', 'address-8', 'address-9', 'address-10', 'address-11']);
});
test('uncertain persistence fails closed without reusing indices or querying addresses', async () => {
  const wallet = { next_free_address_index: 0, _getExternalAddressByIndex: (i: number) => `address-${i}` };
  const history = jest.fn();
  await expect(
    reserveOutputAddresses(wallet, 2, history, async () => {
      throw new Error('disk');
    }),
  ).rejects.toThrow('disk');
  expect(wallet.next_free_address_index).toBe(2);
  expect(history).not.toHaveBeenCalled();
});
test.each<Record<string, unknown[]>>([{}, { 'address-0': [{}] }])('refuses used or missing history', async history => {
  const wallet = { next_free_address_index: 0, _getExternalAddressByIndex: (i: number) => `address-${i}` };
  await expect(
    reserveOutputAddresses(
      wallet,
      1,
      async () => history,
      async () => {},
    ),
  ).rejects.toThrow('used or unverified');
});
