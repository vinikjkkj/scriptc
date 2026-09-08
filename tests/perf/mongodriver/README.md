# mongodriver — what `store-mongo`'s 238 blockers actually are

Block `mongodriver`, 2026-09-08, main **`f91fcd55`**.

The named wall: **`store-mongo` does not reach a binary because we do not fully
compile the mongodb driver.** 238 blocker sites, of which 226 are inside
`mongodb` and `bson`. This measures what those 226 are, proves the shared
causes by substitution, and prices the route to a binary.

---

## 0. The one-paragraph answer

`store-mongo`'s **build** stops at a single error — `SC1012 export =` in
`@mongodb-js/saslprep` — and never reaches lowering. Its **analysis** reports
238 blocker sites, 226 of them in `mongodb` + `bson`, which cluster into **58
message families**: 86 cascade, 65 representation decisions, 75 capability
gaps. The largest single cause is **one line**: `override options:
CommandOperationOptions;` at `mongodb/src/operations/command.ts:93`, a class
field redeclared at a different record shape. Changing that one token gates 25
sites, including 19 of the 22 `extends CommandOperation` refusals — the whole
mongodb operations subsystem. And the most important finding is that **238 is a
floor, not a work estimate**: removing that gate clears 41 sites and exposes 49
previously-unanalysed ones, 17 of which are *more of the same cause*. The wall
does not shrink when you fix the biggest thing in it. It grows.

Two further things a reader should take away before the detail. **The build's
"1 error" was hiding the rest**: routed past that one module-link refusal, the
build runs to completion and prints **237 errors**, whose `(file, line, code)`
keys are the **same set** as `analyze()`'s blockers — 211 keys, 0 on either side
alone. And **the wall is not all ours**: `whatwg-url@14.2.0` and
`sparse-bitfield@3.0.3` publish no provenance attestation, both sit on
`store-mongo`'s critical path, and neither is a package we control.

---

## 1. Host, lanes, and what every number below means

Host win32 x86_64, 6 physical cores. `zig 0.16.0` from the tree
(`<zapo-work>\tools\zig`, **not** the Chocolatey 0.15.2),
`SCRIPTC_TARGET=x86_64-windows-gnu`, `SCRIPTC_CC=zigcc`,
`SCRIPTC_TEST_CC="zig cc"`. GNU `tar` from Git's `usr/bin` ahead of System32
(bsdtar rejects `--force-local` and the provenance lane then silently falls back
to the island). Compiler **built** under node v22.18.0; every analysis, build
and oracle under node **v25.9.0**, read back from the spawned process.

