// Opening announcement adapted from Kilombino's PoolSession.announce (Apache-2.0).
import { signEvent } from "./crypto";
import { parsePool, Terms } from "./protocol";

export function createOpeningAnnouncement(
  terms: Terms,
  now: number,
  poolSecret: Uint8Array,
  auxiliaryRandom: Uint8Array,
) {
  // Select only the public wire fields. A creator session also holds private signing material.
  const {
    v,
    app,
    network,
    id,
    public_key,
    creator,
    blind_key,
    denomination,
    outputs,
    payments,
    fee_rate,
    min_peers,
    max_peers,
    private: privatePool,
    timeout,
    peers,
    script,
    max_inputs,
  } = terms;
  const listing = {
    v,
    app,
    network,
    id,
    public_key,
    creator,
    blind_key,
    denomination,
    outputs,
    payments,
    fee_rate,
    min_peers,
    max_peers,
    private: privatePool,
    timeout,
    peers,
    script,
    max_inputs,
    state: "open",
  };
  const event = signEvent(
    {
      kind: 32022,
      created_at: now,
      tags: [
        ["d", id],
        ["t", "kilojoin"],
        ["network", network],
      ],
      content: JSON.stringify(listing),
    },
    poolSecret,
    auxiliaryRandom,
  );
  parsePool(event, now);
  return event;
}
