import { dismissSendSuccess } from '../../helpers/dismiss-send-success';

function navigator(names: string[]) {
  const parent = { goBack: jest.fn() };
  const routes = names.map((name, index) => ({ name, key: name + index, params: { walletID: 'selected-wallet' } }));
  return {
    getState: () => ({ key: 'wallet-stack', index: routes.length - 1, routes }),
    dispatch: jest.fn(),
    getParent: () => parent,
    parent,
  };
}

it.each(['RBFBumpFee', 'CPFP', 'RBFCancel'])('Done leaves %s and its old transaction without reopening a fee form', feeScreen => {
  const nav = navigator(['WalletsList', 'WalletTransactions', 'TransactionStatus', feeScreen, 'Success']);
  dismissSendSuccess(nav as any);
  expect(nav.dispatch).toHaveBeenCalledWith({ type: 'POP', payload: { count: 3 }, target: 'wallet-stack' });
  expect(nav.parent.goBack).not.toHaveBeenCalled();
  // Applying that pop preserves the actual wallet route and its existing params.
  expect(nav.getState().routes.slice(0, -3).at(-1)).toMatchObject({
    name: 'WalletTransactions',
    params: { walletID: 'selected-wallet' },
  });
});

it('Done on an ordinary send closes the modal instead of returning to Confirm', () => {
  const nav = navigator(['SendDetails', 'Confirm', 'Success']);
  dismissSendSuccess(nav as any);
  expect(nav.parent.goBack).toHaveBeenCalledTimes(1);
  expect(nav.dispatch).not.toHaveBeenCalled();
});

it('returns to the wallet list if there is no transaction-list route', () => {
  const nav = navigator(['WalletsList', 'Broadcast', 'Success']);
  dismissSendSuccess(nav as any);
  expect(nav.dispatch).toHaveBeenCalledWith({ type: 'POP', payload: { count: 2 }, target: 'wallet-stack' });
});