Every cache pinned under `<blocks>\mongodriver\`. `<home>\.cache\scriptc`
verified **absent** before the first build and again at the end.

Two lanes, and every number says which:

| lane | flag | statements reached | blocker sites |
| --- | --- | --- | --- |
| **default** (spec twins on) | none | 48,563 | **238** |
| fast (`SCRIPTC_PROVENANCE_SPEC_TWINS=off`) | off | 3,131 | 242 |

The default lane is the reported one. The fast lane is used for the
substitution arms only, and its relationship to the default lane is
**measured, not assumed** (§4).

Entry: `drivers/store-mongo.ts` — a consumer shape that calls
`createMongoStore` and takes one store out of every domain, so the store
constructors are reached rather than merely named. Resolved through
`--provenance-sources` against the published npm artifacts.

Provenance actually mapped **5** packages; **12** islanded:

```
@zapo-js/store-mongo@1.2.0  <- 9a49e1fffdec      mongodb@6.21.0  <- 387b6dd29e0a
bson@6.10.4                 <- 302f96e9591c      @mongodb-js/saslprep@1.5.2 <- aff0d3bdf6e3
mongodb-connection-string-url@3.0.2 <- 26e2c12671f3
```

---

## 2. Instruments, and the control that failed

Everything is under `harness/`. Each instrument is negative-controlled, because
a tally that can only say "yes" says it whether or not it is true.

| instrument | what it does | its controls |
| --- | --- | --- |
| `sites.mjs` | per-entry refusal-site dump (reused verbatim from `pkgstatus-0907`) | throws on a missing `coverage`, missing `stats`, a site with no code/message, or a zero/zero/zero read |
| `own.mjs` | owner attribution by attested commit, message-family normalisation | pure module, reads no argv |
| `cluster.mjs` | groups sites into causes | 6 family cases + 4 owner cases, positive **and** negative, incl. an unknown sha that must not fold into a known bucket |
| `sitediff.mjs` | compares two records by **site identity**, never by count | self-diff → 0/0/0; drop-3 → 3 cleared; shift-5-by-4-lines → **5 MOVED**, not 5 cleared + 5 added; `--norm` equates two cache roots and nothing else |
| `patch-arm.mjs` | applies one line-neutral edit to a probe cache | refuses any path not under `\probe\`; refuses a stale/mismatched old line; re-reads and re-counts lines after writing |
| `verify-arm.mjs` | asserts **from the record** that an arm read its own tree | passes on the real cache, fails (rc 4) when told to expect a probe root |
| `classify.mjs` | the three-way split | prints `UNCLASSIFIED` loudly and exits 1 if anything is unmatched (it is 0) |
| `redecl-shape.mjs` | the relation between each redeclared field and its inherited slot | named positive control on `command.ts:93` (`base=18 derived=28`); refuses on any unresolved module that is not a known-optional peer |

**A control that failed, and what it caught.** `run-sites.ps1` sources
`env.ps1` on its first line, and the first version of `run-arm.ps1` set the
probe cache root in the *environment* before calling it — so `env.ps1` reset it
and **all six arms read the unpatched tree**. Every one reported a perfect
`0 cleared, 0 added`, which reads exactly like *"this line is not the cause."*
`verify-arm.mjs` exists because of that, it asserts from the record rather than
from the launcher's intentions, and the six records were discarded and re-run.

**A known limit of message identity.** Some diagnostics embed a module ORDINAL
(`typeof m159.ChangeStream`). Changing which packages are in the program
renumbers them, so one unchanged site reads as one cleared plus one added. It
shows up exactly once here (the manifest run) and is called out where it does;
it is a property of the compiler's message text, not of the differ.

A second one: my own `family()` normaliser did not strip the
`(instantiating class 'C' with <T>)` suffix — the type arguments are not
quoted, so the quoted-identifier stripper could not see them. Eight refusals of
**one** line at `operation.ts:92` counted as eight causes, and the family total
read 77 instead of 58. That is the roots-vs-cascade inflation this instrument
exists to remove, reproduced inside the instrument.

---

## 3. The 238, decomposed

Default lane, `sites/base-mongo-default.json`.

```
238 blocker sites   48,563 statements reached, 147 failed
                     1 runtime fence, 55 advisories, 1,245 unreached

  167  mongodb@6.21.0
   59  bson@6.10.4                     -> 226 = "the mongodb driver"
    6  @mongodb-js/saslprep@1.5.2
    3  the driver (this file's console.log lines, all SC2004 cascade)
    2  mongodb-connection-string-url@3.0.2
    1  @zapo-js/store-mongo            -> and that one is cascade (§7)
```

**226 sites → 168 distinct raw messages → 58 families.** 26 families carry ≥2
sites (194 sites); 32 are singletons.

### The three-way split (`classify.mjs`, 0 unclassified)

| bucket | sites | what it means |
| --- | --- | --- |
| **CASCADE** | 77 | the compiler labels it: `SC2004`, "see its own diagnostic", "the class declaration itself was rejected" |
| **CASCADE-UNLABELLED** | 9 | `extending classes not declared in the program ('X')` — X *is* in the program and failed. No cascade code. This is the blind spot, named rather than folded in |
| **REPRESENTATION** | 65 | a decision with semantics attached: a stdlib/@types-node surface with no lowering, a container element/key kind outside the domain, a type with no static representation |
| **CAPABILITY** | 75 | a construct the compiler could learn: field redeclaration, `this.constructor`, `export =`, generator methods, bound method references, … |

The 30 distinct standard-library surfaces behind the REPRESENTATION bucket, at
45 sites, are exactly the family the brief says to step past — `new Date`,
`Date.setTime`, `new WeakMap`, `WeakMap<WeakKey, any>`, `BigInt`, `globalThis`,
`Object.freeze of a possibly-aliased value`, `Object.defineProperty`,
`JSON.parse with a reviver`, `JSON.stringify with replacer/space`,
`ArrayBuffer.isView`, `string.substr`, `Symbol.dispose`, `Symbol.asyncDispose`,
`util.promisify`, `dns.promises`, `Cipheriv | Decipheriv.update`, and so on.

---

## 4. The fast lane is honest, and what the spec-twin fix already bought

`SCRIPTC_PROVENANCE_SPEC_TWINS=off` is not "the old numbers" by assertion — it
was diffed by site identity against the default lane:

```
242 -> 238   cleared 7, added 3, moved 0
```

The **7 cleared are the entire zapo-js-core cluster** — the four
declaration-only `spec/**/index.d.ts` references (`WA_ABPROPS`,
`WA_ABPROPS_BY_CODE`, `RAW_WA_APPSTATE_SCHEMAS`) plus `WaClient.ts`'s
`SC2011`/`SC2001`/`SC2004`. The spec-twin fix on main **closed store-mongo's
whole zapo-side cluster**, and raised reached statements from 3,131 to 48,563.

The **3 added** are in `mongodb/src/cmap/connection.ts:798-805`, code the fast
lane never reaches. They are not a regression; they are newly visible.

Independently: my fast-lane baseline is **site-for-site identical** to
`tests/perf/pkgstatus-0907/sites/store-mongo.json`, measured on main `3f3dd523`
56 commits earlier — `cleared 0, added 0, moved 0`. Nothing in those 56 commits
moved store-mongo on that lane.

---

## 5. The operations spine — proven by substitution

Over half of mongodb's 167 sites live in one subsystem. The causal chain, read
from the compiler source and then **proved by line-neutral substitution on a
copy of the attested tree**:

```
mongodb/src/operations/operation.ts:92    this.constructor                    ->  8 sites
mongodb/src/operations/operation.ts:152   response.toObject(...)              ->  8 sites
mongodb/src/operations/command.ts:93      override options: CommandOperationOptions
                                                                              ->  6 sites
              |
              v  CommandOperation<T> has no compiled concrete instantiation
   22x  class XOperation extends CommandOperation<R>   "extending the generic class ... without
                                                        a compiled concrete instantiation"
              |
              v
    9x  "extending classes not declared in the program ('DeleteOperation', 'InsertOperation',
         'UpdateOperation', 'MongoDBResponse', 'CursorResponse', 'OnDemandDocument')"
   32x  SC2004 "uses of 'AggregateOperation' / 'FindOperation' / ... inherit the blocker"
