/* The two rungs that take an index-signature keyed read to its
 * undefined-armed width at a SWITCH DISCRIMINANT and at an ASSIGNMENT, and
 * the three dials that price them.
 *
 * zapo `src/message/primitives/incoming.ts:538` and `:541` are the same read
 * twice: `firstEncType = child.attrs.type` and `switch (child.attrs.type)`,
 * where `child` is an `<enc>` of an inbound `<message>` and `child.attrs` is
 * `Record<string, string>`. The checker types a signature read by its VALUE
 * type, so both are spelled `string`; a stanza that omits `type=` misses the
 * key; the miss path is `scr_trap_fmt` — an untagged process ABORT past every
 * catch clause, on a switch whose author wrote `default: continue` for
 * exactly that input. Both sites execute on every paired run and survive only
 * because the fake server always sends the attribute.
 *
 *   SCRIPTC_SWITCHARM_OFF=1   ablates the discriminant rung.
 *   SCRIPTC_ASSIGNARM_OFF=1   ablates the assignment rung.
 *   SCRIPTC_CASEBRACE_OFF=1   ablates the half of the union desugar that
 *                             recognises `case 'x': { …; break }` as ending
 *                             in the same exit break as `case 'x': break`.
 *                             All four of zapo's cases wear braces, so with
 *                             this dial on the discriminant rung declines the
 *                             braced switch and the abort comes back.
 *
 * THE HAZARD THIS FILE IS ARMED AGAINST is the one the brief names: trading a
 * runtime kill for a COMPILE-TIME refusal. `lowerUnionSwitch` is the only
 * lowering a union-typed discriminant has and it refuses several clause
 * shapes the primitive switch lowers happily, so every shape it would refuse
 * has to be DECLINED by the rung instead. That is asserted directly — the
 * declining programs must compile with zero diagnostics — and not inferred
 * from the absence of a crash.
 */
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { compile } from "../src/index.js";

/* The zapo shape: a braced tag dispatch over an `<enc>` attribute with the
 * author's own `default: continue`, plus the assignment one line above it. */
const ENC = [
  `type WaNode = { tag: string; attrs: Record<string, string> };`,
  `export function handle(children: WaNode[]): string {`,
  `  let firstEncType: string | undefined;`,
  `  let out = "";`,
  `  for (const child of children) {`,
  `    if (child.tag !== "enc") { continue }`,
  `    if (firstEncType === undefined) {`,
  `      firstEncType = child.attrs.type;`,
  `    }`,
  `    switch (child.attrs.type) {`,
  `      case "skmsg": {`,
  `        out += "S";`,
  `        break;`,
  `      }`,
  `      case "msg":`,
  `      case "pkmsg": {`,
  `        out += "M";`,
  `        break;`,
  `      }`,
  `      default:`,
  `        continue;`,
  `    }`,
  `    out += "|";`,
  `  }`,
  `  return out + ":" + String(firstEncType);`,
  `}`,
  `console.log(handle([{ tag: "enc", attrs: { type: "msg" } }]));`,
  `export {};`,
  ``,
].join("\n");

/* Three clause shapes `lowerUnionSwitch` refuses outright. Each compiles
 * today as a primitive string switch, so each must keep doing so: the rung
 * has to DECLINE, never widen and let the desugar refuse. */
const DECLINERS = [
  `const CASE_A = "alpha";`,
  `export function nonLiteral(a: Record<string, string>): string {`,
  `  switch (a.type) { case CASE_A: { return "A" } default: return "?" }`,
  `}`,
  `export function fallsThrough(a: Record<string, string>): string {`,
  `  let s = "";`,
  `  switch (a.type) { case "p": s += "P"; case "q": s += "Q"; break; default: s += "?" }`,
  `  return s;`,
  `}`,
  `export function earlyBreak(a: Record<string, string>): string {`,
  `  let s = "";`,
  `  switch (a.type) {`,
  `    case "e": { if (a.stop === "yes") { break } s += "E"; break }`,
  `    default: s += "?";`,
  `  }`,
  `  return s;`,
  `}`,
  `export function labelled(a: Record<string, string>): string {`,
  `  let s = "";`,
  `  outer: switch (a.type) { case "l": { s += "L"; break outer } default: s += "?" }`,
  `  return s;`,
  `}`,
  `console.log(nonLiteral({ type: "alpha" }), fallsThrough({ type: "p" }),`,
  `  earlyBreak({ type: "e" }), labelled({ type: "l" }));`,
  `export {};`,
  ``,
].join("\n");

