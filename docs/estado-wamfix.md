# wam from its package entry, and the provenance source-mapper

Block `wamfix`, branch `block/wamfix`, base main `70e1fe48`.
Measured 2026-08-30 on win32 x86_64, `zig 0.16.0` (`G:\zapo-work\tools\zig`),
`SCRIPTC_CC=zigcc`, `SCRIPTC_TARGET=x86_64-windows-gnu`,
`SCRIPTC_GENERIC_SLOT=1`. Compiler built under node **v22.18.0**; every oracle
run under node **v25.9.0** from nvm, which is not the node on PATH. Lab app is
the 147-module tree the merged `pkgstatus` block built, copied to
`G:\blocks\wamfix-lab\app`; provenance source cache copied to
`G:\blocks\wamfix-lab\prov`. `G:\zapo-work` was read only apart from this file.

Three compiler commits, all on `block/wamfix`, none pushed:

- `4676cdc1 feat(provenance): map an attested package that publishes the source it authored`
- `00dab45a fix(frontend): a declaration with its implementation twin in the program is not types-only`
- `b93ea18a fix(provenance): default the authored-JavaScript mapping OFF until its twin init runs`

**The branch is inert by default.** The third commit turns the first two off
behind `SCRIPTC_PROVENANCE_AUTHORED_JS=1`, because with them on the compiler
produces a silent wrong answer (§7). Read §0 before anything else.

---

## 0. The answer to the question I was sent to answer

**Does `wam`'s entry reach a native binary? It reaches one, and the binary is
wrong.** Both halves matter and the second one decides the verdict.

| what | result |
| --- | --- |
| entry links to a native binary | **yes** — `wam-entry2-be.c.exe`, **26,464,256 bytes**, C backend, `--provenance-sources --best-effort` |
| engine scan | `quickjs=0 ScrDyn=0 JS_NewRuntime=0` |
| runs? | **no** — exits `0xC0000005` (STATUS_ACCESS_VIOLATION) with **zero bytes on stdout** |
| oracle | node v25.9.0 prints 16 lines and `WAM-ENTRY2: ALL PASS` |
| score | **WRONG** (it ran and disagreed), not DID-NOT-RUN |

`0xC0000005` is neither of the two known non-bugs: not `0xC00000FD` (stack
overflow) and not `0xC0000142` (orphaned zig children, which this block also
hit separately and discarded).

**`N WRONG→MATCH = 0, M MATCH→WRONG = 0`** for everything shipped. Nothing that
matched before matches differently now, because the default path is byte-
identical to base (§3c) and the wrong answer only exists behind the flag.

---

## 1. The floor, and why it is worth more than a passing test

`wam-wire-probe2`, rebuilt on this block's machine state, both backends,
`--provenance-sources --npm-static '@vinikjkkj/wa-wam'`:

| backend | bytes | recorded in `estado-pkgstatus.md` | oracle |
| --- | --- | --- | --- |
| LLVM | **2,812,416** | 2,812,416 | **14/14 byte-exact, exit 0** |
| C | **2,871,808** | 2,871,808 | **14/14 byte-exact, exit 0** |

Both byte counts are **identical to the recorded floor, to the byte, three
days later on a different block's machine state, on both backends**. That is a
reproducibility claim about the whole toolchain — zig, the cache layout, the
provenance checkout, the generic slot — not just a test that passed twice.
Engine scan on both: `quickjs=0 ScrDyn=0 JS_NewRuntime=0`.

### 1a. A `zig cc` failure shape that is not a compile error

The first C-backend attempt failed with

```
CcCompileError: zig cc failed compiling ...wam-wire-probe2.c.
This is a scriptc bug (generated C should always compile) unless zig cc
itself is missing/broken.
```

and a captured `stderr` containing **only** a `'/*' within block comment`
warning from `scr_runtime.h:8330`, ending at `1 warning generated.` with no
`error:` line anywhere. It had run contended with two sibling `tsc.exe`
processes. Re-run uncontended, nothing else changed, it built and matched.

**The tell: a `CcCompileError` whose stderr holds only warnings is contention,
not a compile error.** Three blocks have now lost time to this shape. Do not
report it without an uncontended re-run.

---

