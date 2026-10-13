# Optional artwork skin

Default appearance and all existing wallet palette settings remain unchanged. A logo at the bottom of Settings toggles a cosmetic dashboard background only after two taps within 450 milliseconds. A second pair of taps restores the default appearance. An accessible activation action is available for assistive technology.

The choice is stored in a dedicated cosmetic preference; no wallet balances, signing rules, keys, accounts, network providers or transaction state are changed. Default is disabled; only the explicitly saved `enabled` value restores artwork on launch. Failed preference writes do not change the visible skin.

The original supplied artwork and PNG logo are included byte-for-byte. The dashboard uses a fixed decorative background with a contrast scrim and limited hero spacing; existing cards, typography, amounts and transaction semantic colors remain unchanged. Only dashboard row surfaces become translucent, through a local React context. Other transaction screens retain their original row surfaces. Artwork never receives touch or accessibility focus. Light-mode contrast has a separate white scrim without changing theme palette values.

Source asset SHA256:

- background.jpeg: d71a97db41676229234b2451f4c452ac1e996a47cadd3b5e285aa4ed0501151c
- logo.png: ffede379cf1aaa9057be7da06aa15285f2e408d3e4ef2b21e9da05891c7182f6

Media supplied by the owner. Redistribution/licensing should be reviewed before public-store distribution; no third-party license ownership is asserted.

Qualification requires toggle/persistence/storage-failure checks, normal wallet regressions, and actual native screenshots for cropped artwork, long transaction lists, large text and safe-area/header placement. Unit tests do not establish physical-device visual fidelity. This feature branch is independent of chain freshness PR48; both must be combined and qualified before a beta containing both is delivered.
