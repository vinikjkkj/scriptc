# block/remeasure — the same three packages, three provenance fixes later

Branch `block/remeasure`, measured against main at `5d0e8427`, **rebased onto
main at `ddff2f4a`** before reporting. Every number below was produced on the
`5d0e8427` compiler, and the rebase does not touch it: `git diff
5d0e8427..ddff2f4a` changes **zero** files under `packages/` — main's five
intervening commits are `.gitignore`, `tests/perf/bench` and
`tests/perf/stores`. 17 commits, all under `tests/perf/mediavoip-remeasure/`.

Subject: `@zapo-js/media-utils`, `@zapo-js/voip` and `@zapo-js/wam` from
the provenance checkout `250f9af5229a545eec28ddbd3e8774a397cdb0bb`, the same
40 non-test modules `tests/perf/mediavoip/sites-default/` recorded at
`e53c19ad`. Nothing under `packages/` changed: `git diff --name-only main..HEAD` lists
only paths under `tests/perf/mediavoip-remeasure/`.

`1c201e7f` — "a package's entry map was built once and never revisited" — is an
ancestor of the base, and its `expand`/`expandSafely` are present in
`packages/compiler/dist/frontend/provenance.js` by content, not by mtime.

---

## 1. Before and after, both lanes

**DEFAULT LANE (`analyze()`, no flags).**

| | recorded at `e53c19ad` | measured at `5d0e8427` | delta |
| --- | --- | --- | --- |
| unique refusal sites | 234 | **234** | **0** |
| distinct causes | 33 | **33** | **0** |
| modules | 40 | 40 | 0 |
| sites fixed | — | **0** | |
| sites new | — | **0** | |

Not "the same total": the same **sites**, keyed on
`(file, line, code, message)` with the block root folded out of both. Every
module agrees on its preflight flag, its statement counts and its site list.
**Three provenance fixes have landed and the default lane has not moved by one
site.** The two blocks before me reported the same for the first two fixes;
this is the third, and the answer is again zero.

Measured twice, independently, with different `node_modules` — 0 modules differ
between the runs.

**PROVENANCE LANE (`--provenance-sources`).**

| | default lane | provenance lane | delta |
| --- | --- | --- | --- |
| unique refusal sites | 234 | **105** | **-129 (-55%)** |
| distinct causes | 33 | **62** | **+29 (+88%)** |
| statements analysed | 586 | **321,687** | x549 |
| statements failed | 236 | **56** | -180 |
| modules failing preflight | 8 | **13** | **+5** |
| raw (undeduped) sites | 659 | 348 | -311 |

192 sites fixed, 63 new. **Both halves of that are real and neither is the
headline on its own.** The site count halves; the cause count nearly doubles.
They move in opposite directions because the provenance lane compiles 549 times
more code, and reaching that much more code finds a long tail of small refusals
the island path never had the chance to hit. A block quoting only "234 -> 105"
would be selling it; a block quoting only "33 -> 62" would be calling a large
win a regression.

Both sweeps pass `selftest.py` with all five checks including the two armed
controls. Four modules were also analysed independently, outside the sweep, and
agree with it site for site and stat for stat.

### What provenance removed, exactly

| cause | default | provenance |
| --- | --- | --- |
| `values from the 'zapo-js' package run in the embedded dynamic engine` | **85** | **0** |
| `importing 'zapo-js' requires the embedded dynamic engine` | **31** | **0** |
| `calls of the generic method 'commit' through this receiver` | **69** | **0** |
| `uses of 'bytes'/'length' inherit the blocker on its declaration` | 3 | 0 |
| `WaWamCoordinator` cascade: member `logger` has type `Logger` | 1 | 0 |
| `AmbientFab[]`: the array's element type does not compile | 1 | **1** |

That is **189 of the 192 sites fixed**, and it is the whole of what the first
survey called "the single fix that buys the most". It is bought.

