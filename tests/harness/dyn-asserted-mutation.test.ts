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
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, test } from "vitest";
import { compile } from "@scriptc/compiler";
import { exeName } from "./exe.js";

const execFileAsync = promisify(execFile);
/* Deliberately NOT under node_modules. This harness runs the cell text on
 * Node itself to obtain the oracle, and Node refuses to strip types from any
 * file inside a node_modules directory
 * (ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING). The first version of this
 * file kept its cells in node_modules/.cache and all 30 rows failed on the
 * ORACLE leg, saying nothing whatever about the compiler -- which is exactly
 * what the "oracle first" assertion below exists to make loud, instead of
 * letting a broken oracle and a broken binary compare equal and pass. */
const cellRoot = join(tmpdir(), "scriptc-dyn-asserted-mutation");

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
  const outDir = join(cellRoot, `${name}-${backend}`);
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
  // fill and copyWithin were the two rows this file used to pin as LOUD:
  // `dyn_arr_proto_unimpl` claimed both names, so they threw "not
  // supported" before the static-copy guard that ALSO named them could
  // fire, and two of that guard's nine arms were unreachable. The dyn ARR
  // arm answers them now (estado-pinned.md), so they are ordinary LANDS
  // rows — and the two guard arms below are live coverage instead of dead
  // text. Both answer the RECEIVER, not a copy, which is why each row
  // prints the method's own result as well as the dyn read back.
  ["array-fill", `const d: unknown = JSON.parse('[1,2,3]');
(d as number[]).fill(0);
console.log(JSON.stringify(d));`],
  ["array-fill-ranged", `const d: unknown = JSON.parse('[1,2,3,4,5]');
console.log(JSON.stringify((d as number[]).fill(9, 1, 3)));
console.log(JSON.stringify(d));`],
  ["array-fill-negative", `const d: unknown = JSON.parse('["a","b","c","d"]');
console.log(JSON.stringify((d as string[]).fill("z", -2)));
console.log(JSON.stringify(d));`],
  ["array-copywithin", `const d: unknown = JSON.parse('[1,2,3,4,5]');
console.log(JSON.stringify((d as number[]).copyWithin(0, 3)));
console.log(JSON.stringify(d));`],
  ["array-copywithin-overlap", `const d: unknown = JSON.parse('[1,2,3,4,5]');
console.log(JSON.stringify((d as number[]).copyWithin(1, 0, 3)));
console.log(JSON.stringify(d));`],
  ["array-copywithin-noop", `const d: unknown = JSON.parse('[1,2,3]');
console.log(JSON.stringify((d as number[]).fill(7, 10)), JSON.stringify((d as number[]).copyWithin(0, 9)));`],
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
  /* THE TWO ARMS THAT USED TO BE UNREACHABLE. `scr_dyn_invoke.c`'s
   * static-copy guard names nine in-place array methods; `fill` and
   * `copyWithin` were also named by `dyn_arr_proto_unimpl`, which is
   * consulted first, so those two arms of the guard could never fire —
   * capability present and unreachable, the failure mode this board keeps
   * finding. estado-fence.md §3.2 recorded them as dead text and left the
   * lowering routing them anyway, so the answer was a "not supported"
   * refusal rather than a lost write.
   *
   * Both methods are implemented on the dyn ARR arm now, so the names left
   * `dyn_arr_proto_unimpl` for the `impl` list beside `push`/`sort`/the
   * rest. The LANDS rows above cover the answering half. THESE two cover
   * the arms: a marked static copy must still refuse, BY NAME, and until
   * this commit neither of these two lines could reach the guard at all.
   * If either stops refusing, an in-place write is landing on a copy of an
   * object the program still names — the silence this whole file exists
   * to prevent. */
  test.for([["fill", "(d as number[]).fill(0)"], ["copyWithin", "(d as number[]).copyWithin(0, 1)"]] as const)(
    "a marked static copy refuses %s by name (the arm that could not fire)",
    { timeout: 240_000 },
    async ([name, call]) => {
      const src = `const o = [1, 2, 3];
const u: unknown = o;
${call.replace("d as", "u as")};
console.log(JSON.stringify(o));`;
      const { node, exe } = await bothWays(`marked-copy-${name}`, backend, src);
      expect(node.code, `Node failed to run the cell:\n${node.err}`).toBe(0);
      expect(exe.code).not.toBe(0);
      expect(exe.err).toContain(`calling '${name}'`);
      expect(exe.err).toMatch(/crossed into an 'unknown' \(dynamic\) slot/);
    },
  );

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
   * A record shape that carries BOTH an index signature AND at least one
   * declared member emits the declared members FIRST and the
   * index-signature keys after them, whatever order the source object
   * carries them in. Node's OrdinaryOwnPropertyKeys is insertion order for
   * non-index string keys, so `{"k":1,"j":2}` recovered as
   * `Record<string, unknown> & { j: number }` must still enumerate `k,j`;
   * both backends answer `j,k`. Silent: the process exits 0 and every key
   * is present, only the order is wrong — and key order is observable
   * through JSON.stringify, Object.keys, for-in and util.inspect alike
   * (tests/corpus/2765 is the rule).
   *
   * ESTADO-FENCE.MD §3.1 NAMED THIS FAMILY "AN INTERSECTION RECOVERY", AND
   * THAT IS THE WRONG NAME — the second row below is the plain INTERFACE
   * spelling `{ j: number; [k: string]: unknown }`, no intersection
   * anywhere, and it is wrong identically. What makes the family is the
   * index signature plus one declared member. The third row is the
   * CONTROL that bounds it: with NO declared member the overflow map keeps
   * the source's own order and the recovery is EXACT, which is why the
   * fix cannot be "stop emitting declared fields first" applied blindly.
   *
   * It is NOT caused by the assertion reroute and needs no assertion
   * receiver to reach — there is no mutation in any of the cells. Since
   * this commit the compiler at least SAYS so: SC6002's risk walk used to
   * skip every index-signature shape and now advises on exactly the ones
   * with a declared member. The wrong bytes are still the wrong bytes;
   * closing them needs a record to carry a per-instance key ORDER, priced
   * in estado-pinned.md. These tests assert the current WRONG answer so
   * that closing it announces itself. */
  test.for([
    ["intersection-key-order", `const d: unknown = JSON.parse('{"k":1,"j":2}');
const back = d as Record<string, unknown> & { j: number };
console.log(JSON.stringify(back), Object.keys(back).join(","));`, '{"k":1,"j":2} k,j', '{"j":2,"k":1} j,k'],
    ["interface-index-key-order", `interface WithIx { j: number; [k: string]: unknown }
const d: unknown = JSON.parse('{"k":1,"j":2}');
const back = d as WithIx;
console.log(JSON.stringify(back), Object.keys(back).join(","));`, '{"k":1,"j":2} k,j', '{"j":2,"k":1} j,k'],
  ] as const)("%s reorders keys (both backends) — a separate open defect", { timeout: 480_000 }, async ([name, src, want, wrong]) => {
    for (const backend of ["c", "llvm"] as const) {
      const { node, exe } = await bothWays(name, backend, src);
      expect(node.out.trim()).toBe(want);
      expect(exe.code, `${backend}: ${exe.err}`).toBe(0);
      expect(
        exe.out.trim(),
        `${backend}: if this now matches Node the defect is CLOSED — move this row into the control below`,
      ).toBe(wrong);
    }
  });

  /* THE CONTROL, and it is not pinned — it MATCHES. An index signature with
   * NO declared member recovers in the source's own order on both backends,
   * because the overflow map is a real per-instance table that keeps
   * insertion order. It is here so that a future fix for the two rows above
   * cannot quietly break the half that was always right. */
  test("an index signature with NO declared member keeps the source order", { timeout: 480_000 }, async () => {
    const src = `const d: unknown = JSON.parse('{"k":1,"j":2,"a":3}');
const back = d as Record<string, unknown>;
console.log(JSON.stringify(back), Object.keys(back).join(","));`;
    for (const backend of ["c", "llvm"] as const) {
      const { node, exe } = await bothWays("index-only-key-order", backend, src);
      expect(node.out.trim()).toBe('{"k":1,"j":2,"a":3} k,j,a');
      expect(exe.code, `${backend}: ${exe.err}`).toBe(0);
      expect(exe.out).toBe(node.out);
    }
  });
});

