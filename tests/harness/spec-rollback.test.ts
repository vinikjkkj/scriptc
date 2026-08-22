/* The SPECULATIVE descent, end to end — what a reader can see.
 *
 * mapType descends speculatively at two sites: the generic-member walk in
 * mapRecordTypeInner (a `<K extends keyof Ev>(e: K, ...) => void` member held
 * in a record slot) and the constraint erasure in the generic-signature rule.
 * Both retract on failure. On main `fd2d121e` the retraction TRUNCATED the
 * shape/union arrays, so the next unrelated shape was handed a discarded
 * one's id — while mapType's memo, a WeakMap that cannot be enumerated and
 * therefore cannot be purged, still named the old one.
 *
 * The first group is what that cost. Five lines of plain TypeScript, no
 * dynamic anything, DEFAULT lane, both backends, main killed the compiler:
 *
 *     TypeError: Cannot read properties of undefined (reading 'fields')
 *         at lowerObjectLiteral (.../lower-exprs.js:8752:38)
 *
 * a Node stack trace and no diagnostic. What pins the memo as the carrier is
 * that SCRIPTC_NO_MEMO=1 turned the very same program into the honest SC1090
 * refusal. These rows assert the compiler ANSWERS — a diagnostic or a working
 * binary, never a crash — which is the invariant that survives the refusal
 * itself being closed later.
 *
 * The second group is what the descent now BUYS, and it is the group that
 * matters more. The generic-member walk used to be gated off by default
 * (SCRIPTC_GENERIC_SLOT); with the retraction correct the gate is gone, so a
 * whole class of members that used to refuse now maps. A refusal replaced by
 * a wrong answer is worse than the refusal, so every one of these is scored
 * against Node itself — the oracle is run here, never typed into this file.
 *
 * The registry-level statement of the same invariant, with the four other
 * leaks the truncation had, is packages/compiler/test/spec-rollback.test.ts.
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
 * file inside one, and the oracle leg would fail for a reason that says
 * nothing about the compiler. */
const cellRoot = join(tmpdir(), "scriptc-spec-rollback");

interface Run {
  out: string;
  code: number;
  err: string;
}

async function run(cmd: string, args: string[]): Promise<Run> {
  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, { encoding: "utf8" });
    return { out: stdout, code: 0, err: stderr };
  } catch (err) {
    const e = err as { code?: unknown; stdout?: string; stderr?: string };
    if (typeof e.code !== "number") throw err;
    return { out: e.stdout ?? "", code: e.code, err: e.stderr ?? "" };
  }
}

/** Compiles `src` and runs it, and runs the SAME text on Node for the
 * oracle. A compile that REFUSES is reported as such (code -1 with the
 * diagnostics in `err`); a compile that THROWS is left to propagate, because
 * an ICE is exactly what the first group is about. */
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

/* ── group 1: a failed attempt must not take the compiler with it ─────────
 *
 * Each of these makes a speculative attempt intern something and then fail,
 * and then names a type the attempt walked through. What the compiler
 * answers is open — a refusal is a perfectly good answer for a generic
 * function held as a value — but it has to ANSWER. */
const MUST_ANSWER: Array<[string, string]> = [
  // The minimal one, and the exact text that ICEd main. `A extends Nest`
  // maps (interning `{c:number}`), the unconstrained `B` fails, the attempt
  // retracts — and `const n: Nest` reads the memo for a shape that used to
  // stop existing at that moment.
  ["constraint-erasure-then-reuse", `interface Nest { readonly a: string; readonly b: { c: number } }
const f: <A extends Nest, B>(x: A, y: B) => void = (_x, _y) => {};
void f;
const n: Nest = { a: "s", b: { c: 42 } };
console.log(n.a + " " + String(n.b.c));`],
  // The same shape of failure with a UNION in the retracted region, so the
  // union registry's half of the retraction is exercised too.
  ["constraint-erasure-union-then-reuse", `interface Wrap { readonly v: string | number }
const f: <A extends Wrap, B>(x: A, y: B) => void = (_x, _y) => {};
void f;
const w: Wrap = { v: "s" };
console.log(typeof w.v);`],
  // A RECURSIVE type inside the retracted region: the attempt mints a
  // placeholder, and the abandoned placeholder must not be what the later
  // legitimate mapping resumes.
  ["constraint-erasure-recursive-then-reuse", `interface Node2 { readonly tag: string; readonly kids: Node2[] }
const f: <A extends Node2, B>(x: A, y: B) => void = (_x, _y) => {};
void f;
const n: Node2 = { tag: "root", kids: [{ tag: "leaf", kids: [] }] };
console.log(n.tag + " " + String(n.kids.length) + " " + n.kids[0]!.tag);`],
];

