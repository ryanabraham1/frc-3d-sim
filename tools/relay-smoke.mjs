import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
const base = new URL(process.argv[2] ?? 'http://localhost:8787');
base.protocol = base.protocol === 'https:' || base.protocol === 'wss:' ? 'wss:' : 'ws:';
base.pathname = '/ws';
const sockets = [];
async function peer() {
  const ws = new WebSocket(base);
  sockets.push(ws);
  const messages = [];
  ws.on('message', (data, binary) => messages.push(binary ? data : JSON.parse(data.toString())));
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  const next = async op => {
    const end = Date.now() + 5000;
    while (Date.now() < end) {
      const i = messages.findIndex(m => op === 'binary' ? Buffer.isBuffer(m) : m.op === op);
      if (i >= 0) return messages.splice(i, 1)[0];
      await new Promise(r => setTimeout(r, 10));
    }
    throw new Error(`Timed out waiting for ${op}`);
  };
  return { ws, messages, next, send: data => ws.send(JSON.stringify(data)) };
}
try {
  const host = await peer();
  host.send({ op: 'create', name: 'Smoke host', meta: { visibility: 'public', title: 'Smoke test' } });
  const created = await host.next('created');
  const a = await peer();
  a.send({ op: 'join', room: created.room, name: 'Alice' });
  const alice = await a.next('joined');
  await host.next('peer-joined');
  const b = await peer();
  b.send({ op: 'join', room: created.room, name: 'Bob' });
  const bob = await b.next('joined');
  await host.next('peer-joined');
  b.send({ op: 'list' });
  assert.ok((await b.next('rooms')).rooms.some(r => r.code === created.room && r.players === 3));
  a.send({ op: 'send', data: { t: 'cmd', s: 1 } });
  assert.equal((await host.next('msg')).from, alice.peerId);
  host.send({ op: 'send', to: alice.peerId, data: { hello: 'Alice' } });
  assert.deepEqual((await a.next('msg')).data, { hello: 'Alice' });
  host.send({ op: 'signal', to: alice.peerId, data: { session: 'test', description: { type: 'offer' } } });
  assert.equal((await a.next('signal')).from, created.peerId);
  a.send({ op: 'signal', to: bob.peerId, data: { forbidden: true } });
  host.send({ op: 'snapshot-route', exclude: [alice.peerId] });
  host.ws.send(Buffer.from([1, 2, 3]));
  assert.deepEqual(await b.next('binary'), Buffer.from([1, 2, 3]));
  assert.equal(a.messages.some(Buffer.isBuffer), false);
  assert.equal(b.messages.some(m => m.op === 'signal'), false);
  host.send({ op: 'snapshot-route', exclude: [] });
  host.ws.send(Buffer.from([4, 5, 6]));
  assert.deepEqual(await a.next('binary'), Buffer.from([4, 5, 6]));
  await b.next('binary');
  a.ws.terminate();
  await host.next('peer-lost');
  const resumed = await peer();
  resumed.send({ op: 'rejoin', room: created.room, token: alice.token });
  assert.equal((await resumed.next('joined')).peerId, alice.peerId);
  await host.next('peer-back');
  host.send({ op: 'checkpoint', data: { lobby: 'smoke checkpoint' } });
  host.ws.close(4000, 'leave');
  const handoff = await resumed.next('host-changed');
  assert.equal(handoff.hostId, alice.peerId);
  assert.deepEqual(handoff.checkpoint, { lobby: 'smoke checkpoint' });
  assert.equal((await b.next('host-changed')).checkpoint, undefined);
  console.log('PASS: rooms, discovery, controls, signaling isolation, mixed snapshot routing, fallback, reconnect, host recovery');
} finally {
  for (const ws of sockets) { try { ws.close(4000, 'leave'); } catch { ws.terminate(); } }
  setTimeout(() => { for (const ws of sockets) ws.terminate(); }, 100).unref();
}
