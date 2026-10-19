import React from 'react';
import { Alert } from 'react-native';
import { act, cleanup, fireEvent, render } from '@testing-library/react-native';
import CoinjoinLive from '../../screen/settings/CoinjoinLive';
import { XbtSegwitBech32Wallet } from '../../class/wallets/xbt-segwit-bech32-wallet';
const mockWallet = new XbtSegwitBech32Wallet();
mockWallet.setLabel('Test wallet');
const mockTerms = { id: 'ab'.repeat(8), denomination: 10000, fee_rate: 2, peers: 2, max_peers: 5, max_inputs: 10, script: 'p2wpkh' };
const mockView = {
  session: { phase: 'review', seats: [], signatures: {} },
  journal: { phase: 'review', myFee: 271, commitment: 'approved-commitment', reviewedId: '11'.repeat(32) },
};
const mockApprove = jest.fn(async () => {}),
  mockClose = jest.fn(async () => {});
const mockJoin = jest.fn(async (config: { onUpdate: (view: unknown) => void }) => {
  config.onUpdate(mockView);
  return { view: () => mockView, approve: mockApprove, close: mockClose };
});
jest.mock('../../class/xbt/kilojoin/client', () => ({
  recoverWalletRounds: async () => [],
  confirmRecoveredRound: async () => false,
  MixingClient: { join: (config: { onUpdate: (view: unknown) => void }) => mockJoin(config) },
}));
jest.mock('../../class/xbt/kilojoin/protocol', () => ({ LIVE_JOIN_ENABLED: true, parsePool: () => mockTerms }));
jest.mock('../../class/xbt/kilojoin/relay', () => ({
  KilojoinRelay: class {
    private readonly receive: (event: unknown) => Promise<void>;
    constructor(receive: (event: unknown) => Promise<void>) {
      this.receive = receive;
    }

    async connect() {}
    discoverPools() {
      return this.receive({ created_at: 1 });
    }

    close() {}
  },
}));
jest.mock('../../hooks/context/useStorage', () => ({ useStorage: () => ({ wallets: [mockWallet] }) }));
jest.mock('../../components/themes', () => {
  const actual = jest.requireActual('../../components/themes');
  return { ...actual, useTheme: () => actual.BlueDefaultTheme };
});
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }));
afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});
test('live controls select coins but require an explicit confirmation before signing', async () => {
  jest.spyOn(mockWallet, 'fetchUtxo').mockResolvedValue(undefined);
  jest.spyOn(mockWallet, 'getUtxo').mockReturnValue([{ txid: '11'.repeat(32), vout: 0, value: 50000 } as never]);
  const prompt = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const screen = render(<CoinjoinLive experimentalAcknowledged />);
  await act(async () => {
    fireEvent.press(screen.getByText('○ Test wallet'));
  });
  await act(async () => {
    fireEvent.press(screen.getByText('Find pools'));
  });
  fireEvent.press(screen.getByText('○ 10,000 sats · 2/5 · 2 sats/vB'));
  fireEvent.press(screen.getByText('○ 50,000 sats · 11111111…:0'));
  await act(async () => {
    fireEvent.press(screen.getByText('Join pool and reserve coins'));
  });
  expect(mockJoin).toHaveBeenCalledWith(
    expect.objectContaining({ selected: ['11'.repeat(32) + ':0'], maxFee: 1000, experimentalAcknowledged: true }),
  );
  fireEvent.press(screen.getByText('Review and sign'));
  expect(mockApprove).not.toHaveBeenCalled();
  const buttons = prompt.mock.calls[0][2]!;
  await act(async () => {
    buttons.find(b => b.text === 'Sign transaction')!.onPress!();
  });
  expect(mockApprove).toHaveBeenCalledWith('approved-commitment');
});