The `AmbientFab[]` row is the one the first survey classed as a cascade of the
zapo-js island and **it is not one**: it survives in a lane with zero zapo-js
island sites. It moved from three modules to one only because two of the three
now fail preflight on `SC1016` before they can reach it.

Every one of `zapo-js`, `/util`, `/crypto`, `/media`, `/proto`, `/protocol` and
`/transport` maps now — the swept modules import all seven and the provenance
lane carries **zero** `zapo-js` island sites.

### What provenance added

| cause | sites | modules it blocks |
| --- | --- | --- |
| `SC1090 calls of the generic method 'on' with no defining object literal` | **12** | wam's coordinator/index/plugin |
| `SC1016 circular imports` in zapo-js `src/protocol/` | **1** | **7**, all preflight-failed |
| `ChildProcess.stdin`, `execFile`, `spawn` stdin slots, `Readable\|null` re-tags, … | 1-4 each | media-utils |
| the `@vinikjkkj/wa-wam` island | 7 -> **10** | wam |

**`SC1016` is the row a site count gets wrong.** One unique site — zapo-js's own
`protocol/constants.ts -> bot.ts -> jid.ts -> constants.ts` cycle, over a
top-level read of `WA_DEFAULTS` — and it fails preflight for **seven** modules,
**five of which passed preflight in the default lane**
(`voip/relay/relay-ack.ts`, `wam/WaWamUploader.ts`, `wam/send-parse.ts`,
`wam/synthetic/WaWamSyntheticUi.ts`, `wam/synthetic/index.ts`). It is the
provenance lane's own regression and it is 1.0% of the ranking.


---

## 2. What compiles now — six binaries, and two packages across the line

**Three run clean, from two different packages:**

| binary | bytes | oracle | result |
| --- | --- | --- | --- |
| `wire-probe2.exe` | 2,811,392 | zapo's `wire/__tests__/wire.test.ts` | **14 of 14, exit 0** |
| `voip-stun.exe` | 811,008 | the same module under node v25.9.0 | **all 7, exit 0** |
| `voip-ssrc.exe` | 925,696 | the same module under node v25.9.0 | **all 6, exit 0** |

**Three more build and run and stop somewhere informative:**

| binary | bytes | result |
| --- | --- | --- |
| `wire-probe.exe` | 2,809,344 | 12 of 14, then the SC1090 throw exactly where it should |
| `voip-bytes.exe` | 823,296 | 9 of 11, then a runtime fence inside zapo-js's own source |
| `bytesview-repro.exe` | 803,840 | three lines, the minimal form of that fence (section 4a) |

**`wam` reached a binary before; `voip` had never reached one.** It has now,
twice, from modules that were islands in the default lane.

All six are engine-free, and that is an armed scan, not a hopeful one: of five
markers, only `quickjs` and `ScrDyn` are non-zero in a two-line `--dynamic`
control. `JS_NewRuntime`, `JS_Eval` and `__island_eval` are **zero in a binary
that certainly does embed the engine** and would have called anything
engine-free. Both discriminating markers read 0 in every static binary here.

### The WAM wire path: 12 of 14 became 14 of 14, and one of its two edits is gone

At `e53c19ad` the wire path needed **two** source changes to build at all, and
reached 12 of 14 assertions. Now:

| build | statements | failed | blockers |
| --- | --- | --- | --- |
| the real modules, `--provenance-sources` | 191 | 5 | 7 = 6 wa-wam island + 1 SC1090 |
| + `--npm-static @vinikjkkj/wa-wam` | 191 | 5 | the same; wa-wam falls back |
| `probe-wire` — one `type` token localised | 203 | 1 | **1**, the SC1090 |
| `probe-wire2` — + that SC1090 narrowed | 218 | 0 | **0** |

The `TEXT_ENCODER from 'zapo-js/util'` change the first survey needed **is no
longer needed**: provenance compiles zapo-js from source and the build reports
`zapo-js@1.6.2 <- github.com/vinikjkkj/zapo@v1.6.2 @ 250f9af5229a (source
compiles statically)`. What is left is one npm type-surface defect and one
language construct, and with both removed in copies the path is 218 statements,
zero failed, zero blockers, and it prints ALL PASS.

