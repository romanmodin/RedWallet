# Physical device lifecycle and cold signing checklist

Status: unexecuted checklist. Hosted emulator/simulator results are not physical-phone or hardware-signer evidence.

## Before testing

- [ ] Record exact commit, app version/build, distribution receipt, phone OS/model and signer firmware/model.
- [ ] Use newly created disposable test wallets and a dedicated compatible test chain. Never enter personal seeds into logs or a test harness.
- [ ] Confirm a recoverable backup before testing device lock, storage migration or deletion.

## Each phone platform and BIP84/BIP86 format

- [ ] Recover receive and change paths, including spent-out history and a second account.
- [ ] Verify gap/account limits, incomplete scan notice, cancel/resume semantics and passphrase handling.
- [ ] Receive, inspect address/QR on screen, spend, RBF and CPFP, and verify confirmations independently at the test node.
- [ ] Restart encrypted storage offline; verify balance/history preservation and wrong-password rejection.
- [ ] Delete the disposable wallet; verify cache cleanup, then recover and verify complete history.
- [ ] Exercise valid custom-CA TLS, invalid/expired/wrong-name certificates, wrong checkpoint, primary failure, configured backup selection and total outage.
- [ ] Exercise Wi-Fi/cellular change, airplane mode, background/foreground, force close, locked phone and interrupted recovery.
- [ ] Verify red launch/loading/receive QR branding on fresh installs and upgrades, including dark/light appearance.

## Each actual hardware signer

- [ ] Record supported chain/firmware and available QR/USB/SD transport; unsupported combinations remain explicitly unsupported.
- [ ] Export/import public descriptors with correct fingerprint, derivation path and receive/change branches.
- [ ] Inspect destination, amount, fee, change, network and signing mode on the signer.
- [ ] Round-trip PSBTs for SegWit and Taproot Unified signing, then RBF/CPFP where supported.
- [ ] Reject wrong-chain, malformed, modified or stale signing requests; verify cancel/retry and multipart QR behavior.
- [ ] Check actual node acceptance of the returned signatures and transaction IDs. Simulator signing or software regtest acceptance is insufficient for a hardware interoperability claim.

## Evidence and release boundary

Record pass/fail and redacted receipts without secrets. PR40 qualification and publication receipts are separate. Unchecked items stay unchecked; no inference from an APK/app build to physical-device safety or signer compatibility.
