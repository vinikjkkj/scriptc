# `zapo-rest-182-nobuf.exe` — zapo-js 1.8.2, **no event buffer**

Run it with `start-182-nobuf.cmd`. It listens on **port 8789**, so it collides
with neither the live service on 8787 nor `zapo-rest-182.exe` on 8788, and it
uses its own database file.

---

## 1. What changed, and it will break polling code on purpose

**This build keeps no event history.** An event is delivered to whatever
WebSocket subscribers are connected *at that moment* and is then dropped. There
is no ring, no replay, and no way to ask for anything that has already happened.

**You must subscribe before the traffic you care about.** A client that connects
a second late has missed that second, permanently. That is the requested
behaviour, not a regression.

Three concrete differences from `zapo-rest-182.exe`:

**`GET /s/<id>/events` and `GET /s/<id>/messages` answer `410 Gone`.**

```json
{"error":"gone",
 "reason":"this build retains no events; listen on the websocket before the traffic you want",
 "websocket":"/s/<sessionId>/events/ws",
 "detail":"no event retention: … The session is at seq 29."}
```

They do **not** answer an empty list. An empty list is exactly what the old
build returns when nothing has happened yet, so a caller could not tell "quiet"
from "this build will never tell you". A `410` is unambiguous, names the route
that does work, and tells you the session's current `seq` so you can start from
a known point. The routes still exist rather than 404-ing, so you cannot mistake
this for a typo in your URL.

**`?since=<seq>` on the WebSocket no longer replays.** It returns a `$gap` frame
naming exactly what you will never see:

```json
{"type":"$gap","fromSeq":1,"toSeq":131,
 "reason":"this build retains no events; anything that happened before you subscribed is gone"}
```

**`$hello` reports `retention: "none"` and has no `buffered` field.** If your
client reads `buffered`, it will find it absent rather than zero — deliberately,
because zero would read as "the ring is empty" rather than "there is no ring".

### `$gap` under load is normal, and the old build does it too

If a subscriber stops acking, it hits the 64-event window and stops being
written to; when it catches up it gets a `$gap` for what it missed. Measured on
a 1,500-message burst, on the same repetition:

| | `zapo-rest-182.exe` | this build |
|---|---|---|
| `$lag` frames | 34 | 2 |
| `$gap` frames | 1 (317 events lost) | 2 |

The old build lagged **17× more often** and recovered most of it from the ring —
but it too hit a gap it could not cover. **Neither build loses events silently.**
Every lost range is named in a `$gap`. This build simply has nothing to recover
from, which is what removing the buffer means.

### The delivery guarantee still holds

A subscriber attached before the traffic receives everything, verified on both
builds through the same script:

| | `zapo-rest-182.exe` | this build |
|---|---|---|
| early subscriber | 128 events, seq 4..131, **0 missing** | 116 events, seq 4..119, **0 missing** |
| late subscriber (`?since=0`) | replayed **131** events | replayed **0**, one `$gap` |

## 2. The memory answer

**On a message-heavy service it saves ~2.7 MiB of settled memory per session.
On a workload like a history sync it saves nothing measurable.** Both are
measured, not estimated.

| workload | events in the ring | settled working set | verdict |
|---|---|---|---|
| 1,500 live messages | 1,000 (the cap) | **127.11 → 124.45 MiB, −2.66 MiB (−2.10%)** | real, p = 0.0095 |
| history sync (the documented one) | 29 | 104.18 → 104.78 MiB | **draw** — no difference, p = 0.43 |

**Peak memory does not change at all** (−0.06%, a draw). The buffer costs
retained memory, not peak.

Both figures sit against a measured floor of **±0.43%** on settled working set,
established by running the *same binary* against itself and comparing only
within one allocation mode; 58 runs in total. Peak working set on this host is
bimodal — a run either lands near 184 MiB or near 214 MiB, about a fifth to a
third of the time, independent of which build is running — so any comparison
that ignores that will report differences that are not there.

The saving works out at **2,794 bytes per retained event**, so it scales with
`ZAPO_EVENT_BUFFER` in the old build: the default 1,000 costs ~2.7 MiB per
session, and a 10,000-entry ring would cost ~27 MiB.