The 28,759-line `@vinikjkkj/wa-wam` table really is program code: its deepest
event name is in the binary; a name that is in no table is not.

### voip crossed the line — twice

`voip/crypto/ssrc.ts` and `voip/relay/stun.ts` are **islands in the default
lane** — `importing 'zapo-js' requires the embedded dynamic engine`, 0 and 19
statements analysed. Under provenance they are 303 and 48 statements with none
failed, and both build and run. `voip-ssrc.exe` reproduces five exact SSRC
values from node; `voip-stun.exe` reproduces the WhatsApp STUN ping header, the
magic cookie and two subscription payloads byte for byte, rejects a non-STUN
packet, and shows two consecutive transaction ids differing.

zapo's own `ssrc.test.ts` asserts only determinism and never names a value; the
expected numbers here came from running the same module under node, so the
static binaries are held to a stricter oracle than the package ships.

---

## 3. The three packages, side by side

| | `media-utils` | `voip` | `wam` |
| --- | --- | --- | --- |
| modules (non-test) | 4 | 21 | 15 |
| **default lane** — preflight fails | 1 of 4 | 7 of 21 | 0 of 15 |
| statements analysed / failed | 12 / 1 | 101 / 1 | 473 / **234** |
| **provenance lane** — preflight fails | 1 of 4 | **8** of 21 | **4** of 15 |
| statements analysed / failed | 12 / **0** | **92,106** / 3 | **229,569** / 53 |
| unique refusal sites (prov) | 28 | 14 | 44 |
| a binary was produced and ran | no | **yes, twice** | **yes** |

`wam`'s 234 failed statements in the default lane are the 69-site `commit`
cascade and its neighbours, counted once per entry that reaches them; the
provenance lane leaves 53 out of 229,569.

**`media-utils`** — one line, twice over. `index.ts` fails preflight in both
lanes on `fileTypeFromFile`. That is not a package the caller can spell
differently: `file-type`'s `"."` export is
`{ node: { import: index.js }, default: { import: core.js } }` and it has **no
`"./node"` subpath**, so with `moduleResolution` forced to `Bundler` the `node`
condition is never applied and the member is unreachable from source. Measured
past it (`probe-mu`, the string arm dropped), the entry **passes preflight at 40
statements with none failed and exactly one blocker left: `importing 'sharp'`**.
The first survey found 7 causes over 16 sites behind that line; provenance took
11 of those 16. `ffmpeg.ts` is now 11 statements with **none** failed — but it
still cannot build, because `ffmpeg.ts:17` imports `./sharp`.

**`voip`** — the leaves compile and two of them run. `bytes.ts`,
`crypto/primitives.ts`, `crypto/encryption.ts`, `crypto/ssrc.ts` go from
**island (0 statements analysed)** to 29, 29, 303 and 303 statements with
**none failed**; `crypto/srtp.ts`, `media/rtp.ts` and `relay/stun.ts` each reach
29 more statements, still none failed; `media/WaAudioEngine.ts` and
`signaling/signaling.ts` each analyse **over 45,600 statements with one
failed**. What still stops the *entry* is unchanged: `RTCPeerConnection` and
`RTCDataChannel` at `relay/WaSctpRelay.ts:30-31`, in 7 modules, plus the new
`SC1016` in 3 more.

**`wam`** — the one that already reached a binary now reaches a clean one.
`wire/binary-writer.ts` goes from island to **29 statements, none failed**;
`wire/encoder.ts` 4 -> 33 and `wire/WamBatch.ts` 5 -> 34, each with 2 failed and
every remaining blocker belonging to `@vinikjkkj/wa-wam`.
`WaWamCoordinator.ts` goes from **73 failed of 130** to **14 failed of 46,013**.
Four wam modules newly fail preflight on the `SC1016` cycle.

---

---

## 4. The instrument findings, which are worth more than the survey

### 4a. A DataView answers `true` to `instanceof Uint8Array`. Silently.

