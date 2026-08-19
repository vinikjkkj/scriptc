/**
 * twin-lab-real-jsdocarm.mjs <N> <outdir> - the two arms the four-arm lab
 * does not have: the REAL generated shape.
 *
 * `tests/perf/dynpath/twin-lab*.mjs` build a body that a declaration can
 * describe completely, and arm C then types it perfectly. zapo's actual
 * `spec/proto/index.js` is not that body. Measured over its real 1,923
 * members (tests/perf/jsdocarm/hazard-jsdocarm.mjs):
 *
 *   1,282 of 1,923 take parameters the `.d.ts` does not declare
 *   3,561 writes name a property that appears nowhere in the `.d.ts`
 *   3,564 per-instance presence tests (`Object.hasOwnProperty.call`)
 *     642 dynamic property creations (`util.makeProp`)
 *   2,925 oneOf getter/setter installs, whose SETTER DELETES its siblings
 *     644 property writes whose key is computed at run time
 *
 * So this lab writes the SAME four-arm structure over a body that has all
 * six, in the same proportions protobufjs generates them:
 *
 *   R    the real-shape minified JS + its `.d.ts` twin   (today's shipped path)
 *   RP   the SAME JS, pretty-printed                     (the INTERNAL CONTROL)
 *   RC   RP + JSDoc carrying exactly what the `.d.ts` declares, and NOTHING
 *        it does not - what a compiler deriving JSDoc from a declaration
 *        could actually write
 *   RX   RC plus a hand-INVENTED type for every parameter the declaration
 *        does not mention - no compiler can derive these, so RX is the
 *        ceiling, not a candidate
 *   RB   the same logic as typed TypeScript                (the floor)
 *
 * Arm RB is written to be SEMANTICALLY the same, not structurally: a
 * typed source cannot have a oneOf setter that deletes siblings, so it
 * does the deletion explicitly. Every arm is checked against a Node oracle
 * that requires the JS body directly, and the oracle's answer depends on
 * the oneOf deletion, on `$unknowns` and on the per-instance presence
 * tests - so an arm that gets any of them wrong prints a different number.
 *
 * Usage: node twin-lab-real-jsdocarm.mjs <N> <outdir>
 */
import { writeFileSync, mkdirSync, rmSync } from "node:fs";

const N = Number(process.argv[2] ?? 8);
const OUT = process.argv[3];
if (!OUT) { console.error("usage: twin-lab-real-jsdocarm.mjs <N> <outdir>"); process.exit(2); }
const F = ["a", "b", "c", "d", "e", "f"];
const ONEOF = ["a", "b"];          /* one oneof group, as protobufjs generates */
const names = Array.from({ length: N }, (_, i) => `Msg${i}`);

/* protobufjs's own three helpers, verbatim in behaviour. The setter
 * DELETING its siblings is the whole reason this lab exists. */
const UTIL = `var U = {
  oneOfGetter: function (fieldNames) {
    var fieldMap = {};
    for (var i = 0; i < fieldNames.length; ++i) fieldMap[fieldNames[i]] = 1;
    return function () {
      for (var keys = Object.keys(this), i = keys.length - 1; i > -1; --i)
        if (fieldMap[keys[i]] === 1 && this[keys[i]] !== undefined && this[keys[i]] !== null) return keys[i];
    };
  },
  oneOfSetter: function (fieldNames) {
    return function (name) {
      for (var i = 0; i < fieldNames.length; ++i) if (fieldNames[i] !== name) delete this[fieldNames[i]];
    };
  },
  makeProp: function (target, key, enumerable) {
    if (!Object.prototype.hasOwnProperty.call(target, key))
      Object.defineProperty(target, key, { enumerable: enumerable === undefined || enumerable, configurable: true, writable: true });
  }
};
`;

/** one message type, the real generated shape. `doc` adds the JSDoc that
 * carries exactly what the .d.ts declares - the DECLARED parameters only,
 * because the declaration says nothing about the others. */
