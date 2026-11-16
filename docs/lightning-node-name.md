# Lightning node name (iPhone)

In Lightning Node Settings, edit **Node name** and tap **Save node name**.
The default remains RedWallet. The saved name is used at the next node launch.
If the node is already started, finish any payments, fully close RedWallet and
reopen it. Backgrounding alone does not restart the node.

Saving a name writes a separate preference; it does not restart the daemon,
change wallet credentials, create a new node or close channels. The screen
distinguishes the current session name from a saved name awaiting restart.
The existing node directory and Keychain service are unchanged.

The engine limits names to 32 UTF-8 bytes. Unicode is supported, though some
characters take multiple bytes. Control characters and config punctuation
are rejected before writing the LND configuration. Blank names are rejected;
enter RedWallet to restore the default explicitly.

Names can be public, are not unique and are not proof of node identity. Other
nodes may display an old name until they receive a fresh announcement.
The feature is gated on the iOS native bridge; Android does not display it.

Tests cover atomic persistence, corruption recovery, injection rejection,
UTF-8 length, UI save failures, stale reads and duplicate presses. The public
simulator test uses an unfunded disposable node to verify its actual alias and
that saving a pending name does not alter its current alias or public key.