Found by running a binary, not by reading a report. zapo-js's `toBytesView`
branches on `value instanceof Uint8Array` and, inside that branch, on
`value.constructor === Uint8Array`. A `DataView` argument **takes the branch it
must not**, and the constructor compare lowers to `bytes.isBuffer`, whose
honest answer for an unstamped producer is a runtime throw. The visible failure
is the throw; the defect is the branch.

`drivers/instanceof-matrix.ts` isolates it with **no zapo-js and no flags**:

```
node v25.9.0          scriptc, default static lane
ok    Uint8Array      ok    Uint8Array          <- control, true in both
ok    DataView        WRONG DataView            <- got=true, node=false
ok    subarray        ok    subarray
WRONG REPORTER        WRONG REPORTER            <- control, must print WRONG
```

`scriptc coverage` reports that program 45 statements, 0 failed, no blockers,
no runtime fences. It builds without `--best-effort`. It exits 0. **This is a
wrong answer, not a refusal.** `SC1090` on an unsupported operand names the
mechanism: `instanceof Uint8Array` is a flavor test and the compiler "tags
bytes as one kind, and only Uint8Array reads that tag", so every bytes-flavored
arm of a union answers to `Uint8Array`.

### 4b. `statementsFailed = 0` for an entry is a LOWER bound, not a prediction

The provenance sweep reports `voip/crypto/srtp.ts` at 45 statements with 0
failed and `crypto/encryption.ts` at 303 with 0 failed. A driver that actually
calls `protect`/`unprotect` fails to build with **four** errors. An entry's
coverage only analyses what that entry reaches; a module that reports zero
failed statements can still refuse when something reaches further into it.
Every "N/N, 0 failed" row in any coverage survey — mine included — carries that
caveat.

### 4c. The committed self-test could not fail for the right reason

`tests/perf/mediavoip/harness/revalidate.sh`, which that survey's README calls
"not optional", globs `$OUT/*.log`; `sweep2.sh` writes `*.txt`. On a sweep2
output directory it matches nothing, runs its body once on the literal pattern,
and prints a number unrelated to the sweep. `harness/selftest.py` replaces it
with five checks, two of them armed controls that run in the same lane as the
corpus on every sweep, and it was shown to fail three separate ways — empty
negative control, a positive control carrying the fallback `.d.ts` signature,
and a dropped module — before any number here was quoted.

### 4d. A normaliser is a classifier and needed a classifier's control

`rank2.py`'s path regex was written with an escaped backslash and a forward
slash in one character class, and reached disk with the backslash eaten:
a class matching forward slashes only. Every Windows-spelled path inside a
diagnostic would have gone unfolded and every cause quoting one would have
counted once per block root, silently. `norm-selftest.py` folds four path
spellings and two message spellings, asserts two plain strings come through
untouched, and reintroducing the exact corruption makes it print FAIL on the
backslash row. The first draft of the commit message about that bug lost the
same backslash and ended up saying the two spellings were identical.

---

## 5. The ranking, and what is actually left

**Default lane** — 234 sites, 33 causes:

| | sites | % | causes |
| --- | --- | --- | --- |
| owned | 208 | **88.9%** | 10 |
| unowned | 26 | **11.1%** | 23 |

Largest unowned cause: **2 sites, 0.9%**, and there are three of them tied.
That is the flat tail the brief asked about, and it is flatter here than the
2.7% the other corpus reported.

**Provenance lane** — 105 sites, 62 causes:

| | sites | % | causes |
| --- | --- | --- | --- |
| owned | 26 | **24.8%** | 8 |
| unowned | 79 | **75.2%** | 54 |