function body(n, doc) {
  const props = `{ ${F.map((f) => `${f}?: number`).join("; ")}; $unknowns?: number[] }`;
  const d = (s) => (doc === "none" ? "" : s);
  /* The declaration declares TWO parameters for encode and decode. The
   * body takes three and five. `doc === "declared"` writes only what the
   * declaration says, which is what a compiler deriving JSDoc from the
   * `.d.ts` could write; `doc === "invented"` adds a type for each
   * parameter the declaration does not mention, which no compiler can
   * derive and which is therefore the CEILING, not a candidate. */
  const x = (s) => (doc === "invented" ? s : "");
  return `P.${n} = function () {
  function C(p) {
    if (p) for (var k = Object.keys(p), i = 0; i < k.length; ++i)
      if (null != p[k[i]] && "__proto__" !== k[i]) this[k[i]] = p[k[i]];
  }
  var o;
${F.map((f) => `  C.prototype.${f} = null;`).join("\n")}
  Object.defineProperty(C.prototype, "_${ONEOF[0]}", { get: U.oneOfGetter(o = ${JSON.stringify(ONEOF)}), set: U.oneOfSetter(o) });
${d(`  /**\n   * @param {${props}} m\n   * @param {number[]} [w]\n${x(`   * @param {number} [dep]\n`)}   * @returns {number[]}\n   */\n`)}  C.encode = function (m, w, dep) {
    if (!w) w = [];
    if (void 0 === dep) dep = 0;
    if (dep > 64) throw Error("max depth exceeded");
${F.map((f, j) => `    if (null != m.${f} && Object.hasOwnProperty.call(m, "${f}")) w.push(${8 * (j + 1)}, m.${f});`).join("\n")}
    if (null != m.$unknowns && Object.hasOwnProperty.call(m, "$unknowns"))
      for (var u = 0; u < m.$unknowns.length; ++u) w.push(m.$unknowns[u]);
    return w;
  };
${d(`  /**\n   * @param {{ pos: number, len: number, uint32(): number, skipType(t: number): void }} r\n   * @param {number} [l]\n${x(`   * @param {number} [grp]\n   * @param {number} [dep]\n   * @param {${props}} [into]\n`)}   * @returns {${props}}\n   */\n`)}  C.decode = function (r, l, grp, dep, into) {
    if (void 0 === dep) dep = 0;
    var e = void 0 === l ? r.len : r.pos + l;
    var m = into || new C();
    while (r.pos < e) {
      var t = r.uint32();
      if (t === grp) { grp = void 0; break; }
      switch (t >>> 3) {
${F.map((f, j) => `        case ${j + 1}: m.${f} = r.uint32(); ${ONEOF.includes(f) ? `m._${ONEOF[0]} = "${f}"; ` : ""}continue;`).join("\n")}
      }
      r.skipType(7 & t);
      U.makeProp(m, "$unknowns", false);
      (m.$unknowns || (m.$unknowns = [])).push(t);
    }
    return m;
  };
  return C;
}();
`;
}

function jsOf(doc) {
  let js = '"use strict";\n' + UTIL + "var P = {};\n";
  for (const n of names) js += body(n, doc);
  js += "module.exports = P;\n";
  return js;
}

/* arm R is arm RP minified the way esbuild+terser minify: statements
 * joined, whitespace gone. Same statements, so R vs RP is the CONTROL. */
function minify(src) {
  return src
    .split("\n")
    .map((l) => l.replace(/^\s+/, "").replace(/\s+$/, ""))
    .filter((l) => l.length > 0)
    .join("")
    .replace(/;\}/g, "}")
    .replace(/\)\{/g, "){");
}

/* the typed-TypeScript floor. It cannot install a prototype setter that
 * deletes siblings, so it deletes them where the setter would have. */
