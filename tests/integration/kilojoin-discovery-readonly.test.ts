/** Opt-in, read-only public relay probe. No identities, joins or wallet access. */
import { KilojoinRelay } from '../../class/xbt/kilojoin/relay';
import { parsePool } from '../../class/xbt/kilojoin/protocol';
const probe = process.env.REDWALLET_LIVE_POOL_PROBE === '1' ? test : test.skip;
probe(
  'public relay accepts discovery and completes its signed pool snapshot',
  async () => {
    const NodeWebSocket = require('ws');
    const accepted = new Set<string>();
    let announcements = 0;
    const errors: string[] = [];
    const relay = new KilojoinRelay(
      async event => {
        announcements++;
        try {
          accepted.add(parsePool(event, Math.floor(Date.now() / 1000)).id);
        } catch {
          /* Reject unsupported pools. */
        }
      },
      error => errors.push(error.message),
      url => new NodeWebSocket(url),
    );
    try {
      await relay.connect();
      await relay.discoverPools(Math.floor(Date.now() / 1000) - 2100);
      expect(errors).toEqual([]);
      console.log(JSON.stringify({ observedAt: new Date().toISOString(), announcements, compatiblePools: accepted.size, completed: true }));
    } finally {
      relay.close();
    }
  },
  35000,
);
