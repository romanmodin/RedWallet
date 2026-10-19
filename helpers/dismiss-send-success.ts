import { NavigationProp, ParamListBase, StackActions } from '@react-navigation/native';

type SuccessNavigation = Pick<NavigationProp<ParamListBase>, 'getState' | 'dispatch' | 'getParent'>;

/** Leave completed payment/fee-bump screens without returning to their signing forms. */
export function dismissSendSuccess(navigation: SuccessNavigation): void {
  const state = navigation.getState();
  // Fee bumps use Success directly in the wallet stack. Its parent is the
  // drawer, so parent.goBack() cannot close this screen.
  for (let index = state.index - 1; index >= 0; index--) {
    if (state.routes[index].name === 'WalletTransactions' || state.routes[index].name === 'WalletsList') {
      navigation.dispatch({ ...StackActions.pop(state.index - index), target: state.key });
      return;
    }
  }
  // Ordinary sends use a separate modal stack above the existing wallet view.
  navigation.getParent()?.goBack();
}
