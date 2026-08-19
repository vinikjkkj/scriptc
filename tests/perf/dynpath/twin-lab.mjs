// mklab.mjs <N> <outdir> — builds the two-arm probe lab.
//
// Arm A: a provenance package whose spec/proto/index.d.ts has a compiled
//        index.js TWIN — zapo's waproto shape EXACTLY (provenanceDeclSiblings
//        makes the .js a program root, declTwinOf puts it in module order
//        ahead of its declaration).
// Arm B: the SAME package, the SAME logic, written as typed TypeScript.
//
// Both arms drive the SAME entry statements against the SAME declared
// surface, so the only difference in the emitted program is how the
// MODULE'S OWN BODY was typed. That is the apples-to-apples the 11.7x
// per-procedure ratio in estado-imagesize.md is not.
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
const N = Number(process.argv[2] ?? 40);
const OUT = process.argv[3];
const F = ["a", "b", "c", "d", "e", "f"];
rmSync(OUT, { recursive: true, force: true });

const names = Array.from({ length: N }, (_, i) => `Msg${i}`);

/* ---------------- the module BODY, two spellings ---------------- */
// minified CJS, protobufjs-generated shape
let js = '"use strict";var P={};\n';
for (const n of names) {
  js += `P.${n}=function(){function C(p){if(p)for(var k=Object.keys(p),i=0;i<k.length;++i)if(null!=p[k[i]])this[k[i]]=p[k[i]]}` +
    F.map((f) => `C.prototype.${f}=0;`).join("") +
    `C.encode=function(m,w){if(!w)w=[];` +
    F.map((f, j) => `if(null!=m.${f})w.push(${8 * (j + 1)},m.${f});`).join("") +
    `return w};` +
    `C.decode=function(r,l){var m=new C(),e=void 0===l?r.len:r.pos+l;while(r.pos<e){var t=r.uint32();switch(t>>>3){` +
    F.map((f, j) => `case ${j + 1}:m.${f}=r.uint32();break;`).join("") +
    `default:r.skipType(7&t)}}return m};` +
    `C.verify=function(m){if("object"!=typeof m||null===m)return"object expected";` +
    F.map((f) => `if("number"!=typeof m.${f})return"${f}: bad";`).join("") +
    `return"ok"};` +
    `C.fromObject=function(o){var m=new C();` +
    F.map((f) => `if(null!=o.${f})m.${f}=o.${f}|0;`).join("") +
    `return m};` +
    `C.toObject=function(m){var o=new C();` +
    F.map((f) => `o.${f}=m.${f}|0;`).join("") +
    `return o};` +
    `return C}();\n`;
}
js += "module.exports=P;\n";

// the .d.ts twin: the generator's own surface, $Shape intersection included
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

// the SAME logic, typed TypeScript
let tsmod = `export interface PbR { pos: number; len: number; uint32(): number; skipType(t: number): void }\n`;
for (const n of names) {
  tsmod += `export interface ${n}Shape { ${F.map((f) => `${f}: number`).join("; ")} }\n`;
  tsmod += `export class ${n} {\n` + F.map((f) => `\t${f} = 0;\n`).join("") +
    `\tstatic encode(m: ${n}Shape, w0?: number[]): number[] {\n\t\tconst w = w0 ?? [];\n` +
    F.map((f, j) => `\t\tw.push(${8 * (j + 1)}); w.push(m.${f});\n`).join("") +
    `\t\treturn w;\n\t}\n` +
    `\tstatic decode(r: PbR, l?: number): ${n} {\n\t\tconst m = new ${n}();\n\t\tconst e = l === undefined ? r.len : r.pos + l;\n` +
    `\t\twhile (r.pos < e) {\n\t\t\tconst t = r.uint32();\n\t\t\tswitch (t >>> 3) {\n` +
    F.map((f, j) => `\t\t\t\tcase ${j + 1}: m.${f} = r.uint32(); break;\n`).join("") +
    `\t\t\t\tdefault: r.skipType(7 & t);\n\t\t\t}\n\t\t}\n\t\treturn m;\n\t}\n` +
    `\tstatic verify(m: ${n}Shape): string {\n` +
    F.map((f) => `\t\tif (!Number.isFinite(m.${f})) return "${f}: bad";\n`).join("") +
    `\t\treturn "ok";\n\t}\n` +
    `\tstatic fromObject(o: ${n}Shape): ${n} {\n\t\tconst m = new ${n}();\n` +
    F.map((f) => `\t\tm.${f} = o.${f} | 0;\n`).join("") +
    `\t\treturn m;\n\t}\n` +
    `\tstatic toObject(m: ${n}Shape): ${n} {\n\t\tconst o = new ${n}();\n` +
    F.map((f) => `\t\to.${f} = m.${f} | 0;\n`).join("") +
    `\t\treturn o;\n\t}\n}\n`;
}