```

The mechanism is in `frontend/lowering/lower-classes.ts`:
`genericClassInstanceType` collects a generic class's shape under an
`instantiationContext`; a `PoisonError` raised inside marks the instance
`poisoned` and returns null; and `lower-classes.ts:2270` refuses `extends` when
the instantiated base is null or still the family.

### The arms

Every arm is the **same compiler**, the **same entry**, the **same flags**;
only a probe copy of the provenance cache differs, edited on exactly one line,
line-neutral. The real cache `<blocks>\mongodriver\prov` was never written —
`patch-arm.mjs` refuses any path not under `\probe\`.

**Arm P0, the control.** A probe cache with **no edit at all** (and `docs/`,
1,247 MB, and `test/`, 865 MB, omitted) reproduces the fast-lane baseline
**site-for-site**: 242 sites, `cleared 0, added 0, moved 0`, identical stats.
Without this every other arm is void.

| arm | one-line edit | cleared | added | net |
| --- | --- | --- | --- | --- |
| **P1** | `operation.ts:92` — the `this.constructor` read removed | **8** | 0 | 242 → 234 |
| **P2** | `operation.ts:152` — the `response.toObject` call removed | **8** | 0 | 242 → 234 |
| **P3** | both `operation.ts` lines | **16** | 0 | 242 → 226 |
| **P5a** | `command.ts:93` — `override options:` → `declare options:` | **25** | 73 | 242 → 290 |
| **P4** | all three lines | **41** | 73 | 242 → 274 |

P4, P5a and P5b add the **identical 73 sites** — same identities, not just the
same count — which is the cross-check that the exposure is caused by
`command.ts:93` alone and not by the `operation.ts` edits that P4 also carries.
P5a and P5b differ from each other (`24 cleared, 24 added` between them) only in
*which* member a lost slot is read through, never in the total.

Three things fall straight out:

1. **P1 and P2 are exactly additive and clear nothing downstream.** 8 + 8 = 16
   = P3, with zero added. `this.constructor` and `response.toObject` are *not*
   gates on the `extends` family.
2. **`command.ts:93` alone is.** P5a changes one token on one line — `override`
   → `declare`, which makes the member type-only so Node emits no `[[Define]]`
   and no reset — and **19 of the 22 `extends CommandOperation` refusals clear
   with it**, along with all 6 redeclare sites. Nothing in `operation.ts` is
   touched.
3. **P2's first version was a bad arm, and the differ said so.** Substituting
   `return { ok: 1, response } as unknown as TResult` did not satisfy `TResult`:
   8 `SC1090` cleared and **7 `SC2002` appeared at the same line**. That is "a
   thin stub does not isolate a variable, it changes the program", caught
   because the differ reports identities. The arm was rewritten to throw
   (`never` is assignable to `TResult`) and re-run.

### What the gate actually is, in 14 lines

`micro/m4-redecl-wider.ts` reproduces the whole chain standalone, verbatim:

```ts
type BaseOpts = { session?: string; timeoutMS?: number }
type CmdOpts  = { session?: string; timeoutMS?: number; dbName?: string; authdb?: string }
abstract class Base<T> { options: BaseOpts; constructor(o: BaseOpts = {}) { this.options = o } abstract run(): T }
abstract class Cmd<T> extends Base<T> { override options: CmdOpts; /* ... */ }
class Impl extends Cmd<number> { run(): number { return 1 } }
```

→ `redeclaring inherited fields at a different type` → `extending the generic
class 'Cmd' without a compiled concrete instantiation` → `constructing through
a class value whose class has no lowering`. Three sites, same three messages as
mongodb.

Decomposed by further micro-probes, all in `micro/`:

| probe | change | result |
| --- | --- | --- |
| `m4b` | the redeclaration removed | **0 sites** |
| `m4c` | an initializer added | **still refused** — the "without an initializer" half is *not* the gate, and the compiler correctly drops that clause from the message when an initializer is present |
| `m4d` | `declare` instead of `override` | redeclare refusal **gone**; one new site reading a member the base slot does not carry — so it is a **layout** problem, exactly as the message says |
| `m4e` | the generic parameter removed | **still refused** — this is not about genericity; genericity only changes the downstream message |
| `m4g`, `m4h` | the undefined-arm-removal case (`collection?: string` → `override collection: string`) | **0 sites** — the feature landed in `f076f5e3` is present and works |

So the gate is precise: **a class field redeclared at a record type whose
member set or member optionality differs from the inherited record.** Not the
missing initializer, not genericity, and not the already-solved field-level
undefined-arm removal.

### How big the fix would have to be

`redecl-shape.mjs` measures every redeclared field in mongodb against its
inherited slot, with a named positive control:

```
87 redeclared fields
  58  WIDTH-EXT   base members all present at an identical type, extras optional
  13  UNION-OK    differing members all optional, shared members identical
  11  OTHER       a shared member is RETYPED, or a differing member is required
   5  NON-RECORD  neither side is a record (e.g. `declare cause: Error` over `unknown`)
