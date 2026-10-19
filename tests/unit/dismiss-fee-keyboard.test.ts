import { dismissFeeKeyboard } from '../native/dismiss-fee-keyboard';

const timeout = () => new Error('Test Failed: Timed out while waiting for expectation: NOT TOBEVISIBLE WITH MATCHER(UIKeyboardLayoutStar)');
const makeDriver = () => ({
  tapDone: jest.fn().mockResolvedValue(undefined),
  assertKeyboardVisible: jest.fn().mockResolvedValue(undefined),
  waitClosed: jest.fn().mockResolvedValue(undefined),
  now: () => 0,
});

describe('fee keyboard dismissal before transaction preparation', () => {
  it('does not tap again after verified dismissal', async () => {
    const driver = makeDriver();
    await dismissFeeKeyboard(driver);
    expect(driver.tapDone).toHaveBeenCalledTimes(1);
    expect(driver.assertKeyboardVisible).not.toHaveBeenCalled();
  });

  it('allows one additional dismissal only after observing the still-visible keyboard', async () => {
    const driver = makeDriver();
    let time = 0;
    driver.now = () => time;
    driver.waitClosed.mockImplementationOnce(async () => {
      time = 3_000;
      throw timeout();
    });
    await dismissFeeKeyboard(driver);
    expect(driver.tapDone).toHaveBeenCalledTimes(2);
    expect(driver.assertKeyboardVisible.mock.invocationCallOrder[0]).toBeLessThan(driver.tapDone.mock.invocationCallOrder[1]);
    expect(driver.waitClosed.mock.calls).toEqual([[3_000], [7_000]]);
  });

  it('fails if both dismissals leave the keyboard open', async () => {
    const driver = makeDriver();
    driver.waitClosed.mockRejectedValue(timeout());
    await expect(dismissFeeKeyboard(driver)).rejects.toThrow('NOT TOBEVISIBLE');
    expect(driver.tapDone).toHaveBeenCalledTimes(2);
  });

  it('does not retry an uncertain tap', async () => {
    const driver = makeDriver();
    driver.tapDone.mockRejectedValue(new Error('transport lost'));
    await expect(dismissFeeKeyboard(driver)).rejects.toThrow('transport lost');
    expect(driver.tapDone).toHaveBeenCalledTimes(1);
    expect(driver.waitClosed).not.toHaveBeenCalled();
  });

  it('does not retry an unresolved observation', async () => {
    const driver = makeDriver();
    driver.waitClosed.mockRejectedValue(new Error('native observation did not respond'));
    await expect(dismissFeeKeyboard(driver)).rejects.toThrow('did not respond');
    expect(driver.tapDone).toHaveBeenCalledTimes(1);
  });

  it('does not retry when the keyboard cannot be positively observed', async () => {
    const driver = makeDriver();
    driver.waitClosed.mockRejectedValueOnce(timeout());
    driver.assertKeyboardVisible.mockRejectedValue(new Error('keyboard not visible'));
    await expect(dismissFeeKeyboard(driver)).rejects.toThrow('keyboard not visible');
    expect(driver.tapDone).toHaveBeenCalledTimes(1);
  });

  it('does not extend the deadline to perform another tap', async () => {
    const driver = makeDriver();
    let time = 0;
    driver.now = () => time;
    driver.waitClosed.mockImplementationOnce(async () => {
      time = 10_000;
      throw timeout();
    });
    await expect(dismissFeeKeyboard(driver)).rejects.toThrow('original 10-second deadline');
    expect(driver.tapDone).toHaveBeenCalledTimes(1);
  });
});
