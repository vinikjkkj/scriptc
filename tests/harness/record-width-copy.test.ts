/* THE RECORD WIDTH COPY, and the three answers it gets wrong.
 *
 * TypeScript's width subtyping is a RELABEL: `const n: Narrow = wide`,
 * `take(wide)` and `return wide` all hand over the very object the caller
 * still names. scriptc's records are monomorphic C structs, so the flow
 * compiles to `%rec.width.N` -- a fresh struct with the destination's
 * fields copied across -- and the program ends up holding TWO objects
 * where JavaScript has one.
 *
 * Two faces are left here, measured against node v25.9.0 on BOTH backends:
 *
 *   the DROP        the members the destination does not name are gone
 *   the IDENTITY    a write through either name is invisible to the other
 *
 * The first is DATA loss and the overflow grant fixes it. The second is
 * IDENTITY loss, it fires at every width copy including the ones that drop
 * nothing at all, and no grant can reach it -- row `granted` below is 4701's
 * own already-granted path, still answering wrongly.
 *
 * A THIRD FACE USED TO BE HERE. The READ-BACK -- widening back to a type
 * that names the ended member, and answering `undefined` for it -- needs an
 * OPTIONAL-flavored member to be silent (a required one is refused by
 * SC2002), and an optional member is exactly what SHAPE UNIFICATION can
 * carry: the narrow shape gains the slot, the unset slot is the undefined
 * arm no own-key surface reports, and the two shapes become one. That row
 * started agreeing with node, which is what this file asks a row to do
 * before it leaves, and it left -- for
 * tests/corpus/7790-an-optional-member-the-width-view-does-not-name-survives-the-upcast.ts,
 * with node's answers as the oracle. Every row still here has a REQUIRED
 * extra member, which no layout can spell "absent" for.
 *
 * WHY THIS IS A HARNESS TEST. tests/corpus needs a program that compiles
 * and matches node byte for byte; this one compiles, runs, exits 0 and does
 * NOT match. tests/diagnostics needs a program that fails to compile; this
 * one compiles clean. Same reasoning as record-width-alias.test.ts, which
 * pins the class-instance-into-a-nullable-binding sibling.
 *
 * THE ASSERTIONS RECORD A DEFECT, NOT A SANCTIONED SEMANTIC. When a row
 * starts agreeing with node, THIS TEST FAILS -- that is the point of it --
 * and the right move is to delete that row and add the program to
 * tests/corpus with node's answers as the oracle.
 *
 * The `exact` row is the CONTROL and agrees with node: an exact-shape
 * binding aliases, because no copy happens. If it ever fails, the defect
 * has spread rather than been fixed.
 *
 * SC6004 is asserted here too. It is advice, so it cannot fail a build --
 * but a silent wrong answer with no diagnostic anywhere is the thing this
 * project calls worse than a refusal, and the advisory is what stops this
 * program from being that.
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
interface A { a: number }
interface B { a: number; b: number }

function take(x: A): A { return x }

// (1) THE DROP, at an ARGUMENT-position upcast. Assignment and return
//     positions are already refused by SC1090; argument position is not.
const big: B = { a: 1, b: 2 }
const narrowed = take(big)
console.log("drop " + JSON.stringify(narrowed) + " " + Object.keys(narrowed).join(","))

// (2) A WRITE THROUGH the narrowed view.
const w1: B = { a: 1, b: 2 }
const n1 = take(w1)
n1.a = 9
console.log("through " + w1.a + " " + n1.a)

// (3) A WRITE TO THE ORIGINAL after the upcast.
const w2: B = { a: 1, b: 2 }
const n2 = take(w2)
w2.a = 9
console.log("source " + w2.a + " " + n2.a)

// (4) THE DOUBLE ASSERTION - 4701's GRANTED path. Its own field names, so
//     the grant (per-shape and whole-program, keyed on field names plus type
//     kinds) cannot reach the shapes the rows above use.
interface A5 { z: number }
interface B5 { z: number; y: number }
const w3: B5 = { z: 1, y: 2 }
const asserted = w3 as unknown as A5
asserted.z = 9
console.log("granted " + w3.z + " " + asserted.z)

// (5) THE CONTROL: an exact-shape binding ALIASES, and must keep aliasing.
const c1: A = { a: 1 }
const c2: A = c1
c2.a = 9
console.log("exact " + c1.a + " " + c2.a)
`

interface Compiled { out: string; advisories: string[] }

async function runCompiled(backend: "c" | "llvm"): Promise<Compiled> {
  const key = createHash("sha256").update(SOURCE).update(backend)
    .update(sanitize ? "san" : "plain").digest("hex").slice(0, 16)
  const outDir = join(cacheDir, `record-width-copy-${key}`)
  mkdirSync(outDir, { recursive: true })
  const file = join(outDir, "copy.ts")
  writeFileSync(file, SOURCE, "utf8")
  const result = await compile(file, {
    outPath: join(outDir, exeName("copy")),
    outDir,
    sanitize,
    backend,
  })
  // The whole point of this file is that the program compiles CLEAN and
  // answers wrongly, so a refusal here is a different world and must say so.
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

/* Every row's node answer, measured in this session with
 * `node --experimental-strip-types` on v25.9.0. */