/* THE STATIC HALF OF THE SAME SENTENCE, and there is no `unknown` anywhere
 * in any of these programs.
 *
 * `as` is the IDENTITY in JS. A record is a monomorphic C struct, so an
 * assertion BETWEEN TWO STATIC SHAPES materialised a value of the target
 * shape (`sc_f_%rec_width_N` building a fresh `sc_rnew_rB`) and the store
 * landed on that temporary: exit 0, no diagnostic, and the object the
 * program still names unchanged. estado-fence.md §3.3 found it while
 * closing the dynamic half, called it a THIRD silent wrong answer, and left
 * it open — its point being that the family is larger than "the dynamic
 * boundary": it is ANY shape-crossing assertion.
 *
 * `staticAssertionReceiver` closes it for the case that cannot invent an
 * answer: the field being written must already exist on the OPERAND's own
 * shape at an identical lowered type. The last two tests pin what that
 * deliberately leaves open. */
describe.each(["c", "llvm"] as const)("a write through a STATIC assertion reaches the object (%s backend)", (backend) => {
  const STATIC_LANDS: Array<[string, string]> = [
    ["st-widen", `interface A { n: number }
interface B { n: number; m?: number }
const a: A = { n: 1 };
(a as B).n = 7;
console.log(JSON.stringify(a));`],
    ["st-narrow", `interface A { n: number; m: number }
interface B { n: number }
const a: A = { n: 1, m: 2 };
(a as B).n = 7;
console.log(JSON.stringify(a));`],
    ["st-string-field", `interface A { s: string }
interface B { s: string; m?: number }
const a: A = { s: "x" };
(a as B).s = "y";
console.log(JSON.stringify(a));`],
    ["st-nested-record", `interface Inner { v: number }
interface A { i: Inner }
interface B { i: Inner; m?: number }
const a: A = { i: { v: 1 } };
(a as B).i = { v: 9 };
console.log(JSON.stringify(a));`],
    ["st-double-assertion", `interface A { n: number }
interface B { n: number; m?: number }
const a: A = { n: 1 };
((a as unknown) as B).n = 7;
console.log(JSON.stringify(a));`],
    ["st-through-param", `interface A { n: number }
interface B { n: number; m?: number }
function f(x: A): void { (x as B).n = 7; }
const a: A = { n: 1 };
f(a);
console.log(JSON.stringify(a));`],
    ["st-optional-source", `interface A { n?: number }
interface B { n?: number; m?: number }
const a: A = { n: 1 };
(a as B).n = 7;
console.log(JSON.stringify(a));`],
    ["st-destructuring-assign", `interface A { n: number }
interface B { n: number; m?: number }
const a: A = { n: 1 };
[(a as B).n] = [7];
console.log(JSON.stringify(a));`],
    // The BRACKET spelling of the same write — a separate lowering path
    // (lowerElementWrite's literal-key arm), and it was silently wrong too.
    ["st-element-access", `interface A { n: number }
interface B { n: number; m?: number }
const a: A = { n: 1 };
(a as B)["n"] = 7;
console.log(JSON.stringify(a));`],
    ["st-array-element", `interface A { n: number }
interface B { n: number; m?: number }
const xs: A[] = [{ n: 1 }];
(xs[0] as B).n = 7;
console.log(JSON.stringify(xs));`],
    ["st-call-result", `interface A { n: number }
interface B { n: number; m?: number }
function mk(): A { return { n: 1 }; }
const a = mk();
(a as B).n = 3;
console.log(JSON.stringify(a));`],
    // THE RECEIVER RUNS EXACTLY ONCE. The rule answers the operand NODE and
    // not a lowered value, precisely so that the receiver is lowered once
    // whether the rule fires or not. Answering a lowered value and then
    // declining on it — which is how `dynAssertionReceiver` is written — has
    // the caller lower the receiver a second time, and this cell would count
    // 2 where Node counts 1.
    ["st-receiver-runs-once", `interface A { n: number }
interface B { n: number; m?: number }
let calls = 0;
function mk(): A { calls = calls + 1; return { n: 1 }; }
const box: { a: A } = { a: { n: 0 } };
function pick(): { a: A } { calls = calls + 1; return box; }
(mk() as B).n = 7;
console.log("after dot on a call result:", calls);
(pick().a as B).n = 9;
console.log("after dot through a call:", calls, JSON.stringify(box));
(pick().a as B)["n"] = 11;
console.log("after bracket through a call:", calls, JSON.stringify(box));`],
    // The rows that were ALREADY right and a careless widening breaks.
    ["st-same-shape", `interface A { n: number }
const a: A = { n: 1 };
(a as A).n = 7;
console.log(JSON.stringify(a));`],
    ["st-read-only", `interface A { n: number }
interface B { n: number; m?: number }
const a: A = { n: 5 };
console.log((a as B).n, JSON.stringify(a));`],
    ["st-class-receiver", `class C { n = 1 }
interface I { n: number }
const c = new C();
(c as I).n = 7;
console.log(c.n);`],
  ];
  test.for(STATIC_LANDS)("%s", { timeout: 240_000 }, async ([name, src]) => {
    const { node, exe } = await bothWays(name, backend, src);
    expect(node.code, `Node failed to run the cell:\n${node.err}`).toBe(0);
    expect(node.out.trim().length).toBeGreaterThan(0);
    expect(exe.code, `compiled program failed:\n${exe.err}`).toBe(0);
    expect(exe.out).toBe(node.out);
  });
});