function tsOf() {
  let s = `export interface PbR { pos: number; len: number; uint32(): number; skipType(t: number): void }\n`;
  for (const n of names) {
    s += `export interface ${n}Props { ${F.map((f) => `${f}?: number`).join("; ")}; $unknowns?: number[] }\n`;
    s += `export class ${n} {\n`;
    for (const f of F) s += `\t${f}?: number;\n`;
    s += `\t$unknowns?: number[];\n`;
    s += `\tstatic encode(m: ${n}Props, w?: number[]): number[] {\n` +
      `\t\tif (!w) w = [];\n` +
      F.map((f, j) => `\t\tif (m.${f} !== undefined && m.${f} !== null) w.push(${8 * (j + 1)}, m.${f});`).join("\n") + "\n" +
      `\t\tconst u = m.$unknowns;\n\t\tif (u !== undefined && u !== null) for (let i = 0; i < u.length; i++) w.push(u[i]);\n` +
      `\t\treturn w;\n\t}\n`;
    s += `\tstatic decode(r: PbR, l?: number): ${n}Props {\n` +
      `\t\tconst end = l === undefined ? r.len : r.pos + l;\n` +
      `\t\tconst m: ${n}Props = {};\n` +
      `\t\twhile (r.pos < end) {\n\t\t\tconst t = r.uint32();\n\t\t\tconst fld = t >>> 3;\n` +
      F.map((f, j) => `\t\t\tif (fld === ${j + 1}) { m.${f} = r.uint32();${ONEOF.includes(f) ? ONEOF.filter((x) => x !== f).map((x) => ` m.${x} = undefined;`).join("") : ""} continue; }`).join("\n") + "\n" +
      `\t\t\tr.skipType(7 & t);\n\t\t\tif (m.$unknowns === undefined) m.$unknowns = [];\n\t\t\tm.$unknowns.push(t);\n\t\t}\n` +
      `\t\treturn m;\n\t}\n`;
    s += `}\n`;
  }
  return s;
}

/* the declaration - what the real waproto `.d.ts` declares, at the same
 * arity: encode(m, w?) and decode(r, l?), never the extra parameters. */
let dts = `export interface PbR { pos: number; len: number; uint32(): number; skipType(t: number): void }\n`;
for (const n of names) {
  dts += `export class ${n} {\n` +
    `\tconstructor(p?: ${n}.$Properties)\n` +
    F.map((f) => `\t${f}?: (number|null)\n`).join("") +
    `\t$unknowns?: number[]\n` +
    `\tstatic encode(m: ${n}.$Properties, w?: number[]): number[]\n` +
    `\tstatic decode(r: PbR, l?: number): ${n} & ${n}.$Shape\n}\n` +
    `export namespace ${n} { interface $Properties { ${F.map((f) => `${f}?: (number|null)`).join("; ")}; $unknowns?: number[] }\n` +
    `  type $Shape = ${n}.$Properties }\n`;
}

/* The driver reads ONLY the declared surface, and every number it prints
 * depends on a semantic the declaration does not describe:
 *   - `dec.a` is absent because the oneOf setter deleted it when `b` came in
 *   - `$unknowns` was created by makeProp and rides back out through encode
 *   - encode's field gate is a PER-INSTANCE presence test
 */
function driver(mod, typed) {
  /* The reader is a RECORD, not a class instance: a class instance
   * crossing into an interface-typed slot takes scriptc's width-COPY
   * stance (docs/limitations, "structural width subtyping copies"), and
   * this lab is not measuring that. A record literal whose methods
   * advance `r.pos` through the outer binding aliases exactly as Node
   * does, on both backends - verified before this lab was built. */
  let s = `import { ${names.join(", ")} } from "${mod}";\n` +
    `import type { PbR } from "${mod}";\n\n` +
    `const W: number[] = [8, 11, 16, 22, 63, 99];\n` +
    `const r: PbR = {\n` +
    `  pos: 0,\n  len: 6,\n` +
    `  uint32(): number { const v = W[r.pos]; r.pos = r.pos + 1; return v; },\n` +
    `  skipType(_t: number): void { r.pos = r.pos + 1; },\n};\n` +
    `let acc = 0;\nlet present = 0;\n`;
  for (const n of names) {
    /* tags: field a (1<<3=8), field b (2<<3=16), then an unknown tag 63 */
    s += `{\n` +
      `  r.pos = 0;\n` +
      `  const dec = ${n}.decode(r);\n` +
      `  const back = ${n}.encode(dec);\n` +
      `  acc += back.length;\n` +
      `  for (let i = 0; i < back.length; i++) acc += back[i];\n` +
      `  if (dec.a !== undefined && dec.a !== null) present += 1;\n` +
      `  if (dec.b !== undefined && dec.b !== null) present += 2;\n` +
      `}\n`;
  }
  s += `console.log("acc=" + acc + " present=" + present);\n`;
  void typed;
  return s;
}

