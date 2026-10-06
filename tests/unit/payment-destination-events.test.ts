import { updatePaymentDestination } from '../../util/updatePaymentDestination';

test('a delayed amount event preserves an address entered after the callback was created', () => {
  const initial = [{ key: 'recipient-a', address: '', amount: '', amountSats: 0 }];
  const renderedRecipient = initial[0];
  const onAmountChange = (current: typeof initial) =>
    updatePaymentDestination(current, renderedRecipient.key, destination => ({
      ...destination,
      amount: '0.0009',
      amountSats: 90_000,
    }));
  const afterAddressEntry = updatePaymentDestination(initial, renderedRecipient.key, destination => ({
    ...destination,
    address: 'new-recipient',
  }));
  const afterAmountEntry = onAmountChange(afterAddressEntry);
  expect(afterAmountEntry[0]).toEqual({
    key: 'recipient-a',
    address: 'new-recipient',
    amount: '0.0009',
    amountSats: 90_000,
  });
  expect(initial[0].address).toBe('');
  expect(afterAddressEntry[0].amount).toBe('');
});

test('a delayed event cannot update a different recipient after deletion or reordering', () => {
  const recipients = [
    { key: 'recipient-b', address: 'second', amount: '' },
    { key: 'recipient-a', address: 'first', amount: '' },
  ];
  const updated = updatePaymentDestination(recipients, 'recipient-a', destination => ({ ...destination, amount: '1' }));
  expect(updated[0]).toBe(recipients[0]);
  expect(updated[1].address).toBe('first');
  expect(updated[1].amount).toBe('1');
  const afterDeletion = [recipients[0]];
  expect(
    updatePaymentDestination(afterDeletion, 'recipient-a', () => {
      throw new Error('must not run');
    }),
  ).toBe(afterDeletion);
});