describe("what the STATIC half deliberately leaves open", () => {
  /* Pinned, not fixed, and for the same reason as the dynamic sibling
   * above: the store target is a NAME, so no syntactic rule can see the
   * assertion that produced it. */
  test("a static recovery bound to a name first still loses the write (both backends)", { timeout: 480_000 }, async () => {
    const src = `interface A { n: number }
interface B { n: number; m?: number }
const a: A = { n: 1 };
const b = a as B;
b.n = 7;
console.log(JSON.stringify(a));`;
    for (const backend of ["c", "llvm"] as const) {
      const { node, exe } = await bothWays("st-name-bound", backend, src);
      expect(node.out.trim()).toBe('{"n":7}');
      expect(exe.code, `${backend}: ${exe.err}`).toBe(0);
      expect(
        exe.out.trim(),
        `${backend}: if this now prints {"n":7} the remainder is CLOSED — move the row into STATIC_LANDS`,
      ).toBe('{"n":1}');
    }
  });

  /* A field the ASSERTED type adds and the operand's shape has no slot for.
   * Node grows the object; a monomorphic struct cannot, and the rule
   * declines rather than trade a lost write for a refusal on a program that
   * compiles today. Whoever closes this has to decide which of the two it
   * is — that decision is the reason this row is pinned rather than
   * quietly widened. */
  test("a write to a field only the ASSERTED type declares is still lost (both backends)", { timeout: 480_000 }, async () => {
    const src = `interface A { n: number }
interface B { n: number; m?: number }
const a: A = { n: 1 };
(a as B).m = 5;
console.log(JSON.stringify(a));`;
    for (const backend of ["c", "llvm"] as const) {
      const { node, exe } = await bothWays("st-target-only-field", backend, src);
      expect(node.out.trim()).toBe('{"n":1,"m":5}');
      expect(exe.code, `${backend}: ${exe.err}`).toBe(0);
      expect(
        exe.out.trim(),
        `${backend}: if this changed, say in the report whether it LANDS or REFUSES — both are answers, silence is not`,
      ).toBe('{"n":1}');
    }
  });

  /* The DOCUMENTED width-copy stance, and NOT an assertion: `const b: B = a`
   * is a coercion, which copies, and limitations/page.mdx says mutations
   * through the narrower reference are invisible to the original. It is
   * here as the boundary of the fix — if this ever starts aliasing, the
   * assertion rule has leaked into ordinary assignment. */
  test("an ordinary width-copy binding still copies (both backends)", { timeout: 480_000 }, async () => {
    const src = `interface A { n: number }
interface B { n: number; m?: number }
const a: A = { n: 1 };
const b: B = a;
b.n = 9;
console.log(JSON.stringify(a), JSON.stringify(b));`;
    for (const backend of ["c", "llvm"] as const) {
      const { node, exe } = await bothWays("st-width-copy", backend, src);
      expect(node.out.trim()).toBe('{"n":9} {"n":9}');
      expect(exe.code, `${backend}: ${exe.err}`).toBe(0);
      expect(exe.out.trim(), `${backend}: the documented width-copy stance`).toBe('{"n":1} {"n":9}');
    }
  });
});