```

**71 of 87 would be served by one slot holding the union of both member sets** —
a member the base view cannot see is absent-or-undefined either way, which is
what `?:` already means. Note `command.ts:93` itself is UNION-OK, not
WIDTH-EXT: `CommandOperationOptions` does not extend `Abortable`, so it *drops*
the optional `signal`. A width-only rule would miss the very site that gates
everything. Of the 11 OTHER, **8 are `SERVER_COMMAND_RESPONSE_TYPE`** — a
class-*value* field overridden covariantly — and 3 are `options` fields whose
`writeConcern` is retyped to `undefined` by `& { writeConcern?: never }`.

**And the obstacle is named in the compiler's own source, not guessed.**
`lower-classes.ts` says it directly:

> A TYPE-CHANGING redeclare has no single slot type and keeps the fence: these
> layouts give the property ONE slot, and `override o: Wide` over an inherited
> `o: Narrow` needs that slot to answer both spellings, **which the record model
> (a narrowing conversion COPIES into the narrower shape) cannot do.**

`widthCoerce`'s record→record arm builds a **fresh value**. A base-typed read of
a widened field slot would therefore read a copy, and writes through one view
would not be visible through the other. So this is not a small feature: it needs
a non-copying narrowing *view* for field slots, which touches the record layout,
the IR, `ir/validate.ts`, and both emitters. **That is a decision for the user,
not a change this block should make on its own.**

---

## 6. THE HEADLINE: 238 is a floor, not a work estimate

Arm **P4** removes all three spine lines. It

* **clears 41** sites, and
* **adds 73**.

Of the 73, **24 are artifacts of the probe edit itself** — removing the
declaration exposes reads of members the base slot never had — and **49 are
genuinely newly-exposed refusals** — code inside
the 22 operation classes that had *never been analysed*, because a class the
compiler refuses to instantiate never has its body walked.

**17 of those 49 are more `redeclaring inherited fields at a different type`,**
one per subclass's own `override options: XOptions`, at
`delete.ts:46`, `insert.ts:15`, `update.ts:75`, `aggregate.ts:52`,
`count.ts:27`, `indexes.ts:247`, `indexes.ts:333`, `indexes.ts:373`,
`list_databases.ts:31`, `list_collections.ts:38`, `rename.ts:23`,
`remove_user.ts:14`, `estimated_document_count.ts:22`,
`client_bulk_write.ts:18` and the rest.

So the honest arithmetic on the fast lane is `242 − 41 + 49 = 250`. **Fixing the
single largest cause in store-mongo makes the measured wall grow by 8.** The
226 is suppressed by the refusals themselves: every refusal hides its own
subtree.

This is the roots-vs-cascade blind spot running the *other* way. It means no
count of blocker sites — this one included — can be read as an estimate of
remaining work, and it means progress on this objective will look like
regression on the dashboard for a while.

---

## 7. The other 12, and the build

**The build stops at one error and never reaches lowering.** Default config,
`logs/build-default.log`:

```
.../saslprep/src/index.ts:155:1 - error SC1012: export = assignments are not supported yet
  155 | export = saslprep;
