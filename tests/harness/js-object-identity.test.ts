/* A JAVASCRIPT file-scope object literal has ONE object, and a binding that
 * NAMES it must not get a second.
 *
 * WHY THIS FILE EXISTS. `const ns = { v: 1 }` at the file scope of a JS
 * source already holds the checked-dynamic object itself, and the rule that
 * makes it do so says why in its own comment: *JS object identity is the
 * literal's contract*. One declaration later the identity was gone again.
 * The checker types `const a = ns` by INFERENCE over that literal, which
 * maps to a closed record; a record is a monomorphic C struct, so the
 * assignment ran the dynCheck builder, allocated a FRESH instance and copied
 * the declared members into it. Measured against Node v25.9.0 on both
 * backends, at exit 0, with no diagnostic:
 *
 *     const ns = { v: 1 };
 *     const a = ns, b = ns;
 *     a === b        Node true    scriptc FALSE
 *     a.v = 99; b.v  Node 99      scriptc 1
 *     a.v = 99; ns.v Node 99      scriptc 1
 *     ns.v = 5; a.v  Node 5       scriptc 1
 *
 * Four silent wrong answers out of one assignment, and the same program in
 * a `.ts` file was right — only the source's EXTENSION differed, because
 * only that decides whether the source binding is dyn.
 *
 * THE FIX IS THE SLOT'S TYPE, and it could not be anything else. A record's
 * fields ARE struct members; nothing can make one alias a ScrDyn key table.
 * So the only place the copy can be declined is where the copy is ASKED
 * for — the binding's representation — and the binding keeps the dyn value
 * its initializer names. That is the dyn face of two arms the compiler
 * already ships for exactly this reason: the class-instance adoption arm
 * (`const v: Iface = live`, whose comment reads *"the record slot COPIES at
 * the assignment... Node has one object"*) and the file-scope object-literal
 * rule itself.
 *
 * WHAT IT DELIBERATELY DOES NOT TOUCH. TypeScript. There the record is an
 * ANNOTATION the author wrote and the width copy is the DOCUMENTED stance
 * (limitations/page.mdx; `dyn-asserted-mutation.test.ts` pins three rows of
 * it). In a JS file there is no annotation to honour — the record is
 * inference residue over a literal whose value was never a struct.
 *
 * THE SECOND HALF, added after the first landed, is two more questions with
 * two OPPOSITE answers, and the file keeps them apart on purpose:
 *
 *   - `const a = root.sub` — a binding one link past the identifier. Same
 *     defect, same cause, and out of reach only because the rule asked for a
 *     BARE identifier. A member read off a checked-dynamic receiver is
 *     checked-dynamic at every link, so the ROOT identifier answers for the
 *     whole chain. This one LINKS.
 *   - `{ ...o }` and `structuredClone(o)` — the two spellings that copy on
 *     purpose. They were dropping the run-time keys they exist to copy,
 *     because the spread desugar reads an IDENTIFIER source's type off the
 *     checker and everything else's off the lowering: `{ ...x }` copied two
 *     declared fields silently while `{ ...root.sub }` — the same value one
 *     link along — met a loud fence. These COPY, and must keep copying: a
 *     spread that started aliasing would be this rule's own worst outcome.
 *
 * The PINNED rows at the bottom are the spellings the rules do not reach.
 * They are here so a later block cannot mistake this file for a claim that
 * the family is closed.
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
/* Deliberately NOT under node_modules: Node refuses to strip types from any
 * file inside one, and the TypeScript control cell below is the oracle for
 * the whole "only the extension differs" argument. */
const cellRoot = join(tmpdir(), "scriptc-js-object-identity");

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

/** Compile `src` on `backend` and run it, and run the SAME text on Node, so
 * no expected string in this file is a literal somebody typed. `ext` is the
 * whole experiment for the control rows: the identical program in `.js` and
 * in `.ts` used to disagree. A `package.json` with no `type` rides along so
 * Node reads a `.js` cell as CommonJS, which is what a JS source IS here. */
async function bothWays(
  name: string,
  backend: "c" | "llvm",
  src: string,
  ext: ".js" | ".ts" = ".js",
): Promise<{ node: Run; exe: Run }> {
  const outDir = join(cellRoot, `${name}-${backend}`);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "package.json"), '{"name":"js-object-identity-cell","version":"0.0.0"}\n', "utf8");
  const file = join(outDir, `cell${ext}`);
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