### Where the memory actually is, which is not the buffer

The old build's ring never held the message payloads. `push()` and
`rememberMessage()` were handed the *same object*, so the ring and the typed
message array (the one `message.download*` reads from) held one set of payloads
between them. Removing the ring frees the per-event wrapper — those 2,794 bytes
— and **not one message payload**.

Those payloads are still retained here, at the same cap of 1,000, because the
download routes need them. This build gives them their own knob:

```
set ZAPO_MSG_KEEP=0
```

Set it to `0` if you never call `/message/downloadBytes` or
`/message/downloadToFile` and want that memory back. In the old build one knob
capped both and they could not be separated. An attempt to measure this arm did
not reach a conclusion — the control side survived only 2 usable repetitions —
so no saving is claimed for it.

## 3. This build is on the LLVM tier

Same program and same source as `zapo-rest-182.exe`, **different compiler
backend**. `zapo-rest-182.exe` was compiled through C because zapo-js 1.8.2 hit
a `WeakMap` construct the LLVM tier could not lower; that work landed, and this
build emits `.ll` with no `.c` alongside it.

| | `zapo-rest-182.exe` | `zapo-rest-182-nobuf.exe` |
|---|---|---|
| backend | C | **LLVM** |
| size | 32,368,640 bytes | **31,262,720 bytes** |
| build | strict, `rc=0` | strict, `rc=0` |
| refusal sites | — | **0** |
| toolchain | — | zig 0.16.0, `x86_64-windows-gnu` |

Two things follow. The backend change is **not** controlled for in the memory
figures above — those compare no-buffer against buffered *on the LLVM tier both
sides*, which is the honest comparison, but it means you should not diff this
binary's memory against `zapo-rest-182.exe` and attribute the difference to the
buffer. And since this is the first LLVM-tier 1.8.2 binary to leave the bench,
treat unfamiliar behaviour as worth reporting rather than assumed.

## 4. The database is a separate file, and the migration is one-way

`start-182-nobuf.cmd` points `ZAPO_DB` at **`zapo-state-182-nobuf.sqlite`** — not
your live `zapo-state.sqlite`, and not the 8788 build's `zapo-state-182.sqlite`.

This binary carries `@zapo-js/store-sqlite` 1.2.0, which has four migrations the
1.0.2 binaries do not: `0017`/`0018`/`0020` each add one nullable column, and
`0019` creates `chat_metadata_cache`. They are applied the first time this `.exe`
opens a database file and they are **one-way** — there is no down migration.
They are strictly additive, so the older `zapo-rest*.exe` keep working on a
migrated file; the risk is not corruption, it is that you cannot go back.

Out of the box this starts an **empty session** and asks you to scan a QR. Your
live store is not touched or migrated.

To try it against your existing paired session, copy the live files first — all
three, while the live service is stopped:

```
copy zapo-state.sqlite      zapo-state-182-nobuf.sqlite
copy zapo-state.sqlite-wal  zapo-state-182-nobuf.sqlite-wal
copy zapo-state.sqlite-shm  zapo-state-182-nobuf.sqlite-shm
```

The copy gets migrated on first open; the original stays as it is. Only point
`ZAPO_DB` at the live file once you have decided the one-way migration is what
you want.

## 5. Knobs

| variable | default | what it does |
|---|---|---|
| `ZAPO_REST_PORT` | `8789` | chosen to collide with neither 8787 nor 8788 |
| `ZAPO_DB` | `zapo-state-182-nobuf.sqlite` | its own file; see §4 |
| `ZAPO_REST_TOKEN` | unset | set it and every request must send `x-api-key` |
| `ZAPO_MSG_KEEP` | `1000` | incoming messages kept readable by `message.download*`. **Not** the event ring — that is gone and has no knob |
| `ZAPO_WS_WINDOW` | `64` | events a subscriber may fall behind before it stops being written to |
| `ZAPO_WS_LAG_MS` | `30000` | how long it may sit there before being closed with `1013` |

`ZAPO_EVENT_BUFFER` **does not exist in this build.** Setting it does nothing.
