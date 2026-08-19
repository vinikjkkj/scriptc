// mklab2.mjs <N> <outdir> — the two EXTRA arms that bound "what would the
// declaration's types buy if the compiler applied them to the JS body".
//
// Arm P: the SAME generated JS body, PRETTY-PRINTED (statement for
//        statement identical to arm A's minified text, only whitespace and
//        newlines differ). This is the INTERNAL CONTROL: a change that only
//        reformats the body must not move .text.
// Arm C: arm P plus JSDoc @param/@returns on every generated function,
//        naming exactly the types the .d.ts already declares for that
//        member. The compiler's JS frontend reads JSDoc (the --npm-static
//        doctrine's stated typing route), so arm C is the CEILING of any
//        declaration-driven typing of a JS body: it is the same body with
//        the declaration's types already applied, by hand, perfectly.
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
const N = Number(process.argv[2] ?? 40);
const OUT = process.argv[3];
const F = ["a", "b", "c", "d", "e", "f"];
rmSync(OUT, { recursive: true, force: true });
const names = Array.from({ length: N }, (_, i) => `Msg${i}`);

/* one message type's body, pretty-printed. `doc` decides whether the
 * declaration's types ride along as JSDoc. */
function body(n, doc) {
  const d = (s) => (doc ? s : "");
  return `P.${n} = function () {
  function C(p) {
    if (p) for (var k = Object.keys(p), i = 0; i < k.length; ++i) if (null != p[k[i]]) this[k[i]] = p[k[i]];
  }
${F.map((f) => `  C.prototype.${f} = 0;`).join("\n")}
${d(`  /**\n   * @param {{ ${F.map((f) => `${f}: number`).join("; ")} }} m\n   * @param {number[]} [w]\n   * @returns {number[]}\n   */\n`)}  C.encode = function (m, w) {
    if (!w) w = [];
${F.map((f, j) => `    if (null != m.${f}) w.push(${8 * (j + 1)}, m.${f});`).join("\n")}
    return w;
  };
${d(`  /**\n   * @param {{ pos: number, len: number, uint32(): number, skipType(t: number): void }} r\n   * @param {number} [l]\n   * @returns {{ ${F.map((f) => `${f}: number`).join("; ")} }}\n   */\n`)}  C.decode = function (r, l) {
    var m = new C(), e = void 0 === l ? r.len : r.pos + l;
    while (r.pos < e) {
      var t = r.uint32();
      switch (t >>> 3) {
${F.map((f, j) => `        case ${j + 1}: m.${f} = r.uint32(); break;`).join("\n")}
        default: r.skipType(7 & t);
      }
    }
    return m;
  };
${d(`  /**\n   * @param {{ ${F.map((f) => `${f}: number`).join("; ")} }} m\n   * @returns {string}\n   */\n`)}  C.verify = function (m) {
    if ("object" != typeof m || null === m) return "object expected";
${F.map((f) => `    if ("number" != typeof m.${f}) return "${f}: bad";`).join("\n")}
    return "ok";
  };
${d(`  /**\n   * @param {{ ${F.map((f) => `${f}: number`).join("; ")} }} o\n   * @returns {{ ${F.map((f) => `${f}: number`).join("; ")} }}\n   */\n`)}  C.fromObject = function (o) {
    var m = new C();
${F.map((f) => `    if (null != o.${f}) m.${f} = o.${f} | 0;`).join("\n")}
    return m;
  };
${d(`  /**\n   * @param {{ ${F.map((f) => `${f}: number`).join("; ")} }} m\n   * @returns {{ ${F.map((f) => `${f}: number`).join("; ")} }}\n   */\n`)}  C.toObject = function (m) {
    var o = new C();
${F.map((f) => `    o.${f} = m.${f} | 0;`).join("\n")}
    return o;
  };
  return C;
}();
`;
}

