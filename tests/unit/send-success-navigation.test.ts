import { StackRouter } from '@react-navigation/routers';
import { sendSuccessReturnAction } from '../../navigation/sendSuccess';

function stack(names: string[]) {
  return {
    stale: false as const,
    type: 'stack' as const,
    key: 'wallet-stack',
    preloadedRoutes: [],
    index: names.length - 1,
    routeNames: [...new Set(names)],
    routes: names.map((name, index) => ({
      name,
      key: name + '-' + index,
      params: { walletID: 'wallet-' + index },
    })),
  };
}

it.each(['RBFBumpFee', 'CPFP', 'RBFCancel'])('Done returns from %s to the existing wallet route', screen => {
  const state = stack(['WalletsList', 'WalletTransactions', 'TransactionStatus', screen, 'Success']);
  const action = sendSuccessReturnAction(state)!;
  expect(action.target).toBe(state.key);
  expect(action.source).toBe(state.routes[4].key);
  const next = StackRouter({}).getStateForAction(state, action, {
    routeNames: state.routeNames,
    routeParamList: {},
    routeGetIdList: {},
  });
  expect(next?.routes).toEqual(state.routes.slice(0, 2));
  expect(next?.index).toBe(1);
});

it('returns to the nearest existing wallet without replacing its params', () => {
  const state = stack(['WalletTransactions', 'WalletTransactions', 'CPFP', 'Success']);
  expect(sendSuccessReturnAction(state)?.payload.count).toBe(2);
});

it('leaves ordinary send modal dismissal to its parent', () => {
  expect(sendSuccessReturnAction(stack(['SendDetails', 'Confirm', 'Success']))).toBeUndefined();
});

it('does not target a wallet route ahead of the current screen', () => {
  const state = stack(['Success', 'WalletTransactions']);
  state.index = 0;
  expect(sendSuccessReturnAction(state)).toBeUndefined();
});
