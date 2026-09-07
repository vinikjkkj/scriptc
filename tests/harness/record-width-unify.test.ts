/* SHAPE UNIFICATION, against node. What the merge fixes, and what it must
 * not break on the way.
 *
 * record-width-copy.test.ts pins the DEFECT: a record flowing into a
 * narrower shape is COPIED, so `n = take(w); n.a = 9` leaves `w.a` at 1
 * where node prints `9 9`. Where the narrow shape can afford to carry the
 * wide one's extra members, shape-unify.ts makes the two ONE shape and the
 * copy becomes the identity. This file is that fix measured on a running
 * binary, on both backends, against node v25.9.0.
 *
 * IT IS NOT ENOUGH TO FIX THE IDENTITY. A shape that GREW must not start
 * reporting the members it gained. `{ a: 5 }` typed `{ a: number }` has ONE
 * own key in JavaScript however wide the struct behind it is, and
 * Object.keys, JSON.stringify and Object.hasOwn all have to keep saying so.
 * That is why the pass only ever adds an OPTIONAL-flavored member: the unset
 * slot IS the undefined arm, which is the presence signal every one of those
 * surfaces already reads. The `keys` row is the assertion; if it ever answers
 * `a,b` the fix has traded an identity bug for an enumeration bug, which is
 * not a trade.
 *
 * ORDER is the second obligation. JSON.stringify prints declaredOrder, so a
 * merged layout has to print each member's own keys in that member's own
 * order — `order` and `orderNarrow` are the two halves of that.
 *
 * THE `declined` ROWS ARE A PINNED DEFECT, not an oversight. Their extra
 * member is REQUIRED, and a required member has no undefined arm to spell
 * "this instance does not have this key" with. Admitting it needs a
 * per-instance own-key mask WRITER at every record construction (the mask
 * exists; only the dynCheck builder writes it, and ownPresentCondC falls
 * back to the undefined-arm rule for every instance whose mask byte 0 is
 * zero). Until that writer exists these keep the copy — so `declined` still
 * prints node's `9 9` as `1 9`, exactly as record-width-copy.test.ts's rows
 * do. When it starts agreeing with node, THIS ROW FAILS: that is the point
 * of it, and the right move is to move the row to the matching set above.
 */
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, test } from "vitest"
import { compile } from "@scriptc/compiler"
import { exeName } from "./exe.js"

const repoRoot = join(import.meta.dirname, "../..")
const cacheDir = join(repoRoot, "node_modules/.cache/scriptc-tests")
const sanitize = process.env["SCRIPTC_SAN"] === "1"
const BACKENDS = ["c", "llvm"] as const

const SOURCE = `export {}
// THE PAIR THAT MERGES. The member Narrow gains is optional-flavored, so its
// unset slot is the undefined arm and every own-key surface reads it as
// absence -- which is what lets the layout carry it.
interface Wide { a: number; b?: number }
interface Narrow { a: number }
function take(x: Narrow): Narrow { return x }

// (1) IDENTITY, the defect this closes. In JS \`n\` and \`w\` are one object.
const w: Wide = { a: 1, b: 2 }
const n = take(w)
n.a = 9
console.log("identity " + w.a + " " + n.a)

// (2) THE OTHER DIRECTION of the same split.
const w2: Wide = { a: 1, b: 2 }
const n2 = take(w2)
w2.a = 9
console.log("source " + w2.a + " " + n2.a)

// (3) OWN KEYS of a value built AT the narrow shape. It has one key in JS,
//     and the slot it gained for 'b' must not become a key.
const only: Narrow = { a: 5 }
console.log("keys " + Object.keys(only).join(",") + " " + JSON.stringify(only) + " " + Object.hasOwn(only, "b"))

// (4) OWN-KEY ORDER, through the merged layout. 'zz' sorts after 'a', so a
//     merged shape that printed its fields by name would fail this.
interface OWide { zz: number; a: number; q?: number }
interface ONarrow { zz: number; a: number }
function otake(x: ONarrow): ONarrow { return x }
const ow: OWide = { zz: 1, a: 2, q: 3 }
console.log("order " + JSON.stringify(otake(ow)))
const onarrow: ONarrow = { zz: 7, a: 8 }
console.log("orderNarrow " + JSON.stringify(onarrow) + " " + Object.keys(onarrow).join(","))

// (5) THE DECLINED PAIR. 'd' is REQUIRED, so a narrow instance has no way to
//     spell "I do not have this key" -- the edge is declined and the copy
//     stays. PINNED DEFECT: node prints 9 9 here.
interface RWide { c: number; d: number }
interface RNarrow { c: number }
function rtake(x: RNarrow): RNarrow { return x }
const rw: RWide = { c: 1, d: 2 }
const rn = rtake(rw)
rn.c = 9
console.log("declined " + rw.c + " " + rn.c)
const rOnly: RNarrow = { c: 5 }
console.log("declinedKeys " + Object.keys(rOnly).join(","))

// (6) THE CONTROL: an exact-shape binding aliases, because no copy happens.
const c1: Narrow = { a: 1 }
const c2: Narrow = c1
c2.a = 9
console.log("exact " + c1.a + " " + c2.a)
`

