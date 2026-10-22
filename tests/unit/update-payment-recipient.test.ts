import { updatePaymentRecipient } from '../../helpers/update-payment-recipient';

it('a delayed amount callback preserves the address entered after its render', () => {
  const rendered = { key: 'first', address: '', amount: '', amountSats: 0, unit: 'XBT' };
  const onAmount = (recipients: (typeof rendered)[]) =>
    updatePaymentRecipient(recipients, rendered.key, current => {
      current.amount = '0.0009';
      current.amountSats = 90000;
    });
  const latest = Object.freeze({ ...rendered, address: 'public-test-recipient' });
  const recipients = [latest];
  const result = onAmount(recipients);
  expect(result[0]).toEqual({ ...latest, amount: '0.0009', amountSats: 90000 });
  expect(recipients[0]).toBe(latest);
  expect(latest.amount).toBe('');
});

it('targets the same recipient after another recipient is removed', () => {
  const recipients = [{ key: 'second', address: 'second-address', amount: '1' }];
  expect(
    updatePaymentRecipient(recipients, 'second', current => {
      current.amount = '2';
    }),
  ).toEqual([{ key: 'second', address: 'second-address', amount: '2' }]);
});

it('ignores a late amount event for a removed recipient without touching its successor', () => {
  const recipients = [{ key: 'second', address: 'second-address', amount: '1' }];
  const update = jest.fn();
  expect(updatePaymentRecipient(recipients, 'first', update)).toBe(recipients);
  expect(update).not.toHaveBeenCalled();
});

it('leaves other recipients and their amounts unchanged', () => {
  const first = { key: 'first', address: 'first-address', amount: '1' };
  const second = { key: 'second', address: 'second-address', amount: '2' };
  const result = updatePaymentRecipient([first, second], 'first', current => {
    current.amount = '3';
  });
  expect(result[1]).toBe(second);
  expect(result[0].address).toBe(first.address);
  expect(first.amount).toBe('1');
});
