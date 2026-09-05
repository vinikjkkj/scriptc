# zapo-rest

A **single compiled Windows executable** that runs **any number of real WhatsApp
sessions at once**, keeps them all in **one SQLite file**, and exposes zapo's
public API as a plain-JSON HTTP service you can drive from `curl` or any HTTP
client.

No Node. No `node_modules`. No repo checkout. One `.exe` and one `.sqlite` file —
however many WhatsApp accounts you put in it.

---

## Start it

```sh
zapo-rest.exe
```

That is the whole command. On first run it will:

1. create (or open) `zapo-state.sqlite` in the current directory and run its migrations,
2. start serving on `http://127.0.0.1:8787`,
3. bring up the **default session** (`ZAPO_SESSION`, default `default`), connect it
   to WhatsApp and **print a QR code string to stdout**.

**Scan that QR with your phone** (WhatsApp → Settings → Linked devices → Link a
device). Once paired, the credentials are written to the SQLite file and every
later start reuses them — you scan once, not every run.

While you are waiting, the QR is also available over HTTP:

```sh
curl -s http://127.0.0.1:8787/qr
```

and the service is live from the moment it starts:

```sh
curl -s http://127.0.0.1:8787/health
```

### More than one WhatsApp account

Add sessions at run time. Each gets its own client, its own connection to
WhatsApp and its own QR; all of them share the one SQLite file.

```sh
curl -s -X POST 'localhost:8787/sessions/create?id=work'
curl -s -X POST 'localhost:8787/sessions/create?id=personal'

curl -s localhost:8787/sessions          # list them all
curl -s localhost:8787/s/work/qr         # the QR for 'work'
curl -s localhost:8787/s/personal/qr     # a different QR, same process, same file
```

Sessions are remembered: restart the executable and every session comes back,
still paired, still separate. See "Sessions" below.

---

## Configuration

Everything is an environment variable; all have working defaults.

| variable | default | meaning |
|---|---|---|
| `ZAPO_REST_HOST` | `127.0.0.1` | bind address. **Left on localhost on purpose** — this process holds a live WhatsApp session. |
| `ZAPO_REST_PORT` | `8787` | port |
| `ZAPO_REST_TOKEN` | *(empty)* | when set, every request must carry `x-api-key: <token>` or it gets 401 |
| `ZAPO_DB` | `zapo-state.sqlite` | the SQLite file |
| `ZAPO_SESSION` | `default` | the **default** session — the one an unprefixed route such as `/health` is addressed to. Other sessions live beside it in the same file. |
| `ZAPO_AUTOCONNECT` | `1` | `0` to start serving without connecting the sessions restored at boot (then `POST /s/<id>/connect`). It does **not** gate `POST /sessions/create`, which takes its own `autoconnect` parameter. |
| `ZAPO_EVENT_BUFFER` | `1000` | how many events `/events` and `/messages` keep in memory |
| `ZAPO_CONNECT_TIMEOUT_MS` | `30000` | socket connect timeout |
| `ZAPO_DEVICE_BROWSER` | `Chrome` | the device name your phone will show |
| `ZAPO_DEVICE_OS` | `Windows` | the device platform your phone will show |
| `ZAPO_SQLITE_CACHE_KB` | `16000` | SQLite page cache in KiB. `0` = leave zapo's default (2 MiB). See "Operational notes". |
| `ZAPO_WS_URL` | *(empty)* | override the WhatsApp endpoint. For testing against a local fake server; leave unset for real WhatsApp. |

A typical real-use start:

```sh
ZAPO_REST_TOKEN=$(openssl rand -hex 16) ZAPO_DB=C:/wa/state.sqlite zapo-rest.exe
```

---

## The API in one minute

Full reference with every route, its parameters and a `curl` example:
**[`API.md`](./API.md)**.

The convention is that a zapo method `client.<group>.<method>(...)` is the route
`/<group>/<method>`. If you know zapo, you can guess the route.

**Every such route is addressed to one session**, and the session is named in the
path:

```
  /s/<sessionId>/<route>      e.g.  GET /s/work/store/threads
  /<route>                    the same route on ZAPO_SESSION
```