1 error.   BUILD-RC 1   EXE-EXISTS False
```

`export =` is refused in preflight at `frontend/program.ts:2708`, over each user
source file's top-level statements — and with `--provenance-sources`, saslprep's
source *is* a user source file.

**But "one error" is not "one fix".** `@mongodb-js/saslprep` carries **six**
blocker sites in that one file:

| site | code | what |
| --- | --- | --- |
| `index.ts:155` | SC1012 | `export = assignments` (preflight) |
| `index.ts:155` | SC1090 | `'export =' assignments` (the lowering's own residue) |
| `index.ts:153` | SC1090 | `assignment to non-variables` — `saslprep.saslprep = saslprep` |
| `index.ts:154` | SC1090 | `assignment to non-variables` — `saslprep.default = saslprep` |
| `index.ts:4` | SC2020 | `string.codePointAt` has no lowering |
| `index.ts:40` | SC2011 | a `sparse-bitfield` type with no static representation |

The whole file is the expando-function-export idiom, and the compiler already
handles its JavaScript twin well (`cjsWholeExportAssignmentOf` &c. for
`module.exports = f`). **The published `@mongodb-js/saslprep` dist is exactly
that**: `dist/node.js` ends `module.exports = saslprep;`. So there is a cheaper
route than teaching `export =` — see §8.

**`mongodb-connection-string-url`, 2 sites, and it is on the critical path.**
One is `extending classes not declared in the program ('URL')` at `index.ts:101`
— the class-layout family the brief says is parked alongside `Date` and the
WebRTC handles. The other is new and matters more:

```
index.ts:1  SC2013  importing 'whatwg-url' requires the embedded dynamic engine
```

`whatwg-url@14.2.0` **publishes no provenance attestation**. So even with
`extends URL` solved, this package still cannot compile. And `store-mongo`
cannot avoid it: `MongoClient` parses its URI through it.

The same shape sits under saslprep: **`sparse-bitfield@3.0.3` publishes no
attestation either**, and that is the `SC2011` at `index.ts:40`.

**The one `@zapo-js/store-mongo` site is cascade**, as suspected:
`createMongoStore.ts:117`, `SC2011` on `WaMongoStoreConfig`, whose `db` member
is `Db | { uri; database; options?: MongoClientOptions }` — two mongodb types
that do not compile. The three driver sites are `SC2004` off it. **`store-mongo`'s
own source contributes nothing of its own.**

---

## 8. The shortest path to a `store-mongo` binary, honestly

There is no short path. Priced by what was measured:

| # | what | who | evidence |
| --- | --- | --- | --- |
| 1 | `whatwg-url` and `sparse-bitfield` publish provenance attestations — **or** the compiler compiles them from their published JS | upstream / compiler | measured: both island today, both produce a hard blocker, both are on the critical path |
| 2 | `class X extends URL` (and behind it `extends URLSearchParams`, generic `extends Map`) | compiler, currently parked | measured by an earlier block; `store-mongo` cannot route around it |
| 3 | the redeclared-field slot (§5) | compiler, **architectural** | measured: gates 25 sites and 71 of mongodb's 87 redeclares would need it; blocked by copy-on-narrow in the record model |
| 4 | saslprep: either `export =` + `assignment to non-variables` + `string.codePointAt` + a `sparse-bitfield` representation, **or** an entry mapping that follows `./dist/.esm-wrapper.mjs` to its CommonJS sibling | compiler | measured: the build's only error, the 5 that follow it in the same file, and the manifest probe that removes all 6 |
| 5 | the remaining ~49 newly-exposed sites behind (3), then whatever they in turn expose | compiler | measured once, at P4; **not converged** |
| 6 | the 65-site representation bucket — `Date`, `WeakMap`, `BigInt`, `globalThis`, `Object.freeze`, `Set<ClassInstance>`, `Record<string, ComplexUnion>` … | compiler, each with semantics attached | measured |

### The `--npm-static` escape, tested rather than assumed

`--npm-static` rides alongside `--provenance-sources`, and both packages that
block us publish no attestation but do publish plain, unminified JS. Four runs,
all `242 → 242, cleared 0, added 0` — and the coverage report says why each
time, which is the useful part:

| run | `npmStatic` says | site delta |
| --- | --- | --- |
| `--npm-static whatwg-url,sparse-bitfield` | `sparse-bitfield fallback: SC1010 the 'memory-pager' module is not supported yet`<br>`whatwg-url fallback: SC1010 the 'tr46' module is not supported yet` | 0 |
| `--npm-static whatwg-url,tr46,sparse-bitfield,memory-pager` | **`sparse-bitfield static`, `memory-pager static`**<br>`tr46 fallback: SC1010 'punycode/'`<br>`whatwg-url fallback: SC1010 'webidl-conversions'` | 0 |
| `--npm-static @mongodb-js/saslprep` | `@mongodb-js/saslprep **static**` | 0 |
| `--npm-static auto` | `whatwg-url fallback: auto: its declared types come from a third-party @types package, not the package itself` | 0 |

Three things this settles:

1. **The escape is a short chain of small packages deep, not shut.**
   `sparse-bitfield` and `memory-pager` already compile statically; `whatwg-url`
   needs `tr46`, `webidl-conversions` and `punycode/` first. Those are small,
   dependency-light packages.
2. **`--npm-static` compiles a package's implementation without making its
   exported TYPE representable.** `sparse-bitfield` reads `static`, and the
   `SC2011` in saslprep on `bitfield.BitFieldInstance` is unchanged, site for
   site.
3. **`--provenance-sources` wins over `--npm-static` for a package it has
   already mapped, and the status line does not say so.**
   `--npm-static @mongodb-js/saslprep` reports `status: "static"`, yet all six
   saslprep sites still resolve to
   `…/aff0d3bdf6e3…/packages/saslprep/src/index.ts` — the attested *TypeScript*,
   `export =` and all. So this flag cannot be used to route **around** a
   provenance-mapped package, and a reader trusting `npmStatic: static` would
   conclude the opposite.

### And the manifest hook, which gets closer and then declines

There is no per-package provenance opt-out flag. There is
`SCRIPTC_PROVENANCE_MANIFEST=<path.json>`, which pre-seeds a package's source
**directory** and skips the network for it. Pointed at
`node_modules/@mongodb-js/saslprep`, the lane gets the published dist, whose
entry ends `module.exports = saslprep` — the CommonJS form the compiler already
supports. The result (`sites/manifest-saslprep.json`):

```
242 -> 237   cleared 7, added 2
  cleared: all six saslprep sites, SC1012 `export =` included
  added:   SC2013 importing '@mongodb-js/saslprep' requires the embedded dynamic engine