## 2. What the brief and `estado-pkgstatus.md` got right, and what they did not

### 2a. Reproduced exactly

`wam/index.ts`, default lane, on `70e1fe48`: **130 statements, 73 failed, 95
blocker sites, 6 distinct messages** — the pkgstatus row to the number,
including the 69-site `SC1090 commit` cascade, 16 + 5 + 2 + 2 `SC2013`, and one
`SC2020 Uint8Array.from`. And independently on my base, **`SC2008` at
`plugin.ts:27` is in the unreached group**, exactly as that block refuted.

### 2b. The 69-site `commit` cascade is not a thing to fix

The brief ranked it as wam's real biggest blocker and the first lead. It is
real — 69 distinct sites in `synthetic/fabrications.ts` — but it is **not an
independent problem**. `commit<K extends WaWamEventName>` at
`WaWamCoordinator.ts:108` is a class generic method *with a body*, which is
exactly the shape that monomorphizes. It refuses only because the class it
lives on cannot lower while `zapo-js` types are dyn boxes. Under
`--provenance-sources` the cascade is **zero** without anyone touching it.

So the mapper was not the second lead. **It was the only one.**

### 2c. Two numbers I measure differently

On `70e1fe48`, `wam/index.ts`, `--provenance-sources`, **no `--best-effort`**:

| | `estado-pkgstatus.md` (base `16705f5c`) | this block (base `70e1fe48`) |
| --- | --- | --- |
| statements analysed | 46,013 | **46,013** |
| statements failed | 14 | **14** |
| blocker sites | 18 | **18** |
| distinct messages | 8 | **7** |
| of which wa-wam | 12 (5 importing + 7 values-from) | **13 (5 + 8)** |

Statement counts agree to the digit; the message and wa-wam-site counts differ
by one each, on a different base. Both are stated with their base so a reader
can see the difference rather than average it.

---

## 3. The mapper: what was wrong, and the shape of the fix

`mapEntryToSource` (`packages/compiler/src/frontend/provenance.ts:458`) built
every candidate with a TypeScript extension. A package with **no build step**
publishes the file it authored — the published target IS the attested source —
so every candidate missed and the package fell to the island with a
`no source mapping` note, however faithfully its source had been fetched.

Two of the corpus's three attested-but-islanded packages are that shape:
`@vinikjkkj/wa-wam` (published target `index.js`) and `mysql2` (`./promise.js`).

**The handover proposed accepting the `.js`. That is the wrong half.** Mapping
to the `.js` gets the values and loses the types: the hand-written declarations
stop being consulted, and one type token off the package sends the whole tree
back to the island. That is not a prediction — it is the measured failure mode
of `--npm-static '@vinikjkkj/wa-wam'`, where the single `type WaWamChannel`
token in `wire/WamBatch.ts` sends the 28,758-line table to the island.

**What landed instead:** map to the `.d.ts` beside the published file, and only
when an implementation twin (`.js`/`.mjs`/`.cjs`) sits beside it. The existing
decl-twin path then supplies the body — `provenanceDeclSiblings` puts the
implementation into the program, `declTwinOf` puts it into module order ahead
of its declaration. That is the path zapo-js's own `spec/proto/index.js` has
always taken; wa-wam's `index.js` is the same shape (`"use strict"`,
`module.exports = {...}`). The result keeps wa-wam's 30,556-line hand-written
`index.d.ts` **and** its 28,725-line implementation.

A `.d.ts` with **no** twin is deliberately refused. It would map the package to
a body-less surface on which every exported value refuses — **a worse answer
than the island it replaced**, which is not an improvement.

### 3a. The second fence, which only became reachable once the first was fixed

With the mapping in place the build still refused, at five sites:

```
SC1010  the '@vinikjkkj/wa-wam' import (it resolves only to type
        declarations — there is no runtime implementation to compile)
        globals.ts:1  registry.ts:1  WaWamCoordinator.ts:1
        wire/encoder.ts:1  wire/WamBatch.ts:1
```

`program.ts` refused any bare specifier whose project resolution landed on a
`.d.ts`, testing the **file extension** rather than the question it means to
ask. The 28,725-line implementation was sitting in the same program as a root
at that moment. The fence now asks `declTwinOf(program, projDep) === undefined`
— the twin is looked up **in the program, not on disk**, so a declaration whose
sibling was never loaded still has no implementation, still refuses, and still
says so in the same words.