| # | sites | % | the new top causes, unowned |
| --- | --- | --- | --- |
| 1 | **12** | 11.4% | `SC1090 calls of the generic method 'on' with no defining object literal` |
| 2 | 4 | 3.8% | `SC2020 'ChildProcess.stdin' is typed by @types/node but has no lowering` |
| 3 | 3 | 2.9% | `SC2020 'child_process.execFile'` |
| 4-12 | 2 each | 1.9% | destructuring dyn-typed sources, `spawn` stdin slots, `Readable\|null` re-tags, `child.on("close")`, `ReadableStream.destroy`, compound array-element assignment, dynamic keyed reads of a logger record, `off` |
| 13-54 | 1 each | 1.0% | forty-two of them |

**The new top cause is the old top cause wearing different clothes.** The
69-site `commit` cascade was `SC1090 calls of the generic method 'X' through
this receiver`; the 12-site `on`/`off` pair is `SC1090 calls of the generic
method 'X' with no defining object literal`. Same code, same family — a generic
method whose only declaration is signature-only — reached through
`EventEmitter` rather than through an islanded class field. It is **not** owned
by the provenance work and I have not seen it claimed elsewhere.

**Answering the question the brief asked directly:** in the **default** lane
there is no big unowned lever — 88.9% is owned and the largest unowned cause is
0.9% over a 23-row flat tail, exactly the shape the other corpus reported. In
the **provenance** lane the proportions invert, 75.2% unowned, but that is an
artefact of the owned causes having been *fixed*, not of anything new being
large: the biggest unowned cause is 11.4% and everything below rank 3 is at or
under 1.9%.

**But "no big lever" is not "nothing worth fixing", and this corpus proves it.**
The biggest thing left in `voip` — the whole SRTP path, 303 + 45 + 43 statements
across three modules that all report **zero failed statements** — refuses to
build on exactly **three** of those 1-site and 2-site tail rows:

    SC2020  createCipheriv('aes-128-ctr', ...)   primitives.ts:27   -- one string
    SC2001  a bigint in a template literal       srtp.ts:83
    SC1090  compound array-element assignment
            through a FIELD receiver             srtp.ts:175, :180

Three causes, four sites, 1.0% + 1.0% + 1.9% of the ranking, and they are what
stands between WhatsApp's SRTP layer and a native binary. Rank by call sites and
they are invisible; rank by what they unblock and they are the top of the list.

---

## 6. Everything I measured wrong

1. **My first provenance sweep was contaminated and I threw it away.** It
   reported `media-utils/ffmpeg.ts` regressing from "preflight OK, 11
   statements" to "preflight FAILED", on two `SC0001`s inside zapo-js's own
   `src/argo-decoder.ts` — `Cannot find module 'argo-codec'` and a strict-null
   assignment. Both were mine: zapo-js declares `argo-codec`, `pino`,
   `pino-pretty` and `ws` as **optional** peer dependencies and my lab app had
   none of them. The default lane never resolves them because it refuses at the
   package boundary, so the omission is invisible there; the provenance lane
   walks into the source and trips over it. It looked exactly like a compiler
   defect introduced by the fix I was sent to measure. Fixed by installing all
   four, killing the sweep by full command line, and re-running BOTH lanes —
   the default lane came back byte-identical, which is how I know the four
   dependencies changed nothing but the provenance lane.
2. **I read the wall clock wrong repeatedly and nearly called a slow run a
   hung one.** `voip/media/WaAudioEngine.ts` takes **950 seconds** to analyse
   45,645 statements and `signaling/signaling.ts` takes 912 for 45,630. I
   polled every few seconds, saw "still 17 of 40", and started reasoning about
   a hang. The clock had moved ninety seconds. The previous survey lost a day
   to the same shape and wrote it down; I read that and did it anyway.
3. **My `rank2.py` path regex reached disk missing a backslash** (4d). It
   happened to work on the sites that were present, because those messages
   spell paths with forward slashes — so it would have passed every check I
   had, and only a control specifically for backslash spellings caught it.
4. **My first `instanceof` repro used `unknown` slots and `Int16Array`
   constructors**, both of which the compiler refuses, so the interesting rows
   never ran and the output looked like a small failure rather than a large
   one. Two rewrites before the matrix could carry its own controls.