/** Every row keeps a NAME for the source object and reads back through it.
 * Without that readback the copy is unobservable and the row proves
 * nothing — which is how this family stayed invisible. */
const LANDS: Array<[string, string]> = [
  ["identity-and-write", `const ns = { v: 1 };
const a = ns, b = ns;
console.log("ident", a === b, a === ns);
a.v = 99;
console.log("read", b.v, ns.v);
`],
  ["enumerable-descriptor-root", `const ns = {};
Object.defineProperty(ns, "v", { value: 1, enumerable: true, writable: true, configurable: true });
const a = ns, b = ns;
console.log("ident", a === b);
a.v = 99;
console.log("read", b.v, JSON.stringify(Object.keys(ns)));
`],
  ["expando-root", `const ns = {};
ns.v = 1;
const a = ns, b = ns;
console.log("ident", a === b);
a.v = 99;
console.log("read", b.v);
`],
  // The direction a snapshot gets WRONG even when it is fresh: a write made
  // through the SOURCE after the binding exists.
  ["source-write-seen-through-binding", `const ns = { v: 1 };
const a = ns;
ns.v = 5;
const b = ns;
console.log("a", a.v, "b", b.v);
`],
  ["function-scope-binding", `const ns = { v: 1 };
function f() { const a = ns; a.v = 99; return ns.v; }
console.log("fn", f());
`],
  // A `let` the file never writes rests on the SAME proof the two shipped
  // adoption arms rest on (bindingHoldsItsInitializer), and takes the same
  // route. The reassigned twin is in the CONTROLS below.
  ["let-never-reassigned", `const ns = { v: 1 };
let a = ns;
console.log("ident", a === ns);
a.v = 99;
console.log("read", ns.v);
`],
  ["two-hop-binding", `const ns = { v: 1 };
const a = ns;
const b = a;
console.log("ident", b === ns, b === a);
b.v = 99;
console.log("read", ns.v);
`],
  ["mutation-both-directions", `const ns = { v: 1, w: 2 };
const a = ns;
a.v = 10;
console.log("src-sees-binding", ns.v);
ns.w = 20;
console.log("binding-sees-src", a.w);
a.extra = 3;
console.log("new-key", ns.extra, JSON.stringify(Object.keys(ns)));
`],
  ["enumeration-through-the-binding", `const ns = { a: 1, b: 2 };
const x = ns;
x.c = 3;
console.log(JSON.stringify(Object.keys(x)), JSON.stringify(Object.values(x)));
console.log(JSON.stringify(Object.entries(x)), JSON.stringify(x));
console.log(Object.prototype.hasOwnProperty.call(x, "c"), "c" in x);
`],
  ["empty-root-grows-after-the-binding", `const ns = {};
const a = ns;
ns.k = 1;
console.log(a.k, JSON.stringify(Object.keys(a)));
a.j = 2;
console.log(ns.j, JSON.stringify(Object.keys(ns)));
`],
  // A RING the copy used to break: the binding stores the source into the
  // source. Two nodes with an edge each way, and both are the same object.
  ["self-reference-through-the-binding", `const ns = { v: 1 };
const a = ns;
a.self = ns;
console.log(a.self === ns, a.self.self === a, a.self.v);
`],
  // The binding still has to WORK as the record the checker thinks it is:
  // arithmetic, comparison, concatenation and a typed callee.
  ["the-binding-still-reads-as-a-record", `const ns = { v: 1 };
const a = ns;
/** @param {{v:number}} o */
function typed(o) { return o.v * 2; }
console.log(typed(a), a.v + 1, a.v > 0, "s" + a.v);
`],
  ["inspect-and-json", `const util = require("util");
const ns = { v: 1 };
const a = ns;
a.w = 2;
console.log(util.inspect(a), JSON.stringify(a));
`],
  // protobufjs's inquire() in shape — the site the whole require row exists
  // for — over an object-literal namespace reached through a binding.
  ["inquire-shape-over-a-named-namespace", `const mod = { v: 42 };
function inquire(x) {
  try {
    const t = x;
    return t && (t.length || Object.keys(t).length) ? t : null;
  } catch (e) { return null; }
}
const got = inquire(mod);
console.log(got === null, got === null ? "-" : got.v, got === mod);
`],

  /* ------------------------------------------------------------------ the
   * SECOND half of the family: a binding ONE LINK past the identifier, and
   * the two spellings that copy on purpose.
   *
   * `const a = root.sub` is the identical defect with the identical cause —
   * the slot is a record because the checker inferred one, the value is dyn
   * because the file is JavaScript — and it was only out of reach because
   * the rule asked for a BARE identifier. A member read off a dyn receiver
   * is dyn at every link, so the root identifier answers for the chain.
   *
   * `{ ...o }` and `structuredClone(o)` are the opposite question and needed
   * the opposite answer: they must NOT alias, and they were dropping the
   * keys they were supposed to copy. The spread's own desugar read the
   * source's type off the CHECKER for an identifier source and off the
   * LOWERING for anything else, so `{ ...x }` copied two declared fields
   * silently while `{ ...root.sub }` — the same value one link along — met a
   * loud fence. One line decided which of the two a program got. */
  ["nested-member-identity-and-write", `const root = { sub: { v: 1 } };
const a = root.sub, b = root.sub;
console.log("ident", a === b, a === root.sub);
a.v = 99;
console.log("read", b.v, root.sub.v);
`],
  ["nested-member-source-write-seen", `const root = { sub: { v: 1 } };
const a = root.sub;
root.sub.v = 5;
const b = root.sub;
console.log(a.v, b.v);
`],
  ["nested-member-two-levels-deep", `const root = { mid: { leaf: { v: 1 } } };
const a = root.mid.leaf, b = root.mid.leaf;
console.log(a === b);
a.v = 5;
console.log(root.mid.leaf.v);
`],
  ["nested-member-through-a-string-key", `const root = { sub: { v: 1 } };
const a = root["sub"];
a.v = 4;
console.log(a === root.sub, root.sub.v);
`],
  ["nested-member-function-scope", `const root = { sub: { v: 1 } };
function main() {
  const a = root.sub, b = root.sub;
  console.log(a === b);
  a.v = 99;
  console.log(b.v, root.sub.v);
}
main();
`],
  ["nested-member-two-hop", `const root = { sub: { v: 1 } };
const s = root.sub;
const a = s;
console.log(a === s, a === root.sub);
a.v = 42;
console.log(root.sub.v);
`],
  ["nested-member-let-never-reassigned", `const root = { sub: { v: 1 } };
let a = root.sub;
console.log(a === root.sub);
a.v = 8;
console.log(root.sub.v);
`],
  ["nested-member-both-directions", `const root = { sub: { v: 1, w: 2 } };
const a = root.sub;
a.v = 10;
console.log(root.sub.v);
root.sub.w = 20;
console.log(a.w);
a.extra = 3;
console.log(root.sub.extra, JSON.stringify(Object.keys(root.sub)));
`],
  ["nested-member-enumeration", `const root = { sub: { a: 1 } };
root.sub.b = 2;
const a = root.sub;
console.log(JSON.stringify(Object.keys(a)), JSON.stringify(a), "b" in a);
`],
  // A RING through the nested binding: an edge to itself and an edge back up
  // to the root, both of which the copy used to break.
  ["nested-member-ring", `const root = { sub: { v: 1 } };
const a = root.sub;
a.self = a;
a.up = root;
console.log(a.self === root.sub, a.up.sub === a);
`],
  /* THE TRAP-CATCHER for this half, the nested twin of
   * source-write-seen-through-binding. A binding names the object that was
   * AT the key, never the key itself: replacing the value there afterwards
   * must stay invisible through the binding. A rule that "re-read the key"
   * to make the identity cell pass would answer 9 where Node answers 1 —
   * the same shape of quieter wrong answer an identity cache on the crossing
   * would have traded for. */
  ["source-rebinds-the-key-after-the-binding", `const root = { sub: { v: 1 } };
const a = root.sub;
root.sub = { v: 9 };
console.log(a.v, root.sub.v, a === root.sub);
`],
  ["json-round-trip-through-a-nested-binding", `const root = { sub: { v: 1 } };
root.sub.w = 2;
const a = root.sub;
console.log(JSON.stringify(a), JSON.stringify(JSON.parse(JSON.stringify(a))));
`],

  ["spread-copies-a-runtime-key", `const o = { a: 1 };
o.b = 3;
const x = o;
console.log(JSON.stringify(Object.keys(x)), JSON.stringify({ ...x }));
`],
  ["spread-of-a-nested-member", `const root = { sub: { a: 1 } };
root.sub.b = 3;
console.log(JSON.stringify({ ...root.sub }));
`],
  ["spread-then-override", `const o = { a: 1 };
o.b = 3;
console.log(JSON.stringify({ ...o, z: 5 }), JSON.stringify({ ...o, a: 7 }));
`],
  ["two-spreads-merge", `const p = { a: 1 };
p.x = 9;
const q = { b: 2 };
q.y = 8;
console.log(JSON.stringify({ ...p, ...q }));
`],
  ["spread-of-an-empty-root-that-grew", `const o = {};
o.a = 1;
console.log(JSON.stringify({ ...o }));
`],
  // Node calls an enumerable GETTER exactly once during the copy and the
  // target receives a plain data property. The record field-copy desugar
  // fenced accessor-carrying sources by name because it could not model the
  // calls; scr_dyn_assign does one [[Get]] per key, which is the same rule.
  ["spread-invokes-a-getter-once", `const o = { a: 1 };
let calls = 0;
Object.defineProperty(o, "g", { get() { calls++; return 7; }, enumerable: true, configurable: true });
const c = { ...o };
console.log(JSON.stringify(c), calls);
`],
  ["spread-evaluates-in-source-order", `const o = { a: 1 };
o.b = 3;
const seen = [];
function t(n, v) { seen.push(n); return v; }
const c = { p: t("p", 0), ...o, q: t("q", 1) };
console.log(JSON.stringify(seen), JSON.stringify(c));
`],
  /* A spread is a SHALLOW copy, and these two rows are the half of this
   * family that must never become an alias. They are LANDS rather than
   * controls only because they did not RUN before — the `c === o` line met
   * the record/dyn operator fence — so they moved, and what they moved to is
   * Node's `false`. */
  ["spread-does-not-alias-its-source", `const o = { a: 1 };
o.b = 3;
const c = { ...o };
c.a = 99;
console.log(o.a, c.a, c === o);
`],
  ["spread-is-shallow", `const root = { sub: { v: 1 } };
root.k = 2;
const c = { ...root };
console.log(c.sub === root.sub, c.k);
c.sub.v = 5;
console.log(root.sub.v);
`],
  ["spread-into-a-binding-then-mutated", `const o = { a: 1 };
o.b = 3;
const c = { ...o };
c.b = 9;
console.log(o.b, c.b, JSON.stringify(Object.keys(c)));
`],
  ["structured-clone-copies-a-runtime-key", `const o = { a: 1 };
o.b = 3;
console.log(JSON.stringify(structuredClone(o)));
`],
  ["structured-clone-is-deep", `const root = { sub: { v: 1 } };
root.k = 2;
const c = structuredClone(root);
console.log(c.sub === root.sub, c.k, c.sub.v);
c.sub.v = 5;
console.log(root.sub.v);
`],
];