This fence was never wrong before because a decl-twin module had never arrived
through a *bare* specifier — zapo-js's reaches lowering by a relative path.

### 3b. What the two fixes buy, with the flag ON

`wam/index.ts`, `--provenance-sources`, **no `--best-effort`**, both `dist`
builds verified by content:

| | before both fixes | after both fixes |
| --- | --- | --- |
| statements analysed | 46,013 | **46,035** |
| statements failed | 14 | **6** |
| blocker sites | 18 | **5** |
| distinct messages | 7 | **5** |
| **wa-wam mentions ANYWHERE in the site record** | 13 | **0** |

Zero *mentions*, not zero blockers: none in blockers, runtime fences,
advisories or unreached, counted together. The five that remain, named to the
line — this is the real residue of `@zapo-js/wam`:

| # | file:line | code | construct |
| --- | --- | --- | --- |
| 1 | `wam/registry.ts:77` | `SC2020` | `Number(raw)` of an unknown value |
| 2 | `wam/synthetic/random.ts:20` | `SC2020` | `Uint8Array.from` |
| 3 | `wam/WaWamUploader.ts:88` | `SC2012` | `Number.parseInt` |
| 4 | zapo-js `src/client/WaClient.ts:261` | `SC2020` | `emit('debug_transport_node_in')` arity |
| 5 | zapo-js `src/client/WaClient.ts:264` | `SC2020` | `emit('debug_transport_node_out')` arity |

**Both counting rules, each with its flag.** Without `--best-effort`: **5
blocker sites** (above). With `--best-effort` the frontend lowers the whole
program — **141,409,061 bytes of C**, **205,596,457 bytes of LLVM IR**, **zero
`SC` errors** — and the emitted C of the minimal probe carries **0** `[SCxxxx]`
runtime throws. The user's objective number is therefore zero fences, and it
is worthless here, because the binary is wrong for a reason no fence describes
(§7). A zero fence count is not a correct program.

**And `SC2008` is conditional, in both directions, measured from both sides.**
At the bare entry it is *unreached* (this census: absent). In a driver that
calls `wamPlugin()` it is a hard stop at `wam/plugin.ts:27` that poisons five
downstream uses through `SC2004`. Both the brief and `estado-pkgstatus.md` are
right that it is not a blocker at the entry — and that is conditional on
nobody calling the package's own plugin factory, which **anyone actually using
`@zapo-js/wam` does**. This is the first *reached* measurement of that site.

### 3c. Blast radius, measured with the narrow instrument

`resolveProvenanceSources()` alone returns exactly the surface
`mapEntryToSource` decides — which packages mapped, which specifier to which
file, and every note. A before/after diff of **that** is the blast radius
directly: seconds, against roughly two hours for a full analyze sweep over
eight entries. Choosing the instrument that answers the question, rather than
the broad one that answers it incidentally, is the point.

All eight package entries, base `dist` verified pre-fix by content, then
rebuilt and re-run:

| entry | before | after | verdict |
| --- | --- | --- | --- |
| `media-utils` | 3 mapped | 3 | IDENTICAL |
| `store-mongo` | 12 mapped | 12 | IDENTICAL |
| `store-postgres` | 9 | 9 | IDENTICAL |
| `store-redis` | 8 | 8 | IDENTICAL |
| `store-sqlite` | 9 | 9 | IDENTICAL |
| `voip` | 6 | 6 | **IDENTICAL** |
| `store-mysql` | 9 | 10 | **+1 NEW** `mysql2/promise` → `<mysql2-src>/promise.d.ts` |
| `wam` | 5 | 6 | **+1 NEW** `@vinikjkkj/wa-wam` → `<wa-wam-src>/packages/wam/index.d.ts` |

**Every change is `island → mapped`. Nothing MOVED** — no specifier that
resolved to one file now resolves to another. That is the candidate ordering
doing its job: the authored-JavaScript list is probed only after every
TypeScript candidate has missed, which is the property that makes this claim
checkable rather than argued.