5. **The DOM-shim probe for voip did not converge and I have no number from
   it.** Declaring two interfaces turned two errors into eleven; declaring
   twenty members and both constructors left eight. Reported as an open
   question, not as a measurement.
6. **I left orphaned processes behind, the exact way the previous survey
   documented.** A side-run of three modules hit the 10-minute shell timeout;
   the shell died and its `timeout`/`node` children kept going on
   `wam/globals.ts`. I only found them because I went looking by full command
   line. They were writing to a directory the sweep did not own, so nothing was
   corrupted, but the same mistake against `sites-prov/` is precisely what
   produced a 27-byte log in the first survey. Killed by pid, verified by a
   second query returning zero.
7. **My `rank2.py` docstring claimed both of its controls were asserted every
   run.** Only `__never__` is. The rule table is a positive control only in the
   default lane. Corrected in the source rather than quietly relied on.
8. **I wrote "190 of the 192 sites fixed" into the first draft of this report
   and it is 189.** I had assumed `AmbientFab[]` was a cascade of the zapo-js
   island because the survey I was re-running said so, and only checked when
   totalling the table. The correction is in section 1 and it is the fourth
   claim in section 7.
9. **The first version of `instanceof-matrix.ts` had a `must-be-false` control
   that the compiler refuses to compile** (`instanceof` against a local class
   through a union). I replaced it with a control on the REPORTER instead — a
   row handed an answer that disagrees with its oracle on purpose, which must
   print WRONG. That is a weaker control than I wanted and I am saying so:
   it proves the harness can report a mismatch, not that the lane can answer
   `false`.

---

## 7. Claims in the brief I tested rather than inherited

**Confirmed:**

1. **"`sharp` is not a thin native wrapper — 5,604 lines of JS whose first
   refusal is a `semver` import."** Exactly right. `sharp/lib` is 13 modules
   and 5,604 lines, and `--npm-static sharp` falls back with
   `SC1010: the 'semver/functions/coerce' module is not supported yet`. Three
   `semver` deep requires, and `detect-libc` and `color` behind them.
2. **"A union-typed `===` at `WamBatch.ts:51`, predicted by name, a single
   language construct."** Confirmed and now proved terminal: narrowing that one
   comparison per arm is the difference between 203 statements with 1 failed
   and 218 with 0, and between 12 of 14 assertions and 14 of 14.
3. **"`SC2001 values of type BinaryWriter` — 7 sites, a cascade of the
   `@vinikjkkj/wa-wam` island's `.d.ts`, not of `zapo-js`."** Confirmed: those
   7 sites survive in the provenance lane, which removes every `zapo-js` island
   refusal, so they cannot be a cascade of zapo-js.
4. **"ffmpeg is not independent — it imports `./sharp`."** Confirmed by
   building it: `drivers/mu-ffmpeg.ts` refuses at `sharp.ts:1`.

**Refuted or corrected:**

1. **"`voip` has no long tail: 67 of its 81 sites were one cause."** 67 of 81
   is right; **one cause is not**. It is two distinct diagnostics — `values
   from the 'zapo-js' package…` at 52 sites and `importing 'zapo-js'…` at 15 —
   i.e. the zapo-js island *family*. voip's single largest cause is 52 sites,
   64%. The conclusion survives; the arithmetic behind it does not.
2. **"What stopped voip's entry was two type names on adjacent lines."** True
   of the DIAGNOSTIC and misleading about the work. Declaring those two names
   moves the failure, it does not remove it: `WaSctpRelay` needs at least
   twelve distinct `RTCPeerConnection`/`RTCDataChannel` members plus
   `MessageEvent`. Two names are the first two of a real DOM surface.
3. **"A second block reported the default lane identical site for site, 235 and
   235."** The committed recording is **234**, and my re-run reproduces 234
   exactly. Whatever 235 counted, it was not `sites-default/`.
