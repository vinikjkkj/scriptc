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
