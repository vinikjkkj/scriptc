# estado-voidpromise — wall 2 on the sqlite path is closed, and it cost nothing on the hot path

Block `voidpromise`, worktree `G:\blocks\voidpromise\wt`, branch
`block/voidpromise`, base main `a49c2a88`. Measured 2026-09-03 on win32
x86_64, `zig 0.16.0` (`/g/zapo-work/tools/zig`),
`SCRIPTC_TARGET=x86_64-windows-gnu`, `SCRIPTC_CC=zigcc`. Built under node
v22.18.0, gated under **node v25.9.0** (`which node` =
`/c/Users/vinicius/AppData/Local/nvm/v25.9.0/node`, `node -e
process.version` = `v25.9.0`).

---

## 1. The answer

`store-sqlite/src/connection.ts:452`
`SC2020 'Promise.resolve with an argument at a void-promise type'` is
**closed**, and closed **without the nullable-record representation the
brief named as the requirement**. No record read changed. No hot path
changed. The measured blast radius in the codegen is **zero programs**.

The construct:

```ts
const createdEntry: SqliteConnectionCacheEntry = {
    connection: null,
    connectionPromise: Promise.resolve(null as never),   // :452
    refs: 0
}
createdEntry.connectionPromise = createdConnection.then(...).catch(...)  // :455
...
await entry.connectionPromise                                            // :485
```

**The mechanism.** A whole-program pre-pass marks any PROMISE-typed record
property that some object literal initializes with a
`Promise.resolve(<bare null>)` the checker types `Promise<never>`. A marked
property's field **payload becomes `void`** — the field is
`promise<void>`, not `promise<WaSqliteConnection>`.

That is the whole change. Everything downstream is machinery that already
existed:

- the placeholder is `scr_promise_new()` + `scr_promise_fulfill_void()` —
  the already-settled payload-less promise;
