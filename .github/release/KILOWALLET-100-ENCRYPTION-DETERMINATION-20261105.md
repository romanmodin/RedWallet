# Kilowallet publisher encryption determination — November 5, 2026

Scope: current Kilowallet 1.0 release for United States distribution. France is excluded. Reassess this determination if cryptography or distribution territories change.

Roman confirmed no France distribution on November 5. Live App Store Connect availability showed exactly one selected territory: United States, available on app release; France was Not Available.

The maintainer supplied the component inventory: AES-GCM protected exports with PBKDF2/scrypt, published NIP-44 and blind signatures, libsecp256k1 signatures, embedded LND/Go TLS/aezeed/secretbox/channel backups, Ark/rustls and Arti Tor. The maintainer reports no proprietary or unpublished algorithms or protocols and no existing ECCN, CCATS or Apple determination. Publicly published AEZ, Tor, Lightning BOLTs and Ark were disclosed; lack of standards-body adoption alone was not treated as unpublished cryptography.

The publisher completed the live App Store Connect App Information encryption questionnaire on November 5 at approximately 07:58 Pacific:

- App purpose: self-custody BLAKE2b-chain wallet with on-chain payments, CoinJoin, Lightning, Ark, Tor and password-encrypted backups.
- Standard encryption algorithms outside or in addition to Apple's OS: selected.
- Proprietary/non-standard checkbox: not selected, based on the supplied published inventory and Apple's definition.
- Distribution in France: No.

Apple returned that no documents need to be uploaded for these answers. The publisher clicked OK. No document, CCATS, approved code or separate declaration record was created. This is a questionnaire/documentation result, not an ECCN assignment or a claim that the app has no encryption.

`ITSAppUsesNonExemptEncryption = NO` records this supported documentation outcome. No `ITSEncryptionExportComplianceCode` is supplied. This replaces the publisher's earlier unsupported YES; it does not rely on upstream's historical NO.

Apple references:
- https://developer.apple.com/help/app-store-connect/manage-app-information/overview-of-export-compliance/
- https://developer.apple.com/help/app-store-connect/reference/app-information/export-compliance-documentation-for-encryption/
- https://developer.apple.com/documentation/bundleresources/information-property-list/itsappusesnonexemptencryption

Release qualification and package verification remain required. This preparation is not a signed package, upload, TestFlight availability or App Store approval. The existing 0.4.0 review remains in place.

## Signing preparation status

Prepared app commit 292a614fa1a5b850622978ad6322a92d6df0f7e3 changes only the plist declaration and explanatory documentation from 8238b3e34dbdadcf5ce8805a622bf20aa74caba1. It is unpublished and not yet natively qualified. Preserve running native 42036850517. Do not repin or dispatch a signer based on historical 59b13da receipts. After current evidence is collected, integrate the final app changes and qualify that exact source before activation.

The package checker must require the explicit Boolean false and absence of an export compliance code for this release. It must continue requiring the actual embedded Tor binary, arm64/device SDK, Apple Distribution signature, expected team/bundle/version, background task identifiers and exact source receipt.