An unknown session id is a clean **404**; a malformed one is a **400**. Neither
reaches a handler, so no zapo call ever runs without a session behind it.

Every route accepts **both** a query string and a JSON body; they are merged into
one parameter bag. So a read works as a plain `GET` with query parameters, and a
write works as a `POST` with JSON — but either spelling works on either.

```sh
# is it alive, is it paired, how big is the store
curl -s localhost:8787/health

# the pairing QR
curl -s localhost:8787/qr

# send a message
curl -s -X POST localhost:8787/message/sendText \
     -H 'content-type: application/json' \
     -d '{"to":"5511999999999","text":"hello from a compiled binary"}'

# ... the same thing as a query string
curl -s 'localhost:8787/message/sendText?to=5511999999999&text=hello'

# the generic form: /message/send takes a typed content object, dispatched on
# content.type (text|reaction|revoke|pin|unpin|poll|image|video|audio|
# document|sticker), which is the same set the dedicated routes cover
curl -s -X POST localhost:8787/message/send      -H 'content-type: application/json'      -d '{"to":"5511999999999","content":{"type":"text","text":"hi"}}'

# download the media of a message this process received; seq is the number
# /messages reports for it
curl -s 'localhost:8787/message/downloadBytes?seq=12'

# incoming messages since sequence 0
curl -s 'localhost:8787/messages?since=0&limit=20'

# every event, not just messages
curl -s 'localhost:8787/events?since=0'

# the sessions, and the same routes addressed to one of them
curl -s localhost:8787/sessions
curl -s 'localhost:8787/sessions?rows=1'
curl -s localhost:8787/s/work/health
curl -s -X POST localhost:8787/s/work/message/sendText \
     -H 'content-type: application/json' \
     -d '{"to":"5511999999999","text":"from the work account"}'

# what is in the store -- `total` is the whole file, `session` is this session's
curl -s localhost:8787/store/counts
curl -s 'localhost:8787/store/threads?limit=20'
curl -s 'localhost:8787/store/messages?thread=5511999999999@s.whatsapp.net&limit=50'
curl -s 'localhost:8787/store/contacts?limit=50'

# groups
curl -s localhost:8787/group/queryAllGroups
curl -s 'localhost:8787/group/queryGroupMetadata?groupJid=12345@g.us'
curl -s -X POST localhost:8787/group/addParticipants \
     -H 'content-type: application/json' \
     -d '{"groupJid":"12345@g.us","participants":["5511999999999@s.whatsapp.net"]}'
```

### Responses

Success is `{"ok":true,"result":...}`. Failure is `{"error":"...","detail":"..."}`
with a status:

| status | meaning |
|---|---|
| 400 | missing required parameter, the body is not JSON, or the session id is malformed |
| 401 | `ZAPO_REST_TOKEN` set and `x-api-key` missing or wrong |
| 404 | no such route, **or no such session** |
| 500 | zapo threw — not connected, WhatsApp refused, etc. `detail` has the message |
| **501** | **the compiler has no static lowering for this zapo method.** `diagnostic` carries the `[SCxxxx]` code. |

The 501 case is worth understanding: this binary is compiled ahead of time, so a
zapo construct with no static lowering becomes a per-statement runtime refusal
rather than a missing route, and the service turns that into a 501 that **names
the compiler diagnostic**. **This build is compiled strictly and no such
construct is left on any routed path**, so no route answers 501 (see "What
still refuses" below for the one deferred site that remains, which no route
reaches). The classifier stays because the alternative is a route that vanishes
or a process that dies.

### Receiving messages

Polling. `GET /messages?since=<seq>` returns everything after that sequence
number; take `seq` from the last item you saw and pass it back. `GET /events`
does the same across every event type (`connection`, `receipt`, `presence`,
`chatstate`, `call`, `group`, `newsletter`, `auth_qr`, ...).

There is no webhook and no SSE stream in this build — see "Not implemented".

The event ring is **per session**: `/s/work/messages` and `/s/personal/messages`
keep separate sequence numbers, and a `seq` from one is meaningless to the other.

