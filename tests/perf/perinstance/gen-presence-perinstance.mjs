/* gen-presence-perinstance.mjs -- the key-PRESENCE population.
 *
 * The oracle is Node: an own property exists once it has been ASSIGNED,
 * whatever value it holds. `{a: 1}` has no `b`; `{a: 1, b: undefined}` has
 * one, and it enumerates, JSON-skips, and answers hasOwn/in as such.
 * Nothing here is read off the compiler: the constructions are the ways JS
 * lets a key be present or absent, the boundaries are the ways a value
 * reaches an `object`-typed place, the surfaces are what asks.
 * usage: node gen-presence-perinstance.mjs <outDir>
 */
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const DECL = `interface W { a?: number; b?: number; c?: number }`;

export const CONSTRUCTIONS = {
  // every key written: the control. Must be EXACT everywhere, always.
  allpresent: `const w: W = { a: 1, b: 2, c: 3 };`,
  // keys simply not written: Node has no such property.
  omit:       `const w: W = { a: 1 };`,
  // the RESIDUE: written, and written `undefined`. Node KEEPS the key.
  explicit:   `const w: W = { a: 1, b: undefined, c: 3 };`,
  // the same, at the front and the back, so a one-position rule cannot pass.
  explicitAll:`const w: W = { a: undefined, b: undefined, c: undefined };`,
  // presence decided at RUN TIME by a conditional spread.
  condTrue:   `const flag = process.argv.length >= 0;\nconst w: W = { a: 1, ...(flag ? { b: 2 } : {}) };`,
  condFalse:  `const flag = process.argv.length < 0;\nconst w: W = { a: 1, ...(flag ? { b: 2 } : {}) };`,
};

export const BOUNDARIES = {
  direct:    { pre: ``, expr: `w`, ty: `W` },
  param:     { pre: `function viaParam(o: object): object { return o; }`, expr: `viaParam(w)` },
  ret:       { pre: `function viaRet(): object { return w; }`, expr: `viaRet()` },
  arrayElem: { pre: ``, expr: `([w] as object[])[0]!` },
  recField:  { pre: ``, expr: `({ v: w } as { v: object }).v` },
};

export const SURFACES = {
  keys:     `console.log(Object.keys(o).join(","));`,
  ownNames: `console.log(Object.getOwnPropertyNames(o).join(","));`,
  hasOwn:   `console.log(Object.hasOwn(o, "a"), Object.hasOwn(o, "b"), Object.hasOwn(o, "c"));`,
  inOp:     `console.log("a" in o, "b" in o, "c" in o);`,
  forIn:    `let acc = ""; for (const k in o) { acc += k + ","; } console.log(acc);`,
  json:     `console.log(JSON.stringify(o));`,
  assign:   `console.log(JSON.stringify(Object.assign({}, o)));`,
  spread:   `console.log(JSON.stringify({ ...o }));`,
};

export function cellSource(cName, bName, sName) {
  const b = BOUNDARIES[bName];
  const parts = [`// ${cName} / ${bName} / ${sName}`, DECL];
  if (b.pre.length > 0) parts.push(b.pre);
  parts.push(CONSTRUCTIONS[cName], `const o: ${b.ty ?? "object"} = ${b.expr};`, SURFACES[sName]);
  return parts.join("\n") + "\n";
}

export function cellNames() {
  const out = [];
  for (const c of Object.keys(CONSTRUCTIONS))
    for (const bn of Object.keys(BOUNDARIES))
      for (const s of Object.keys(SURFACES)) out.push({ c, b: bn, s, id: `${c}__${bn}__${s}` });
  return out;
}

if (process.argv[1] && import.meta.url === (await import("node:url")).pathToFileURL(process.argv[1]).href) {
  const dir = process.argv[2];
  if (!dir) throw new Error("usage: gen-presence-perinstance.mjs <outDir>");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  let n = 0;
  for (const { c, b, s, id } of cellNames()) { writeFileSync(join(dir, id + ".ts"), cellSource(c, b, s)); n++; }
  console.log(`${n} cells in ${dir}`);
}
