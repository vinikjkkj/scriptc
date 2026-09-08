# The instruments, and the controls run before any number was quoted

Every check below can fail, and was shown failing. A check that can only say
"yes" is not evidence.

---

## 1. The cache guard — `harness/guard.mjs`

`packages/compiler/src/frontend/provenance.ts` falls back to
`homedir()/.cache/scriptc` **with no warning** when `SCRIPTC_PROVENANCE_CACHE`
is unset. That has filled the user's C: drive three times, once with 2.17 GB.
The guard refuses rather than warns, and `harness/env.sh` and `harness/env.ps1`
both end by running it, so a shell that sets *some* pins and not others cannot
start a build.

| arm | expected | observed |
| --- | --- | --- |
| all eight pins unset | REFUSE | `rc=2`, all eight named |
| seven pins on G:, `SCRIPTC_PROVENANCE_CACHE=<home>\.cache\scriptc` | REFUSE | `rc=2`, that one named |
| `STORESTATUS_GUARD_SELFTEST=1` + the real env | pass, **and** prove `onG()` rejects a C: path and an empty string | `guard self-test ok`, `rc=0` |

`<home>\.cache\scriptc` was verified **absent** before the first
build and again before this report was written. The guard also exits 4 if it
appears mid-run.

`harness/sites.mjs` imports the guard **for effect** and refuses if `WT` is
unset: a bare `node checkmap.mjs` in an earlier block extracted five attested
trees to C: precisely because a resolving `.mjs` did not self-guard.

---

## 2. The engine scan — `harness/engine-scan.sh`, armed by `harness/arm-engine-scan.sh`

Armed on **this** compiler at `f91fcd55`, not inherited:

```
ENGINE-SCAN ctl-hello-static.exe    bytes=677888    quickjs=0 ScrDyn=0 | JS_NewRuntime=0 JS_Eval=0 __island_eval=0
ENGINE-SCAN ctl-hello-dynamic.exe   bytes=1857536   quickjs=1 ScrDyn=1 | JS_NewRuntime=0 JS_Eval=0 __island_eval=0
```

`JS_NewRuntime`, `JS_Eval` and `__island_eval` read **zero in a binary that
certainly embeds the engine**. Only `quickjs` and `ScrDyn` discriminate, and
only those two are quoted anywhere in this survey.

---

## 3. The fence counter — `harness/fences.sh`, and two false zeros it is armed against

### 3a. `<name>.c` is not the program

`_x-sqlite-plus-zapo` emits **16 translation units** — `.c`, `.part1.c` …
`.part14.c` and `.scrh` — totalling **141,386,592 bytes**. The one real fence
lives in **part4**. Scanning `.c` alone reads 17,269,182 bytes and reports 0.

### 3b. The emitted TUs are named after the ENTRY, not after `-o`

The first run of `harness/build1.sh` scanned `$OUT/c-store-sqlite.*` and found
nothing beside a 28.9 MB binary. It printed

```
NO emitted TU at all: fence count ABSENT, not 0
```

which is the correct behaviour and the reason nothing false was recorded, but
the count was missing. `build1.sh` now passes **both** basenames.

### 3c. `SC900x` — the difference between 1 and 6,075

On the one clean binary this survey produced:

| pattern | what it counts | result |
| --- | --- | --- |
| `SC[0-9]{4}` anywhere in the emitted C | everything, including backend assertions | **6,075** |
| of which `SC900[0-9]` | assertions emitted for **correct** code (3,861 `SC9004`, 2,151 `SC9005`, 52 `SC9002`, 9 `SC9003`) | **6,073** |
| `\[SC[0-9]{4} at file:line\]` | actual runtime fences | **1** |
| the same, minus `SC900x` | the number a status row may quote | **1** |

The single fence is

```
[SC2020 at .../757a8071b819.../spec/proto/index.js:1]
  "... is part of the standard library types but has no scriptc lowering yet"
```

and it accounts for **two** of the 6,075 bare occurrences, because the code
appears twice on that line. A bare `SC` grep on this binary's C would report
**6,075 refusals in a program with one**.

---

## 4. Two counts that are not the same question

A build **log** carries `` - error SCxxxx: ``; an emitted C **TU** carries
`[SCxxxx at file:line]`. Scanning one with the other's pattern reads a silent
zero. `build1.sh` counts with both patterns, prints the **byte size** of what
it scanned beside every count, and prints the compiler's own `N errors.` line
as a cross-check. It also counts refusals that carry **no code at all**
(`LOG-UNCODED`), because a refusal need not be coded — one in an earlier block's
clean-looking build carried none.

---

## 5. The substitution ladder — `harness/ladder.sh`

Twelve arms, ~7 s, and an **A/A control** in every run: arm C is a
byte-identical copy of arm A in a different directory and must read exactly
what A reads. It does, in all three drivers. See [`LADDER.md`](LADDER.md).

---

## 6. The attribution-trailer check — `harness/trailer-check.sh`

Run as its **own step**, never chained to a commit, with the positive control
shown failing first:

```
file harness/ctl-trailered.txt   trailer lines=2   FAIL   <- the control
rev  <commit>                    trailer lines=0   PASS
```

---

## 7. The instrument against another block's published number

`drivers/_x-redis-plus-zapo.ts` at `f91fcd55` reads
`sites=103 total=46994 failed=19`. `tests/perf/wamcoord/logs/qR2.log.txt`
recorded `sites=103 ... total=46994 failed=19` at `0c66825d`, from a different
worktree and a different compiler build. A survey whose instrument cannot
reproduce another block's published number has not been controlled.

---

## 8. The false zero a killed run leaves behind

See [`HOST-NOTES.md`](HOST-NOTES.md). A run killed for machine pressure still
wrote a `sites.mjs` record reading `BLOCKER SITES=0 ... distinct messages=0`.
Only the state on the line above separates it from a real zero:

```
=== b-store-sqlite  [CRASHED]  ms=219760  CRASHED=EPIPE: broken pipe, write
```

The record is kept as `sites/_void-killed-b-store-sqlite.json` as the exhibit.
`harness/tally.mjs` prints the state first for this reason, and `sites.mjs`
raises rather than writing a record that merely looks empty — it throws
`BLIND: ...` if `coverage`, `coverage.stats`, `preflightFailed` or
`diagnostics` change shape, or if a site carries no code or no message.
