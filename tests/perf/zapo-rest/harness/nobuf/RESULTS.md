# The measured answer

**Removing the event buffer saves 2.66 MiB of settled working set when the ring
is full, and nothing at all on the documented workload.** Both halves are
measurements, and the first one **refutes the prediction registered in
`PREDICTION.md`** — in the direction that prediction named in advance as the way
it could be wrong.

Built at `e6f48fb2f`, both arms, strict, LLVM tier, zig 0.16.0,
`SCRIPTC_TARGET=x86_64-windows-gnu`. 58 measured runs. Peak and settled are
`PeakWorkingSetSize` / working set sampled by a separate process (`../pmon.exe`)
through the kernel; the compiled lane has no V8 heap and `memoryUsage()`'s heap
fields are refused by name. `process.cpuUsage()` has no lowering — **n/a**,
never 0.

---

## 1. The headline

| workload | ring depth | settled working set | verdict |
|---|---|---|---|
| **`ablive`** — 1,500 live messages | **1,000 (at cap)** | **127.11 → 124.45 MiB, −2.66 MiB (−2.10%)** | **real, p = 0.0095** |
| `ab` — the documented workload | 29 | 104.18 → 104.78 MiB (+0.57%) | **DRAW**, p = 0.43 |

Peak working set is a **DRAW in both** (−0.06% and +0.01%). The buffer costs
retained memory, not peak.

The two results are the same finding measured at two ring depths, and they agree
quantitatively: **2,794 bytes per retained event**. At 1,000 entries that is
2.66 MiB and visible; at 29 entries it is 79 KB, which is 0.07% of a 104 MiB
process and below any floor this host can produce.

## 2. Why the prediction was wrong, and what that says

`PREDICTION.md` computed ~128 bytes per entry — a 56-byte `Ev`, an 8-byte array
slot, and a 64-byte `ScrDyn` box for `data` — and predicted DRAW. It also named
the one assumption that could break it:

> The 64-byte `ScrDyn` figure assumes boxing a record into `unknown` keeps a
> **reference** to it. If instead the box **materialises** the record […] 1,000
> of them would be ~4.4 MiB […] the finding is about `unknown`, not about the
> buffer.

**Measured: 2,794 bytes per entry.** That is 22× the by-reference figure and the
same order as the materialisation figure. So the fork resolves:

**Boxing a typed record into `unknown` does not keep a cheap pointer to it.**
A `WaIncomingMessageEvent` costs ~2.7 KB to hold as `unknown`, against 56 bytes
to hold as itself. That is a compiler-level fact about `ScrDyn`, it was found by
measuring a buffer rather than by reading the runtime, and it applies to every
`unknown` field that outlives its statement — not just this one.

## 3. The structural finding, which is why the number is only 2.66 MiB

`wireEvents` calls `push(sess, "message", e)` and `rememberMessage(sess, seq, e)`
with **the same `e`**. The ring's `data` and `msgEvents[i]` were two references
to one object, both capped at 1,000, both shifted at the same rate.

**Removing the ring frees no message payload.** What it frees is the `Ev`, the
array slot, and the `ScrDyn` box — the 2,794 bytes above. The payload itself is
still retained by the typed message array that the media-download routes read
from, which this change deliberately did not touch.

## 4. The floor, and the instrument failure that produced it

**`aa2` — the second A/A run, the same binary on both arms — FAILED its DRAW
check**, reporting peakWS +16.23% against a ±12.63% floor. It was not accepted.
Sorting all 14 A/A peaks showed why:

```
183.77 183.96 184.22 184.22 184.26 184.30 184.31 184.34 184.42 184.52 184.68
                                                    ← nothing here →
                                         210.57  214.32  214.35
```

**The peak is bimodal.** Eleven runs inside a 0.91 MiB band (0.5%); three ~30 MiB
higher; nothing between. Private commit steps with it, **+140 MiB** — commit going
*up* rules out OS working-set trimming, which lowers resident pages and leaves
commit alone. This is the program taking a different allocation path, at a
measured **~21% per-run incidence, arm-independent** (1/7 for one arm, 2/7 for the
other, on the same executable).

Pooling both modes into one `max|r−1|` is what produced the ±12.63% "floor" and
then the +16% phantom. Comparing within a mode collapses it:

| metric | mode-blind floor | **mode-matched floor** |
|---|---|---|
| peakWS | ±12.63% | **±0.26%** |
| peakPriv | ±16.06% | **±0.15%** |
| settledWS | ±2.31% | **±0.43%** |
| settledPriv | ±1.26% | **±0.28%** |
| idle60WS | ±9.67% | ±9.67% (genuinely noisy; not used) |