/* the entry statements, IDENTICAL in both arms up to the import specifier */
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

function scaffold(root, name) {
  mkdirSync(root + "/attested/pbprobe/spec/proto", { recursive: true });
  mkdirSync(root + "/attested/pbprobe/src", { recursive: true });
  mkdirSync(root + "/node_modules/pbprobe/dist", { recursive: true });
  mkdirSync(root + "/case", { recursive: true });
  writeFileSync(root + "/attested/pbprobe/package.json", pkg);
  writeFileSync(root + "/node_modules/pbprobe/package.json", pkg);
  writeFileSync(root + "/node_modules/pbprobe/dist/index.d.ts", "export declare const unused: number;\n");
  writeFileSync(root + "/node_modules/pbprobe/dist/index.js", "export const unused = 0;\n");
  writeFileSync(root + "/attested/pbprobe/src/index.ts",
    `export { ${names.join(", ")} } from "../spec/proto/index.js";\nexport type { PbR } from "../spec/proto/index.js";\n`);
  writeFileSync(root + "/case/main.ts", driver("pbprobe"));
  writeFileSync(root + "/manifest.json", manifest);
  writeFileSync(root + "/package.json",
    JSON.stringify({ name, version: "1.0.0", private: true }, null, 2) + "\n");
}

/* ---------------- arm A: the provenance .d.ts + .js TWIN ---------------- */
scaffold(OUT + "/A", "probe-a");
writeFileSync(OUT + "/A/attested/pbprobe/spec/proto/index.js", js);
writeFileSync(OUT + "/A/attested/pbprobe/spec/proto/index.d.ts", dts);

/* ---------------- arm B: the same package, typed source ---------------- */
scaffold(OUT + "/B", "probe-b");
writeFileSync(OUT + "/B/attested/pbprobe/spec/proto/index.ts", tsmod);

/* ---------------- the NODE oracle: run the JS body directly ------------- */
mkdirSync(OUT + "/oracle", { recursive: true });
writeFileSync(OUT + "/oracle/pbmod.cjs", js);
writeFileSync(OUT + "/oracle/run.mjs",
  `import { createRequire } from "node:module";\n` +
  `const P = createRequire(import.meta.url)("./pbmod.cjs");\n` +
  `const r = { pos: 0, len: 0, uint32() { return 0; }, skipType(_t) {} };\n` +
  `const lit = { ${F.map((f, j) => `${f}: ${j + 1}`).join(", ")} };\n` +
  `let acc = 0, tag = "";\n` +
  `for (const n of ${JSON.stringify(names)}) {\n` +
  `  acc += P[n].encode(lit).length;\n` +
  `  acc += P[n].decode(r, 0).a;\n` +
  `  acc += P[n].toObject(P[n].fromObject(lit)).c;\n` +
  `  tag += P[n].verify(lit);\n` +
  `}\n` +
  `console.log("acc=" + acc + " tag=" + tag.length);\n`);

console.log(`N=${N} js=${js.length} dts=${dts.length} ts=${tsmod.length}`);