---

## Sessions

One process, N WhatsApp accounts, one SQLite file, **one SQLite connection**.

### The identifier

A session is named by an id of **1-64 characters from `A-Za-z0-9` and `. _ -`**.
That id is the same string the store writes into the `session_id` column of all
21 of its domain tables, so the name a caller uses and the name the rows carry
are one value — there is no mapping table to drift, and a row's owner is legible
from the database with a plain `SELECT`.

### The routes

| route | what it does |
|---|---|
| `GET /sessions` | list every session: id, live or not, paired, connected, whether a QR is waiting, counters. `?rows=1` adds per-session row counts read from the database. |
| `POST /sessions/create?id=<id>` | build a session and (unless `autoconnect=0`) start connecting it, which is what produces its QR. Also takes `label`. |
| `POST /sessions/remove?id=<id>` | **stop the client and forget it. Every data row is KEPT.** |
| `POST /sessions/remove?id=<id>&purge=1` | the same, and then `DELETE` every row the session owns from all 21 tables. Irreversible; it un-pairs the account. |
| `GET /sessions/rows?id=<id>` | per-table row counts for one session, from the database. |
| `GET /sessions/connection` | proves the one-connection claim, with a negative control (see below). |

**Removal never deletes by accident.** A plain `remove` stops the client, drops
the service's registry row, and leaves every WhatsApp credential and message row
in place — so `POST /sessions/create?id=<same id>` afterwards resumes the same
paired account. Deleting the data needs the explicit `purge=1`, and the response
reports the before/after row counts per table so you can see exactly what went.

### They survive a restart

The set of sessions is recovered from the file, not from memory or a config: the
service's own `zapo_rest_sessions` table, plus **every distinct `session_id`
present in any of the 21 domain tables**. So a session whose registry row was
removed but whose rows remain comes back, and a session that a previous build
wrote comes back too.

### One connection, one file

Every session's stores go through the *same* SQLite connection.
`openSqliteConnection` keys its process-wide connection cache on
`driver|path|pragmas|tableNames` — **the session id is not part of that key** —
and `BaseSqliteStore.getConnection()` is the only route a domain store has to
SQLite, so all 15 domains of all N sessions land on one `better-sqlite3`
`Database`.

`GET /sessions/connection` demonstrates it rather than asserting it. A SQLite
`TEMP` table is private to one connection, so the route writes a token into one
and then reads it back through (a) a handle opened with the stores' exact
options, which must see it, and (b) a **negative control** opened on the same
file with a different pragma set — a genuinely separate connection, which must
*not*. A run where both see the token is reported as `INCONCLUSIVE`, not as a
pass.

Because there is one connection and `better-sqlite3` is synchronous, two
sessions' statements cannot interleave at all; and `runInTransaction` serialises
transactions on that connection through an explicit promise tail
(`connection.ts`, `wrapConnection`). Concurrency between sessions is therefore
not a race this service has to manage.

### Cross-session isolation

This is the hazard that outranks everything else here: two sessions in one file
means a query missing its `session_id` returns plausible data belonging to
someone else. It is checked, not assumed:

* all **124** SQL statements in `@zapo-js/store-sqlite` that name a
  session-scoped table are qualified by `session_id` (the two that build their
  `WHERE` from a variable build it as `session_id = ? AND ...`), and
  `session_id` is in the PRIMARY KEY of every one of the 21 tables;
* `harness/isolation.mjs` plants deliberately asymmetric rows for three session
  ids, then compares what each session's routes return against counts read
  **directly from the file with its own connection** — never through the API
  that would confirm its own bug;
* `harness/verify.sh` runs that end to end, including a session removed while
  another keeps serving, a restart, and unknown/empty/over-long identifiers.

---

## What is *not* implemented, and why

`API.md` ends with the full table: **40 of zapo's 210 public client members are
not routed**, each with its reason. Nothing is omitted silently. The reasons fall
into a few groups:

* **EventEmitter plumbing** (`on`/`off`/`emit`/`listenerCount`/... — 15 members).
  Not REST operations; the event stream is `GET /events` instead.
