---
title: RIBLT
description: Rateless set reconciliation that finds exactly which keys two peers do not share, sending about 27 bytes per differing key and no estimate of how many differ.
head:
  - tag: title
    content: RIBLT set reconciliation in JavaScript and TypeScript | distillate
---

`distillate/riblt` ships a rateless invertible Bloom lookup table (Yang, Gilad
and Alizadeh, SIGCOMM 2024), which answers "which keys does the other side have
that I do not, and the reverse?" between two peers that each hold a large set.
One side encodes its set into an endless stream of coded symbols; the other
pushes them into a decoder until it decodes, then holds the exact difference.

- **Cost follows the difference.** Bytes sent grow with how many keys differ,
  not with how many each side holds.
- **No estimate up front.** The stream is rateless: the receiver stops when it
  decodes, so nobody guesses the difference size or sizes a table for it.
- **Exact.** The result is the difference itself, not a probable one.

## Reconcile two sets

```ts
import { RibltDecoder, RibltEncoder } from "distillate/riblt";

const server = RibltEncoder.from(["alice", "bob", "dave"]);
const client = RibltDecoder.from(["alice", "carol"]);

let decoded = false;
for (let sent = 0; !decoded && sent < 1024; sent += 4) {
  decoded = client.push(server.take(4));
}

client.local().join(); // "carol"
client.remote().length; // 2
```

`take(n)` returns the next `n` coded symbols as one frame, a `Uint8Array` to
send as it is; `push(frame)` ingests one and reports whether the decoder has
decoded. `local()` returns the keys only the decoder's side holds, exactly as
they were added. `remote()` returns the keys only the other side holds, as
64-bit hashes: the decoder never saw those keys, only their symbols.
`stream(n)` yields `take(n)` frames forever, for a sender that loops.

## When to pick it

Pick RIBLT when two parties hold sets that are mostly the same and need to
agree on the few keys that differ: a client reconnecting after a day offline, a
replica catching up, two peers syncing over WebRTC, a Worker checking which
items a client lacks.

Sending the whole set costs bytes for every key. Sending a
[Bloom filter](/guides/bloom/) of it is smaller but only probable, and it
answers one direction only, so each side still has to send its own and a false
positive hides a key forever. An invertible Bloom filter with a fixed size gives
the exact difference, but only if it was sized for the difference before anyone
knew how big it was. See [choosing a structure](/guides/choosing-a-structure/).

## Sync over the network

Frames must reach the decoder in order, each once, so any ordered transport
works. Over a `WebSocket`, the server answers each request for more with the
next frame from a per-connection stream:

```ts
import { RibltEncoder } from "distillate/riblt";

declare const serverKeys: string[];
declare const socket: WebSocket;

const frames = RibltEncoder.from(serverKeys).stream(64);
socket.addEventListener("message", (event) => {
  if (event.data === "more") socket.send(frames.next().value);
});
```

The client asks until it decodes:

```ts
import { RibltDecoder } from "distillate/riblt";

declare const clientKeys: string[];
declare const socket: WebSocket;

const decoder = RibltDecoder.from(clientKeys);
socket.binaryType = "arraybuffer";
socket.addEventListener("message", (event: MessageEvent<ArrayBuffer>) => {
  if (!decoder.push(new Uint8Array(event.data))) socket.send("more");
});
socket.send("more");
```

Over `fetch` the shape is the same, one request per frame or per few frames.
The server keeps an encoder per sync session so it can hand out frames in
order, and drops it when the client reports it has decoded:

```ts
import { RibltDecoder } from "distillate/riblt";

declare const clientKeys: string[];

async function pull(session: string): Promise<RibltDecoder<string>> {
  const decoder = RibltDecoder.from(clientKeys);
  for (;;) {
    const response = await fetch(`/sync/${session}/next`);
    if (decoder.push(new Uint8Array(await response.arrayBuffer()))) {
      return decoder;
    }
  }
}
```

A larger frame means fewer round trips but may overshoot: the decoder can
finish partway through the last frame, and the rest of it was sent for nothing.
64 symbols is 1,280 bytes, a comfortable fit for one packet's worth of payload.

Both peers must use the same `seed`; a frame from another throws
`RibltParamMismatchError`. A frame out of order throws `ParamError`. Either way
the decoder is left as it was, so the right frame can still follow.

## Resolve the remote side

`remote()` reports the keys only the other side holds as hashes, so send them
back and let that side look them up. `RibltDecoder.hashOf(key)` is the hash
`remote()` reports for a key, under the same seed:

```ts
import { RibltDecoder } from "distillate/riblt";

declare const serverKeys: string[];
declare const requested: bigint[];

const byHash = new Map(
  serverKeys.map((key) => [RibltDecoder.hashOf(key), key]),
);
const missing = requested.map((hash) => byHash.get(hash));
```

JSON has no `bigint`, so send each as `hash.toString()` and read it back with
`BigInt(text)`. The lookup map covers the server's whole set; a server that
reconciles often can keep it alongside the set rather than rebuild it.

## What it costs

Each coded symbol is 20 bytes: a 64-bit sum of key hashes, a 64-bit sum of
their checksums and a 32-bit count. A frame adds 36 bytes: the 16-byte header,
16 bytes of params and a 4-byte checksum. The number of symbols a decode needs,
per differing key, measured over 50 seeded trials each:

| Keys that differ | Symbols per differing key |
| ---------------- | ------------------------- |
| 10               | 1.81                      |
| 100              | 1.47                      |
| 10,000           | 1.36                      |

So a large difference costs about 27 bytes per differing key, near the paper's
1.35 symbols. Small ones cost more per key, and a single differing key takes a
few symbols. None of it depends on how many keys the two sides share: shared
keys cancel exactly.

A key reaches symbol `i` with probability about `1 / (1 + i/2)`, so it lands in
about `2 ln(m)` of the first `m` symbols. Producing `m` symbols therefore costs
the sender about `2 n ln(m)` key updates for `n` keys, most of them in the first
few symbols; the receiver does the same over its own keys, plus a short walk
for each key it peels.

## Limits

Keys must be distinct. A key added twice cancels in the sums but adds in the
count, so its cells never peel and the decode would never finish. Instead the
first `take` or `push` on the side holding it throws `ParamError`. Deduplicate
before `from` or `add`. Add every key before the first frame: an encoder or
decoder refuses `add` once symbols have moved.

The hash is seeded, not keyed: anyone who knows the seed can choose keys whose
symbols travel together, and crafted keys can stop a decode from ever
finishing. Choose a private `seed` when the keys come from people who may want
that, and cap the frames you will accept before falling back to sending the
set. The cap also bounds memory: a decoder holds about 32 bytes per symbol it
has received, up to twice that just after its buffers double, so a peer that
never stops sending grows it about 1.6 times as fast as it sends.

Keys are reduced to 64-bit hashes, so two distinct keys can collide. At a
million keys on the two sides together the odds of any collision are about
n^2 / 2^65, or 2.7e-8. Two colliding keys on one side look like a repeated key,
and the first frame throws as it would for one; another `seed` resolves it. Two
colliding keys on opposite sides look like one shared key, so the difference
between them is missed, silently.