**Which rows were capable of moving.** An unchanged row for an unattested
package is not evidence — `pg`, `@types/pg`, `ioredis`, `sharp`, `file-type`,
`@roamhq/wrtc` and `libmlow-wasm` publish no attestation, so the compiler never
opens them. The rows that could genuinely have moved are the attested-and-
reached ones: **`zapo-js`** (all eight entries, 3–12 specifiers each),
**`mongodb`**, **`bson`**, **`mongodb-connection-string-url`**, **`mysql2`**,
**`wa-wam`**. Four of those six kept an identical table and two gained one.
`store-mongo` is the strongest control in the set: an attested TypeScript
package mapping twelve specifiers, every one unchanged. `better-sqlite3` is
attested but **not capable of moving** — `await import(BETTER_SQLITE3_MODULE)`
with a `const` specifier produces no import edge, so it never enters the
mapper at all.

`voip` is unaffected, measured, not argued.

---

## 4. A guard that could never fire for the case it describes

`provenance.ts` carries a version-skew note for a source tree whose
`package.json` disagrees with the installed version. Before the fix, wam's
notes were only:

```
@vinikjkkj/wa-wam@2.3000.1041713829-1ec0d3b: no source mapping for
'@vinikjkkj/wa-wam' (published target: index.js); island path used
```

After the fix, that note is gone and **this one appears**, in the build log
where a user sees it:

```
@vinikjkkj/wa-wam: source tree's package.json says 2.3000.1041627196-aaa11ce,
installed is 2.3000.1041713829-1ec0d3b (release tooling that bumps at publish)
— the behavior differential is the check
```

The note is emitted inside `expand()` **after a successful mapping**. wa-wam
never mapped. So the one package in this corpus with a measured version skew
was **the one package whose skew warning could never fire** — the guard was
gated behind the condition it guards.

The general form, which outlives provenance:

> **A warning attached to the success path cannot warn you about a failure, and
> "we have a note for that" is not evidence the note has ever been printed.**

The practical rule: before counting a guard as coverage, find proof it has
actually fired.

---

## 5. The attested wa-wam tree is NOT the published artifact

This is the most important thing in this report for anyone else using
`--provenance-sources`.

Installed: `@vinikjkkj/wa-wam@2.3000.1041713829-1ec0d3b`. The tree fetched at
the attested commit `1ec0d3b91d0e` carries the **previous** day's table — its
`package.json` says `2.3000.1041627196-aaa11ce` and its `index.js` header reads
`WhatsApp Version: 2.3000.1041627196`. `md5` differs; sizes differ by 2,149
bytes. This is a daily-regenerated table whose publish step regenerates data
the attested commit does not contain. **An attestation proves where a tarball
was built. It does not prove the tree at that commit reproduces it.**

The whole divergence is **49 lines and every one is additive**:

| kind | what | where |
| --- | --- | --- |
| new enum table | `CA2D_EXTENSION_CONNECTION_STATE` (`NONE CREATING CREATED CONNECTING CONNECTED REMOVED`) | `WA_WAM_ENUMS` |
| new enum member | `INTEGRITY_SCAM_ALERT_UPSELL: 115` | `BANNER_TYPES` |
| new enum member | `AI_IMAGINE_MESSAGE_QUICK_EDIT: 131` | `MEDIA_PICKER_ORIGIN_TYPE` |
| new enum member | `CONDITIONAL_REVEAL: 77` | `MEDIA_TYPE` |
| new enum members | `SIM_SWAP_CHANGE_PHONE_NUMBER: 344`, `SPLIT_MESSAGE_BUBBLE: 345` | `PAYMENT_ACTION_TARGETS` |
| new enum member | `WIDGET_TAP: 11` | `PTT_MESSAGE_USER_JOURNEY_ACTION` |
| new enum member | `WIDGET: 3` | `PTT_MESSAGE_USER_JOURNEY_STAGE` |
| new enum member | `GEN_AI_AGENT_SMART_COMPOSER_HANDOFF_CARD: 318` | `SURFACE_TYPE` |
| 12 new fields | `ca2dExtensionAddT ca2dExtensionConnectionState ca2dExtensionCreateT ca2dPreviewT extensionType extensionTypeBitmask extensionUserRid imuTxBitrate imuTxDroppedCount imuTxFrameCount maxNumConnectedExtensions numConnectedExtensions` | event `Call` |
| 1 new field | `isScheduled` (id 94) | event `MessageSend` |

