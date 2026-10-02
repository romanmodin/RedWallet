import Bugsnag from '@bugsnag/react-native';
import analytics from '../../blue_modules/analytics';
import '../../bugsnag';

jest.unmock('../../blue_modules/analytics');
jest.mock('@bugsnag/react-native', () => ({
  start: jest.fn(),
  notify: jest.fn(),
  setUser: jest.fn(),
  addOnError: jest.fn(),
}));

it('never initializes or transmits crash reports, including when opt-out is changed', async () => {
  const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    analytics.setOptOut(false);
    await analytics('wallet-opened');
    analytics.logError('test diagnostic');
    analytics.setOptOut(true);
    expect(consoleSpy).toHaveBeenCalledWith('test diagnostic');
    expect(Bugsnag.start).not.toHaveBeenCalled();
    expect(Bugsnag.notify).not.toHaveBeenCalled();
    expect(Bugsnag.setUser).not.toHaveBeenCalled();
    expect(Bugsnag.addOnError).not.toHaveBeenCalled();
  } finally {
    consoleSpy.mockRestore();
  }
});
