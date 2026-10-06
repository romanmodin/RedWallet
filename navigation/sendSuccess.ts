import { NavigationState, StackActions } from '@react-navigation/native';

// Fee bumps share the wallet stack; ordinary sends live in a separate modal.
// Pop to the existing wallet route so its identity and parameters are preserved.
export function sendSuccessReturnAction(state: Pick<NavigationState, 'index' | 'key' | 'routes'>) {
  for (let index = state.index - 1; index >= 0; index--) {
    if (state.routes[index].name === 'WalletTransactions') {
      return {
        ...StackActions.pop(state.index - index),
        target: state.key,
        source: state.routes[state.index].key,
      };
    }
  }
  return undefined;
}