const NODE = {
  drop: `drop {"a":1,"b":2} a,b`,
  through: "through 9 9",
  source: "source 9 9",
  granted: "granted 9 9",
  exact: "exact 9 9",
}

describe("a record flowing into a different shape is copied, not relabelled", () => {
  for (const backend of BACKENDS) {
    test(`${backend}: the copy ends members, answers undefined, and splits identity`, async () => {
      const { out } = await runCompiled(backend)

      // ---- THE CONTROL. Agrees with node and must keep agreeing. -------
      expect(lineOf(out, "exact"), "an exact-shape binding aliases: no copy happens")
        .toBe(NODE.exact)

      // ---- THE DROP. node: `drop {"a":1,"b":2} a,b` --------------------
      expect(
        lineOf(out, "drop"),
        "PINNED DEFECT: an ARGUMENT-position upcast copies into the narrower shape and ends " +
          "'b'. The same flow at an assignment or a return is refused by SC1090; the key-risk " +
          "walk does not follow a value through a PARAMETER (its 'name the site or say nothing' " +
          "rule), so this position is the silent one. If this now reads node's answer the drop " +
          "is FIXED: move this row to tests/corpus.",
      ).toBe(`drop {"a":1} a`)

      // ---- THE IDENTITY, both directions. node: `9 9` twice ------------
      expect(
        lineOf(out, "through"),
        "PINNED DEFECT: the narrowed value is a DIFFERENT OBJECT, so a write through it never " +
          "reaches the original. This is the face no overflow grant can fix -- it fires at " +
          "every width copy, including the ones that end no member at all.",
      ).toBe("through 1 9")

      expect(
        lineOf(out, "source"),
        "PINNED DEFECT: the other direction of the same split -- a write to the ORIGINAL is " +
          "invisible through the narrowed value.",
      ).toBe("source 9 1")

      // ---- 4701's GRANTED path, still wrong. node: `granted 9 9` -------
      expect(
        lineOf(out, "granted"),
        "PINNED DEFECT: this is the double assertion 4701's overflow grant already 'fixed'. " +
          "The grant repaired the MEMBERS and left the IDENTITY split, and SC6001 fires here " +
          "saying the members were preserved. That is why the grant is not a fix for this " +
          "family: it addresses data loss, and this row loses no data.",
      ).toBe("granted 1 9")
    })

    test(`${backend}: SC6004 names the copy rather than letting it be silent`, async () => {
      const { advisories } = await runCompiled(backend)
      expect(
        advisories.filter((c) => c === "SC6004").length,
        "the width copies above must be reported: a wrong answer with no diagnostic anywhere " +
          "is the thing this project calls worse than a refusal",
      ).toBeGreaterThan(0)
    })
  }
})
