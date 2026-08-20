/* gen-keyorder.mjs — generate the key-ORDER population.
 *
 * The oracle is Node: integer-like own keys ascending FIRST, then string keys
 * in INSERTION order. Every cell is (construction x boundary x surface):
 *   construction  how the value's real insertion order is made
 *   boundary      how that value reaches a dyn/`object`-typed place
 *   surface       what then enumerates it
 * Nothing here is copied from the compiler; the expected answer is whatever
 * Node prints. Usage: node gen-keyorder.mjs <outDir>
 */
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

/* ── constructions: each declares `interface W` and binds `const w: W`. ── */
export const CONSTRUCTIONS = {
  // the ORDER risk: spelled in an order the shape does not carry.
  order: {
    decl: `interface W { inner: number; middle: string; tag: boolean }`,
    make: `const w: W = { tag: true, inner: 1, middle: "m" };`,
  },
  // control: spelled IN declaration order. Must be EXACT everywhere.
  inorder: {
    decl: `interface W { inner: number; middle: string; tag: boolean }`,
    make: `const w: W = { inner: 1, middle: "m", tag: true };`,
  },
  // the SET risk: a width copy ends keys JS keeps.
  width: {
    decl: `interface Wide { inner: number; middle: string; tag: boolean; extra: string }\ninterface W { inner: number; middle: string; tag: boolean }`,
    make: `const wide: Wide = { inner: 1, middle: "m", tag: true, extra: "x" };\nconst w: W = wide;`,
  },
  // the DYN risk: materialised out of a dynamic value, source order unseen.
  dyn: {
    decl: `interface W { inner: number; middle: string; tag: boolean }`,
    make: `const w = JSON.parse('{"tag":true,"inner":1,"middle":"m"}') as W;`,
  },
  // integer-like keys BEFORE string keys, spelled last: Node hoists them.
  intmix: {
    decl: `interface W { "2": string; alpha: number; "10": string; beta: number }`,
    make: `const w: W = { beta: 4, "10": "ten", alpha: 3, "2": "two" };`,
  },
  // integer-like keys ONLY, spelled descending: Node sorts them ascending.
  intonly: {
    decl: `interface W { "1": string; "2": string; "10": string }`,
    make: `const w: W = { "10": "ten", "2": "two", "1": "one" };`,
  },
};

/* ── boundaries: each turns `w` into an `object`-typed place named `o`. ── */
export const BOUNDARIES = {
  // NOT a boundary: the value is enumerated at its own record type. This is
  // the row the compiler already refuses, and the control the widened rows
  // are measured against.
  direct: { pre: ``, expr: `w`, widened: false, ty: `W` },
  local: { pre: ``, expr: `(() => { const o: object = w; return o; })()`, widened: true },
  param: { pre: `function viaParam(o: object): object { return o; }`, expr: `viaParam(w)`, widened: true },
  ret: { pre: `function viaRet(): object { return w; }`, expr: `viaRet()`, widened: true },
  arrayElem: { pre: ``, expr: `([w] as object[])[0]!`, widened: true },
  recField: { pre: ``, expr: `({ v: w } as { v: object }).v`, widened: true },
  classField: {
    pre: `class Box { readonly v: object; constructor(v: object) { this.v = v; } }`,
    expr: `new Box(w).v`,
    widened: true,
  },
  mapValue: {
    pre: `function viaMap(x: object): object { const m = new Map<string, object>(); m.set("k", x); return m.get("k")!; }`,
    expr: `viaMap(w)`,
    widened: true,
  },
  nullableUnion: {
    pre: `function viaUnion(x: object): object { const u: object | null = x; if (u === null) throw new Error("no"); return u; }`,
    expr: `viaUnion(w)`,
    widened: true,
  },
  globalSlot: { pre: `const gSlot: object = w;`, expr: `gSlot`, widened: true, needsW: true },
};

/* ── surfaces: each reads `o` (typed `object`) and prints ONE line. ── */
export const SURFACES = {
  keys: `console.log(Object.keys(o).join(","));`,
  values: `console.log(JSON.stringify(Object.values(o)));`,
  entries: `console.log(JSON.stringify(Object.entries(o)));`,
  ownNames: `console.log(Object.getOwnPropertyNames(o).join(","));`,
  forIn: `let acc = ""; for (const k in o) { acc += k + ","; } console.log(acc);`,
  json: `console.log(JSON.stringify(o));`,
  assign: `console.log(JSON.stringify(Object.assign({}, o)));`,
  spread: `console.log(JSON.stringify({ ...o }));`,
  // Three more surfaces the first population missed entirely: the PRINTERS.
  // util.inspect walks the object's own keys too, so console.log of a value
  // is an enumeration of it, and `%j` is JSON.stringify wearing a format
  // specifier.
  log: `console.log(o);`,
  inspect: `console.log(inspect(o));`,
  fmtj: `console.log(format("%j", o));`,
};

const SURFACE_IMPORTS = {
  inspect: `import { inspect } from "node:util";`,
  fmtj: `import { format } from "node:util";`,
};

export function cellSource(cName, bName, sName) {
  const c = CONSTRUCTIONS[cName];
  const b = BOUNDARIES[bName];
  const s = SURFACES[sName];
  const parts = [`// ${cName} / ${bName} / ${sName}`];
  if (SURFACE_IMPORTS[sName]) parts.push(SURFACE_IMPORTS[sName]);
  parts.push(c.decl);
  const ty = b.ty ?? "object";
  if (b.needsW) {
    parts.push(c.make, b.pre, `const o: ${ty} = gSlot;`);
  } else {
    parts.push(b.pre, c.make, `const o: ${ty} = ${b.expr};`);
  }
  parts.push(s);
  return parts.filter((p) => p.length > 0).join("\n") + "\n";
}

export function cellNames() {
  const out = [];
  for (const c of Object.keys(CONSTRUCTIONS)) {
    for (const b of Object.keys(BOUNDARIES)) {
      for (const s of Object.keys(SURFACES)) out.push({ c, b, s, id: `${c}__${b}__${s}` });
    }
  }
  return out;
}

if (process.argv[1] && import.meta.url === (await import("node:url")).pathToFileURL(process.argv[1]).href) {
  const dir = process.argv[2];
  if (!dir) throw new Error("usage: gen-keyorder.mjs <outDir>");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  let n = 0;
  for (const { c, b, s, id } of cellNames()) {
    writeFileSync(join(dir, id + ".ts"), cellSource(c, b, s));
    n++;
  }
  console.log(`${n} cells in ${dir}`);
}