describe.each(["c", "llvm"] as const)("a JS binding that names an object literal IS that object (%s backend)", (backend) => {
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

/** The rows the rule must NOT move. Each one is a reason the rule is gated
 * where it is, and each would be a silent regression if it changed. */
const CONTROLS: Array<[string, string, ".js" | ".ts"]> = [
  // A reassigned `let` cannot adopt: the second assignment could name an
  // unrelated value, which is why both shipped adoption arms demand
  // bindingHoldsItsInitializer and this one does too.
  ["let-reassigned", `const ns = { v: 1 };
const other = { v: 7 };
let a = ns;
console.log("first", a.v);
a = other;
console.log("second", a.v);
`, ".js"],
  // A program that ASKED for a copy must still get one: the snapshot does
  // not see a later write to the source, and is not the source. (The
  // `snap === ns` comparison this row would also like to make meets the
  // record/dyn operator fence — it is in the pinned group below.)
  ["object-assign-still-copies", `const ns = { v: 1 };
const snap2 = Object.assign({}, ns);
ns.v = 7;
console.log(snap2.v, ns.v);
`, ".js"],
  // A function-LOCAL literal was never dyn and never lost its identity.
  ["function-local-literal", `function main() {
  const ns = { v: 1 };
  const a = ns, b = ns;
  console.log(a === b);
  a.v = 99;
  console.log(b.v);
}
main();
`, ".js"],
  // A file-scope ARRAY already aliased correctly (its global is a real
  // ScrArr, not a record), and must keep doing so.
  ["file-scope-array", `const arr = [1, 2];
const a = arr, b = arr;
console.log(a === b);
a[0] = 99;
console.log(b[0]);
`, ".js"],
  // The dyn-TYPED root: the same program whose root the CHECKER already
  // calls dynamic. It was the one spelling that always matched, and it is
  // the pair that proved only the root's static type differed.
  ["json-parse-root", `const ns = JSON.parse("{}");
ns.v = 1;
const a = ns, b = ns;
console.log(a === b);
a.v = 99;
console.log(b.v);
`, ".js"],
  // The class-instance arm this rule is the dyn twin of.
  ["class-instance-binding", `class C { constructor() { this.v = 1; } }
const c = new C();
const a = c;
console.log(a === c);
a.v = 9;
console.log(c.v);
`, ".js"],
  ["two-distinct-literals-stay-distinct", `const p = { v: 1 };
const q = { v: 1 };
const a = p, b = q;
console.log(a === b, a === p, b === q);
`, ".js"],
  ["primitive-binding", `const n = 1;
const a = n, b = n;
console.log(a === b, a + b);
`, ".js"],
  // TypeScript, both spellings. Nothing here is dyn, so nothing here moves —
  // and these are the reason the rule is gated to JS sources: in a `.ts`
  // file the record is an annotation, not inference residue.
  ["ts-annotated", `interface NS { v: number }
const ns: NS = { v: 1 };
const a: NS = ns;
const b: NS = ns;
console.log(a === b);
a.v = 99;
console.log(b.v);
`, ".ts"],
  ["ts-inferred", `const ns = { v: 1 };
const a = ns, b = ns;
console.log(a === b);
a.v = 99;
console.log(b.v);
`, ".ts"],
  // The nested-member half of the same argument: TypeScript was always
  // right, because nothing there is dyn.
  ["ts-nested-member", `const root = { sub: { v: 1 } };
const a = root.sub, b = root.sub;
console.log(a === b);
a.v = 99;
console.log(root.sub.v);
`, ".ts"],
  ["ts-spread", `const o = { a: 1 };
const c = { ...o };
c.a = 9;
console.log(o.a, c.a, JSON.stringify(c));
`, ".ts"],
  ["ts-structured-clone", `const o = { a: 1 };
const c = structuredClone(o);
c.a = 9;
console.log(o.a, c.a, JSON.stringify(c));
`, ".ts"],
  // A member whose value is a PRIMITIVE has no identity to keep and no
  // record slot: the rule must not fire, and the reads stay static.
  ["primitive-member-binding", `const root = { n: 1, s: "x" };
const a = root.n, b = root.s;
console.log(a, b, a === root.n, b === root.s);
`, ".js"],
  // A JS literal with NOTHING dyn in it keeps the record spread desugar.
  ["static-spread-with-no-dyn-source", `function main() {
  const o = { a: 1, b: 2 };
  const c = { ...o, b: 9 };
  console.log(JSON.stringify(c), c === o);
}
main();
`, ".js"],
  // structuredClone already answered this one and must keep answering it:
  // the clone is a fresh object, so a write through it never reaches the
  // source. Its TWIN — the keys the clone carries — is a LAND above.
  ["structured-clone-does-not-alias", `const o = { a: 1 };
o.b = 3;
const c = structuredClone(o);
c.a = 99;
console.log(o.a, c.a);
`, ".js"],
];

describe.each(["c", "llvm"] as const)("the rows the rule must not move (%s backend)", (backend) => {
  test.for(CONTROLS)("%s", { timeout: 240_000 }, async ([name, src, ext]) => {
    const { node, exe } = await bothWays(name, backend, src, ext);
    expect(node.code, `Node failed to run the cell:\n${node.err}`).toBe(0);
    expect(node.out.trim().length).toBeGreaterThan(0);
    expect(exe.code, `compiled program failed:\n${exe.err}`).toBe(0);
    expect(exe.out).toBe(node.out);
  });
});

/* MEASURED AND NOT PINNED, because they are not this rule's business and
 * answer identically on both sides of its A/B. Recorded so the next block
 * does not re-derive them, each with the fence it meets today (all on both
 * backends, all against Node v25.9.0):
 *
 *   const m = new Map(); m.set("k", a)   `TypeError: m.set is not a function`
 *   delete x.a  over a dyn binding       a BUILD error, not a run-time fence
 *   module.exports read back as a value  SC1090 "the reference to 'module'"
 *   for (const k in x)                   SC2001 on the loop's binding type
 *   a instanceof Object                  SC1090, non-program right-hand side
 *   Object.freeze(a)                     SC2020 "possibly-aliased value"
 *
 * (`{ ...ns }` beside `snap === ns` used to be on that list, meeting the
 * record/dyn operator fence. It is a LAND now — spread-does-not-alias-its-
 * source — and it answers Node's `false`.)
 */
describe("what these rules deliberately leave open", () => {
  /* A binding that names a nested ARRAY. Same defect, one representation
   * over: the checker types `root.xs` as `number[]`, the slot maps to an
   * ARRAY, and the dyn read is checked into a fresh ScrArr. A file-scope
   * array LITERAL already keeps its identity (its global is a real ScrArr,
   * so the slot and the value agree and nothing copies) — it is only the
   * nested one, read out of a dyn table, that crosses. Widening the slot
   * rule from `record` to `record | array` is the shape of the fix and a
   * strictly larger blast radius: every `const xs = obj.list` in a JS source
   * would move to dyn reads at once. Measured, not fixed. */
  test("a binding that names a nested array still copies (both backends)", { timeout: 480_000 }, async () => {
    const src = `const root = { xs: [1, 2] };
const a = root.xs, b = root.xs;
console.log(a === b);
a[0] = 9;
console.log(root.xs[0]);
`;
    for (const backend of ["c", "llvm"] as const) {
      const { node, exe } = await bothWays("nested-array-member", backend, src);
      expect(node.out.trim()).toBe("true\n9");
      expect(exe.code, `${backend}: ${exe.err}`).toBe(0);
      expect(
        exe.out.trim(),
        `${backend}: if this now prints Node's answer the remainder is CLOSED — move the row into LANDS`,
      ).toBe("false\n1");
    }
  });

  /* A binding whose initializer is an `Object.assign` CALL. The call already
   * answers a dyn value — `JSON.stringify(Object.assign({}, o))` prints
   * Node's answer — and the binding is where it is lost: the slot is the
   * checker's inferred record and the dyn result is checked back into it,
   * dropping exactly the run-time keys the call had just copied. It is the
   * same sentence as the spread and the clone; what it needs is the call
   * added to the initializer shapes the slot rule can predict, and no
   * measurement here says which other calls would want the same. */
  test("a binding holding an Object.assign result still narrows (both backends)", { timeout: 480_000 }, async () => {
    const src = `const o = { a: 1 };
o.b = 3;
const c = Object.assign({}, o);
c.a = 9;
console.log(o.a, c.a, JSON.stringify(c));
`;
    for (const backend of ["c", "llvm"] as const) {
      const { node, exe } = await bothWays("object-assign-binding", backend, src);
      expect(node.out.trim()).toBe('1 9 {"a":9,"b":3}');
      expect(exe.code, `${backend}: ${exe.err}`).toBe(0);
      expect(
        exe.out.trim(),
        `${backend}: if this now prints Node's answer the remainder is CLOSED — move the row into LANDS`,
      ).toBe('1 9 {"a":9}');
    }
  });

  /* A `let` one link past the identifier that the file DOES reassign. It
   * cannot adopt — the second assignment could name an unrelated value, the
   * proof both shipped adoption arms rest on — so the binding stays a record
   * and the `a === root.sub` comparison meets the record/dyn operator fence.
   * That is the acceptable half of wrong: a fence, not a silent answer. */
  test("a reassigned let one link along still refuses loudly (both backends)", { timeout: 480_000 }, async () => {
    const src = `const root = { sub: { v: 1 } };
let a = root.sub;
a = { v: 7 };
console.log(a.v, root.sub.v, a === root.sub);
`;
    for (const backend of ["c", "llvm"] as const) {
      const { node, exe } = await bothWays("nested-member-let-reassigned", backend, src);
      expect(node.out.trim()).toBe("7 1 false");
      expect(exe.code, `${backend}: expected the fence, got ${exe.out}`).toBe(1);
      expect(exe.out + exe.err).toMatch(/SC1100/);
    }
  });

  /* The value is not BOUND at all — it is put straight into a composite or
   * a conditional, which coerces it to the checker's record. Today both
   * spellings meet the mixed record/dyn comparison and refuse LOUDLY
   * (SC1100), which is the acceptable half of wrong: it is a fence, not a
   * silent answer. Whoever closes this has to keep it that way or make it
   * right — never quiet. */
  test("an unbound crossing into a composite still refuses loudly (both backends)", { timeout: 480_000 }, async () => {
    const src = `const ns = { v: 1 };
const arr = [ns];
console.log(arr[0] === ns);
`;
    for (const backend of ["c", "llvm"] as const) {
      const { node, exe } = await bothWays("array-element-crossing", backend, src);
      expect(node.out.trim()).toBe("true");
      expect(exe.code, `${backend}: expected the fence, got ${exe.out}`).toBe(1);
      expect(exe.out + exe.err).toMatch(/SC1100/);
    }
  });

});