* **Callback registration** (`ignoreKey`, `lowlevel.registerIncomingHandler`, ...).
  These take a function and return an unsubscribe handle; that cannot cross an
  HTTP boundary.
* **Internal protocol plumbing** (`auth.persistServerStaticKey`,
  `auth.handleIncomingIqSet`, ...). Driven by the connection state machine, not
  by a user.
* **Private key material** (`auth.getCurrentCredentials`). Deliberately not
  exposed; `GET /credentials` reports presence only.
* **Media/stream handles** (`message.download` returns a `Readable` the caller
  must own, `message.upload`, `profile.setProfilePicture`,
  `business.updateCoverPhoto`). Use `/message/downloadBytes`,
  `/message/downloadToFile` and `/message/sendMedia` (which takes a file path
  the server process can read). The two download routes take the **`seq`** of a
  message this process received — the number `/messages` and `/events` report —
  rather than a hand-written JSON message: the mediaKey, directPath and
  fileEncSha256 a download needs only ever came from a real incoming event, and
  zapo's parameter is a union an open JSON record cannot become.
* **`chat.set` / `chat.remove`**: the argument is a 60-arm app-state schema
  union with no stable JSON spelling. The named per-collection routes
  (`/chat/setChatPin`, `/chat/setChatMute`, ...) cover the same ground.

### What still refuses, and what no longer does

Two numbers, and they are not the same number. A **strict** build (no
`--best-effort`) stops on a construct with no static lowering; `--best-effort`
turns each one into a per-statement runtime throw instead, so the count to
watch is the number of DEFERRED SITES in the emitted module, not whether the
build succeeded.

| arm | `958b912f` | `b6aac7aa` | `c02b73ca` | `d97d74e3` (this build) |
|---|---|---|---|---|
| strict, no `--best-effort` | 14 errors | 1 error | 0 errors, 1 advisory | **0 errors, 1 advisory** |
| `--best-effort`, deferred sites in the emitted module | 15 by the bracket scan | 4 sites (1 bracket) | 1 site (1 bracket) | **1 site (1 bracket)** |
| `scr_trap` call sites | — | — | 3, all compiler helpers | **3, all compiler helpers** |

`958b912f` is the 29,085,696-byte binary shipped on 2026-09-04; `b6aac7aa` is
the revision that first carried this file; `c02b73ca` is the single-session
build this one replaces. **This binary is built strictly** — the
`--best-effort` column is now a cross-check, not the shipping arm.

Adding N sessions moved none of these numbers. The one advisory is the same
`SC6003` in zapo's own `credentials-flow.ts:204`, and the three `scr_trap`
sites are the compiler's own `sc_oom`, `sc_bad_tag` and `sc_bad_key` helpers —
none emitted into program code.

Both arms were built from the same tree into separate caches. The executables
are **27,940,864 bytes, the same to the byte**; their md5s differ only because
each embeds the absolute path of the provenance checkout its own arm used
(11 occurrences each, `.../prov/` versus `.../prov-be/`), which grows `.rdata`
by 48 bytes and shifts every downstream RIP-relative displacement. Neither
binary contains the other's path.

The deferred numbers across columns are not one measurement: the oldest scan
counted `[SCxxxx]` markers inside message text, and only some refusals spell
one. The bracket count is printed beside the site count so the difference is
visible rather than inferred.

What closed the strict arm was `9fd92e4b`, *a bound subscribe reads its slot
off the bind's own type*. The one strict error and three of the four deferred
sites were the same construct: **`client.on.bind(client)`** (and `.off`,
`.once`) in zapo's own `src/client/plugins/install.ts:77`, an EventEmitter
surface monomorphized per event. All four are gone.

**One deferred site is left, and it is deliberate**: `require()` with a
run-time specifier, one statement inside the vendored minified protobufjs at
`spec/proto/index.js` (protobufjs's `inquire()`, a `require()` in a
`try`/`catch`). It is emitted as `scr_fence_fatal`, the refusal that is *not*
catchable, precisely so `inquire()` cannot swallow it into the `null` it
would hand back on any other platform. `scr_runtime.h` documents the site as
the one construct that opts into that treatment. It survives a strict build
because a fence is not a compile error.

