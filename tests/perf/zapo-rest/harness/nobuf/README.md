# `nobuf` — does removing the event buffer save memory?

The question, as asked: **compile `zapo-rest` without the event buffer —
whoever wants events has to be listening on the WebSocket beforehand — and see
whether memory use drops.**

This directory holds the whole experiment: the generator that derives the
no-buffer arm, the build recipe for both arms, the paired runner, and the
statistics tool with its floor rules. Everything here is committed, because a
rig outside the repository dies with its worktree and has already cost this
project a week of unreproducible numbers.

---

## What "the event buffer" actually is

Confirmed by reading `app182/zapo-rest.ts`, not assumed:

| piece | line (control) | what it does |
|---|---|---|
| `const EVENT_BUFFER = envNum("ZAPO_EVENT_BUFFER", 1000)` | 51 | the cap |
| `sess.events.push(ev); if (… > EVENT_BUFFER) sess.events.shift()` | 462–463 | the ring |
| `readonly events: Ev[]` | 420 | the retained array |
| `since()` | 485–495 | the only reader of the ring |
| `GET /s/<id>/events`, `GET /s/<id>/messages` | 1550–1555 | the polling routes |
| `wsCatchUp()` | 626–644 | replays the ring after an ack or a `?since=` |
| `$hello`'s `buffered:` field | 776 | reports the ring's depth |
| `counts.events` in `/health` and `/sessions` | 1300, 1536 | reports the ring's depth |

**One thing the same constant also caps, which is NOT the event buffer**:
`sess.msgSeqs` / `sess.msgEvents` (line 472), the typed incoming-message array
the `message.download*` routes read back from. It exists because zapo's
download parameter is a `WaIncomingMessageEvent | Proto.IMessage` union that an
open JSON record cannot be re-tagged into. It was not in scope and it stays —
but it holds **the very same objects** the ring pointed at (`push(sess,
"message", e)` and `rememberMessage(sess, seq, e)` are handed the same `e`), so
**removing the ring does not free a single message payload.** The no-buffer arm
gives it its own knob, `ZAPO_MSG_KEEP`, so the two can be measured apart; on the
control they share one knob and cannot be.

## What the no-buffer arm does instead

No retained array at all. An event is fanned out to whatever WebSocket
subscribers exist at that instant and then dropped. A client that connects later
has missed it.

* `GET /events` and `GET /messages` answer **410 Gone**, with a body naming the
  WebSocket route and the session's current `seq`. Returning `[]` was the other
  defensible option and was rejected: an empty array is exactly what a quiet
  service returns, so a caller could not tell "nothing happened" from "this
  build will never tell you". The routes are kept rather than deleted so a 404
  cannot be misread as a typo in the caller's URL.
* `?since=` on the WebSocket no longer replays. It gets a `$gap` frame naming
  precisely the range it will never see. The rule that a consumer must be able
  to tell it lost events survives the removal of the ring; only the replay does
  not.
* `push()` returns before allocating when nobody is subscribed. With no ring,
  an `Ev` built with no subscriber attached is garbage before the function
  returns; building one per event on an idle service would be the same
  retention, deferred to the allocator.
* `seq` still advances on every event whether or not anyone is listening. It is
  the service's event clock — `/health` reports it, `$gap` is expressed in it,
  and the download routes take it as a parameter — so making it depend on who
  happened to be connected would corrupt all three.

## The files

| file | what it is |
|---|---|
| `make-nobuf.mjs` | derives `app182/zapo-rest-nobuf.ts` from `app182/zapo-rest.ts`. **The generator is the specification of the difference.** Every edit asserts its anchor matched exactly once; the post-conditions are checked against the output with comments and strings blanked, and are then run against the *control* as a positive control — they must all fire there, or their pass on the arm proves nothing. |
| `env.sh` | the only environment. Two node lanes: build under v22 (prepending v25 resolves pnpm through corepack, which purges the v22 install), gate under v25 (the rig needs a global `WebSocket`). |
| `build.sh` | toolchain + both arms, strict, no `--best-effort`. |
| `artifact.sh` | the facts that must be read *off the artifact*: backend lane from which intermediate was emitted, size beside its zig and target, engine scan, fences with SC900x separated. |
| `pair.sh` | the paired, interleaved, **order-rotated** runner. |
| `memstat.mjs` | paired ratios with a pooled A/A floor. `--selftest` proves it can report a null result *and* a true one. |