n = 4 pooled mode-matched A/A repetitions from 2 logs. The 0.91 MiB within-mode
spread **is** the 0.92 MiB A/A floor this rig recorded historically — the
instrument was always this good, the statistic was wrong.

## 5. The repetition budget did not survive, and one experiment could not be paired

8 / 8 / 6 repetitions were budgeted at an expected ~21% mode incidence. Observed
incidence ran higher (31–37%), and mode-matching cost more than planned:

| experiment | reps run | mode-matched | rotation survived? |
|---|---|---|---|
| `ab` | 8 | 5 | **yes** (nobuf first in 3 of 5) |
| `ablive` | 8 | 4 | **NO** — all four survivors had the same arm order |
| `msgkeep` | 6 | 2 | yes, but n = 2 is not a measurement |

**`ablive`'s four surviving repetitions were exactly the odd ones**, because the
mode struck the even ones; mode-matching had silently undone the rotation that
cancels position bias. `memstat.mjs` **refused to report a difference** from that
log, which is correct and is why the paired result for the headline experiment
is absent.

The fallback is `modestat.mjs`: an unpaired within-mode comparison with a
**permutation null** (arm labels shuffled 20,000 times). It is only legitimate
because the low mode does not drift — measured over 58 runs spanning 200
minutes, low-mode peak ran 183.77–184.86 MiB, a total range of **0.59%**, with
the first run of the session and the last reading the same. Pairing cancels
drift; where there is none, an unpaired test is sound and uses every run.
The tool refuses if it measures drift above 2% range or 1% half-to-half.

**Validated on the A/A data before being trusted:** DRAW on all four metrics
(p = 0.14, 0.33, 0.21, 0.29).

## 6. Every number

### `ablive` — the ring at its 1,000 cap (the experiment that answers the question)

```
HIGH-mode incidence:  buf=4/8   nobuf=2/8
drift check: 10 low-mode runs over 32 min, range 0.28%, half-to-half -0.14% — STABLE
peakWS         -0.06%   184.59 ->  184.49 MiB  n=4v6  p=0.9297  DRAW
peakPriv       +0.06%   715.08 ->  715.48 MiB  n=4v6  p=0.5243  DRAW
settledWS      -2.10%   127.12 ->  124.45 MiB  n=4v6  p=0.0340  nobuf LOWER
settledPriv    -1.02%   203.82 ->  201.75 MiB  n=4v6  p=0.0490  nobuf LOWER
```

The two settled p-values are marginal on their own, so here are the raw values —
the separation is **complete**:

| buf (ring holds 1,000) | nobuf (no ring) |
|---|---|
| 126.99, 126.66, 127.24, 127.77 | 123.27, 123.88, 124.04, 124.86, 124.87, **126.51** |

Every one of the four `buf` values exceeds five of the six `nobuf` values, and
the sixth (126.51) still falls below the lowest `buf` value. **Mann–Whitney
U = 0 of 24 pairs, exact two-sided p = 0.0095.** The median-ratio permutation
test is the more conservative of the two and is the one quoted above.

### `ab` — the documented workload, ring 29 deep

```
peakWS         +0.01%   184.51 ->  184.52 MiB  n=7v4  p=0.9924  DRAW
peakPriv       -0.04%   715.63 ->  715.36 MiB  n=7v4  p=0.7033  DRAW
settledWS      +0.57%   104.18 ->  104.78 MiB  n=7v4  p=0.4256  DRAW
settledPriv    +0.46%   198.11 ->  199.01 MiB  n=7v4  p=0.2605  DRAW
```

Confirmed by measurement, not assumed: **every one of the 16 runs reported
`lastSeq=29`**. The ring reached 2.9% of its capacity.

**The two statistics disagree here and the disagreement is worth stating.** The
paired tool reports settledWS `+0.81%` against a ±0.43% floor and calls it
"nobuf HIGHER". That is an artefact: the five per-rep ratios span
`[−2.09% .. +1.15%]`, straddling zero, so a median-versus-floor rule declares a
difference from a distribution consistent with none. The permutation test
accounts for that spread and returns p = 0.43. The direction is also physically
backwards — removing a buffer cannot *raise* retention. **It is a draw.**

### `msgkeep` — the buffer this change did NOT remove (same binary, `ZAPO_MSG_KEEP` 1000 vs 0)

```
HIGH-mode incidence:  MSG_KEEP=1000 -> 4/6      MSG_KEEP=0 -> 0/6
settledWS      -1.42%   124.49 ->  122.73 MiB  n=2v6  p=0.4977  DRAW
settledPriv    -1.32%   202.44 ->  199.76 MiB  n=2v6  p=0.5332  DRAW
```