describe.each(["c", "llvm"] as const)("a failed speculative attempt does not kill the compiler (%s backend)", (backend) => {
  test.for(MUST_ANSWER)("%s", { timeout: 240_000 }, async ([name, src]) => {
    // The oracle first: a cell Node cannot run proves nothing either way.
    const { node, exe } = await bothWays(name, backend, src);
    expect(node.code, `Node failed to run the cell:\n${node.err}`).toBe(0);
    expect(node.out.trim().length).toBeGreaterThan(0);
    if (exe.code === -1) {
      // A REFUSAL is an answer. It has to be a diagnostic, though — the
      // failure this file exists for produced no diagnostic at all.
      expect(exe.err).toMatch(/^SC\d{4}: /m);
      return;
    }
    // ...and if it compiled, it has to be RIGHT. A refusal that became a
    // wrong answer is the worse outcome, not the better one.
    expect(exe.code, `compiled program failed:\n${exe.err}`).toBe(0);
    expect(exe.out).toBe(node.out);
  });
});

/* ── group 2: what the ungated descent now maps, scored against Node ───── */
const MUST_MATCH: Array<[string, string]> = [
  // The bound-emit slot: `emit.bind(this)` in a `<K extends keyof Ev>` slot.
  // Three SC1090-family refusals in the default lane before the gate went.
  ["bound-emit-two-events", `import { EventEmitter } from "node:events";
interface Ev { alpha: (p: { kind: string }) => void; beta: (n: number) => void }
interface Sink { readonly emitEvent: <K extends keyof Ev>(event: K, ...args: Parameters<Ev[K]>) => void }
class Bus extends EventEmitter { sink(): Sink { return { emitEvent: this.emit.bind(this) }; } }
const bus = new Bus();
bus.on("alpha", (p: { kind: string }) => { console.log("alpha " + p.kind); });
bus.on("beta", (n: number) => { console.log("beta " + String(n)); });
const s = bus.sink();
s.emitEvent("alpha", { kind: "A" });
s.emitEvent("beta", 7);
console.log("done");`],
  // A payload that is itself a UNION arm, so the slot's element union is
  // more than one shape wide.
  ["bound-emit-union-payload", `import { EventEmitter } from "node:events";
interface Ev { one: (p: { t: "a"; n: number }) => void; two: (p: { t: "b"; s: string }) => void }
interface Sink { readonly emitEvent: <K extends keyof Ev>(event: K, ...args: Parameters<Ev[K]>) => void }
class Bus extends EventEmitter { sink(): Sink { return { emitEvent: this.emit.bind(this) }; } }
const bus = new Bus();
bus.on("one", (p: { t: "a"; n: number }) => { console.log("one " + p.t + String(p.n)); });
bus.on("two", (p: { t: "b"; s: string }) => { console.log("two " + p.t + p.s); });
const s = bus.sink();
s.emitEvent("one", { t: "a", n: 1 });
s.emitEvent("two", { t: "b", s: "z" });
console.log("done");`],
  // The generic member that CANNOT map, sitting beside one that must. The
  // attempt interns `Nest` on the way down and then fails on the
  // unconstrained `B`; `nest` is read afterwards and has to be itself. This
  // is the group-1 defect reached through the generic-MEMBER site, and it
  // ICEd main with SCRIPTC_GENERIC_SLOT=1 — the only lane zapo ever ran in.
  ["generic-member-retracts-beside-a-good-one", `interface Nest { readonly a: string; readonly b: { c: number } }
interface Holder {
  readonly bad: <A extends Nest, B>(x: A, y: B) => void;
  readonly nest: Nest;
}
const h: Holder = { bad: (_x, _y) => {}, nest: { a: "s", b: { c: 42 } } };
console.log(h.nest.a + " " + String(h.nest.b.c));`],
  // An ALIASED handler in the key map — the other half of the gate that went
  // (handlerFnTypeNodeOf follows the alias to its declaration).
  ["aliased-handler-in-the-key-map", `import { EventEmitter } from "node:events";
type AlphaHandler = (p: { kind: string }) => void;
interface Ev { alpha: AlphaHandler; beta: AlphaHandler }
interface Sink { readonly emitEvent: <K extends keyof Ev>(event: K, ...args: Parameters<Ev[K]>) => void }
class Bus extends EventEmitter { sink(): Sink { return { emitEvent: this.emit.bind(this) }; } }
const bus = new Bus();
bus.on("alpha", (p: { kind: string }) => { console.log("alpha " + p.kind); });
bus.on("beta", (p: { kind: string }) => { console.log("beta " + p.kind); });
const s = bus.sink();
s.emitEvent("alpha", { kind: "A" });
s.emitEvent("beta", { kind: "B" });
console.log("done");`],
  // A generic member the descent maps at its CONSTRAINT instantiation and
  // that is then actually CALLED through the slot — the ordinary closure
  // slot the gate's comment names, exercised rather than described.
  ["generic-member-called-through-the-slot", `interface Reg { readonly a: number; readonly b: number }
interface Ops { readonly pick: <K extends keyof Reg>(k: K) => number }
const reg: Reg = { a: 1, b: 2 };
const ops: Ops = { pick: (k) => reg[k] };
console.log(String(ops.pick("a")) + " " + String(ops.pick("b")));`],
];

