/** Real loopback sockets around the unchanged Kotlin participant's stdio test adapter. */
import { AddressInfo } from 'net';
import { NostrEvent } from '../../../class/xbt/kilojoin/crypto';
import { KilojoinRelay, publishIsolated, SocketFactory } from '../../../class/xbt/kilojoin/relay';
const WebSocket = require('ws');
export async function loopbackRelay(
  receive: (event: NostrEvent) => Promise<void>,
  deliver: (event: NostrEvent) => void,
  error: (e: Error) => void,
) {
  const server = new WebSocket.Server({ host: '127.0.0.1', port: 0 });
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const factory: SocketFactory = () => new WebSocket(url);
  const subscriptions = new Map<any, Map<string, any[]>>();
  const history: NostrEvent[] = [];
  let connections = 0;
  const matches = (event: NostrEvent, f: any) =>
    (!f.kinds || f.kinds.includes(event.kind)) &&
    (!f.authors || f.authors.includes(event.pubkey)) &&
    (!f['#p'] || event.tags.some(t => t[0] === 'p' && f['#p'].includes(t[1]))) &&
    (!f.since || event.created_at >= f.since);
  const forward = (event: NostrEvent) => {
    history.push(event);
    for (const [socket, filters] of subscriptions)
      for (const [id, choices] of filters) if (choices.some(f => matches(event, f))) socket.send(JSON.stringify(['EVENT', id, event]));
  };
  server.on('connection', (socket: any) => {
    connections++;
    const filters = new Map<string, any[]>();
    subscriptions.set(socket, filters);
    socket.on('close', () => subscriptions.delete(socket));
    socket.on('message', (bytes: Buffer) => {
      const frame = JSON.parse(bytes.toString());
      if (frame[0] === 'EVENT') {
        deliver(frame[1]);
        socket.send(JSON.stringify(['OK', frame[1].id, true]));
      }
      if (frame[0] === 'CLOSE') filters.delete(frame[1]);
      if (frame[0] === 'REQ') {
        filters.set(frame[1], frame.slice(2));
        for (const event of history)
          if (frame.slice(2).some((f: any) => matches(event, f))) socket.send(JSON.stringify(['EVENT', frame[1], event]));
        socket.send(JSON.stringify(['EOSE', frame[1]]));
      }
    });
  });
  const relay = new KilojoinRelay(receive, error, factory);
  await relay.connect();
  return {
    relay,
    forward,
    connections: () => connections,
    publish: (event: NostrEvent, isolated: boolean) => (isolated ? publishIsolated(event, factory) : relay.publish(event)),
    close: async () => {
      relay.close();
      for (const socket of server.clients) socket.terminate();
      await new Promise<void>(resolve => server.close(resolve));
    },
  };
}
