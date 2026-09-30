# RedWallet 0.24 payment status and follow-up payment

Acknowledged payments display Sent — awaiting confirmation, with no submit
checkbox or retry button, including after restoring the saved receipt. submit()
also rejects acknowledged state. Check confirmation is the normal next action.
Unknown outcomes retain explicit original-byte retry with wording that makes
clear it is not a new payment. Durable pending/archived receipt format unchanged.

After live confirmation and archive, Send another to this recipient keeps the
recipient, clears amount and consent, and requires a fresh account refresh/review.
The new unsigned draft persists. Nothing is automatically signed or submitted.

29 targeted tests passed, covering submission, acknowledged-state restore,
confirmation/archive and follow-up amount reset without another signature or
broadcast, plus existing pending-payment/network and metadata tests. Typecheck
passed. Production bridge probe 2026-09-30T05:17:16.061Z: height974797,
checkpointverified,broadcastenabled,invalidinputrejected. Publication pending.