The strict arm's one advisory is `SC6003` on
`src/auth/credentials-flow.ts:204` in zapo's own source — a projection that
copies `readyState` off a socket whose methods write it. Advice, not a
refusal; the build succeeds and nothing is deferred.

Both arms were built from the same tree into separate caches and agree: the
executables are the same size to the byte, and the emitted modules differ in
exactly two string literals, both of which embed the absolute path of the
provenance checkout each arm used.

Everything else the shipped binary used to defer now compiles: the
`/message/send` content object, both download routes, and seven lowerings in
zapo's and `@zapo-js/store-sqlite`'s own source (`RegExp` in a template,
`RegExp.toString`, `Object.freeze` of a checked-then-published local, a
function replacement over a runtime-built regex, `new Set(otherSet)`,
`Math.max` with a mixed spread list, `clearTimeout` of an optional handle, a
`?? new Map()` default, and `promisify(deflate)` with `{ level }`).

`harness/traps.sh` is what counts these. Give it the directory the build
emitted into and the number of translation units the build produced; it
aborts rather than report a partial scan, and it prints both the SITE count
and the (smaller, misleading) count of messages that spell `[SCxxxx]` inline.

Also not present in this build:

* **A QR *image*.** `/qr` returns the QR *string*. zapo does not ship a QR
  renderer, and nothing in the binary can produce a PNG. Any QR encoder will
  turn the string into an image; the terminal output is the intended path.
* **Webhooks / SSE.** Receiving is poll-only (`/messages`, `/events`).
* **Auto-reconnect.** zapo does not reconnect by itself. Watch for a
  `connection` event with `status: "close"` on `/events` and `POST /connect`.

---

## Operational notes

* **The SQLite page cache — zapo's default is small, and this service raises it.**
  zapo's `store-sqlite` `connection.ts` defaults to `journal_mode=WAL`,
  `synchronous=normal` and `busy_timeout=5000`, and **does not set
  `cache_size`** — so out of the box the database runs on SQLite's compiled-in
  2 MiB page cache, which is small for a long-lived server with a real message
  archive. `cache_size` *is* on store-sqlite's allowed-pragma list, so it is a
  supported knob rather than something needing a patch, and zapo's source is
  **not** modified here.

  This service therefore passes `cache_size = -16000` (16 MiB) by default.
  Override with `ZAPO_SQLITE_CACHE_KB`, or set `ZAPO_SQLITE_CACHE_KB=0` to leave
  zapo's behaviour exactly as shipped. `GET /health` reports which is in effect.
* **Bind address.** The default is `127.0.0.1` deliberately. This process holds a
  live WhatsApp session; do not put it on a public interface without a
  reverse proxy, TLS and `ZAPO_REST_TOKEN` set.
* **One writer.** Run one instance per SQLite file. WAL tolerates concurrent
  readers, but two servers on one file writing the same session will fight.
* **Logout is one-way.** After `POST /logout` the client instance is spent;
  restart the process to pair again.
* **Memory: the fiber-stack pool, and how to see it.** Every awaiting call in
  this binary owns a real stack, and a finished one goes back to a pool
  rather than being freed — that is what keeps a burst of concurrent work
  from paying the page-fault bill twice. The pool is capped
  (`SCR_FIBER_POOL`, default 4096) and, since this build, it also *decays*:
  every `SCR_FIBER_POOL_DECAY_MS` (default 5000) it frees half of whatever
  sat idle for the whole window, so a burst's high-water mark comes back
  down instead of being held until the process exits.

  **This is the first build that can be asked whether the pool is involved
  in a given memory climb.** Set `SCR_FIBER_POOL_STAT=1` and the process
  writes one line per window to **stderr**:

  ```
  [fiberpool] window freed=0 idle=12 lo=0 decayedTotal=0
  [fiberpool] window freed=3 idle=9 lo=6 decayedTotal=3
  [fiberpool] window freed=2 idle=7 lo=3 decayedTotal=5
  ```

  `idle` is how many stacks the pool is holding right now, `lo` the number
  that were idle at every instant of the window (the provably surplus ones),
  `freed` how many this window released. Read `idle` during and after a
  history sync: if it climbs into the thousands the pool is holding the
  memory, and if it stays in the tens it is not and the climb is elsewhere.
  A window that frees nothing still prints, so "no lines at all" means the
  decay is off (`SCR_FIBER_POOL_DECAY_MS=0`) rather than idle — the two are
  distinguishable readings. Measured on the HTTP path the pool has not been
  seen above 189 stacks against the 4096 cap, so **the decay is not known to
  fix an idle-10-MB-to-70-MB climb**; the instrument is here to settle it.

