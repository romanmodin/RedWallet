# CoinJoin coin history and suggestions

This change is isolated on `feat/coinjoin-coin-labels-20261019`. It is not part of the current artwork/discovery iOS release and must not be described as delivered until independently qualified and shipped.

## Labels

Each output has text as well as color: purple for a confirmed output from a locally recorded CoinJoin; blue while that output is unconfirmed; amber for known CoinJoin change; gray when mixing history is unknown. Labels appear in coin control, output details, CoinJoin input selection and transaction output details. They describe recorded history, not an anonymity score or guarantee.

Roles are recorded for the exact reviewed transaction and exact wallet output addresses. They are saved durably before sharing a signature or broadcasting, so another participant's broadcast does not erase that history on restart. Saving failure prevents those actions. Change stays frozen by default; existing notes and freezes are preserved. Editable notes, similar amounts and server labels cannot create a mixed label. A seed-only restore without local metadata remains unknown. Reorg/unconfirmed status changes a mixed output back to pending.

## Spending and suggestions

Normal send selection first tries each history category separately using the wallet's existing fee and dust rules. Frozen and reserved outputs are excluded. If a payment requires combining a recorded mixed output with change or unknown-history outputs, the user must choose either different coins or explicitly confirm combining before transaction creation/signing. Approval is not cached across selections. MAX still means all eligible coins and warns instead of silently sending a smaller amount.

The CoinJoin screen has a Suggest coins button. It considers confirmed, unfrozen, unreserved inputs, the pool's denomination and maximum input count, and the user's fee limit. It prefers a single category and fewer inputs, then lower fee/change. Suggestions only select inputs; they never join a pool, sign or broadcast. Any cross-category combination still needs the explicit warning before joining.

## Limits and validation

Unknown does not mean definitely unmixed. Labels are local wallet metadata; no label is published to a relay or the chain. Combining outputs from separate rounds can still link them, even when both carry a mixed label. This patch does not provide cross-wallet metadata exchange, proof of anonymity, full-round mobile interoperability, or a physical-device assurance claim. Existing explicit transaction review/sign/broadcast, fee caps, reservations and recovery gates remain required.

Focused regression coverage includes both XBT formats, amount-plus-fee selection, MAX, frozen/reserved exclusions, fee/input limits, unknown histories, confirmation changes, persistence before signature sharing/broadcast, and UI cancellation/approval. Native rendering and full hosted iOS qualification remain pending for this separate feature.
