# Security review of e1140408b8073ffc8d4a655d20486c0291822c13

Reviewed source: `e1140408b8073ffc8d4a655d20486c0291822c13`.
Base: `9a23b81ad0520bd71467e75abeb0d26e66575a2d`.
Pinned LND source independently inspected: Kilombino/lnd `cae303b36594a2c48c9ce0cbb238672e3a1b284e`.

Verdict: do not approve the reviewed revision. Its hidden-amount guarantees fail. No principal-substitution exploit was found in the reviewed confirmation paths; this is not a proof of absence.

## Confirmed defects in the reviewed revision

1. **Hidden amounts and fees leak through history details, cancellation and clipboard.** `screen/wallets/LndWalletHome.tsx:214` builds details with `exactAmount(row.sats)` and `exactAmount(row.feeSats)` regardless of `wallet.hideBalance`. The cancellation prompt at line236 repeats the amount; line251 copies the unredacted details. Reproduced with a hidden wallet containing123457 sats and239 sats fee: all four redaction assertions failed. The same details function is used for on-chain funding rows.
2. **The global transaction feed leaks hidden wallet amounts visually and to accessibility.** `class/blue-app.ts:823` filters `_hideTransactionsInWalletsList`, not `hideBalance`. `class/wallets/lnd-wallet.ts:getTransactions` supplies exact settled values. `screen/wallets/WalletsList.tsx:132` uses that feed. `components/TransactionListItem.tsx:213` formats `item.value` without checking the owning wallet; lines568/574/589 include it in accessibility labels. CopyAmount at line458 is also unguarded. Rendering the actual global-feed component reproduced both visual and accessibility leaks. The carousel and wallet-search card themselves do redact correctly.
3. **Real save errors do not reach privacy rollback.** `LndWalletHome.tsx:56` awaits the storage context's default save. `components/Context/StorageProvider.tsx:163` calls `BlueApp.saveToDisk()` without its strict argument. `class/blue-app.ts:572,684` defaults `throwOnError=false` and catches write failures. The home screen's catch never runs on that failure path. Reproduced entering and leaving hidden mode using the real BlueApp with disposable failing storage; both retained the new state instead of restoring the prior one. The existing mocked-rejection tests bypass this behavior.
4. **Advanced node tools do not consult the hidden flag.** `XBTLightning.tsx` displays and copies the raw node-balance/history result, channel selection details and channel local balances without consulting the LND wallet's `hideBalance`. These surfaces are outside the hero masking. Explicit new-payment confirmation amounts must remain visible so the user can review a spend; historical balances need a deliberate reveal/redaction policy.
5. **Lightning submission and recovery export omit the ordinary wallet's extra authentication.** `XBTLightning.tsx` confirmation callbacks call native pay/withdraw/open/close directly. `XBTLightningChannelFunds.tsx` confirms a splice directly. Recovery export accepts a newly entered encryption phrase without the `useSecretExport` reauthentication used for other wallet secrets. Confirmed from these paths and the existing regular-send/secret-export controls; no fund theft was attempted.
6. **Payment proofs are logged by the inherited Ark wallet.** `class/wallets/lightning-ark-wallet.ts:669,718` logs payment preimages; nearby logs include invoice and swap payloads. This finding is in the reviewed commit but is separate from embedded LND. No exploit of a log was attempted.

## Claims verified from code and tests

- 10,000,000 sats is allowed by the opening predicate.10,000,001 is rejected in the form, and by iOS `openChannel` and Android `invoice("open")` before sync checks/RPCs. The native tests each have an above-cap rejection. The iOS funded integration case opens exactly 10m; Android's funded case opens 100000, so exact-cap Android execution is not established by that case.
- iOS resize requests use the general monetary bound, not the opening cap. They omit use_max and force_low_fee. Android has no splice bridge/method or resize implementation in this revision; shared UI is conditionally omitted when the method is absent. Android regtest config also lacks the wumbo/maxchansize entries present in its mainnet config and iOS config. This is a parity/coverage gap, not evidence of a cap bypass.
- Checked the actual pinned protobufs and their callers. Open writes fields1/3/4/8 and leaves push_sat5/fund_max26 unset. Payment writes 5/6/7; zero routing fee is zero-fee-only, not unlimited. Withdrawal writes 1/2/4/7/8 and leaves send_all6 unset. Close writes 1/6/7 and leaves force2 unset. Splice writes amount3/rate5 and omits 4/8.
- Open captures key/amount/rate in the alert closure and guards repeated approval per alert. Pay binds its reviewed invoice/hash/amount/fee, native re-decodes, and the current hash guards repeats. Withdrawal uses an immutable single-use native token. iOS splice consumes its native token, rechecks readiness and requires the current estimate to equal the review. Close captures point/rate and checks selection. Editing a field afterward does not substitute it into those reviewed calls. Two separately approved opening alerts can intentionally open two channels; the opening guard is not a global single-channel policy.
- XBT→sats→NeoxEX USDC→hidden→XBT is the actual cycle: hidden on the third tap from XBT, XBT on the fourth. `fromJson` preserves hideBalance. The hero, fiat estimate, funding split, home activity rows, canceled stack and main-menu/search cards mask their direct numeric elements. Those facts do not negate the leaks above.
- `profile.ts` has companionsEnabled=false. Watch/widget paths are inactive for this profile and are not counted as live leaks.

## Fee semantics and residual risk

Opening and withdrawal confirmations specify a sat/vB rate with no absolute fee estimate or total-sat budget. The rate is an input to LND fee construction, not an absolute spend ceiling. A 10m opening cap applies to the channel principal; the network fee is additional. Splice displays an estimate and explicitly warns that the final fee may vary. Payment has a routing-fee budget. Cooperative close sends rate and rate×3, with LND's max-rate restriction applying when this node funded the channel; the UI explicitly states that limitation.