/* ── group 3: a refusal must not name a type the program never wrote ─────
 *
 * The aliasing in group 1 is not always a crash. One line of reordering and it
 * comes out as a REFUSAL whose reason is another declaration's shape, which is
 * the same defect wearing a diagnostic. On main `fd2d121e` this program gets
 * three errors, and the second one is:
 *
 *   SC2002: record shapes must match exactly or width-coerce:
 *           expected '{ w: number; y: number }', got '{ a: string; b: { c: number } }'
 *
 * at `const n: Nest = …`. `{ w: number; y: number }` is `o2`'s literal, two
 * lines above; `Nest` is neither of those things. The retracted attempt freed
 * `Nest`'s id, `o2` took it, and the memo still answered with it.
 *
 * SC1090 here is legitimate — a generic function held as a value genuinely has
 * no pinned signature. The row asserts that it is the ONLY thing reported, so
 * a phantom diagnostic about a type the source never mentions cannot come back
 * disguised as a real one. */
const NO_PHANTOM = `interface Nest { readonly a: string; readonly b: { c: number } }
const f: <A extends Nest, B>(x: A, y: B) => void = (_x, _y) => {};
void f;
const o1 = { z: "one" };
const o2 = { y: 2, w: 3 };
console.log(o1.z, o2.y, o2.w);
const n: Nest = { a: "s", b: { c: 42 } };
console.log(n.a, n.b.c);`;

describe.each(["c", "llvm"] as const)("a refusal names only what the program wrote (%s backend)", (backend) => {
  test("no phantom shape mismatch against an unrelated literal", { timeout: 240_000 }, async () => {
    const { node, exe } = await bothWays("no-phantom-shape-mismatch", backend, NO_PHANTOM);
    expect(node.code, `Node failed to run the cell:\n${node.err}`).toBe(0);
    expect(node.out).toBe("one 2 3\ns 42\n");
    if (exe.code === -1) {
      const codes = [...new Set(exe.err.match(/SC\d{4}/g) ?? [])].sort();
      expect(codes, exe.err).toEqual(["SC1090"]);
      return;
    }
    expect(exe.code, `compiled program failed:\n${exe.err}`).toBe(0);
    expect(exe.out).toBe(node.out);
  });
});

describe.each(["c", "llvm"] as const)("the ungated generic-member descent maps correctly (%s backend)", (backend) => {
  test.for(MUST_MATCH)("%s", { timeout: 240_000 }, async ([name, src]) => {
    const { node, exe } = await bothWays(name, backend, src);
    expect(node.code, `Node failed to run the cell:\n${node.err}`).toBe(0);
    expect(node.out.trim().length).toBeGreaterThan(0);
    expect(exe.code, `compiled program failed:\n${exe.err}`).toBe(0);
    expect(exe.out).toBe(node.out);
  });
});