**Nothing that already existed changed value.** Both halves of what that means
matter, and reporting only one of them misleads:

1. A driver that reads one of those identifiers prints **WRONG** for a reason
   that is not a compiler bug.
2. Far more dangerous: because the divergence is purely additive, **every
   driver reading only pre-existing keys is green automatically.** The green is
   the *default*, not something care earned. Steering clear was cheap — it cost
   two table choices — so "our oracle passed" carries almost no information
   about this lane.

The reassuring half, which a rewritten table would not give: provenance-lane
behaviour here is a **strict subset** of published behaviour, so wrong answers
are confined to newly-added keys. **Establish which kind a package is — purely
additive, or values rewritten — before trusting the lane on it.**

---

## 6. An emit diagnostic whose stated cause is not the cause

Rows 4 and 5 of §3b say the event's tuple has **0** arguments. It does not:
`zapo-js/src/client/types.ts:1496` declares
`debug_transport_node_in: (event: { node: BinaryNode; frame: Uint8Array }) => void`
— one parameter. I formed a hypothesis (the payload names the self-recursive
`BinaryNode`, which the two failing events have and the passing ones lack) and
**refuted it by construction**, four probes, about eight seconds each:

| probe | construct | result |
| --- | --- | --- |
| 1 | `emit` of a fresh object literal, no listener anywhere | **compiles clean** |
| 2 | plus a registration with a non-literal event name | that construct is *itself* refused (`SC2020 'on with a non-literal event name'`), so it cannot be zapo-js's shape |
| 3 | a **zero-parameter listener** on the same event — the scenario `lower-emitter.ts`'s own comment blames for this exact site | **compiles clean**; the trace shows the tuple derived as **1**, from the emit site |
| 4 | a typed event map behind typed `emit` overloads, two events differing only in that one payload names a self-recursive interface with `BinaryNode`'s exact shape | **both compile clean, both `tuple=1`** |

So it is **not** the recursive type, **not** the object literal, **not** a
zero-argument listener, and **not** an opaque registration. Note what probe 3
means: **the explanation `lower-emitter.ts` writes in its own comment for this
very site does not reproduce**, so the comment is misleading to the next
reader as well.

Handed over as an open question with four dead ends closed, and with the
instrument that settles it in one run: `lower-emitter.ts` ships
`SCRIPTC_NOOPEMIT_WHY` (prints why the listenerless no-op declined) and
`SCRIPTC_EMIT_WHY` (prints the derived tuple). Nobody needs to guess again.

If it is confirmed that the tuple is derived as 0 for a reason unrelated to
arity, the diagnostic's advice — *"every emit site of one event name must
supply the same argument tuple"* — **points a reader at source that is already
correct**, which would make it another instance of the unfollowable-advice
pattern this fleet keeps finding.

---

## 7. The wrong answer, and why the feature is off

`--provenance-sources` with the mapping ON, no `--best-effort`, zero `[SC`
fences in the emitted C. The smallest program that reads three constants and
two enum lookups off the mapped package, nothing else in the graph, no
zapo-js — `probe-wawam/wawam-min.ts`, 657,408 bytes, C backend:

```
protocol=0                    node v25.9.0 prints  protocol=5
<access violation, 0xC0000005>
```

`WA_WAM_PROTOCOL_VERSION` is `5` in the attested tree **and** in the published
artifact, so the §5 skew is not involved. This is a **silent wrong answer
followed by a crash**, and it is the one trade this compiler does not make.

### 7a. Cause, localized

The twin **is** lowered: 11 MB of C, the enum tables present, and
`sc_f__x25_init_0` correctly assigns `sc_g_m0_WA_WAM_PROTOCOL_VERSION = 5.0`
and builds every table.

**That function is defined and never called.** `main()` calls
`sc_f__x25_main()`, which calls only `sc_f__x25_init_2()` — the entry's init.
Every global the twin owns keeps its zero value, so the read prints `0`, and
the first table dereference (`sc_t8->sc_fld_regular` on a NULL record) is the
access violation.