```

**All six saslprep blockers go, and the build's only error with them — but the
package ISLANDS rather than compiles**, which for a no-quickjs binary is not
progress. The lane says exactly why, and it is a familiar shape:

> `@mongodb-js/saslprep@1.5.2: no source mapping for '@mongodb-js/saslprep'
> (published target: ./dist/.esm-wrapper.mjs); island path used`

That is the same "no source mapping for X (published target: …)" class that
islands `mysql2/promise` and `@vinikjkkj/wa-wam` for the other packages — the
`exports.import` condition resolves to an ESM wrapper the entry-mapping
heuristic will not follow to a source. **Teaching the source-entry mapping to
follow an `.esm-wrapper.mjs` to its CommonJS sibling is a small, well-shaped
change, and it would give saslprep a static route without any `export =` work.**

(One freed slot also changed the note for `@zapo-js/native` from *"provenance
package limit (16) reached"* to *"not installed"* — the cap is that close to
biting on this driver.)

### …and that probe answered the question nobody could answer before

With the module-link refusal out of the way the **build runs to completion and
prints its whole error list for the first time**:

```
237 errors.   BUILD-RC 1   (logs/build-manifest.log)
  SC1090 94   SC2020 45   SC2004 41   SC2011 22   SC2009 19   SC1043 5
  SC2001  3   SC2013  2   SC2002  2   SC2006  1   SC1100  1   SC1071 1   SC1045 1
  mongodb 165   bson 59   zapo-js 8   driver 3   mongodb-connection-string-url 2
