# zapo-rest — a compiled WhatsApp REST service over the SQLite store

`app/zapo-rest.ts` is one entry program that compiles to a single native
executable which runs **N real zapo WhatsApp clients at once**, persists them all
to **one SQLite file over one SQLite connection**, and serves zapo's public API
as plain JSON over HTTP.

Every zapo route is addressed to a session as `/s/<sessionId>/<route>`; an
unprefixed `/<route>` means `ZAPO_SESSION`. Five service-level routes under
`/sessions` list, create and remove them. The session id is the same string the
store puts in the `session_id` column of its 21 domain tables.

It exists here so the artifact is reproducible: the shipped folder is just the
built `.exe` plus generated docs.

## Build

```sh
# the app dir supplies the deps and the tsconfig; the entry path is absolute
cd tests/perf/zapo-rest/app && npm install
cd <worktree>
node packages/cli/dist/main.js build \
  tests/perf/zapo-rest/app/zapo-rest.ts \
  -o <out>/zapo-rest.exe \
  --provenance-sources
```

`--provenance-sources` is required: `@zapo-js/store-sqlite` is only compilable
from its attested source, and the vendored SQLite the compiler intercepts is
what the binary links (no native addon ships).

**`--best-effort` is no longer required.** It was, until `9fd92e4b`: a handful
of zapo constructs had no static lowering and the strict build stopped on the
first. The strict arm has been clean since, and it is the shipping arm — build
without the flag, so a construct that stops lowering is an error you see at
build time rather than a 501 the service reports to a caller later.

`--best-effort` is still worth running as a cross-check, because the two arms
answer different questions. Strict asks "did anything fail to lower"; best
effort asks "how many sites would have been deferred" — and a construct can
be deferred without being an error, which is why the one site left in this
program (a `scr_fence_fatal`) survives a strict build. **A zero refusal-site
count under `--best-effort` is not zero refusals**; `harness/traps.sh` counts
the deferred sites in the emitted module, and it aborts rather than scan fewer
translation units than the build produced.

### Import order is load-bearing

```ts
import { WaClient, createStore } from "zapo-js";
import { createSqliteStore, openSqliteConnection } from "@zapo-js/store-sqlite";
```

The two provenance checkouts collide on ~39 tsconfig `paths` alias keys, the
paths table is one per program, and **the first package seen wins**. With
`@zapo-js/store-sqlite` imported first, `zapo-js`'s own `@client` / `@store`
aliases are lost and its barrel fails with 21 × `SC1014 re-exports from
packages or builtin modules`. The build log names the winner:

```
provenance: 40 alias key(s) are spelled by more than one mapped package ...
  so zapo-js's answer is used for all of them            <- what you want
  so @zapo-js/store-sqlite's answer is used for all of them  <- barrel will fail
```

## The push endpoint — `/s/<sessionId>/events/ws`

`GET /events` serves the per-session event ring by polling. The same events are
also **pushed** over a WebSocket at

```
ws://<host>:<port>/s/<sessionId>/events/ws      # /events/ws for ZAPO_SESSION
    ?since=<seq>   replay from the ring (absent = live only)
    &type=<name>   only that event type
    &token=<t>     when ZAPO_REST_TOKEN is set and the client cannot send x-api-key
```

One JSON text frame per event — exactly the object `/events` returns. Service
frames use a `$`-prefixed `type` so they can never collide with a zapo event
name: `$hello` (on connect), `$gap` (events the ring dropped before you got
them), `$lag` (the window closed on you).

### The runtime had no WebSocket server

