# The LLVM tier and node:dgram — sized

**Every dgram build today reports `backend c (llvm refused:
libCall:dgram.onMessage)` and demotes to the C backend.** If the WebRTC path
is dgram-based end to end — and zapo's FNA relay path is — then this clause
lands **C-only** until someone takes this.

## It is not one missing function. It is 16 of 20.

`ir/nodes.ts` declares **20** `dgram.*` lib functions. Only **4** appear
anywhere in `backend/llvm/emitter.ts`:

| present on LLVM | absent |
| --- | --- |
| `dgram.close` | `dgram.address` |
| `dgram.connectCb` | `dgram.bind` |
| `dgram.createSocket` | `dgram.bindCb` |
| `dgram.sendChk` | `dgram.closeCb` |
| | `dgram.connect` |
| | `dgram.onClose` |
| | `dgram.onConnect` |
| | `dgram.onError` |
| | `dgram.onListening` |
| | `dgram.onMessage` |
| | `dgram.ref` |
| | `dgram.sendBytes` |
| | `dgram.sendStr` |
| | `dgram.unref` |
| | `dgram.sendConnBytes` (new, this block) |
| | `dgram.sendConnStr` (new, this block) |

The two this block added join the absent column rather than widening the gap
in kind: `sendStr`/`sendBytes` were already absent, so no dgram program was
on the LLVM tier before this change either.

## Why the size estimate should go up

The absent set is not a tail of exotica. It contains **every event
registration** (`onMessage`, `onListening`, `onClose`, `onError`,
`onConnect`), both halves of `bind`, the plain `connect`, `address`, the
loop-liveness pair `ref`/`unref`, and every static send. A socket that
cannot bind, cannot register a message listener and cannot report its
address is not a partially-supported surface — it is the whole surface.

So "take the LLVM tier for dgram" is 16 lib functions plus whatever shape and
ABI support each needs, not a one-line map entry. **Measured by counting the
declarations against the emitter, not estimated.**

Not taken on inside this block, per the orchestrator.