Client code validates positive/exact integers, monetary domain, addresses, sync, and fee bounds. Dust, balances, anchor/channel reserves, liquidity, fee floors and peer policy are largely delegated to LND. A deterministic withdrawal rejection such as dust is collapsed by the UI catch into outcome-unknown; this is conservative but loses a definite refusal reason. Review expiry/consumption and the absence of auto-retry prevent that message from itself authorizing another send.

Exact requested arithmetic checks pass:

| Expression | Exact value | Bound |
|---|---:|---:|
| rate×3 | 9007199254740990| JS safe maximum 9007199254740991|
| rate×3000 | 9007199254740990000| signed Int64 maximum 9223372036854775807|
| max sats×1000 | 2100000000000000000| signed Int64 maximum 9223372036854775807|

Swift validates the amount before multiplying; Android short-circuit-validates the signed amount before multiplying. The millisatoshi equality cannot wrap within that accepted range.

**Do not infer full backend arithmetic safety from that table.** The pinned LND's `lnwallet/chainfee/rates.go` multiplies signed rate by transaction weight/vsize before division. At the admitted maximum rate, rate×250×724equals 543434355036039730000, beyond Int64. Its wrapped signed product would be 8478776898462733136. This is a demonstrated arithmetic counterexample, but full RPC behavior at such rates and resulting fund-loss impact were not executed. Extreme-rate native rejection and downstream arithmetic bounds remain unresolved coverage/risk.

## Fee arithmetic remediation — November 9 UTC

The shared JavaScript, Swift and Kotlin admission bound is now 3,074,457,345 sat/vB:
`floor((Int64.max - 999) / (3 * 1000 * 1_000_000))`. It accounts for the cooperative-close 3x ceiling, conversion to sat/kvB and the backend's multiplication before division for the maximum consensus-valid transaction size of 1,000,000 vB / 4,000,000 weight units. The 999 rounding increment is included. The counterexample above remains a historical finding against the original reviewed source, not the current accepted fee domain. Ordinary rates above the former 100 sat/vB beta ceiling remain allowed; the user-selected 10,000,000-sat channel-opening cap is unchanged.

Opening and withdrawal now reject malformed amounts/unsafe fees before querying node readiness; cooperative close already validated fees before RPC. Unit regression calculations reproduce the old 724-WU overflow and cover both backend rate representations through maximum valid transaction size. Native Swift/Kotlin cases check the new boundary and early refusal. Native execution of these added cases remains pending. This bounded admission guard is not a claim that every internal LND operation on oversized/invalid intermediate transactions has been audited.

## Validation and gaps

On unchanged reviewed production source: 154 unit suites passed, 2899 tests passed, 1 explicit test skipped; lint/type checking passed with existing warnings. Some inherited mnemonic-dependent groups do not register tests without their optional environment fixtures. The 8 new privacy regressions all failed on that source, with durable JSON/log evidence outside the repository.

iOS tests present: above-cap early rejection; exact 10m opening at 125 sat/vB; 44m invoice creation/decode; 2m outgoing / 1.5m incoming; 44m splice-in/2m splice-out; duplicate/expired review handling; 2m withdrawal and portable recovery; protobuf bounds; malformed/refused/negative/foreign-destination splice estimates. The funded scenario failed while waiting after the large splice-in, so its later splice-out/close/withdraw/recovery assertions were not reached in that run. The fixture mines its own minimum plus 2 blocks; the peer can require 144 for the new large inputs. A separate fix queries the peer's pending-splice lock depth without lowering production policy.

Android tests present: above-cap rejection before node calls;44000000invoice creation/decode; 100000 opening; 20000 outgoing with 250 routing budget; 2000 incoming; mismatched reviewed amount rejection; withdrawal token and portable recovery. Embedded Android qualification passed for this source. Android has no native resize cases. Android e2e TLS run failed 7 cases while waiting for window focus, before the certificate assertions; this is not evidence that invalid certificates were accepted.

Missing evidence includes exact-cap Android funded opening, extreme-fee native operations and full backend overflow analysis, multi-alert/native concurrency stress, real storage/provider failures in the original suite, and the hidden detail/global-feed/copy/accessibility paths. No public network funds were moved for this review.

## Separate remediation branch

This branch adds redaction of details/cancellation/copy and global-feed numeric/accessibility/copy surfaces; optional strict persistence used by privacy preferences; submission authentication and secret export reauthentication; removal of Ark payment-proof logs; and the two-peer fixture confirmation fix. The 8 baseline privacy cases now pass, along with 148 focused tests and a real StorageProvider durability test. Further native/full-suite results are pending. Advanced node tools now read the persisted LND wallet privacy preference: opaque native balance/history/error text is replaced while hidden, channel rows and close-button balances are masked, and the selected peer identity is reconstructed without its balance. Activity copying is unavailable while hidden and retained callbacks recheck the current privacy state. Resize reviews mask resulting capacity and balance while keeping the newly entered principal and network fee visible. Fixed amount-free submission outcomes remain visible. Tests cover hidden native results/errors, accessibility, retained copy callbacks across mutated or replaced wallets, selected channel identity, unrelated wallets and explicit payment/resize confirmations. Four new privacy cases reproduced leaks on the prior branch source before the fix. The demonstrated extreme fee multiplication is now rejected by the common admission bound; see the separate remediation section and its native-qualification limits. Do not approve or distribute the original reviewed source on the strength of these separate fixes.

Follow-up local validation: 2927 tests passed in 157 suites, 1 skipped. Full TypeScript/localization/metadata/ESLint checks passed with existing warnings. Native Swift/Kotlin and iOS/Android UI qualification of this follow-up is pending.