```

Compared **key by key** — `(file, line, code)` — against `analyze()`'s blocker
set for the same configuration:

```
build error sites : 211 distinct keys
analyze blockers  : 211 distinct keys
only in build     : 0
only in analyze   : 0
```

**They are the same set.** The earlier reading — that a build's error count and
`analyze()`'s site count "are different questions that can differ by 240" — is
true only because the build stops at the *first module-link refusal*. Remove
that one refusal and the two instruments agree site for site.

That is a real strengthening of the survey: for this package, `analyze()`'s
blocker set predicts the build's frontend errors exactly. It says **nothing**
about `ir/validate.ts` or either emitter — this build still never reached
lowering, because it errored. A closed site count is still not a build.

**What this block did *not* do:** it did not attempt item 3. The obstacle is the
record model's copy-on-narrow, named in the compiler's own source; widening it
correctly means giving field slots a non-copying narrowing view, and
`ir/validate.ts` plus both emitters have to be walked before any assertion there
is touched. The measurement says what it would buy (25 sites now, 71 redeclares
in total, the whole operations subsystem) and what it would cost. **The route is
not shut; it is expensive, and the call is the user's.**

---

## 9. Found while measuring, not asked for

1. **The provenance cache extracts 2.1 GB to compile 2 MB.** mongodb's attested
   checkout is 2,157 MB, of which `docs/` is 1,247 MB and `test/` is 865 MB.
   `src/` — everything the compiler reads — is **2 MB**. Arm P0 proves the point
   the hard way: a copy of all five checkouts with `docs/` and `test/` omitted is
   **23.4 MB** and produces a **site-for-site identical** analysis. This is
   almost certainly the "2.17 GB on the user's C: drive" already in the fleet
   notes; a checkout filter would make that class of accident 99% smaller.
2. **Only 5 of 17 packages are source-mapped, and one was dropped by a cap.**
   `@zapo-js/native: skipped — provenance package limit (16) reached`.
   `MAX_PACKAGES = 16` silently islands the seventeenth package, and store-mongo
   is the driver wide enough to hit it.
3. **`this.constructor` is filed under "standard library surface with no
   lowering" (SC2020)**, next to `Date` and `WeakMap`, because `constructor` is
   an `Object.prototype` member typed by the stdlib. Mechanically it is a
   lowering the compiler could learn, not a representation decision. Any triage
   that buckets by diagnostic code will put it in the wrong pile — this
   classifier has an explicit rule for it.
4. **One 8-line idiom in bson costs 8 sites across two packages.**
   `bson/src/parser/on_demand/index.ts` builds `const onDemand: OnDemand =
   Object.create(null)`, assigns members, then `Object.freeze`s it. That yields
   `Object.freeze of a possibly-aliased value`, and then five
   `the reference to 'onDemand' (a binding form with no lowering)` sites in
   *mongodb*'s `src/bson.ts:40-43` and `src/cmap/commands.ts:33`.
5. **A hypothesis of mine, refuted by its own probe.** bson's five `SC1043
   comparing non-number, non-string values` sites sit on lines that are compound
   *assignments* (`numBits &= 63`, `approx -= delta`), so I suspected a
   mis-attributed location. `micro/m1`, `m1b` and `m2` reproduce those exact
   shapes standalone and report **0 sites**. The message is not describing what I
   thought; the cause is in the operand types, and the claim is withdrawn.
6. **A second hypothesis, also refuted.** I suspected the redeclare message's
   "and without an initializer" clause was misleading, since adding an
   initializer does not clear the refusal. It is not: `lower-classes.ts` builds
   the two reasons independently and `micro/m4c` confirms the clause is
   **dropped** when an initializer is present. The message is exact.

---

## 10. Reproducing

```powershell
. tests\perf\mongodriver\harness\env.ps1     # refuses unless every cache is on G:
.\tests\perf\mongodriver\harness\build-compiler.ps1
# the consumer app: npm install tests/perf/mongodriver/drivers/napp-package.json
.\tests\perf\mongodriver\harness\run-sites.ps1 -Entry <napp>\drivers\store-mongo.ts `
    -OutName base-mongo-default --provenance-sources          # ~9 min, default lane
node tests\perf\mongodriver\harness\cluster.mjs  sites\base-mongo-default.json --owner mongodb,bson
node tests\perf\mongodriver\harness\classify.mjs sites\base-mongo-default.json
.\tests\perf\mongodriver\harness\run-all-arms.ps1             # P0..P5b, ~90 s each
```

`sites/` carries the records this document is computed from; `logs/` carries
every run log, each ending in a `GATE-EXIT` sentinel so a truncated log is
distinguishable from a killed one.
