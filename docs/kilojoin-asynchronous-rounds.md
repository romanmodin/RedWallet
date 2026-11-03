# Asynchronous participation proposal

Status: proposed for discussion with Kilombino. Existing v3–v5 pools retain their current deadlines. The phone keeps its spending keys.

## What a participant sees

After accepting a closing vote the wallet can leave the screen. It distinguishes a relay receipt from the creator accepting the vote. During blind output registration it tells the user when its last output has been acknowledged. Once the relay accepts all of its signatures for the verified transaction, the phone can go offline while peers sign. Anyone who collects all valid signatures can broadcast.

## Agreement needed across implementations

- Introduce an explicitly advertised protocol version or capability with mandatory negotiation. Older participants must ignore incompatible pools. Include the timing policy and absolute maximum expiry in the authenticated announcement; bind them to the selected pool at join.
- The creator fixes a roster for each vote and records one response per seat and vote ID. Advance immediately on unanimous acceptance. Define decline, withdrawal and timeout as explicit outcomes. Never silently shrink an approved roster in this mode. A replacement roster starts a new vote.
- For each closing attempt, persist the round ID, stage, absolute deadline and accepted progress before publishing acknowledgment. Retried messages must be idempotent. Provide a creator-authenticated replayable snapshot on reconnect, with explicit conflicts and superseded attempts. Do not link a blinded output to a participant in status messages. In the output phase use aggregate counts only.
- Specify the maximum vote, registration and signing windows together with relay retention, history pagination, replay rules and creator restart recovery. A missing participant cannot extend the announced maximum. After signing, expiry alone never releases reserved inputs; a peer may still hold a valid signature.
- The final signature commits to the exact transaction. A changed transaction requires fresh review and signing. Once all signatures are available, the last participant or another online participant can broadcast without waking earlier signers.
- Notifications are optional hints. Use per-attempt opaque subscriptions, avoid sending wallet addresses or vote decisions to a push service, and let the wallet verify current signed state before acting. Define how a creator can trigger a stage notice without identifying individual blind outputs. RedWallet also needs restart recovery and an iPhone notification path before promising asynchronous participation.

## Interoperability acceptance cases

Three devices approve at different times. The first goes offline after its signature is acknowledged. The last device broadcasts the identical fully signed transaction. Repeat with lost acknowledgments, duplicate and reordered events, an expired stage, a changed roster, a restarted creator, an iPhone terminated between stages, and a legacy wallet discovering the pool. Verify that duplicate messages add no votes, missing history never authorizes signing, and a signed input stays reserved until safely resolved.