`packages/runtime/src/scr_websocket.h` is the **client** codec — masking is a
client obligation and `scr_ws_accept_key` exists only to *validate* a server's
reply. There is no server-side frame builder and no accept path in C. What the
runtime does have is the seam: `server.on("upgrade", (req, socket, head))`
fires instead of `'request'` for a `Connection: upgrade` request and hands the
socket over raw (`scr_http.c`'s upgrade arm), `createHash("sha1")…
digest("base64")` lowers, and the Buffer surface covers the framing
arithmetic. So the server half is **TypeScript in this file** and needs no
runtime change at all.

It is proven, not assumed:

| evidence | what it pins |
|---|---|
| `tests/corpus/7760-websocket-server-frames.ts` | the framing matrix against the runtime's own native WebSocket client; every outbound header printed as hex, so the 7-bit / 16-bit / 64-bit length forms and the clear mask bit are pinned as bytes. Byte-exact vs node v25.9.0 on **both** backends |
| `tests/corpus/7761-websocket-server-raw-client.ts` | fragmentation, an unmasked client frame refused with 1002, ping/pong, a client vanishing mid-frame. Byte-exact vs node on **both** backends |
| `tests/fixtures/server/cases/ws-server` | the same server judged by **Node's own built-in `WebSocket`** from a separate process — a real client, not this code talking to itself |

### Slow consumers

The service keeps **no per-subscriber buffer**. A subscriber is a few numbers
next to a socket; the only buffer in the system is the per-session ring the
polling route already used, bounded at `ZAPO_EVENT_BUFFER` (1000) entries. A
consumer that stops reading therefore cannot grow this process's memory.

What it does instead is stop being written to. The server sends at most
`ZAPO_WS_WINDOW` (64) events past the consumer's last `{"ack":<seq>}`; at the
window it emits one `$lag` frame and goes quiet. If the consumer acks, the
server catches it up from the ring — announcing a `$gap` for anything the ring
evicted in the meantime, so a consumer can always tell it lost events. If it
stays at the window for `ZAPO_WS_LAG_MS` (30 s) the server closes it with 1013
and the consumer reconnects with `?since=<its last seq>`.

An ack window rather than a byte budget because **the compiled socket surface
has no `'drain'` event and no `writableLength`** (the lowered net Socket is
write/end/destroy/pipe/setTimeout/remoteAddress/read/unshift plus
data/end/close/error/connect/timeout/readable). Byte-level backpressure is not
observable from TypeScript on this lane; an ack is arithmetic, and arithmetic
is enforceable.

## Harness

| script | what it does |
|---|---|
| `harness/surface.mjs` | enumerates zapo's public surface through the TypeScript checker (`WaClient` plus every coordinator it exposes) and writes `surface.txt` |
| `harness/coverage.mjs` | cross-references that surface against the routes the entry actually serves; writes `coverage.json` and prints the implemented/unimplemented split |
| `harness/gen-api-md.mjs` | generates `API.md`, taking each route's parameters from the handler body so the doc cannot drift from the code |
| `harness/verify.sh` | starts the binary on a fresh store, exercises the API with `curl`, drives the **multi-session isolation probe**, kills it, restarts on the same file and diffs the row counts — both through the API and straight from the database |
| `harness/isolation.mjs` | the cross-session instrument: plants asymmetric rows for three session ids on **its own** connection and reports/asserts per-session, per-table counts read directly from the file. Aborts rather than print a reassuring table of zeroes. |
| `harness/scan.sh` | the 100%-C proof, armed: engine markers beside a `--dynamic` control and beside positive controls that must be non-zero |
| `harness/traps.sh` | counts `[SCxxxx]` deferred-refusal sites and trap sites across every emitted TU |
| `harness/memrig-report.mjs` | the memory time series of one memrig run: presync, peak, settled, +30 s, +60 s, in both working set and private commit |
| `harness/memrig-rows.mjs` | row counts and history-sync integrity for a run's store — what a streaming or serialising change has to leave untouched |
| `harness/memrig-throughput.mjs` | what a sync cost in wall time, and whether the `progress` a consumer sees was monotonic |

Run `surface.mjs` and `coverage.mjs` from inside `app/` (they need its
`node_modules` for `typescript` and the zapo types).

## repro/ambient-enum-twin — a standing divergence from Node

A minimal, self-contained reproduction of a compiled-vs-Node divergence found
while building this. `pb.d.ts` declares an ambient enum; `pb.js` is its runtime
twin, the protobufjs shape. Node prints the members; the compiled binary throws
`ReferenceError: Kind is not defined`.

```sh
node tests/perf/zapo-rest/repro/ambient-enum-twin/main.ts   # prints the values
node packages/cli/dist/main.js build \
  tests/perf/zapo-rest/repro/ambient-enum-twin/main.ts -o /tmp/t.exe
/tmp/t.exe                                                  # ReferenceError
```

The mechanism: `lowerEnumMemberRead` (`lower-enums.ts:138`) folds an ambient
enum member to its constant **only** when `declTwinCompiled(sf)` is true, and
that asks whether the `.js` twin is in module order. `declTwinOf`
(`program.ts:409`) can only find it via `program.getSourceFile(stem + ".js")` —
but resolution handed the program the `.d.ts`, so the `.js` was never added and
`getSourceFile` returns undefined. The only thing that adds such a `.js` as a
root is `provenanceDeclSiblings()` (`provenance-registry.ts:192`), which walks
`<packageDir>/spec` — so the fold works for a provenance package and for
nothing else. Otherwise the read falls through to
`global.undefRead(<enumName>)` → `scr_undef_global_read` → `ReferenceError`.

This is deliberately **not** a corpus program: it would go red. It is the
evidence for the finding. The neighbouring stance — a twin-*less* `declare enum`
throwing, matching Node — is already pinned by `tests/corpus/1832-enum-modules`.
The twin-backed fold at `lower-enums.ts:138` has no test at all.

## The peak of a history sync — measured, and where it comes from

A WhatsApp history sync is the largest single thing this binary does to memory,
and the peak is what sets everything after it: a separate measurement found the
process settles at a fixed fraction of the transient climb no matter which knob
you turn, so the climb is the only lever.

Driven with **19,200 messages in 8 chunks** (`CHUNKS=8 CONVS=400 MSGS=6
TEXTLEN=300`, about 6.0 MB of message text) from a 33 MiB presync baseline, the
shipped binary reaches **211 MiB working set / 582 MiB private commit** and
settles at 147 MiB. That is **30× the payload resident and 96× committed** —
about 8.9 KiB of peak for every 320-byte message.

### It is chunk concurrency, not chunk size

`WaClientFactory` dispatches incoming stanzas fire-and-forget —

```ts
emitIncomingMessage: (event) => {
    void runtime.handleIncomingMessageEvent(event).catch(...)
}
```

— so nothing serialises `runHistorySyncNotification`. Every chunk WhatsApp
pushes decodes and persists **at the same time**, and the peak is the whole
sync rather than one chunk. Holding the total at 19,200 messages and varying
only how it is chunked shows it directly:

| chunking | peak WS | peak private |
|---|---|---|
| 1 chunk × 3200 conversations | 214 MiB | 282 MiB |
| 8 chunks × 400 | 210 MiB | 582 MiB |
| 32 chunks × 100 | 316 MiB | 1172 MiB |

Resident bytes are flat from 1 to 8 chunks — eight chunks each holding an
eighth of the sync cost the same as one chunk holding all of it, which is what
"all of them are live at once" looks like. Commit, on the other hand, scales
with the chunk **count**: each concurrent decode pays its own allocator
reservation, roughly 30–40 MiB per chunk in flight. **Cutting a sync into more,
smaller chunks makes this worse, not better.**

### What the bytes are

Holding the message count fixed and varying only the body length (`TEXTLEN`
30 / 300 / 900, peak WS 201 / 210 / 282 MiB) gives 5.1 MiB of peak per MiB of
message text and a **166 MiB intercept at zero text**. So of the ~178 MiB
climb, roughly **84% is per-message structure and 16% is the message bodies**.
The compressed blob and the inflated buffer together cannot account for more
than ~10 MiB of it: dropping the text tenfold removed 4.9 MiB of payload and
only 9.9 MiB of peak. Varying conversations against messages per conversation
at a fixed message count (2400×1 → 201 MiB, 400×6 → 210 MiB, 100×24 → 255 MiB)
says conversations are not the term either.

The dominant term is the decoded protobuf graph plus the per-message re-encode
`proto.Message.encode(webMsg.message).finish()` and the queued row it produces,
multiplied by the number of chunks in flight.

### Serialising the chunks — measured

Gating `runHistorySyncNotification` on a one-chunk-at-a-time promise, measured
on the same binary with the gate as an env knob so both arms are the same
executable:

| | peak WS | peak private | settled | +60 s | sync wall time |
|---|---|---|---|---|---|
| 19,200 msgs, as shipped | 211.05 / 210.91 MiB | 582.41 / 582.57 MiB | 146.87 / 146.02 | same | 11.87 / 10.02 s |
| 19,200 msgs, serialised | **79.22 / 78.64 MiB** | **144.25 / 144.51 MiB** | 76.17 / 75.64 | same | **5.20 / 4.30 s** |
| 38,400 msgs, as shipped | 265.80 / 265.62 MiB | 546.34 / 546.27 MiB | 175.30 / 175.99 | same | 19.15 / 23.48 s |
| 38,400 msgs, serialised | **107.16 / 107.54 MiB** | **173.82 / 175.03 MiB** | 95.70 / 96.27 | same | **15.09 / 11.21 s** |

Both numbers in each cell are the two halves of an A/A pair. **−62% peak
working set, −75% peak commit at 19,200 messages; −60% and −68% at 38,400** —
and the sync finishes *faster*, not slower, because eight concurrent decodes
thrash where one does not.

Releasing each conversation's decoded messages as they are written is a second,
independent change; on its own it moves nothing (217 MiB, inside the spread of
the unserialised arm) because the other seven chunks still hold their graphs.
It only becomes visible once the chunks are serialised.

Row counts are **identical**, not close, across every arm at both sizes:
19,200 / 38,400 history messages, 3,200 / 6,400 threads, the same
`SUM(length(message_bytes))` to the byte, no duplicate ids, no null bodies, no
orphan rows, `PRAGMA integrity_check` ok.

### The A/A floor, and a defect it exposed

Four runs of the shipped binary at the same workload give peak working sets of
210.82, 210.82, 211.44 and **247.16** MiB. The first three are a 0.29% spread;
the fourth is a different mode of the same code, and it is the run in which the
`history_sync_chunk` events arrived **out of order**:

```
progress [13,25,38,50,63,75,88,100]   monotonic     3 of 4 runs
progress [13,38,50,63,75,88,100,25]   NOT monotonic 1 of 4 runs
```

A consumer polling `/events` in that run sees progress reach 100 and then fall
back to 25, and 25 is the last value it ever sees. This is the concurrent path,
not a rig artefact — chunk 2 simply finished after chunk 8. It happened in 2 of
7 unserialised runs and in **0 of 4** serialised ones, where completion order is
arrival order by construction. So quote a per-arm floor that includes both
modes (17% on peak WS) unless the arm is serialised, in which case it is under
1%.

### A chunk that dies mid-write

The receipt that tells the phone a chunk is done (`onProcessed`) is sent only
after that chunk's writes are flushed, and every store write is
`INSERT … ON CONFLICT(session_id, message_id) DO UPDATE SET …`. So an
interrupted chunk is simply not acked and is resent, and re-applying it is a
no-op for the rows that already landed. Measured by SIGKILLing the binary two
seconds into a sync and re-running the same payload against the same file:

| | rows after the kill | after the resync |
|---|---|---|
| serialised | 4,800 messages / 800 threads — exactly two whole chunks | 24,000 = 4,800 + 19,200 |
| as shipped | 2,400 messages / 401 threads — partial across chunks | 21,600 = 2,400 + 19,200 |

`integrity_check` ok, no duplicate ids and no null bodies in either partial
store. The resync adds its full 19,200 (the rig mints fresh message ids each
run, so the totals add) while threads coalesce to exactly 3,200 — the upsert
merging as it should. Note that the store has **no chunk-level atomicity today
and does not want any**: `upsertBatch` commits ≤250 rows per transaction on the
write-behind queue's own schedule, which has never lined up with chunk
boundaries. Serialising the chunks does not change that; it only makes the
partial store land on a chunk boundary more often.

### Running it

The rig is `packages/fake-server/memrig.ts` in the zapo checkout: it drives this
binary through pairing and the whole post-login sequence with no phone, and
samples the child's `WorkingSet64`/`PrivateMemorySize64` kernel-side. The three
scripts here read what it leaves behind, and every one of them takes the run
directory as an argument and exits 2 when it cannot look — a hardcoded run root
that has moved prints a clean table of zeroes and is believed.

```sh
CHUNKS=8 CONVS=400 MSGS=6 TEXTLEN=300 IDLE_S=60 \
  node --import tsx memrig.ts <exe> <tag>
node harness/memrig-report.mjs     <runRoot> <tag>     # presync/peak/settled/+30/+60
node harness/memrig-rows.mjs       <runRoot> <tag>...  # row counts and integrity
node harness/memrig-throughput.mjs <runRoot> <tag>...  # wall time and progress order
```
