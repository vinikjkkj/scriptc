/* A MUTATION whose receiver is an ASSERTION over a checked-dynamic value —
 * `(u as Record<string, unknown>)["k"] = v`, `(u as number[]).push(x)`,
 * `delete (u as Record<string, unknown>)["k"]`.
 *
 * `as` is the IDENTITY in JS: `(u as T).k = v` writes the very object `u`
 * names, and Node has no second object to write. scriptc keeps a composite
 * in two physically different representations — a monomorphic C struct /
 * packed ScrArr, and a ScrDyn key-value table — so the dyn->static recovery
 * the assertion used to lower to CANNOT alias: `sc_dc_N` / `sc_da_N` build a
 * FRESH value with `sc_rnew_rN`. The store landed on that fresh value and
 * the write was lost in SILENCE: no trap, no diagnostic, the object the
 * program still names unchanged, and the process exiting 0.
 *
 * That is the answer this project calls worse than a refusal, and it was the
 * majority answer. Measured over the mutating surfaces before the fix, on
 * BOTH backends, against Node v25.9.0: exactly ONE was loud
 * (`(u as unknown[]).push(x)` — the asserted type is itself dynamic, so
 * nothing is recovered and the receiver stays a ScrDyn), one refused at
 * compile time (`Object.defineProperty`), and every other spelling a real
 * program writes was silently wrong.
 *
 * The fix is a LOWERING one, not a representation one: see through the
 * assertion and keep the receiver dyn (`dynAssertionReceiver`), so the store
 * reaches the mutating dyn entry points. Those are already right in both
 * directions — they mutate a real dyn in place, and they refuse LOUDLY
 * through `scr_dyn_static_copy_refuse` when the dyn is a marked copy of a
 * static original the program still names. Both answers are correct; the
 * recovery's answer was correct in neither.
 *
 * WHAT THIS FILE DOES NOT COVER, and why it is worth saying. The same defect
 * reached through a NAME (`const r = u as T; r.k = v`) or across a CALL
 * (`f(u as T)` writing inside `f`) is untouched — closing those needs the
 * recovered value itself to carry its origin, which is a representation
 * change. The last test below pins that remainder so a future block cannot
 * mistake this file for a claim that the family is closed.
 */
import { execFile } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, test } from "vitest";
import { compile } from "@scriptc/compiler";
import { exeName } from "./exe.js";

const execFileAsync = promisify(execFile);
const repoRoot = join(import.meta.dirname, "../..");
const cacheDir = join(repoRoot, "node_modules/.cache/scriptc-tests/dyn-asserted-mutation");

interface Run { out: string; code: number; err: string }

async function run(cmd: string, args: string[]): Promise<Run> {
  try {
    const { stdout } = await execFileAsync(cmd, args, { encoding: "utf8" });
    return { out: stdout, code: 0, err: "" };
  } catch (err) {
    const e = err as { code?: unknown; stdout?: string; stderr?: string };
    if (typeof e.code !== "number") throw err;
    return { out: e.stdout ?? "", code: e.code, err: e.stderr ?? "" };
  }
}

/** Compile `src` on `backend` and run it; also run the SAME text on Node, so
 * the oracle is never a literal typed into this file. */