**n = 2 on the control side is not a measurement** and the DRAW here means "not
resolved", not "no effect". The mode ate four of six repetitions on one arm.

What *is* interesting is the thing that ate them: **the arm retaining 1,000 typed
messages took the expensive allocation mode 4 times in 6; the arm retaining none
took it 0 times in 6.** Fisher exact, one-sided p ≈ 0.03 (two-sided ≈ 0.06). If
that holds up it means retention does not merely add bytes, it makes a +30 MiB
allocation mode more likely — which no median would ever show. It is
**suggestive and unproven**: `ab`'s incidence went the other way (1/8 vs 4/8), so
a single experiment cannot carry it. It is the obvious next measurement.

## 7. Does the WebSocket path still deliver?

Yes, and the contrast between the arms is the feature. Control and treatment
through the **same script** (`results/wsdemo.txt`):

| | control `zapo-rest.exe` | treatment `zapo-rest-nobuf.exe` |
|---|---|---|
| `$hello` | `buffered=3`, no `retention` field | `retention=none`, **no `buffered` field** |
| early subscriber (before traffic) | 128 events, seq 4..131, **0 missing** | 116 events, seq 4..119, **0 missing** |
| by type | `message=123 message_protocol=3 history_sync_chunk=2` | `message=111 message_protocol=3 history_sync_chunk=2` |
| **late subscriber**, `?since=0` | **replayed 131 events** | **replayed 0**, one `$gap 1..131` |
| its capture file on disk | **169,226 bytes** | **474 bytes** |

The late subscriber's `$gap` carries its reason inline:

```json
{"type":"$gap","fromSeq":1,"toSeq":131,
 "reason":"this build retains no events; anything that happened before you subscribed is gone"}
```

Delivered frames carry real payloads, not empty envelopes — e.g.
`{"seq":8,"at":…,"type":"history_sync_chunk","data":{"received":true,"progress":50,"syncType":0}}`.

### On `$gap` under load: it is the feature, and the control does it too

`ablive` shows `gaps=2` on the treatment arm. That is the designed behaviour of a
64-event ack window with no ring to recover from, and the control is **not**
exempt — measured on the same repetition:

| | control | treatment |
|---|---|---|
| `$lag` frames | **34** | 2 |
| `$gap` frames | 1 (`212..529`) | 2 (`144..329`, `394..1529`) |

Both arms fell behind the window during a 1,500-message burst. The control
lagged **17× more often** and recovered most of it from the ring, losing 317
events to a gap it could not cover. The treatment lagged twice and lost what it
missed, because that is what having no ring means.

**In neither arm is the loss silent.** Every lost range is named to the consumer
in a `$gap` frame, which is the rule that survives removing the buffer — only
the replay does not.

## 8. What a caller sees on the polling route

`GET /s/<id>/events` and `GET /s/<id>/messages` answer **410 Gone**:

```json
{"error":"gone",
 "reason":"this build retains no events; listen on the websocket before the traffic you want",
 "websocket":"/s/<sessionId>/events/ws",
 "detail":"no event retention: … The session is at seq 29."}
```

**Returning `[]` was the other defensible option and was rejected.** An empty
array is exactly what this service returns when nothing has happened yet, so a
caller polling a no-retention build could not distinguish "quiet" from "this
build will never tell you". 410 is the status for a resource that existed and is
permanently gone; the body names the route that does work and the session's
current `seq` so a caller can start from a known point. The routes are kept
rather than deleted so the 404 handler's "no such route" cannot be misread as a
typo in the caller's URL.

Confirmed live: every treatment run records
`events-ring-disabled 410 — this build retains no events; the WS capture is the readback`.

## 9. What this means in practice

* **On a workload like the documented one — history sync, few discrete events —
  removing the buffer saves nothing measurable.** The ring is 29 entries deep.
* **On a message-heavy service it saves ~2.7 MiB per session**, and that number
  scales with `ZAPO_EVENT_BUFFER` × 2.8 KB. A 10,000-entry ring would cost
  ~27 MiB per session.
* **The bigger cost is next door.** The typed message array retains the payloads
  themselves at the same 1,000 cap and was not in scope. `ZAPO_MSG_KEEP` now
  exists so it can be measured and turned off; `msgkeep` could not resolve it and
  is the measurement to run next.
* **The real compiler finding is that `unknown` is expensive to retain**:
  2,794 bytes for a record that costs 56 as itself. Anywhere a long-lived
  structure holds `unknown`, that multiplier applies.
