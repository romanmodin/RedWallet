import { XBT_PROFILE } from '../class/xbt/profile';
const useWidgetCommunication = (): void => {};

export const isBalanceDisplayAllowed = async (): Promise<boolean> => {
  return XBT_PROFILE.companionsEnabled;
};

export const setBalanceDisplayAllowed = async (_allowed: boolean): Promise<void> => {};

export default useWidgetCommunication;