async function bothWays(name: string, backend: "c" | "llvm", src: string): Promise<{ node: Run; exe: Run }> {
  const outDir = join(cacheDir, `${name}-${backend}`);
  mkdirSync(outDir, { recursive: true });
  const file = join(outDir, "cell.ts");
  writeFileSync(file, src, "utf8");
  const node = await run(process.execPath, [file]);
  const result = await compile(file, { outPath: join(outDir, exeName("program")), outDir, backend });
  if (!result.ok) {
    return {
      node,
      exe: { out: "", code: -1, err: result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n") },
    };
  }
  return { node, exe: await run(result.binaryPath, []) };
}

/** The rows that must now LAND: the write reaches the object the program
 * still names, byte for byte with Node. Each source keeps a name for the dyn
 * (`d`) and reads it back through it — without that readback the copy is
 * unobservable and the row would prove nothing. */
const LANDS: Array<[string, string]> = [
  ["record-named-field", `const d: unknown = JSON.parse('{"n":1}');
(d as { n: number }).n = 2;
console.log(JSON.stringify(d));`],
  ["index-signature-keyed", `const d: unknown = JSON.parse('{"k":1}');
(d as Record<string, unknown>)["k"] = 2;
console.log(JSON.stringify(d));`],
  ["array-element", `const d: unknown = JSON.parse('[1,2,3]');
(d as number[])[0] = 9;
console.log(JSON.stringify(d));`],
  ["array-push", `const d: unknown = JSON.parse('[1,2]');
(d as number[]).push(3);
console.log(JSON.stringify(d));`],
  ["array-pop", `const d: unknown = JSON.parse('[1,2,3]');
(d as number[]).pop();
console.log(JSON.stringify(d));`],
  ["array-reverse", `const d: unknown = JSON.parse('[1,2,3]');
(d as number[]).reverse();
console.log(JSON.stringify(d));`],
  ["array-sort", `const d: unknown = JSON.parse('[3,1,2]');
(d as number[]).sort((x: number, y: number): number => x - y);
console.log(JSON.stringify(d));`],
  ["array-splice", `const d: unknown = JSON.parse('[1,2,3]');
(d as number[]).splice(1, 1);
console.log(JSON.stringify(d));`],
  ["delete-key", `const d: unknown = JSON.parse('{"k":1,"j":2}');
delete (d as Record<string, unknown>)["k"];
console.log(JSON.stringify(d));`],
  ["object-assign-target", `const d: unknown = JSON.parse('{"k":1}');
Object.assign(d as Record<string, unknown>, { j: 2 });
console.log(JSON.stringify(d));`],
  // The asserted type that was ALREADY dynamic — the one row of the family
  // that was ever right. It is here so a change that reroutes the others
  // cannot quietly break the one that worked.
  ["asserted-unknown-array", `const d: unknown = JSON.parse('[1,2]');
(d as unknown[]).push(3);
console.log(JSON.stringify(d));`],
  // zapo's own `contextInfo` shape, one function deep: a keyed read out of a
  // dyn, asserted to a carrier record, written through. This is the row
  // tests/corpus/5630's header excludes by name as one that "diverges".
  ["keyed-read-then-asserted-write", `interface IContextInfo { stanzaId?: string }
interface Carrier { text?: string; contextInfo?: IContextInfo }
const message: unknown = JSON.parse('{"extendedTextMessage":{"text":"hi"}}');
const key = "extendedTextMessage";
const v = (message as Record<string, unknown>)[key];
(v as Carrier).contextInfo = { stanzaId: "X" };
console.log(JSON.stringify(message));`],
];

describe.each(["c", "llvm"] as const)("a mutation through an asserted 'unknown' lands (%s backend)", (backend) => {
  test.for(LANDS)("%s", { timeout: 240_000 }, async ([name, src]) => {
    const { node, exe } = await bothWays(name, backend, src);
    // The oracle first: a cell whose Node run failed proves nothing about
    // the compiler, and would otherwise pass by comparing two failures.
    expect(node.code, `Node failed to run the cell:\n${node.err}`).toBe(0);
    expect(node.out.trim().length).toBeGreaterThan(0);
    expect(exe.code, `compiled program failed:\n${exe.err}`).toBe(0);
    expect(exe.out).toBe(node.out);
  });
});

describe.each(["c", "llvm"] as const)("the surfaces that stay LOUD rather than silent (%s backend)", (backend) => {
  /* `fill` and `copyWithin` are named by `scr_dyn_invoke.c`'s static-copy
   * guard AND by `dyn_arr_proto_unimpl`, and the second one wins: they throw
   * "not supported" before the guard that also names them can fire, so two
   * of that guard's nine arms are unreachable. They are routed here anyway,
   * deliberately — the choice is between a loud refusal and a write that
   * vanishes, and this project prefers the refusal. If the dyn tier ever
   * implements them, this test flips to a LANDS row rather than being
   * deleted. */
  test("(u as number[]).fill(0) refuses loudly instead of losing the write", { timeout: 240_000 }, async () => {
    const src = `const d: unknown = JSON.parse('[1,2,3]');
(d as number[]).fill(0);
console.log(JSON.stringify(d));`;
    const { node, exe } = await bothWays("array-fill", backend, src);
    expect(node.code).toBe(0);
    expect(node.out.trim()).toBe("[0,0,0]");
    // Loud: a non-zero exit carrying a refusal, NOT a zero exit printing the
    // unmutated array (which is what this row did before).
    expect(exe.code).not.toBe(0);
    expect(exe.out).not.toContain("[1,2,3]");
    expect(exe.err).toMatch(/not supported/);
  });

  /* The static->dyn half of the same boundary, reached through the SAME
   * lowering. `o` is a static record the program still names, so the
   * crossing marks its dyn copy and the rerouted write must REFUSE rather
   * than land on the copy. This is the row that proves the reroute did not
   * trade a lost write for a lie. */
  test("a write through an asserted MARKED static copy still refuses", { timeout: 240_000 }, async () => {
    const src = `const o = { n: 1 };
const u: unknown = o;
(u as Record<string, unknown>)["n"] = 2;
console.log(JSON.stringify(o));`;
    const { node, exe } = await bothWays("marked-static-copy", backend, src);
    expect(node.code).toBe(0);
    expect(node.out.trim()).toBe('{"n":2}');
    expect(exe.code).not.toBe(0);
    expect(exe.err).toMatch(/crossed into an 'unknown' \(dynamic\) slot/);
  });
});

describe("the remainder this fix does NOT close", () => {
  /* Pinned, not fixed. The store target is a NAME, so no syntactic rule can
   * see the assertion that produced it; closing it needs the recovered value
   * to carry its origin, which is a representation change. estado-fence.md
   * carries the measurement. This test asserts the CURRENT wrong answer on
   * purpose: when a future block closes it, this test fails, and that
   * failure is the notification. */
  test("a recovery bound to a name first still loses the write (both backends)", { timeout: 480_000 }, async () => {
    const src = `const d: unknown = JSON.parse('{"n":1}');
const r = d as { n: number };
r.n = 2;
console.log(JSON.stringify(d));`;
    for (const backend of ["c", "llvm"] as const) {
      const { node, exe } = await bothWays("via-local-binding", backend, src);
      expect(node.out.trim()).toBe('{"n":2}');
      expect(exe.code, `${backend}: ${exe.err}`).toBe(0);
      expect(
        exe.out.trim(),
        `${backend}: if this now prints {"n":2} the remainder is CLOSED — delete this test and move the row into LANDS`,
      ).toBe('{"n":1}');
    }
  });

  /* A DIFFERENT family, found by walking into it while measuring this one,
   * and pinned here because nothing else covers it.
   *
   * Recovering an INTERSECTION of an index signature and a declared field
   * emits the declared field FIRST and the index-signature keys after it,
   * whatever order the source object carries them in. Node's
   * OrdinaryOwnPropertyKeys is insertion order for non-index string keys, so
   * `{"k":1,"j":2}` recovered as `Record<string, unknown> & { j: number }`
   * must still enumerate `k,j`; both backends answer `j,k`. Silent: the
   * process exits 0 and every key is present, only the order is wrong — and
   * key order is observable through JSON.stringify, Object.keys, for-in and
   * util.inspect alike (tests/corpus/2765 is the rule).
   *
   * It is NOT caused by the assertion reroute and needs no assertion
   * receiver to reach — there is no mutation in the cell at all. It is
   * reported in estado-fence.md; this test asserts the current WRONG answer
   * so that closing it announces itself. */
  test("an intersection recovery reorders keys (both backends) — a separate open defect", { timeout: 480_000 }, async () => {
    const src = `const d: unknown = JSON.parse('{"k":1,"j":2}');
const back = d as Record<string, unknown> & { j: number };
console.log(JSON.stringify(back), Object.keys(back).join(","));`;
    for (const backend of ["c", "llvm"] as const) {
      const { node, exe } = await bothWays("intersection-key-order", backend, src);
      expect(node.out.trim()).toBe('{"k":1,"j":2} k,j');
      expect(exe.code, `${backend}: ${exe.err}`).toBe(0);
      expect(
        exe.out.trim(),
        `${backend}: if this now matches Node the defect is CLOSED — delete this test`,
      ).toBe('{"j":2,"k":1} j,k');
    }
  });
});
