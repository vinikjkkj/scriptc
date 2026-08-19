// gen-dyncheck-pop.mjs — generate a MUTATION population for the dyn->static
// boundary validator, derived from JavaScript's own [[Get]] / value-kind
// surface rather than from the emitter's source.
//
// The axes are JS facts, not scriptc facts:
//   PRODUCER  how the runtime value is BUILT (data, accessor, inherited,
//             non-enumerable, null-prototype, frozen, array-like, boxed,
//             sparse, numeric keys, unicode keys, __proto__ key)
//   TARGET    what `as T` claims it is
//   CONSUMER  what the program then does with it
//
// Each case is one try/catch printing a single line, so ONE compiled binary
// covers many cases and the whole file diffs byte-exact against Node.
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const outDir = process.argv[2];
if (!outDir) { console.error("usage: node gen-dyncheck-pop.mjs <outdir>"); process.exit(2); }
mkdirSync(outDir, { recursive: true });

// ---------------------------------------------------------------- producers
// Every producer returns `unknown` and is opaque to the checker: the value
// arrives through JSON.parse of a string the compiler cannot fold.
const producers = [
  { id: "data", why: "a plain parsed object", src: `JSON.parse(J)` },
  { id: "accessor", why: "a non-enumerable ACCESSOR own property", src: `withAccessor(JSON.parse(J), K, V)` },
  { id: "nonenum", why: "a non-enumerable DATA own property", src: `withHidden(JSON.parse(J), K, V)` },
  { id: "inherited", why: "the property lives on the PROTOTYPE", src: `withProto(JSON.parse(J))` },
  { id: "protoacc", why: "an ACCESSOR on the prototype", src: `withProto(withAccessor(JSON.parse(J), K, V))` },
];

// ---------------------------------------------------------------- targets
// (name, type text, how to observe the result in a way Node and scriptc must
// agree on byte for byte)
const targets = [
  { id: "string", ty: "string", obs: `String(x)` },
  { id: "number", ty: "number", obs: `String(x)` },
  { id: "boolean", ty: "boolean", obs: `String(x)` },
  { id: "recA", ty: "RA", obs: `x.a` },
  { id: "recAopt", ty: "RAopt", obs: `String(x.a)` },
  { id: "recAB", ty: "RAB", obs: `x.a + "/" + String(x.b)` },
  { id: "strArr", ty: "string[]", obs: `x.join(",")` },
  { id: "numArr", ty: "number[]", obs: `x.join(",")` },
  { id: "tuple", ty: "[string, number]", obs: `x[0] + "/" + String(x[1])` },
  { id: "unionSN", ty: "string | number", obs: `String(x)` },
  { id: "unionSnull", ty: "string | null", obs: `String(x)` },
  { id: "recIdx", ty: "RIdx", obs: `Object.keys(x).sort().join(",")` },
  { id: "recNest", ty: "RNest", obs: `x.n.a` },
];

// ---------------------------------------------------------------- payloads
// The JSON text a producer parses.  Each is a JS value kind the boundary must
// have an answer for.
const payloads = [
  { id: "objA", json: `{"a":"hi"}` },
  { id: "objAB", json: `{"a":"hi","b":7}` },
  { id: "objABx", json: `{"a":"hi","b":7,"zz":true}` },
  { id: "objEmpty", json: `{}` },
  { id: "objAnull", json: `{"a":null}` },
  { id: "objAnum", json: `{"a":5}` },
  { id: "objNest", json: `{"n":{"a":"deep"}}` },
  { id: "str", json: `"plain"` },
  { id: "num", json: `42` },
  { id: "numNeg0", json: `-0` },
  { id: "numBig", json: `1e308` },
  { id: "boolT", json: `true` },
  { id: "nul", json: `null` },
  { id: "arrS", json: `["p","q"]` },
  { id: "arrN", json: `[1,2]` },
  { id: "arrMixed", json: `["p",2]` },
  { id: "arrEmpty", json: `[]` },
  { id: "objProtoKey", json: `{"a":"hi","__proto__":{"b":1}}` },
  { id: "objUni", json: `{"\\u00e9":"acc","a":"hi"}` },
  { id: "objNumKey", json: `{"0":"zero","a":"hi"}` },
];


