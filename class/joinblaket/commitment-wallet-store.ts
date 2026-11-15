import { CommitmentPersistence } from './commitments';
import { persistReservationChange, ReservationWallet, reservedCoins } from '../xbt/kilojoin/wallet-store';

export type CommitmentWallet = ReservationWallet & { _joinblaketCommitments?: string };
// The whole serialized wallet carries this metadata through existing secure
// storage. A mnemonic alone does not carry commitment history. Backup imports
// must merge through CommitmentStore.mergeBackup rather than replace history.
export class WalletCommitmentPersistence implements CommitmentPersistence {
  private readonly walletId: string;
  private loaded = false;
  private expected: string | undefined;
  constructor(
    private readonly wallet: CommitmentWallet,
    private readonly saveDurably: () => Promise<void>,
    private readonly assertActive: () => void,
  ) {
    this.walletId = wallet.getID();
    if (!this.walletId) throw new Error('Missing wallet identity');
  }

  private assertCurrent(): void {
    this.assertActive();
    if (this.wallet.getID() !== this.walletId) throw new Error('Commitment wallet identity changed');
  }

  async load(): Promise<string | null> {
    this.assertCurrent();
    reservedCoins(this.wallet);
    const value = this.wallet._joinblaketCommitments;
    if (value !== undefined && typeof value !== 'string') throw new Error('Invalid wallet commitment metadata');
    this.expected = value;
    this.loaded = true;
    return value ?? null;
  }

  async save(text: string): Promise<void> {
    this.assertCurrent();
    if (!this.loaded || this.wallet._joinblaketCommitments !== this.expected)
      throw new Error('Commitment history changed; reload required');
    const before = this.expected;
    await persistReservationChange(
      this.wallet,
      () => {
        this.wallet._joinblaketCommitments = text;
      },
      () => {
        this.wallet._joinblaketCommitments = before;
      },
      async () => {
        this.assertCurrent();
        await this.saveDurably();
        this.assertCurrent();
      },
    );
    this.expected = text;
  }
}
