# zapo-rest

A **single compiled Windows executable** that runs a real WhatsApp client, keeps
everything in a **SQLite file**, and exposes zapo's public API as a plain-JSON
HTTP service you can drive from `curl` or any HTTP client.

No Node. No `node_modules`. No repo checkout. One `.exe` and one `.sqlite` file.

---

## Start it

```sh
zapo-rest.exe
```

That is the whole command. On first run it will:

1. create (or open) `zapo-state.sqlite` in the current directory and run its migrations,
2. start serving on `http://127.0.0.1:8787`,
3. connect to WhatsApp and **print a QR code string to stdout**.

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

---

## Configuration

Everything is an environment variable; all have working defaults.

| variable | default | meaning |
|---|---|---|
| `ZAPO_REST_HOST` | `127.0.0.1` | bind address. **Left on localhost on purpose** — this process holds a live WhatsApp session. |
| `ZAPO_REST_PORT` | `8787` | port |
| `ZAPO_REST_TOKEN` | *(empty)* | when set, every request must carry `x-api-key: <token>` or it gets 401 |
| `ZAPO_DB` | `zapo-state.sqlite` | the SQLite file |
| `ZAPO_SESSION` | `default` | session id; one database file can hold several sessions |
| `ZAPO_AUTOCONNECT` | `1` | `0` to start serving without connecting (then `POST /connect`) |
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

# incoming messages since sequence 0
curl -s 'localhost:8787/messages?since=0&limit=20'

# every event, not just messages
curl -s 'localhost:8787/events?since=0'

# what is in the store
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
| 400 | missing required parameter, or the body is not JSON |
| 401 | `ZAPO_REST_TOKEN` set and `x-api-key` missing or wrong |
| 404 | no such route |
| 500 | zapo threw — not connected, WhatsApp refused, etc. `detail` has the message |
| **501** | **the compiler has no static lowering for this zapo method.** `diagnostic` carries the `[SCxxxx]` code. |

The 501 case is worth understanding: this binary is compiled ahead of time, and a
handful of zapo constructs have no static lowering yet. Rather than omit those
routes, the build defers them to a runtime refusal, and the service turns that
into a 501 that **names the compiler diagnostic**. So an unsupported method tells
you exactly why it is unsupported instead of vanishing, and it cannot take the
process down.

### Receiving messages

Polling. `GET /messages?since=<seq>` returns everything after that sequence
number; take `seq` from the last item you saw and pass it back. `GET /events`
does the same across every event type (`connection`, `receipt`, `presence`,
`chatstate`, `call`, `group`, `newsletter`, `auth_qr`, ...).

There is no webhook and no SSE stream in this build — see "Not implemented".

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
  the server process can read).
* **`chat.set` / `chat.remove`**: the argument is a 60-arm app-state schema
  union with no stable JSON spelling. The named per-collection routes
  (`/chat/setChatPin`, `/chat/setChatMute`, ...) cover the same ground.

### Routes that answer 501 in this build

These are not guesses: the deferred refusals were counted in the emitted C of
the shipped binary (15 sites across the 14 translation units the program is
split into) and mapped back to their source. Everything else compiled
statically.

| route | code | why |
|---|---|---|
| `POST /message/send` **with a `content` object** | `SC2003` | an open `Record<string, unknown>` cannot be re-tagged into zapo's message-content union. **`text` works** — use `POST /message/sendText`, or `/message/send` with `text`, or `/message/reply`, `/message/react`, `/message/poll`, `/message/sendMedia`, all of which build a typed literal. |
| `POST /message/downloadBytes` | `SC2003` | same: the `message` parameter is an open record going into a union |
| `POST /message/downloadToFile` | `SC2003` | same |
| `/mobile/*` companion routes | `SC2020` | three sites in zapo's own `WaMobileCoordinator` (`new Set(values)`, `Math.max`, a `handles` member) |

Four more `SC2020`/`SC2009`/`SC1120` sites sit inside `@zapo-js/store-sqlite`
(`table-names.ts`, `connection.ts`, `appstate.store.ts`) and one in
`spec/proto`. They are on paths the service does not drive during normal
operation — the store opens, migrates, reads and writes — but if you reach one
you get a 501 naming it rather than a crash.

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

---

## What was verified, and what was not

Verified against this exact binary:

* it builds, starts, creates and migrates the SQLite file, and serves the API;
* the API answers over a real socket to `curl` — routing, query parameters, JSON
  bodies, the `x-api-key` gate, 400/401/404, and the 501 refusal path;
* **persistence across a restart**: the process was killed and restarted on the
  same file and the store came back with the same row counts;
* the binary is 100% statically compiled — no embedded JavaScript engine.

**Not verified: a live WhatsApp conversation.** Pairing requires scanning the QR
with a real phone, which only you can do. So sending and receiving against the
real WhatsApp service has **not** been exercised end to end for this binary. The
underlying client and store paths are the ones prior work has run compiled, but
this specific claim is untested here and is not being asserted.

No test credentials are bundled and no recorded session ships with this folder.
Your first run is the scan.