const pkg = JSON.stringify({
  name: "pbprobe", version: "1.0.0", type: "module",
  exports: { ".": { types: "./dist/index.d.ts", default: "./dist/index.js" } },
}, null, 2) + "\n";
const manifest = JSON.stringify({
  packages: { pbprobe: { dir: "./attested/pbprobe",
    commit: "3333333333333333333333333333333333333333", repo: "https://github.com/example/pbprobe" } },
}, null, 2) + "\n";

function scaffold(root, name, opts) {
  mkdirSync(root + "/attested/pbprobe/spec/proto", { recursive: true });
  mkdirSync(root + "/attested/pbprobe/src", { recursive: true });
  mkdirSync(root + "/node_modules/pbprobe/dist", { recursive: true });
  mkdirSync(root + "/case", { recursive: true });
  writeFileSync(root + "/attested/pbprobe/package.json", pkg);
  writeFileSync(root + "/node_modules/pbprobe/package.json", pkg);
  writeFileSync(root + "/node_modules/pbprobe/dist/index.d.ts", "export declare const unused: number;\n");
  writeFileSync(root + "/node_modules/pbprobe/dist/index.js", "export const unused = 0;\n");
  if (opts.ts) {
    writeFileSync(root + "/attested/pbprobe/spec/proto/index.ts", tsOf());
    writeFileSync(root + "/attested/pbprobe/src/index.ts",
      `export { ${names.join(", ")} } from "../spec/proto/index.js";\nexport type { PbR } from "../spec/proto/index.js";\n`);
  } else {
    writeFileSync(root + "/attested/pbprobe/spec/proto/index.js", opts.js);
    writeFileSync(root + "/attested/pbprobe/spec/proto/index.d.ts", dts);
    writeFileSync(root + "/attested/pbprobe/src/index.ts",
      `export { ${names.join(", ")} } from "../spec/proto/index.js";\nexport type { PbR } from "../spec/proto/index.js";\n`);
  }
  writeFileSync(root + "/case/main.ts", driver("pbprobe", !!opts.ts));
  writeFileSync(root + "/manifest.json", manifest);
  writeFileSync(root + "/package.json", JSON.stringify({ name, version: "1.0.0", private: true }, null, 2) + "\n");
}

rmSync(OUT, { recursive: true, force: true });
const pretty = jsOf("none");
const prettyDoc = jsOf("declared");
const prettyDocX = jsOf("invented");
scaffold(OUT + "/R", "probe-r", { js: minify(pretty) });
scaffold(OUT + "/RP", "probe-rp", { js: pretty });
scaffold(OUT + "/RC", "probe-rc", { js: prettyDoc });
scaffold(OUT + "/RX", "probe-rx", { js: prettyDocX });
scaffold(OUT + "/RB", "probe-rb", { ts: true });

/* the Node oracle: it requires the JS body directly, so its answer is the
 * real protobufjs semantics and nothing else. */
mkdirSync(OUT + "/oracle", { recursive: true });
writeFileSync(OUT + "/oracle/pbmod.cjs", pretty);
writeFileSync(OUT + "/oracle/run.mjs",
  `import { createRequire } from "node:module";\n` +
  `const P = createRequire(import.meta.url)("./pbmod.cjs");\n` +
  `class R { constructor(w) { this.w = w; this.pos = 0; this.len = w.length; }\n` +
  `  uint32() { return this.w[this.pos++]; }\n  skipType(_t) { this.pos++; } }\n` +
  `let acc = 0, present = 0;\n` +
  `for (const n of ${JSON.stringify(names)}) {\n` +
  `  const r = new R([8, 11, 16, 22, 63, 99]);\n` +
  `  const dec = P[n].decode(r);\n` +
  `  const back = P[n].encode(dec);\n` +
  `  acc += back.length;\n` +
  `  for (let i = 0; i < back.length; i++) acc += back[i];\n` +
  `  if (dec.a !== undefined && dec.a !== null) present += 1;\n` +
  `  if (dec.b !== undefined && dec.b !== null) present += 2;\n` +
  `}\n` +
  `console.log("acc=" + acc + " present=" + present);\n`);

console.log(`N=${N} R=${minify(pretty).length} RP=${pretty.length} RC=${prettyDoc.length} RX=${prettyDocX.length} RB=${tsOf().length}`);