- `:455`'s real `Promise<Conn>` enters the slot through **`promiseVoidWiden`**,
  an IR node that has been in the tree since before this block ("one C
  representation (ScrPromise\*), so this is a type-only reinterpret:
  awaiting through the slot ignores the fulfillment payload
  (`scr_await_void`) and rejections flow untyped"). I added no adapter and
  no widening rule;
- `:485`'s `await` is in statement position, so nothing reads a payload.

**Why `void` and not a nullable payload.** I built the null-arm version
first — the field's payload as `Conn | null`, which is exactly the
representation zapo's own sibling field `connection: WaSqliteConnection |
null` already uses (a `union` with a `nullT` arm; scriptc has had nullable
records all along, as tagged boxes). It compiled. It is **wrong**:

```
$ scriptc run p1.ts
Unhandled promise rejection: TypeError: null is not representable in the
target union (a value narrowed or asserted past it still held it)
```

`const v = await e.connectionPromise` gives the checker's `Conn`, so the
union takes the checker-trusted extraction into the record slot and the
extraction **throws** — where node prints `object`, `null`, `null`,
`falsy`, and only then `TypeError: Cannot read properties of null (reading
'driver')` at the deref. A throw at the await is a wrong answer, not a
refusal. The void payload turns that same site into a **compile-time
refusal** instead, which is the one answer that is never wrong.

---

## 2. The bar: `await`'s answer and every downstream read

Node v25.9.0, the value the placeholder fulfils with, at every read the
brief named:

| read | node | branch |
|---|---|---|
| `await p` | `null` | **refused at compile time** (`SC2002 … expected '{ driver: string }', got 'void'`) |
| `typeof v` | `object` | (unreachable — the declaration refused) |
| `console.log(v)` | `null` | (unreachable) |
| `JSON.stringify(v)` | `null` | (unreachable) |
| `v ? … : …` | falsy | (unreachable) |
| `v.driver` | `TypeError: Cannot read properties of null (reading 'driver')` | (unreachable) |
| `await p` **discarded** | settles, fulfilled | **MATCH** |
| `await p` in a try/catch | no rejection | **MATCH** |
| `p.then(cb)` | `cb` runs | **MATCH** |
| a real `Promise<Conn>` assigned over it, then awaited | settles / rejects with the same error | **MATCH** |

The refusal is deliberate and is the design: node's answer is `null`, no
`WaSqliteConnection` slot holds a `null`, and the alternatives are a crash,
a throw node does not do, or a plausible empty record. The compiler says
so instead.

---

## 3. What still refuses, and why each one must

Pinned in `tests/diagnostics/promise-resolve-null-placeholder-fences.ts`
(snapshotted).

| spelling | diagnostic | why |
|---|---|---|
| `const p: Promise<Conn> = Promise.resolve(null as never)` | SC2020, unchanged | a variable is not a slot whose layout the whole program shares; nothing can carry the mark |
| `{ f: Promise.resolve(bump()) }` (effectful argument) | SC2020, unchanged | **the fence's own stated reason** — "the argument's effects must still run — no statement slot exists here for them". Only a bare `null` is admitted, because only a bare `null` has nothing to drop |
| `{ f: Promise.resolve(undefined as never) }` | SC2020, unchanged | node fulfils that one with `undefined`, not `null`. The rule names the value it can name and declines the other rather than assuming they are the same |
| `const c = await marked.f` | SC2002 | §2 |
| `take(marked.f)` into a `Promise<Conn>` slot | SC1090 | the slot promises a payload this promise does not carry |

---

## 4. Blast radius, measured in the codegen

Bounding property: the rule can only fire in a program that spells
`Promise.resolve(` at all — the scan's own prefilter, and the mark's
precondition. **55 such programs** across `tests/corpus`,
`tests/diagnostics`, `tests/fixtures`.

**Pass level.** `SCRIPTC_NULLPAYLOAD_WHY=1` names every property the scan
marks. Over all 55: the scan **never even ran** for 53 of them (a
promise-typed record field is the only thing that asks), and marked
`marked=2` on `tests/corpus/7420` and `marked=1` on the diagnostics
fixture. Nothing else in the tree marks anything.

**Codegen level.** `--emit-ir --backend c` for all 55 on the branch build
and on a base build of the same worktree (`git stash` + rebuild), IR JSON
md5 per program:

```
$ diff ir-base.md5 ir-branch.md5
36a37
> e306913ca90ed20579e117b89711fa77 *7420-promise-resolve-null-placeholder-field.ir.json
```

45 programs build on both and emit **byte-identical IR**. The only
difference is the new program, which does not build on base at all.

**Positive control that the scan sees the introduced text.** The text the
change introduces is a record field typed `promise<void>` where the
declaration says `Promise<S>`. Scanning every branch IR's record table for
a `{"kind":"promise","inner":{"kind":"void"}}` field: **one program hits,
7420**, and no other. (Its count is 3: the two marked fields plus
`Mixed.done`, which is declared `Promise<void>` and always was.)

Two more whole-tree measurements agree: the diagnostics suite wrote **1 new
snapshot and changed 0 of the other 126**, and the ts7 order-parity
baseline recorded **2 added, 0 CHANGED** across 1965 entries.

---

## 5. The hot path

**There is none to measure.** The brief priced a guard on every record read
(`obj->field`, `emit-exprs.ts:2044`) against the bench's 513 million typed-
array element accesses. That change was not made and is not needed:

- `recordGet`/`fieldGet` emit exactly the same C and the same IR as before
  — proven by the 45-program byte-identical IR diff above, not by
  inspection;
- no new runtime function, no new IR node, no change to `ScrPromise`, no
  change to any record layout in any program that does not contain the
  construct;
- in a program that DOES contain it, the only layout change is one field's
  payload type, which is erased in both backends (`promise<T>` and
  `promise<void>` are both `ScrPromise *`).

So the A/A floor the brief asked for has nothing to bracket. I did not run
the six-phase cycle bench, and I am saying so rather than reporting a
number: with the codegen proven identical for every program outside the
construct, a bench run could only measure the host.

---

## 6. Correctness

<!-- GATE -->

---

## 7. What I could not close

1. **`Promise.resolve(undefined as never)`** at a record field. Node
   fulfils with `undefined`, not `null`; the same void-payload slot would
   in fact serve it, but I have not measured a program that spells it and
   declined to widen a rule on a guess. SC2020 stands.
2. **Any destination that is not an object-literal property.** A variable,
   a return position, an array element, a `Map` value. The mark needs a
   slot whose layout the whole program shares, and only a record field is
   one. SC2020 stands.
3. **Reading the fulfillment value of a marked field.** Refused, by
   design — §2. This is not a gap to be closed later by a better lowering:
   closing it needs the nullable-record payload the brief named, and the
   cheapest honest form of THAT is the null-arm union I measured and
   rejected in §1, because the checker-trusted extraction throws where node
   answers `null`. A future attempt has to start by making that extraction
   a refusal, which is a change to a rule far outside this construct.
4. **A structurally identical but separately declared interface.** The mark
   is keyed on the property SYMBOL, so `interface Twin { connectionPromise:
   Promise<Conn>; refs: number }` interns a DIFFERENT shape from a marked
   `Entry`, and `const t: Twin = e` refuses where it used to width-coerce.
   A refusal, never a wrong answer; and zapo's
   `SqliteConnectionCacheEntry` is local to `connection.ts` with no
   structural twin.
5. **The SC2002 text at the refused read** says `expected '{ driver:
   string }', got 'void'` and does not say WHY the field is payload-less.
   It is accurate and it is loud, but a reader who has not read this file
   will not connect it to `:452`. A hint naming the placeholder would need
   the field's provenance threaded to the coercion site; I left it.
6. **Walls 1, 3, … on the sqlite path are untouched.** Compiling zapo's
   real `connection.ts` (§ below) still reports the const-specifier
   namespace gap, `RegExp`, `Object.freeze of a possibly-aliased value`,
   the `zapo-js` package import, and the regex-replacement fence. Those are
   other blocks'.

---

## 8. The wall, on the real file

`connection.ts` compiled from a read-only copy of
`G:\zapo-work\caches\provenance\250f9af5…\packages\store-sqlite`, byte for
byte as zapo writes it, with only the two `zapo-js` imports stubbed so the
file resolves. Base build and branch build of the same worktree, same
entry, same tsconfig:

| | base `a49c2a88` | branch |
|---|---|---|
| `connection.ts:2:1` SC2013 `importing 'zapo-js'` | yes | yes |
| `connection.ts:239:91` SC2020 `'RegExp'` | yes | yes |
| `connection.ts:251:23` / `262:23` SC1090 `toSafeNumber` | yes | yes |
| `connection.ts:359:12` SC1090 `isBunRuntime` | yes | yes |
| **`connection.ts:452:32` SC2020 `Promise.resolve with an argument at a void-promise type`** | **yes** | **GONE** |
| `table-names.ts:68 / 116 / 142` | yes | yes |

The diff between the two runs is exactly one line, and it is the wall.