---

## What was verified, and what was not

Verified against this exact binary:

* it builds, starts, creates and migrates the SQLite file, and serves the API;
* the API answers over a real socket to `curl` — routing, query parameters, JSON
  bodies, the `x-api-key` gate, 400/401/404, and the 501 classifier;
* **persistence across a restart**: the process was killed and restarted on the
  same file and the store came back with the same row counts — measured twice,
  through `/store/counts` and by reading the file directly;
* **four sessions in one file**: `harness/verify.sh` makes 59 assertions, all
  passing, over three named sessions plus the default. Each one's reads return
  only its own rows; a session addressed while another is mid-call is
  unaffected; one session is removed while another keeps serving; all of them
  come back across a restart, still separate; unknown, empty, over-long and
  space-bearing identifiers answer 404/400 rather than crashing; and the
  per-session row counts are read straight from the database with a second
  connection, not through the API under test;
* **two live WhatsApp sessions at once**: this exact binary was started, two
  sessions created, and **both connected to `wss://web.whatsapp.com/ws/chat`
  and were issued their own distinct pairing QR simultaneously**, in one
  process, over one SQLite file;
* **one connection**: `GET /sessions/connection` reported
  `storeOptionsHandle.seesTheTempRow=true` with the different-pragma negative
  control at `false` — so the probe discriminates, and the answer is that every
  session's stores share one `better-sqlite3` connection;
* **`purge=1` deletes only its own session**: the throwaway session's five rows
  went and every other session's counts were unchanged, before and after,
  read from the file;
* it opens a real WebSocket to `wss://web.whatsapp.com:5222/ws/chat`, completes
  the noise handshake and is issued a QR (`harness/verify.sh` prints the run
  log);
* `POST /message/send` with a `content` OBJECT reaches zapo — it answers zapo's
  own "sendMessage requires registered meJid" on an unpaired session, where it
  used to answer 501 — and both download routes answer 400 for a missing `seq`
  and a named 500 for a `seq` the buffer no longer holds;
* the binary is 100% statically compiled — no embedded JavaScript engine.
  `harness/scan.sh` reads 0 for `quickjs` and `ScrDyn` against a known
  `--dynamic` control that reads non-zero for both, with `mbedtls_`,
  `deflate`, `inflate` and `sqlite3_` non-zero as positive controls so the
  scan is visibly not blind, and no `libqjs.a` exists anywhere under the
  build tree, so `ensureEngineArchive` never ran;
* the `[fiberpool]` instrument is live: started with `SCR_FIBER_POOL_STAT=1`
  the process printed one window line every 5 s and the pool visibly drained
  (`idle` 12 to 6 over five windows).

**Not verified: a live WhatsApp conversation.** Pairing requires scanning the QR
with a real phone, which only you can do. So sending and receiving against the
real WhatsApp service has **not** been exercised end to end for this binary —
for one session or for several. What *is* verified is that two sessions reach
WhatsApp and are each issued a QR at the same time; what happens after two
phones scan two QRs in one process is untested and is not being asserted.

**Also not verified: message traffic arriving on two paired sessions at once.**
The isolation evidence above uses rows planted directly in the database and
credentials created through zapo's own `auth.loadOrCreateCredentials`, which
exercises the same session-qualified store paths that inbound traffic writes
through — but it is planted data, not received data.

No test credentials are bundled and no recorded session ships with this folder.
Your first run is the scan.