/* The MISS path the emitter plants for a keyed read at a non-armed width.
 * Anchored on the whole trap call, not on the helper name: `sc_rkg_` names
 * every keyed-read helper, aborting or not, and counting those would report a
 * sweep it never took. */
const TRAP = /scr_trap_fmt\("scriptc: TypeError: record has no key/g;

/* Assignments into an undefined-armed slot whose later reads have LOST the
 * arm — tsc narrows an assignment to the declared type filtered by the type
 * assigned, so the very next read of `v` after `v = a.k` is already `string`,
 * `v === undefined` and `v ?? d` included.
 *
 * These three DECLINED when this file was written, on the stated ground that
 * a narrowed read lowers to an UNCHECKED unionNarrow. It does not, and has
 * not since `733f4db9` made every checker-driven narrowing go through
 * `checkedArmBridge` -> `narrowedArmHelper` — an `if (unionIsTag) throw new
 * TypeError` before the payload peek. `block/assignarm` retired the gate and
 * gave each consumer the answer the unit arm has: `v ?? d` takes the default
 * (nullarm), `v === undefined` answers the tag it always could, and `v.length`
 * throws Node's own `Cannot read properties of undefined (reading 'length')`
 * (recvarm). So all three WIDEN now, and the assertion is the other way
 * round. */
const ASSIGN_NARROWED = [
  `export function deref(a: Record<string, string>): number {`,
  `  let v: string | undefined;`,
  `  v = a.k;`,
  `  return v.length;`,
  `}`,
  `export function tested(a: Record<string, string>): string {`,
  `  let v: string | undefined;`,
  `  v = a.k;`,
  `  if (v === undefined) return "(none)";`,
  `  return v;`,
  `}`,
  `export function defaulted(a: Record<string, string>): string {`,
  `  let v: string | undefined;`,
  `  v = a["k"];`,
  `  return v ?? "d";`,
  `}`,
  `console.log(deref({ k: "x" }), tested({ k: "y" }), defaulted({ k: "z" }));`,
  `export {};`,
  ``,
].join("\n");

interface Dials {
  switchOff?: boolean;
  assignOff?: boolean;
  braceOff?: boolean;
}

let dir: string | undefined;
async function emit(program: string, d: Dials): Promise<{ tu: string; diags: string[] }> {
  dir ??= await mkdtemp(join(tmpdir(), "scriptc-switcharm-"));
  const tag = `${d.switchOff === true ? "s" : "n"}${d.assignOff === true ? "a" : "n"}${
    d.braceOff === true ? "b" : "n"
  }${program === ENC ? "e" : program === DECLINERS ? "d" : "a"}`;
  const src = join(dir, `main-${tag}.ts`);
  await writeFile(src, program, "utf8");
  const saved: [string, string | undefined][] = [
    ["SCRIPTC_SWITCHARM_OFF", process.env["SCRIPTC_SWITCHARM_OFF"]],
    ["SCRIPTC_ASSIGNARM_OFF", process.env["SCRIPTC_ASSIGNARM_OFF"]],
    ["SCRIPTC_CASEBRACE_OFF", process.env["SCRIPTC_CASEBRACE_OFF"]],
  ];
  const set = (k: string, on: boolean | undefined): void => {
    if (on === true) process.env[k] = "1";
    else delete process.env[k];
  };
  set("SCRIPTC_SWITCHARM_OFF", d.switchOff);
  set("SCRIPTC_ASSIGNARM_OFF", d.assignOff);
  set("SCRIPTC_CASEBRACE_OFF", d.braceOff);
  try {
    const res = await compile(src, {
      outPath: join(dir, `program-${tag}`),
      outDir: dir,
      backend: "c",
      emitOnly: true,
    });
    if (!res.ok) {
      return { tu: "", diags: res.diagnostics.map((x) => x.message) };
    }
    // The emitted TU carries its entry path in a comment on every function,
    // so two variants differ by their filename before they differ by a
    // lowering. Normalise the name out: a byte comparison of two TUs is only
    // about the lowering when the paths are the same length AND the same
    // text (the 370 305-byte __FILE__ accident this project has already
    // priced, one directory smaller).
    const tu = await readFile(res.cPath, "utf8");
    return { tu: tu.split(`main-${tag}.ts`).join("main.ts"), diags: [] };
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const count = (tu: string, re: RegExp): number => (tu.match(re) ?? []).length;

describe("the enc-attribute rungs", () => {
  test("both rungs together remove every aborting keyed read from the shape", async () => {
    const base = await emit(ENC, { switchOff: true, assignOff: true, braceOff: true });
    expect(base.diags).toEqual([]);
    // A program with no aborting read at all would make every assertion
    // below vacuous, so the baseline is asserted non-trivial first.
    expect(count(base.tu, TRAP)).toBeGreaterThan(0);

    const fixed = await emit(ENC, {});
    expect(fixed.diags).toEqual([]);
    expect(count(fixed.tu, TRAP)).toBe(0);
  }, 240_000);

  test("each dial alone brings the abort back", async () => {
    const both = await emit(ENC, {});
    expect(count(both.tu, TRAP)).toBe(0);

    // The switch rung alone: the assignment still aborts.
    const noSwitch = await emit(ENC, { switchOff: true });
    expect(count(noSwitch.tu, TRAP)).toBeGreaterThan(0);

    // The assignment rung alone: the switch still aborts.
    const noAssign = await emit(ENC, { assignOff: true });
    expect(count(noAssign.tu, TRAP)).toBeGreaterThan(0);

    // The braced-body half of the desugar: without it the discriminant rung
    // declines this switch (all four of zapo's cases wear braces) and the
    // abort is back even though the rung itself is on.
    const noBrace = await emit(ENC, { braceOff: true });
    expect(count(noBrace.tu, TRAP)).toBeGreaterThan(0);
  }, 480_000);

  test("the clause shapes the desugar refuses DECLINE — they do not become refusals", async () => {
    const fixed = await emit(DECLINERS, {});
    expect(fixed.diags).toEqual([]);
    expect(fixed.tu.length).toBeGreaterThan(0);

    // And they lower to exactly what they lowered to before: with the rungs
    // ablated the TU is byte-for-byte the same, which is the only way to say
    // "declined" about a lowering rather than "happened to still compile".
    const base = await emit(DECLINERS, { switchOff: true, assignOff: true, braceOff: true });
    expect(base.diags).toEqual([]);
    expect(fixed.tu).toBe(base.tu);
  }, 240_000);

  test("an assignment whose later reads were narrowed widens too", async () => {
    // The baseline first, so the assertion below cannot be vacuous: with
    // the assignment rung ablated all three shapes keep the aborting read.
    const base = await emit(ASSIGN_NARROWED, { assignOff: true });
    expect(base.diags).toEqual([]);
    expect(count(base.tu, TRAP)).toBeGreaterThan(0);

    // And with it on the abort is gone from every one of them — the gate
    // that used to decline them is retired (see ASSIGN_NARROWED above).
    const fixed = await emit(ASSIGN_NARROWED, {});
    expect(fixed.diags).toEqual([]);
    expect(count(fixed.tu, TRAP)).toBe(0);
  }, 240_000);
});
