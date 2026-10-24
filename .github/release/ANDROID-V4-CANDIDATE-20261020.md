# Android v4 release candidate — October 20, 2026

The October 10 Android beta predates the current shared app changes. The user authorized Android parity on October 20 while iOS qualification continues.

The approved-source Android workflow builds the exact public candidate independently of iOS release orchestration. It retains the existing unsigned package verification, three CPU architectures, disposable emulator launch check, and offline release-signing path. It requires successful software, general Android, and funded Android jobs from the same commit and current workflow attempts before building. It cannot publish or sign with the release key.

- Candidate: `2bb3073678492b476ae67d6e42a76ca705b26fb2` (PR74).
- Production mapping: 988 paths; `08475a6c5c950f7e2485c42960a510911327acc541ee9ded66cbc0cf06a498a1`.
- Software: https://github.com/romanmodin/RedWallet/actions/runs/39418562475 — passed.
- General Android: https://github.com/romanmodin/RedWallet/actions/runs/39418562537 — passed.
- Funded Android: https://github.com/romanmodin/RedWallet/actions/runs/39421759030 — pending when prepared.

Local verification: seven guard tests passed, both actual completed run/job responses passed the guard, the active funded run was correctly rejected, workflow YAML and embedded package Python parsed, and pins matched.

No candidate Android package has yet been release-signed or published. Hosted emulator evidence does not establish physical-phone or ColdWallet interoperability. PR63 coin labels and suggestions remain separate from this candidate.

After all required gates succeed: review retained native evidence, run the guard to a receipt, review and guarded-merge this orchestration-only change, check for an existing package build, and dispatch once from main. Verify the actual package/source receipt before offline signing with the existing certificate; compare signed payload bytes with the unsigned artifact before publishing the beta update. Do not change iOS sources or cancel healthy jobs.