`lower-modules.ts:2628` **already carries the redirect that fixes this** — the
import header names the twin's init rather than the declaration's when
`importBindsStaticTwinGlobal` holds — and it ships its own probe,
`SCRIPTC_TWININIT_WHY`, which prints one line per declaration-file edge.

**On this build that probe prints nothing at all.** So the redirect is not
choosing wrongly; the branch guarding it,
`dep.isDeclarationFile && declTwinSourceOf(dep) !== null`, is never true on any
edge. That is the next fix and it is one instrumented run from being pinned
down. **The next block's first command:**

```
SCRIPTC_PROVENANCE_AUTHORED_JS=1 SCRIPTC_TWININIT_WHY=1   node <wt>/packages/cli/dist/main.js build probe-wawam/wawam-min.ts   --backend c -o <lab>/bin/x.exe --provenance-sources
```

This is the same shape as §4 from the other side: **a guard that never fires
looks exactly like a guard that is working.** §4's note lived on the success
path and could not warn about a failure; this redirect lives behind a branch
nothing reaches and cannot correct what it was written to correct.

### 7b. What the flag costs, stated plainly

With `SCRIPTC_PROVENANCE_AUTHORED_JS=1` the census win is real and large
(§3b). With it unset — the default — `wam`'s entry is exactly where it was on
base. **The honest headline is that wam's entry does not reach a correct
binary**, and the 18→5 result is a measurement of what one lowering fix away
looks like, not a shipped capability.

---

## 8. The gate

Run under node **v25.9.0** (`gate.sh` prints `node --version` as the log's
first line; a log that does not start `v25.9.0` is not evidence).

```
Test Files  3 failed | 142 passed | 7 skipped (152)
     Tests  9 failed | 5697 passed | 54 skipped (5760)
  Duration  3033.75s
```

**Nine, and the ninth is a timeout.** The eight, by name:

| cell | backends | class |
| --- | --- | --- |
| `1360-spawn-sync.ts` | C + LLVM | Windows host: no `/bin/echo` |
| `1482-spawnsync-error.ts` | C + LLVM | Windows host: no `/bin/sh` |
| `1537-os-release-spawnsync-stdio.ts` | C + LLVM | Windows host: no `true` |
| `2390-dot-requires\main.cjs` | C + LLVM | the real open defect, not mine |

The ninth, `coverage.test.ts > every corpus program is 100% static`, failed
with `Test timed out in 600000ms` while three blocks shared the host.
**Re-run alone: 1 file passed, 20 tests passed, 0 failed, the cell taking
393,063 ms against the 600,000 ms limit.** The brief records 267 s for it
uncontended; 393 s is the same cell on a busier host, still inside the limit.
So the failure set is **exactly the eight**, and there are no regressions.

`3394-fs-stream-option-lifecycle.ts` on LLVM, listed as known, did not fail.

---

## 9. Method and controls

- **The driver is negative-controlled.** `drivers/wam-entry.ts` carries 20
  hardcoded expectations. Corrupting exactly one of them makes it print
  `WAM-ENTRY: 1 FAILURES` instead of `ALL PASS`, verified before any binary was
  built. A harness that cannot report a failure cannot be trusted when it
  reports success.
- **The emitted-C fence scan is armed on both sides.** Counting
  `[SCxxxx at file:line]` in the generated C reads **4** for the merged block's
  `store-sqlite-names.c` (the `--best-effort` binary that is known to throw at
  run time, and the markers are the two `table-names.ts` sites it throws on)
  and **0** for `wam-wire-probe2.c`. Positive and negative control both fire.
- **`dist` was verified by CONTENT, never mtime**, at both rebuilds: md5 of
  `frontend/provenance.js`, `frontend/provenance-registry.js` and
  `frontend/program.js` all changed, and the new symbols (`authoredJsEntry`,
  the authored-JavaScript twin loop, `declTwinOf(program, projDep)`) are
  present in the emitted JS. A cached artefact's mtime in this repo is an LRU
  touch (`cc.ts:2199` calls `utimes`).
- **The before-fix numbers were taken against a `dist` proven pre-fix by
  content**, with `tsc --noEmit` used for the interim typecheck precisely so
  the measurement stayed honest.
