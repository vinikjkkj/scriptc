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
 * The PINNED rows at the bottom are the spellings the rule does not reach.
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
  ["delete-through-the-binding", `const ns = { a: 1, b: 2 };
const x = ns;
delete x.a;
console.log(JSON.stringify(Object.keys(ns)), x.a === undefined, ns.a === undefined);
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
  ["the-binding-is-the-export", `const ns = { v: 1 };
const a = ns;
module.exports = { a, ns };
const self = module.exports;
console.log(self.a === self.ns);
self.a.v = 9;
console.log(self.ns.v);
`],
  ["identity-through-a-map", `const ns = { v: 1 };
const a = ns;
const m = new Map();
m.set("k", a);
console.log(m.get("k") === ns);
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
  // A program that ASKED for a copy must still get one. If these ever start
  // aliasing, the rule has leaked out of the declaration.
  ["spread-and-assign-still-copy", `const ns = { v: 1 };
const snap = { ...ns };
ns.v = 99;
console.log(snap.v, ns.v, snap === ns);
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
  ["freeze-through-the-binding", `const ns = { v: 1 };
const a = ns;
Object.freeze(a);
console.log(Object.isFrozen(ns), Object.isFrozen(a));
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

describe("what this rule deliberately leaves open", () => {
  /* Everything PAST a bare identifier. collectGlobals fixes a file-scope
   * slot before any body lowers, so it cannot ask the lowering what a
   * property read produced — it can only predict, and a wrong prediction
   * here is another silent copy rather than a fence. The function-scope
   * rung has the lowered value and could widen; the file-scope one is the
   * half that would have to be argued first, so both stay narrow and agree.
   */
  test("a binding one link past the identifier still copies (both backends)", { timeout: 480_000 }, async () => {
    const src = `const root = { sub: { v: 1 } };
const a = root.sub, b = root.sub;
console.log(a === b);
a.v = 99;
console.log(root.sub.v);
`;
    for (const backend of ["c", "llvm"] as const) {
      const { node, exe } = await bothWays("nested-member-binding", backend, src);
      expect(node.out.trim()).toBe("true\n99");
      expect(exe.code, `${backend}: ${exe.err}`).toBe(0);
      expect(
        exe.out.trim(),
        `${backend}: if this now prints Node's answer the remainder is CLOSED — move the row into LANDS`,
      ).toBe("false\n1");
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

  /* The SPREAD of a dyn-rooted value, which is dynacc's `q1`: the checker
   * types `{...o}` by the literal's declared members, so the emitted code
   * builds a static record with those fields and a run-time-added key has
   * nowhere to land. It is a LOWERING row of the same family and a separate
   * decision — the receiver's static type outranking its run-time value. */
  test("a spread of a dyn-rooted value still drops run-time keys (both backends)", { timeout: 480_000 }, async () => {
    const src = `const o = { a: 1 };
o.b = 3;
const x = o;
console.log(JSON.stringify(Object.keys(x)), JSON.stringify({ ...x }));
`;
    for (const backend of ["c", "llvm"] as const) {
      const { node, exe } = await bothWays("spread-drops-runtime-keys", backend, src);
      expect(node.out.trim()).toBe('["a","b"] {"a":1,"b":3}');
      expect(exe.code, `${backend}: ${exe.err}`).toBe(0);
      expect(
        exe.out.trim(),
        `${backend}: the keys are right and the SPREAD is not — if that changed, say which way`,
      ).toBe('["a","b"] {"a":1}');
    }
  });
});
