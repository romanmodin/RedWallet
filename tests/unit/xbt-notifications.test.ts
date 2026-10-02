import AsyncStorage from '@react-native-async-storage/async-storage';
import { Notifications } from 'react-native-notifications';
import { checkNotifications, requestNotifications, RESULTS } from 'react-native-permissions';
import { XBT_PROFILE } from '../../class/xbt/profile';
import { fetch } from '../../util/fetch';
import {
  addNotification,
  checkNotificationPermissionStatus,
  checkPermissions,
  cleanUserOptOutFlag,
  enqueueTestPushNotification,
  getDeliveredNotifications,
  getPushToken,
  getStoredNotifications,
  initializeNotifications,
  isNotificationsCapable,
  isNotificationsEnabled,
  isNotificationsRedacted,
  majorTomToGroundControl,
  registerArkPaymentPush,
  setLevels,
  setRedactNotifications,
  tryToObtainPermissions,
  unsubscribe,
} from '../../blue_modules/notifications';

jest.mock('../../class/xbt/profile', () => ({ XBT_PROFILE: { notificationsEnabled: false } }));
jest.mock('../../loc', () => ({ __esModule: true, default: {} }));
jest.mock('../../util/fetch', () => ({ fetch: jest.fn() }));
jest.mock('react-native-notifications', () => {
  const events = {
    registerRemoteNotificationsRegistered: jest.fn(() => ({ remove: jest.fn() })),
    registerRemoteNotificationsRegistrationFailed: jest.fn(() => ({ remove: jest.fn() })),
    registerRemoteNotificationsRegistrationDenied: jest.fn(() => ({ remove: jest.fn() })),
    registerNotificationReceivedForeground: jest.fn(() => ({ remove: jest.fn() })),
    registerNotificationReceivedBackground: jest.fn(() => ({ remove: jest.fn() })),
    registerNotificationOpened: jest.fn(() => ({ remove: jest.fn() })),
  };
  return {
    NotificationBackgroundFetchResult: { NO_DATA: 'NO_DATA' },
    Notifications: {
      events: jest.fn(() => events),
      registerRemoteNotifications: jest.fn(),
      getInitialNotification: jest.fn().mockResolvedValue(undefined),
      setNotificationChannel: jest.fn(),
      ios: {
        checkPermissions: jest.fn(),
        setBadgeCount: jest.fn(),
        getDeliveredNotifications: jest.fn(),
      },
    },
  };
});

const mutableProfile = XBT_PROFILE as { notificationsEnabled: boolean };
const address = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu'; // Public BIP84 vector, never a live wallet.
const txid = '01'.repeat(32);

describe('XBT notification service isolation', () => {
  beforeEach(async () => {
    mutableProfile.notificationsEnabled = false;
    await AsyncStorage.setItem('PUSH_TOKEN', JSON.stringify({ token: 'stale-test-token', os: 'ios' }));
    await AsyncStorage.removeItem('NOTIFICATIONS_NO_AND_DONT_ASK_FLAG');
    await AsyncStorage.setItem('NOTIFICATIONS_STORAGE', JSON.stringify([{ address, txid, type: 1 }]));
    jest.clearAllMocks();
  });

  afterEach(() => {
    mutableProfile.notificationsEnabled = false;
  });

  it('ignores saved tokens and subscriptions for every GroundControl and Ark service request', async () => {
    expect(jest.requireActual('../../class/xbt/profile').XBT_PROFILE.notificationsEnabled).toBe(false);
    await majorTomToGroundControl([address], ['test-hash'], [txid]);
    await registerArkPaymentPush('test-hash', 'Test', {} as Parameters<typeof registerArkPaymentPush>[2]);
    await unsubscribe([address], ['test-hash'], [txid]);
    await setLevels(true);
    await setLevels(false);
    await setRedactNotifications(true);
    await enqueueTestPushNotification();

    expect(await isNotificationsEnabled()).toBe(false);
    expect(await isNotificationsRedacted()).toBe(false);
    expect(await getPushToken()).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not prompt, check permissions, register push callbacks, or process stale notifications', async () => {
    const processNotifications = jest.fn();
    await initializeNotifications(processNotifications);
    await cleanUserOptOutFlag();
    expect(await tryToObtainPermissions()).toBe(false);
    expect(await checkNotificationPermissionStatus()).toBe(RESULTS.UNAVAILABLE);
    expect(await checkPermissions()).toEqual({ alert: false, badge: false, sound: false, status: RESULTS.UNAVAILABLE });
    expect(await getStoredNotifications()).toEqual([]);
    expect(await getDeliveredNotifications()).toEqual([]);
    await addNotification({ address, txid, type: 1 } as Parameters<typeof addNotification>[0]);

    expect(isNotificationsCapable).toBe(false);
    expect(processNotifications).not.toHaveBeenCalled();
    expect(checkNotifications).not.toHaveBeenCalled();
    expect(requestNotifications).not.toHaveBeenCalled();
    expect(Notifications.ios.checkPermissions).not.toHaveBeenCalled();
    expect(Notifications.ios.getDeliveredNotifications).not.toHaveBeenCalled();
    expect(Notifications.registerRemoteNotifications).not.toHaveBeenCalled();
    expect(Notifications.events).not.toHaveBeenCalled();
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  });

  it('ignores an already registered token callback after notification support is disabled', async () => {
    // Simulate an old enabled runtime delivering its callback after the profile gate closes.
    mutableProfile.notificationsEnabled = true;
    (checkNotifications as jest.Mock).mockResolvedValue({ status: RESULTS.GRANTED, settings: {} });
    const initialization = initializeNotifications();
    for (let n = 0; n < 20 && !(Notifications.registerRemoteNotifications as jest.Mock).mock.calls.length; n++) {
      await Promise.resolve();
    }
    expect(Notifications.registerRemoteNotifications).toHaveBeenCalledTimes(1);
    const callback = (Notifications.events().registerRemoteNotificationsRegistered as jest.Mock).mock.calls[0][0];
    mutableProfile.notificationsEnabled = false;
    jest.clearAllMocks();

    await callback({ deviceToken: 'late-test-token' });
    await initialization;
    expect(fetch).not.toHaveBeenCalled();
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
    expect(checkNotifications).not.toHaveBeenCalled();
    expect(requestNotifications).not.toHaveBeenCalled();
    expect(await getPushToken()).toBeNull();
  });
});