// ------------------------------------------------ oracle-derived MATCH label
// Does the runtime value ACTUALLY satisfy the target, under plain JavaScript
// semantics ([[Get]], typeof, Array.isArray)?  Computed here in Node, from the
// same producer/payload the program builds — never from the compiler.  A MATCH
// case that the compiled binary refuses is a divergence; a MISMATCH case that
// it refuses is the checked-cast stance working as designed.
const buildValue = (pid, json) => {
  const parse = () => JSON.parse(json);
  const withAcc = (o) => {
    if (o === null || typeof o !== "object" || Array.isArray(o)) return o;
    Object.defineProperty(o, "a", { get() { return "acc"; }, enumerable: false, configurable: true });
    return o;
  };
  const withHid = (o) => {
    if (o === null || typeof o !== "object" || Array.isArray(o)) return o;
    Object.defineProperty(o, "a", { value: "acc", enumerable: false, configurable: true, writable: true });
    return o;
  };
  switch (pid) {
    case "data": return parse();
    case "accessor": return withAcc(parse());
    case "nonenum": return withHid(parse());
    case "inherited": { const b = parse(); return (b !== null && typeof b === "object" && !Array.isArray(b)) ? Object.create(b) : b; }
    case "protoacc": { const b = withAcc(parse()); return (b !== null && typeof b === "object" && !Array.isArray(b)) ? Object.create(b) : b; }
    default: throw new Error(pid);
  }
};
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const matches = (v, tid) => {
  switch (tid) {
    case "string": return typeof v === "string";
    case "number": return typeof v === "number";
    case "boolean": return typeof v === "boolean";
    case "recA": return isObj(v) && typeof v.a === "string";
    case "recAopt": return isObj(v) && (v.a === undefined || typeof v.a === "string");
    case "recAB": return isObj(v) && typeof v.a === "string" && typeof v.b === "number";
    case "strArr": return Array.isArray(v) && v.every((e) => typeof e === "string");
    case "numArr": return Array.isArray(v) && v.every((e) => typeof e === "number");
    case "tuple": return Array.isArray(v) && v.length === 2 && typeof v[0] === "string" && typeof v[1] === "number";
    case "unionSN": return typeof v === "string" || typeof v === "number";
    case "unionSnull": return typeof v === "string" || v === null;
    case "recIdx": return isObj(v) && Object.keys(v).every((k) => typeof v[k] === "string");
    case "recNest": return isObj(v) && isObj(v.n) && typeof v.n.a === "string";
    default: throw new Error(tid);
  }
};

const header = `// GENERATED by gen-dyncheck-pop.mjs — do not edit by hand.
interface RA { a: string }
interface RAopt { a?: string }
interface RAB { a: string; b: number }
interface RIdx { [k: string]: string }
interface RNest { n: { a: string } }

function withAccessor(o: unknown, k: string, v: string): unknown {
  if (o === null || typeof o !== "object" || Array.isArray(o)) return o;
  Object.defineProperty(o as object, k, { get(): string { return v; }, enumerable: false, configurable: true });
  return o;
}
function withHidden(o: unknown, k: string, v: string): unknown {
  if (o === null || typeof o !== "object" || Array.isArray(o)) return o;
  Object.defineProperty(o as object, k, { value: v, enumerable: false, configurable: true, writable: true });
  return o;
}
function withProto(o: unknown): unknown {
  if (o === null || typeof o !== "object" || Array.isArray(o)) return o;
  return Object.create(o as object);
}
function show(label: string, f: () => string): void {
  try { console.log(label + " = " + f()); }
  catch (e) { console.log(label + " ! " + (e instanceof Error ? e.message : String(e))); }
}
`;

// One file per PRODUCER keeps each compiled binary small enough to build.
let n = 0;
const index = [];
for (const p of producers) {
  const body = [];
  body.push(`function main(): void {`);
  body.push(`  const K = "a";`);
  body.push(`  const V = "acc";`);
  for (const pay of payloads) {
    for (const t of targets) {
      const label = `${p.id}|${pay.id}|${t.id}`;
      body.push(`  {`);
      body.push(`    const J = ${JSON.stringify(pay.json)};`);
      body.push(`    const u: unknown = ${p.src};`);
      body.push(`    show(${JSON.stringify(label)}, (): string => { const x = u as ${t.ty}; return ${t.obs}; });`);
      body.push(`  }`);
      n++;
      let verdict = "MISMATCH";
      try { verdict = matches(buildValue(p.id, JSON.parse(JSON.stringify(pay.json))), t.id) ? "MATCH" : "MISMATCH"; }
      catch (err) { verdict = "ORACLE-THREW:" + String(err && err.message); }
      index.push(`${label}	${verdict}`);
    }
  }
  body.push(`}`);
  body.push(`main();`);
  writeFileSync(join(outDir, `pop-${p.id}.ts`), header + body.join("\n") + "\n", "utf8");
}
writeFileSync(join(outDir, "LABELS.txt"), index.join("\n") + "\n", "utf8");
console.log(`${producers.length} programs, ${n} cases`);