function jsOf(doc) {
  let js = '"use strict";\nvar P = {};\n';
  for (const n of names) js += body(n, doc);
  js += "module.exports = P;\n";
  return js;
}

let dts = `export interface PbR { pos: number; len: number; uint32(): number; skipType(t: number): void }\n`;
for (const n of names) {
  dts += `export class ${n} {\n` + F.map((f) => `\t${f}: number\n`).join("") +
    `\tstatic encode(m: ${n}.$Shape, w?: number[]): number[]\n` +
    `\tstatic decode(r: PbR, l?: number): ${n} & ${n}.$Shape\n` +
    `\tstatic verify(m: ${n}.$Shape): string\n` +
    `\tstatic fromObject(o: ${n}.$Shape): ${n} & ${n}.$Shape\n` +
    `\tstatic toObject(m: ${n}.$Shape): ${n}\n}\n` +
    `export namespace ${n} { interface $Shape { ${F.map((f) => `${f}: number`).join("; ")} } }\n`;
}

function driver(mod) {
  const lit = `{ ${F.map((f, j) => `${f}: ${j + 1}`).join(", ")} }`;
  let s = `import { ${names.join(", ")} } from "${mod}";\n` +
    `import type { PbR } from "${mod}";\n\n` +
    `const r: PbR = { pos: 0, len: 0, uint32(): number { return 0; }, skipType(_t: number): void {} };\n` +
    `let acc = 0;\nlet tag = "";\n`;
  for (const n of names) {
    s += `acc += ${n}.encode(${lit}).length;\n` +
      `acc += ${n}.decode(r, 0).a;\n` +
      `acc += ${n}.toObject(${n}.fromObject(${lit})).c;\n` +
      `tag += ${n}.verify(${lit});\n`;
  }
  s += `console.log("acc=" + acc + " tag=" + tag.length);\n`;
  return s;
}

const pkg = JSON.stringify({ name: "pbprobe", version: "1.0.0", type: "module",
  exports: { ".": { types: "./dist/index.d.ts", default: "./dist/index.js" } } }, null, 2) + "\n";
const manifest = JSON.stringify({ packages: { pbprobe: { dir: "./attested/pbprobe",
  commit: "2222222222222222222222222222222222222222", repo: "https://github.com/example/pbprobe" } } }, null, 2) + "\n";

function scaffold(root, name, js) {
  mkdirSync(root + "/attested/pbprobe/spec/proto", { recursive: true });
  mkdirSync(root + "/attested/pbprobe/src", { recursive: true });
  mkdirSync(root + "/node_modules/pbprobe/dist", { recursive: true });
  mkdirSync(root + "/case", { recursive: true });
  writeFileSync(root + "/attested/pbprobe/package.json", pkg);
  writeFileSync(root + "/node_modules/pbprobe/package.json", pkg);
  writeFileSync(root + "/node_modules/pbprobe/dist/index.d.ts", "export declare const unused: number;\n");
  writeFileSync(root + "/node_modules/pbprobe/dist/index.js", "export const unused = 0;\n");
  writeFileSync(root + "/attested/pbprobe/spec/proto/index.js", js);
  writeFileSync(root + "/attested/pbprobe/spec/proto/index.d.ts", dts);
  writeFileSync(root + "/attested/pbprobe/src/index.ts",
    `export { ${names.join(", ")} } from "../spec/proto/index.js";\nexport type { PbR } from "../spec/proto/index.js";\n`);
  writeFileSync(root + "/case/main.ts", driver("pbprobe"));
  writeFileSync(root + "/manifest.json", manifest);
  writeFileSync(root + "/package.json",
    JSON.stringify({ name, version: "1.0.0", private: true }, null, 2) + "\n");
}

scaffold(OUT + "/P", "probe-p", jsOf(false));
scaffold(OUT + "/C", "probe-c", jsOf(true));
console.log(`N=${N} jsP=${jsOf(false).length} jsC=${jsOf(true).length}`);