Both arms are built from one worktree at one commit with one set of flags, so
the only difference between the executables is `make-nobuf.mjs`.

## Why a sibling *file* and not a sibling directory

The entry path selects the dependency tree: the build resolves a program's
packages from the `node_modules` beside its **entry file**. A sibling file in
`app182/` therefore gets that directory's zapo-js 1.8.2 install for free. A
sibling directory would need a second install of the same tree; a symlink or a
re-exporting entry would silently resolve against some other directory's
`node_modules`, which is the worst available outcome. The compiler names its
intermediate from the entry basename, so `zapo-rest-nobuf.ll` and
`zapo-rest.ll` do not collide — `build.sh` still gives them separate `-o`
directories so a half-finished arm can never be mistaken for the other's
artefact.

`app182/zapo-rest.ts` stays byte-identical to `app/zapo-rest.ts`. That
documented drift check is unaffected by this work.

## Measurement discipline

1. **Paired and interleaved**, so a ratio forms inside a repetition. The host
   drifts run to run and an across-rep ratio is not a measurement.
2. **Arm order rotates per repetition.** Pairing removes drift *between*
   repetitions; it does not remove a bias attached to *position within* one. A
   previous block on this project measured exactly that — the arm that ran
   second won one metric 6 of 6 times, sign test p = 0.031 — with a paired
   design that looked sound. `memstat.mjs` refuses a log whose order never
   rotated, and prints the by-position medians beside the pooled one.
3. **The floor is pooled, and its count is printed.** `max|r-1|` over four
   repetitions is not a bound: two consecutive A/A runs of the *same binary*
   have read ±0.80% and ±8.30% on one metric on this host.
4. **Two A/A runs.** `aa1` is the floor; `aa2` is scored against it and must
   come back DRAW on every metric. If it does not, the host is not quiet and no
   A/B taken on it means anything.
5. **DRAW is reported as an answer.** A null result is a result.
6. **Peak RSS is `PeakWorkingSetSize` sampled by a separate process**
   (`../pmon.exe`) through the kernel. The compiled lane has no V8 heap and
   `memoryUsage()`'s heap fields are refused by name, so an external number is
   the only one both lanes have. `process.cpuUsage()` has no lowering: **n/a**,
   never 0.

## The experiments

| name | arms | why |
|---|---|---|
| `aa1`, `aa2` | `buf` vs `buf` | the floor, and the check on the floor |
| `ab` | `buf` vs `nobuf`, documented workload | the question as asked |
| `ablive` | `buf` vs `nobuf`, `LIVEMSGS=1500` | **the only workload in which the ring fills.** The documented one delivers 19,200 messages as a *history sync*, which `zapo-rest` deliberately pushes as eight tiny `{received, progress, syncType}` events rather than parking payloads in the ring — so it never puts more than ~30 entries in a ring whose cap is 1,000. A workload that cannot fill the buffer cannot measure it. |
| `msgkeep` | `nobuf` vs `nobuf`, `ZAPO_MSG_KEEP` 1000 vs 0 | the buffer this change did *not* remove, on one binary, so it carries no build variance |

`LIVEMSGS` and the WebSocket capture were added to `../memrig.mts` for this
work. Both default to leaving every previous arm and every previous number
unchanged (`LIVEMSGS=0`; `WS_CAPTURE=1` only adds a subscriber and two output
files).

## Does the WebSocket path still deliver?

Every run, on both arms, attaches a subscriber **before any traffic** and logs
every frame verbatim to `<tag>.ws.jsonl`. At the end of the run a **second**
subscriber attaches with `?since=0`, after all the traffic, and its frames go to
`<tag>.wslate.jsonl`.

The contrast between those two files is the retention question itself, and it is
what stops "the early subscriber received N events" from being unfalsifiable: a
build that saved memory by delivering nothing to *anybody* would look identical
to one working as designed, unless the late socket is also read.