- **`--best-effort` was not used for any binary here.** It defers per-statement
  refusals into runtime throws, so a census taken with it can read zero while
  the binary is full of throwing fences. Every count below names its flag.

Paths, all under `G:\blocks\` and nothing at `G:\` top level:
`G:\blocks\wamfix` (worktree), `G:\blocks\wamfix-lab\` (`app/`, `bin/` with a
README, `prov/`, `provmap-BEFORE/`, `provmap-AFTER/`, `sites.mjs`,
`provmap.mjs`, `bo.sh`, `gate.sh`, `env.sh`), `G:\blocks\wamfix-tmp` (TMP,
outside the worktree deliberately).

---

## 10. What I refuted

### In my brief

1. **"The 69-site `commit` cascade is wam's real biggest blocker" and the first
   lead.** Real, reproduced, and **not an independent problem** — it is
   downstream of the `zapo-js` island and is already **zero** under
   `--provenance-sources` with nothing touched (§2b). The mapper was not the
   second lead; it was the only one.
2. **"Fixing `mapEntryToSource` removes 12 of wam's 18 remaining sites."**
   It removes **13 of 18** on this base, and the handover's proposed shape —
   accept the `.js` — is the wrong half: it wins the values and loses the
   types, which is the measured failure mode of `--npm-static` here (§3).
3. **"`wam` already produces a binary from `wam-wire-probe2`, 14 of 14."**
   True, and worth qualifying: `probe-wire2` is a **copy** of three wire
   modules with **two edits** to zapo's source — a locally declared
   `type WaWamChannel`, and `setGlobal`'s union comparison narrowed per arm.
   The real `wire/WamBatch.ts:51` still carries
   `SC1090 comparisons of union-typed values`, unreached in the default lane.
   The floor is a floor for the wire *path*, not for wam's own source.

### In `estado-pkgstatus.md`

4. **"18 sites over 8 distinct messages, 12 of them wa-wam (5 + 7)."**
   I measure **18 sites over 7 messages, 13 of them wa-wam (5 + 8)** on
   `70e1fe48` against its `16705f5c` (§2c). Statement counts agree exactly.

### My own hypothesis, refuted by construction

5. **"The emit arity fence fires because the payload names the recursive
   `BinaryNode`."** Wrong, and disproved with four compiled counter-examples
   (§6) — along with the explanation `lower-emitter.ts` gives in its own
   comment for that very site, which also does not reproduce.

### My own change, refuted by compiling the awkward case

6. **"Mapping the authored-JavaScript package makes wam's entry compile."**
   It makes it *link*. The binary prints `protocol=0` where node prints `5` and
   then dies `0xC0000005` (§7). The feature is off by default because of it.

---

## 11. Traps this block paid for

- **A `CcCompileError: zig cc failed` whose stderr holds only warnings and no
  `error:` line is contention, not a compile error.** Re-run uncontended.
- **`zig cc --version` failing with `3221225794` (`0xC0000142`)** is the
  orphaned-zig-children shape. `zig version` answered normally seconds later.
- **A kill filter matched against a full command line matches your own output
  filenames.** `CommandLine -like '*wam-entry*'` also killed a running census
  writing `wam-entry-prov-AFTER.json`. Two processes died where one was meant.
- **The child's death can still be scheduled by an orphan.** `bo.sh` wraps
  builds in `timeout 2400`. The harness killed the `bo.sh` wrapper; the node
  child kept running; the `timeout` processes stayed alive and armed. They were
  40 seconds from killing a build that was 8 minutes from finishing. Killing
  the two `timeout.exe` processes let it complete.
- **Heredocs eat a backslash even when quoted.** `/\/g` in a `<<'EOF'`
  heredoc reached disk as `/\/g` and would not parse. Use the file-writing
  tool for anything containing escapes.
- **This program is large enough to matter**: 205,596,457 bytes of LLVM IR and
  141,409,061 bytes of C, and a zig compile holding 4.6 GB RSS. Two backend
  failures here happened under memory pressure with three blocks live.
- **A later build in the same output directory removed the `.ll`.** The 205 MB
  figure above is a measurement I recorded; the file is gone and the `.c` is
  kept. If an artefact is evidence, copy it out of the build's own output
  directory before the next build runs there.
