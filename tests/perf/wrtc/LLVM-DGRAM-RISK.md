> # SUPERSEDED — 2026-09-08, by block `llvmparity`
>
> **Everything below this banner is kept verbatim as the record of a claim that
> is no longer true. Do not read it as current.** It is preserved rather than
> rewritten because the same wrong premise has now been drawn from a stale
> dgram document three separate times.
>
> ## What this document claimed
>
> That **every** dgram build demotes to the C backend, reporting
> `backend c (llvm refused: libCall:dgram.onMessage)`; that only 4 of 20
> `dgram.*` lib functions were present on the LLVM tier; and that taking dgram
> onto LLVM was therefore "16 lib functions plus whatever shape and ABI
> support each needs".
>
> ## What the artifacts say now
>
> * **0 of 20 `dgram.*` names are missing on the LLVM tier.** Measured by
>   diffing the `IrLibFn` union (`ir/nodes.ts`) against `LIB_FN_SYMS` plus the
>   special cases inside `emitLibCall` (`backend/llvm/emitter.ts`), with
>   `wrtc.newPeer` as the positive control (correctly reported missing) and
>   dgram as the negative control.
> * **The absent column above is wrong item by item**, not merely stale in
>   total: `dgram.onError` is emitted at `backend/llvm/emitter.ts:14522`
>   (`scr_dgram_on_error`), and `dgram.onMessage` — the very function the
>   demotion message named — is emitted immediately above it.
> * **A dgram program builds on the LLVM tier**, read off the artifact rather
>   than off the absence of a message: `../wrtcscope/README.md` records
>   `dgram-connected2` emitting a `.ll` with no `.c`, byte-exact against the
>   node oracle, on both the `noPkg` and `withPkg` arms.
>
> ## What is still true, and is a different clause
>
> **The `wrtc.*` refusal in the same family is live.** A WebRTC program still
> prints `backend c (llvm refused: libCall:wrtc.newPeer)` and leaves a `.c`
> with no `.ll` (`../wrtcscope/README.md`). **28 of 28 `wrtc.*` lib functions**
> have no LLVM lowering — that is the real remaining gap in this area, and it
> is not the one this document sized.
>
> A demotion is not a backend, and a document is not an artifact. The tier is
> read off the emitted file.

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
