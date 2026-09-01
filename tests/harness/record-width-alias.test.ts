/* A class instance assigned to a `T | null`-typed binding is COPIED, while
 * the same assignment to a `T`-typed binding ALIASES. Node aliases in both
 * cases. The copy is silent: no diagnostic, exit 0, and every later read
 * through the nullable binding answers the values the object had at the
 * moment of assignment.
 *
 * Found by being bitten by it. Instrumenting the zapo messaging bench, the
 * RPC counters lived on a ServerRpc instance and a module-level
 * `let profRpc: RpcCounters | null = null` held it for two helpers to read.
 * Every compiled phase then reported "rpc 0 calls" while the node lane
 * reported thousands, and there is no diagnostic anywhere: SC6003 fires
 * only when the projection target names methods AND data, and this target
 * names data only.
 *
 * WHY THIS IS A HARNESS TEST AND NOT A CORPUS PROGRAM OR A DIAGNOSTICS
 * FIXTURE. The corpus requires a program that compiles and matches node
 * byte for byte; this one compiles, runs, exits 0 and does NOT match.
 * tests/diagnostics requires a program that fails to compile; this one
 * compiles clean. So it is pinned here as a characterisation test.
 *
 * THE ASSERTIONS BELOW RECORD A DEFECT, NOT A SANCTIONED SEMANTIC. When
 * the nullable binding starts aliasing, THIS TEST FAILS -- that is the
 * point of it -- and the right move then is to delete it and add the same
 * program to tests/corpus with node's answers as the oracle.
 *
 * The boundary is pinned too, because that is what makes the defect
 * actionable: the plain binding and the parameter both alias correctly on
 * both backends, so whatever the nullable union does differently is the
 * whole bug.
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
interface Counters { calls: number }
class Rpc {
  public calls = 0
  public bump(): void { this.calls += 1 }
}
const rpc = new Rpc()
const plain: Counters = rpc
let nullable: Counters | null = null
nullable = rpc
function viaParam(c: Counters): number { return c.calls }
rpc.bump()
rpc.bump()
rpc.bump()
console.log("instance " + rpc.calls)
console.log("plain " + plain.calls)
console.log("param " + viaParam(rpc))
console.log("nullable " + (nullable === null ? -1 : nullable.calls))
`

async function runCompiled(backend: "c" | "llvm"): Promise<string> {
  const key = createHash("sha256").update(SOURCE).update(backend)
    .update(sanitize ? "san" : "plain").digest("hex").slice(0, 16)
  const outDir = join(cacheDir, `record-width-alias-${key}`)
  mkdirSync(outDir, { recursive: true })
  const file = join(outDir, "alias.ts")
  writeFileSync(file, SOURCE, "utf8")
  const result = await compile(file, {
    outPath: join(outDir, exeName("alias")),
    outDir,
    sanitize,
    backend,
  })
  // A cell that could not compile did not run. The whole point of this
  // file is that the program compiles CLEAN and answers wrongly, so a
  // refusal here is a different world and must say so loudly.
  if (!result.ok) {
    throw new Error(
      `[${backend}] DID NOT RUN (compile refused -- this program is supposed to compile):\n` +
        result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"),
    )
  }
  return execFileSync(result.binaryPath, [], { encoding: "utf8" })
}

const lineOf = (out: string, label: string): string =>
  out.trimEnd().split("\n").map((l) => l.trim()).find((l) => l.startsWith(label + " ")) ?? "<missing>"

describe("a class instance in a `T | null` binding is copied, not aliased", () => {
  for (const backend of BACKENDS) {
    test(`${backend}: the nullable binding freezes at assignment while the plain one tracks`, async () => {
      const out = await runCompiled(backend)

      // The controls. These agree with node and must keep agreeing: if one
      // of them starts failing, the defect has SPREAD rather than been fixed.
      expect(lineOf(out, "instance"), "the object itself").toBe("instance 3")
      expect(lineOf(out, "plain"), "a plain `Counters` binding aliases").toBe("plain 3")
      expect(lineOf(out, "param"), "a `Counters` parameter aliases").toBe("param 3")

      // The defect. Node prints "nullable 3".
      expect(
        lineOf(out, "nullable"),
        "PINNED DEFECT: a `Counters | null` binding holding a class instance is a COPY " +
          "taken at the assignment, so it answers 0 where node answers 3 -- silently, at " +
          "exit 0, with no diagnostic (SC6003 covers only targets naming methods AND data). " +
          "If this now reads 'nullable 3' the defect is FIXED: delete this file and add the " +
          "program to tests/corpus with node's answers as the oracle.",
      ).toBe("nullable 0")
    })
  }
})