3b. **The first survey's ranking marks `SC2009 'AmbientFab[]'` as a cascade of
   the zapo-js island (its row 23).** It is not. The provenance lane has zero
   zapo-js island sites and `AmbientFab[]` is still there, at
   `wam/synthetic/fabrications.ts:26`. Its apparent drop from three modules to
   one is not the cause being fixed either — two of those three modules now
   fail preflight on `SC1016` before they reach it. Two different ways to read
   a smaller number as progress, in one row.
4. **"`--provenance-sources` cannot map any `zapo-js` subpath" / "never engages
   for a type-only import"** — both were true at `e53c19ad` and both are fixed,
   and I measured it rather than assuming it. The three packages import
   `zapo-js` and all six of `/util`, `/crypto`, `/media`, `/proto`, `/protocol`
   and `/transport`; the provenance sweep carries **zero** `zapo-js` island
   sites across all 40 modules. The type-only `Logger` import no longer islands
   its class either: the 69-site `commit` cascade matches **0** in the
   provenance lane.
5. **"The default lane has been identical across two fixes; if it moves now,
   that is the finding."** It did not move, so that is not the finding — but
   the framing is worth correcting anyway. The default lane *cannot* move for
   a provenance fix: it never resolves the package at all, it refuses at the
   import. Three fixes have now produced three zeroes, and a fourth would too.
   The default lane is a **control** for provenance work, not a measurement of
   it, and treating a stable control as a pending surprise costs a sweep every
   time.
6. **The brief's framing that this is "a re-run of committed tooling rather
   than new work"** did not survive contact. The committed lab no longer
   exists, its self-test cannot fail on its own sweep's output, and the corpus
   needs four dependencies the committed README does not name. The re-run was
   most of a rebuild.

---

## 8. Gate

Nothing under `packages/` changed. `git diff 5d0e8427..HEAD` excluding
`tests/perf/mediavoip-remeasure/` is empty. Run anyway, under node **v25.9.0**,
`SCRIPTC_TEST_WORKERS=2`, vitest's own exit code captured immediately into its
own variable:

    npx vitest run tests/harness packages/compiler/test packages/runtime/test \
      --exclude '**/coverage.test.ts' --exclude '**/differential.test.ts' \
      --exclude '**/llvm-differential.test.ts'

    Test Files  136 passed | 7 skipped (143)
         Tests  2206 passed | 54 skipped (2260)
      Duration  1444.18s
    VITEST_EXIT=0

No `Timeout calling "onTaskUpdate"`, so no re-run. **This is the base commit's
own count, measured here** — the 131/2154 the previous survey quotes for main
at `ec718580` is not comparable, main having gained five test files and 52
tests since. main moved five commits further while I worked and **none of the
five touches `packages/`** — `git diff --name-only 5d0e8427..ddff2f4a` lists
`.gitignore`, `tests/perf/bench` and `tests/perf/stores` and nothing else, and
`git diff --stat 5d0e8427..ddff2f4a -- packages/` is empty. The rebased branch
therefore carries the identical compiler and this gate run stands for it. I did
not re-run the gate after the rebase and that is the reason.

---

## 9. Paths

Everything under `G:\blocks\remeasure\`, nothing at `G:\` top level.

| path | keep? |
| --- | --- |
| `wt` | worktree, branch `block/remeasure` — **keep until merged** |
| `lab` | lab app, node_modules, both sweeps, binaries — **disposable** |
| `cache` | `SCRIPTC_CACHE_DIR` — **disposable** |
| `prov` | `SCRIPTC_PROVENANCE_CACHE`, a 12 MB copy of the read-only checkout — **disposable** |
| `zig` | `ZIG_GLOBAL_CACHE_DIR` and `ZIG_LOCAL_CACHE_DIR` — **disposable, delete whole** |
| `tmp` | emptied — **disposable** |

No `base` worktree was created: this was a re-run of one compiler, not an A/B.
`G:\zapo-work` was read only, apart from this report. `G:\scriptc` was not
written to.

Everything a re-run needs is committed under `tests/perf/mediavoip-remeasure/`:
the harness, both lanes' recorded sweeps, every driver, the probe copies, and
the run logs of every binary.
