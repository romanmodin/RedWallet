import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { preventWalletFocusZoom } from "@/lib/wallet-viewport";
import {
  type PublicXbtAccount,
  generateRecoveryPhrase,
  normalizeMnemonic,
} from "@/lib/xbt/key-material";
import type { SavedVault, VaultCatalog } from "@/lib/xbt/vault-catalog";
/** Local-only vault form; mounted only behind the verified browser protection gate. */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

export interface LocalVaultPanelProps {
  catalog: VaultCatalog;
  cryptoApi?: Crypto;
  onUnlocked?: (id: string, account: PublicXbtAccount) => void;
  onLocked?: () => void;
  onRemoved?: (id: string) => void;
}
type Mode = "idle" | "create" | "backup" | "verify" | "recover" | "unlock";

export function LocalVaultPanel({
  catalog,
  cryptoApi = globalThis.crypto,
  onUnlocked,
  onLocked,
  onRemoved,
}: LocalVaultPanelProps) {
  const [removing, setRemoving] = useState<SavedVault | null>(null);
  const [backupConfirmed, setBackupConfirmed] = useState(false);
  const [removeName, setRemoveName] = useState("");
  const [mode, setMode] = useState<Mode>("idle");
  const [saved, setSaved] = useState<SavedVault[]>([]);
  const [name, setName] = useState("");
  const [phrase, setPhrase] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [positions, setPositions] = useState<number[]>([]);
  const [answers, setAnswers] = useState(["", "", ""]);
  const [acknowledged, setAcknowledged] = useState(false);
  const [selected, setSelected] = useState("");
  const [unlocked, setUnlocked] = useState<{
    id: string;
    account: PublicXbtAccount;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const generation = useRef(0);
  const formState = useRef({ mode, busy });
  formState.current = { mode, busy };
  const unlockPassword = useRef<HTMLInputElement>(null);
  const formDeadline = useRef({ wall: 0, monotonic: 0 });
  const formExpired = useCallback(
    () =>
      Date.now() >= formDeadline.current.wall ||
      performance.now() >= formDeadline.current.monotonic,
    [],
  );
  const callbacks = useRef({ onUnlocked, onLocked });
  callbacks.current = { onUnlocked, onLocked };
  useLayoutEffect(() => {
    if (mode === "unlock") return preventWalletFocusZoom();
  }, [mode]);

  const clearSecrets = useCallback(() => {
    setPhrase("");
    setPassphrase("");
    setPassword("");
    setConfirmation("");
    setAnswers(["", "", ""]);
    setAcknowledged(false);
    setPositions([]);
  }, []);
  const refresh = useCallback(() => {
    try {
      setSaved(catalog.list());
    } catch {
      setError(
        "Browser storage is unavailable. Keep your recovery backup and retry when storage is available.",
      );
    }
  }, [catalog]);
  function cancel() {
    setRemoving(null);
    setBackupConfirmed(false);
    setRemoveName("");
    generation.current++;
    catalog.lockAll();
    setUnlocked(null);
    callbacks.current.onLocked?.();
    clearSecrets();
    setMode("idle");
    setBusy(false);
    setError("");
    refresh();
  }
  useEffect(() => {
    refresh();
    const lock = () => {
      generation.current++;
      catalog.lockAll();
      setUnlocked(null);
      callbacks.current.onLocked?.();
      clearSecrets();
      setMode("idle");
      setBusy(false);
    };
    const background = () => {
      // Keep only an unfinished recovery entry in this resident tab, bounded by
      // the original deadline. Saved-wallet keys and pending operations still lock.
      if (
        formState.current.mode === "recover" &&
        !formState.current.busy &&
        !formExpired()
      ) {
        catalog.lockAll();
        setUnlocked(null);
        callbacks.current.onLocked?.();
        return;
      }
      lock();
    };
    const foreground = () => {
      // Safari may suspend timers in the background. Check both clocks before
      // showing or accepting a retained entry; backgrounding never extends it.
      if (formState.current.mode === "recover" && formExpired()) {
        lock();
        setNotice(
          "Recovery entry expired after five minutes. Secret fields were cleared; start again to continue.",
        );
      }
    };
    const visibility = () => {
      if (document.visibilityState === "visible") foreground();
      else background();
    };
    const storage = (event: StorageEvent) => {
      if (event.key === null || event.key.startsWith("redwallet.vault.v1.")) {
        lock();
        refresh();
      }
    };
    window.addEventListener("pagehide", background);
    window.addEventListener("pageshow", foreground);
    window.addEventListener("storage", storage);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      generation.current++;
      catalog.lockAll();
      callbacks.current.onLocked?.();
      window.removeEventListener("pagehide", background);
      window.removeEventListener("pageshow", foreground);
      window.removeEventListener("storage", storage);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [catalog, clearSecrets, refresh, formExpired]);
  useEffect(() => {
    if (!unlocked) return;
    const timer = setInterval(() => {
      if (catalog.controller(unlocked.id).locked) {
        setUnlocked(null);
        callbacks.current.onLocked?.();
        clearSecrets();
        setNotice("Wallet locked. Unlock again to continue.");
      }
    }, 500);
    return () => clearInterval(timer);
  }, [unlocked, catalog, clearSecrets]);

  useEffect(() => {
    if (mode === "idle") return;
    const timer = setInterval(() => {
      if (!formExpired()) return;
      generation.current++;
      catalog.lockAll();
      setUnlocked(null);
      callbacks.current.onLocked?.();
      clearSecrets();
      setMode("idle");
      setBusy(false);
      setNotice(
        "Setup timed out after five minutes. Secret fields were cleared; start again to continue.",
      );
    }, 250);
    return () => clearInterval(timer);
  }, [mode, catalog, clearSecrets, formExpired]);
  function requireActiveForm() {
    if (formExpired()) {
      cancel();
      throw Error(
        "Setup timed out after five minutes. Secret fields were cleared.",
      );
    }
  }
  function begin(next: "create" | "recover" | "unlock", id = "") {
    cancel();
    formDeadline.current = {
      wall: Date.now() + 300_000,
      monotonic: performance.now() + 300_000,
    };
    setNotice("");
    setName("");
    setSelected(id);
    setMode(next);
  }
  function validatePassword() {
    requireActiveForm();
    if (password.length < 12 || password.length > 1024)
      throw Error("Use a password of 12–1024 characters.");
    if (password !== confirmation) throw Error("Passwords do not match.");
    if (!name.trim() || name.trim().length > 80)
      throw Error("Enter a wallet name of 1–80 characters.");
    if (!cryptoApi?.subtle || !cryptoApi.getRandomValues)
      throw Error("Secure browser cryptography is unavailable.");
  }
  function generate() {
    try {
      validatePassword();
      setPhrase(generateRecoveryPhrase(cryptoApi));
      const chosen = new Set<number>();
      while (chosen.size < 3)
        chosen.add(cryptoApi.getRandomValues(new Uint32Array(1))[0]! % 24);
      setPositions([...chosen].sort((a, b) => a - b));
      setMode("backup");
      setError("");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not create a recovery phrase.",
      );
    }
  }
  async function save() {
    let normalized: string;
    try {
      validatePassword();
      normalized = normalizeMnemonic(phrase);
      if (
        mode === "verify" &&
        positions.some(
          (p, i) =>
            answers[i]?.trim().toLowerCase() !== normalized.split(" ")[p],
        )
      )
        throw Error(
          "Those words do not match your backup. Check them and try again.",
        );
      if (mode === "recover" && !acknowledged)
        throw Error("Confirm that you have your recovery backup.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Check the wallet details.");
      return;
    }
    const operation = ++generation.current;
    setBusy(true);
    setError("");
    const secretPassword = password;
    const secretPassphrase = passphrase;
    clearSecrets();
    try {
      const created = await catalog.create(
        name,
        { mnemonic: normalized, passphrase: secretPassphrase },
        secretPassword,
      );
      if (generation.current !== operation) return;
      setMode("idle");
      refresh();
      setNotice(
        created.labelSaved
          ? "Encrypted wallet saved in this browser. Unlock it to verify its address."
          : "Encrypted wallet saved, but its name could not be saved. It is listed below with a default name.",
      );
    } catch {
      if (generation.current !== operation) return;
      setMode("idle");
      refresh();
      setError(
        "Wallet setup could not finish. Check the saved wallets below before retrying; keep your recovery backup.",
      );
    } finally {
      if (generation.current === operation) {
        clearSecrets();
        setBusy(false);
      }
    }
  }
  async function unlock() {
    try {
      requireActiveForm();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Setup expired.");
      return;
    }
    const operation = ++generation.current;
    const secretPassword = password;
    // Dismiss the Keychain/keyboard focus before disabling the password field.
    unlockPassword.current?.blur();
    setPassword("");
    setBusy(true);
    setError("");
    catalog.lockAll();
    try {
      const account = await catalog.controller(selected).unlock(secretPassword);
      if (generation.current !== operation) {
        catalog.lockAll();
        return;
      }
      if (formExpired()) {
        catalog.lockAll();
        clearSecrets();
        setMode("idle");
        setNotice("Unlock expired; try again.");
        return;
      }
      setUnlocked({ id: selected, account });
      setMode("idle");
      callbacks.current.onUnlocked?.(selected, account);
    } catch {
      if (generation.current === operation)
        setError("Could not unlock: incorrect password or damaged vault.");
    } finally {
      if (generation.current === operation) setBusy(false);
    }
  }
  const entryFields = (
    <>
      <Label htmlFor="local-vault-name">Wallet name</Label>
      <Input
        id="local-vault-name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={80}
        autoComplete="off"
      />
      <Label htmlFor="local-vault-password">Browser wallet password</Label>
      <Input
        id="local-vault-password"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete="new-password"
        maxLength={1024}
      />
      <Label htmlFor="local-vault-confirm">Confirm password</Label>
      <Input
        id="local-vault-confirm"
        type="password"
        value={confirmation}
        onChange={(e) => setConfirmation(e.target.value)}
        autoComplete="new-password"
        maxLength={1024}
      />
      <p className="text-xs text-muted-foreground">
        Use at least 12 characters. This password encrypts the wallet in this
        browser; it does not replace your recovery phrase.
      </p>
    </>
  );
  return (
    <section
      id="local-wallet-unlock"
      tabIndex={-1}
      aria-label="Encrypted XBT wallets"
      className="space-y-4 rounded-2xl border border-border bg-card p-5"
    >
      <h2 className="font-display text-lg font-semibold">
        Encrypted XBT wallets
      </h2>
      <p className="text-sm text-muted-foreground">
        Keys stay in this browser, encrypted when saved. Keep your recovery
        phrase offline; clearing browser storage removes the saved wallet.
      </p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {notice && <output className="block text-sm">{notice}</output>}
      {mode === "idle" && (
        <>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => begin("create")}>
              Create encrypted wallet
            </Button>
            <Button variant="outline" onClick={() => begin("recover")}>
              Recover wallet
            </Button>
          </div>
          <ul className="space-y-2">
            {saved.map((vault) => (
              <li
                key={vault.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border p-3"
              >
                <span className="min-w-0 flex-1 break-words">
                  {vault.name}
                  <span className="block text-xs text-muted-foreground">
                    {vault.damaged
                      ? "Damaged saved record — recovery backup needed"
                      : unlocked?.id === vault.id
                        ? "Unlocked"
                        : "Locked"}
                  </span>
                </span>
                <div className="flex shrink-0 flex-wrap gap-2">
                  {unlocked?.id === vault.id ? (
                    <Button variant="outline" onClick={cancel}>
                      Lock wallet
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      disabled={vault.damaged}
                      onClick={() => begin("unlock", vault.id)}
                    >
                      Unlock
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    onClick={() => {
                      cancel();
                      setRemoving(vault);
                    }}
                    aria-label={`Remove ${vault.name}`}
                  >
                    Remove
                  </Button>
                </div>
              </li>
            ))}
          </ul>
          {unlocked && (
            <div className="space-y-2 rounded-xl border border-primary/30 p-3">
              <p className="text-sm">
                Authenticated first XBT address (account 0)
              </p>
              <p className="break-all font-mono text-sm">
                {unlocked.account.firstAddress}
              </p>
              <p className="text-xs text-muted-foreground">
                Scan this public account below to recover its balance and
                history. A saved completed scan restores after unlocking;
                payment preparation checks current coins again.
              </p>
            </div>
          )}
        </>
      )}
      {removing && (
        <section
          aria-label="Remove encrypted wallet"
          className="space-y-3 rounded-xl border border-destructive/50 p-4"
        >
          <h3 className="font-semibold">Remove {removing.name}?</h3>
          <p className="text-sm text-muted-foreground">
            This permanently removes this encrypted wallet copy from this
            browser. Funds stay on the network. To regain access, you need your
            recovery phrase and any BIP39 passphrase. Your browser password
            alone cannot recover it. Saved public history and address indexes
            are retained for recovery.
          </p>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={backupConfirmed}
              onChange={(e) => setBackupConfirmed(e.target.checked)}
            />
            I have my recovery backup, or this is a disposable test wallet.
          </label>
          <Label htmlFor="remove-vault-name">
            Type the wallet name to confirm
          </Label>
          <Input
            id="remove-vault-name"
            value={removeName}
            onChange={(e) => setRemoveName(e.target.value)}
            autoComplete="off"
          />
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setRemoving(null)}>
              Cancel removal
            </Button>
            <Button
              variant="destructive"
              disabled={!backupConfirmed || removeName !== removing.name}
              onClick={() => {
                const id = removing.id;
                try {
                  catalog.remove(id);
                  onRemoved?.(id);
                  cancel();
                  setNotice("Encrypted wallet removed from this browser.");
                } catch {
                  onRemoved?.(id);
                  cancel();
                  setError(
                    "Removal could not fully finish. Check the wallet list before retrying; keep your recovery backup.",
                  );
                }
              }}
            >
              Remove encrypted wallet
            </Button>
          </div>
        </section>
      )}
      {mode !== "idle" && (
        <div className="space-y-3" data-private="true">
          <fieldset disabled={busy} className="space-y-3">
            {(mode === "create" || mode === "recover") && entryFields}
            {mode === "recover" && (
              <>
                <p className="text-xs text-muted-foreground">
                  You can briefly switch apps and return to this entry in the
                  same tab, for up to five minutes. Cancel, reload, or closing
                  the tab clears it.
                </p>
                <Label htmlFor="local-vault-phrase">Recovery phrase</Label>
                <textarea
                  id="local-vault-phrase"
                  value={phrase}
                  onChange={(e) => setPhrase(e.target.value)}
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  maxLength={1024}
                  className="min-h-28 w-full rounded-xl border border-border bg-background p-3"
                />
                <Label htmlFor="local-vault-passphrase">
                  Optional BIP39 passphrase
                </Label>
                <Input
                  id="local-vault-passphrase"
                  type="password"
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                  autoComplete="off"
                  maxLength={1024}
                />
                <p className="text-xs text-muted-foreground">
                  Only enter a BIP39 passphrase if your original wallet used
                  one. Every different passphrase creates a different wallet; a
                  server cannot check it. Recovery uses native RedWallet's BIP84
                  account 0.
                </p>
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={acknowledged}
                    onChange={(e) => setAcknowledged(e.target.checked)}
                  />
                  I have my recovery backup and understand that the browser
                  password is separate.
                </label>
              </>
            )}
            {mode === "backup" && (
              <>
                <p className="text-sm">
                  Write all 24 words down in order. Anyone with these words can
                  spend the wallet's funds. Do not send them to chat or support.
                </p>
                <ol className="grid grid-cols-2 gap-2 rounded-xl bg-background p-3 sm:grid-cols-3">
                  {phrase.split(" ").map((word, i) => (
                    <li key={`${i + 1}-${word}`} className="font-mono text-sm">
                      {i + 1}. {word}
                    </li>
                  ))}
                </ol>
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={acknowledged}
                    onChange={(e) => setAcknowledged(e.target.checked)}
                  />
                  I wrote every word down in order.
                </label>
              </>
            )}
            {mode === "verify" &&
              positions.map((position, i) => (
                <div key={position} className="space-y-1">
                  <Label htmlFor={`backup-word-${i}`}>
                    Word {position + 1}
                  </Label>
                  <Input
                    id={`backup-word-${i}`}
                    value={answers[i]}
                    onChange={(e) =>
                      setAnswers((a) =>
                        a.map((v, j) => (j === i ? e.target.value : v)),
                      )
                    }
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck={false}
                  />
                </div>
              ))}
            {mode === "unlock" && (
              <>
                <Label htmlFor="unlock-vault-password">Wallet password</Label>
                <Input
                  id="unlock-vault-password"
                  ref={unlockPassword}
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  maxLength={1024}
                />
              </>
            )}
          </fieldset>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={cancel}>
              Cancel
            </Button>
            {mode === "create" && (
              <Button disabled={busy} onClick={generate}>
                Generate recovery phrase
              </Button>
            )}
            {mode === "backup" && (
              <Button
                disabled={!acknowledged || busy}
                onClick={() => {
                  setMode("verify");
                  setAcknowledged(false);
                }}
              >
                Verify backup
              </Button>
            )}
            {(mode === "verify" || mode === "recover") && (
              <Button
                disabled={busy || (mode === "recover" && !acknowledged)}
                onClick={() => void save()}
              >
                {busy ? "Encrypting…" : "Save encrypted wallet"}
              </Button>
            )}
            {mode === "unlock" && (
              <Button
                disabled={busy || !password}
                onClick={() => void unlock()}
              >
                {busy ? "Unlocking…" : "Unlock wallet"}
              </Button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
