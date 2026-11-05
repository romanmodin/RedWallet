# Publisher rejected despite matching repository identity and active certificate proof

Submitted with owner approval: https://github.com/zapstore/relay/issues/13

The existing RedWallet publisher cannot publish a separate RedWallet Lightning Android beta. The current official publisher zsp 2.0.1 returns:

```json
{"code":"upload_rejected","detail":"blob upload rejected: upload icon: status 403: authenticated pubkey is not allowed. Visit https://zapstore.dev/docs/publish for more information.","retryable":false}
```

Publisher:
`npub18w06dfgs9f6n2ppytceqnd7hy7ss67cdenmwnulxjvmpq2pq3q5sqwx5l0`

Public key:
`3b9fa6a5102a753504245e3209b7d727a10d7b0dccf6e9f3e693361028208829`

Public repository: https://github.com/romanmodin/RedWallet
Default-branch verification file: https://github.com/romanmodin/RedWallet/blob/main/zapstore.yaml

That file's repository and pubkey exactly match the existing publishing identity, checked without authentication. The existing APK signing-certificate proof was verified with the previous official publisher: certificate hash matches, proof ACTIVE, signature VALID, expiry 2027-10-03.

Certificate SHA-256:
`7843791c3cf340458fbf400a204361a0a97ac9c2902ae36c4511396f1f55884f`

Identity proof event:
`c2885c4f48d695d1c38698b8e0a766a455fa286ed17249ce80db3ddab1b14574`

New package: `com.romanmodin.redwallet.lightning`
Version: `8.0.1` (version code `22`)
Release: https://github.com/romanmodin/RedWallet/releases/tag/android-live-xbt-42008700794
APK SHA-256: `3331bfb2f74d850b64a9d08ab5b91e78cd4ce749a2793c269586f5ed86b58c48`

This is a separate companion package, not a replacement for the regular `com.romanmodin.redwallet` listing. The existing publisher and Android signing identity have been retained.

The earlier zsp 0.4.17 package check also succeeded, but its publication reported that all three software events were rejected. No successful new Lightning publication is being claimed.

Could you check the publisher gate/allowlist state and advise which verification step is needed, or restore publisher access if appropriate?