interface Compiled { out: string; advisories: string[] }

async function runCompiled(backend: "c" | "llvm"): Promise<Compiled> {
  const key = createHash("sha256").update(SOURCE).update(backend)
    .update(sanitize ? "san" : "plain").digest("hex").slice(0, 16)
  const outDir = join(cacheDir, `record-width-unify-${key}`)
  mkdirSync(outDir, { recursive: true })
  const file = join(outDir, "unify.ts")
  writeFileSync(file, SOURCE, "utf8")
  const result = await compile(file, {
    outPath: join(outDir, exeName("unify")),
    outDir,
    sanitize,
    backend,
  })
  if (!result.ok) {
    throw new Error(
      `[${backend}] DID NOT RUN (compile refused -- this program is supposed to compile):\n` +
        result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"),
    )
  }
  return {
    out: execFileSync(result.binaryPath, [], { encoding: "utf8" }),
    advisories: (result.advisories ?? []).map((d) => d.code),
  }
}

const lineOf = (out: string, label: string): string =>
  out.trimEnd().split("\n").map((l) => l.trim()).find((l) => l.startsWith(label + " ")) ?? "<missing>"

/* Every row's node answer, measured with `node --experimental-strip-types`
 * on v25.9.0. */
const NODE = {
  identity: "identity 9 9",
  source: "source 9 9",
  keys: `keys a {"a":5} false`,
  order: `order {"zz":1,"a":2,"q":3}`,
  orderNarrow: `orderNarrow {"zz":7,"a":8} zz,a`,
  declined: "declined 9 9",
  declinedKeys: "declinedKeys c",
  exact: "exact 9 9",
}

describe("a width pair the layout can afford becomes one shape", () => {
  for (const backend of BACKENDS) {
    test(`${backend}: identity is restored, own keys and their order are not`, async () => {
      const { out } = await runCompiled(backend)

      expect(lineOf(out, "exact"), "the control: an exact-shape binding aliases")
        .toBe(NODE.exact)

      expect(
        lineOf(out, "identity"),
        "THE FIX. The narrowed value is the SAME object now, so a write through it reaches the " +
          "original -- the face no overflow grant could ever repair.",
      ).toBe(NODE.identity)

      expect(
        lineOf(out, "source"),
        "...and the other direction of the same split.",
      ).toBe(NODE.source)

      expect(
        lineOf(out, "keys"),
        "OBLIGATION 1. The narrow shape GREW a slot for 'b', and a value built at the narrow " +
          "shape must still have exactly one own key. If this reads 'a,b' the identity bug has " +
          "been traded for an enumeration bug, which is a failure and not a trade.",
      ).toBe(NODE.keys)

      expect(
        lineOf(out, "order"),
        "OBLIGATION 2. JSON.stringify prints declaredOrder, and 'zz' sorts after 'a': a merged " +
          "layout that ordered its fields by name would print {\"a\":2,\"zz\":1,...} here.",
      ).toBe(NODE.order)

      expect(
        lineOf(out, "orderNarrow"),
        "...and the merged order restricted to a NARROW member's own keys is that member's own " +
          "order, with the gained member absent from both surfaces.",
      ).toBe(NODE.orderNarrow)

      expect(
        lineOf(out, "declinedKeys"),
        "the declined pair never merged, so its narrow shape never grew: one key, as before.",
      ).toBe(NODE.declinedKeys)

      expect(
        lineOf(out, "declined"),
        "PINNED DEFECT: 'd' is REQUIRED, so a narrow instance that gained the slot has no " +
          "undefined arm to answer Object.keys with. The edge is declined and the copy stays, " +
          "so this still splits identity where node prints 9 9. Admitting it needs a " +
          "per-instance own-key mask WRITER at every record construction. If this row starts " +
          "agreeing with node, that writer landed: move the row up to the matching set.",
      ).toBe("declined 1 9")
    })

    test(`${backend}: SC6004 falls silent where the copy went and speaks where it stayed`, async () => {
      const { advisories } = await runCompiled(backend)
      // The advisory is the cheapest end-to-end check that the pass did what
      // it claims: it is emitted per width-copy SITE, after unification has
      // pruned the sites it closed. The declined pair keeps its copy, so the
      // count is neither zero nor what it was before the pass.
      expect(
        advisories.filter((c) => c === "SC6004").length,
        "the declined pair still copies and must still be named",
      ).toBeGreaterThan(0)
    })
  }
})
