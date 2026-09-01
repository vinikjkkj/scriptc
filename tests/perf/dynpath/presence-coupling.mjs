// presence-coupling.mjs — the assumption a decode-only static shape rests on,
// executed against the real bundle rather than argued about.
//
// decode-shape.mjs establishes that encode decides the wire with
// `null != e.f && hasOwnProperty(e,"f")`. A decode-produced message is an encode
// input, so ANY static shape for decode must leave a decoded message answering
// those two tests exactly as it does today. This runs that.
//
// The headline it exists to record: the NULL CHECK COMES FIRST. So a shape whose
// field slots default to null stays byte-exact even though a struct makes every
// field an own property and hasOwnProperty becomes universally true. A shape whose
// slots default to 0 / false / "" does not.
//
// Usage: node presence-coupling.mjs [bundle.js]
// Exits non-zero if any check fails.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { existsSync, statSync, readFileSync } from "node:fs";
import path from "node:path";

const BUNDLE = process.argv[2] ?? process.env["WAPROTO_JS"] ?? null;
if (BUNDLE === null) {
  console.error("usage: node presence-coupling.mjs <bundle.js>");
  process.exit(2);
}

/* typescript resolves from this repo; a worktree has no node_modules of its own,
 * so fall back to the MAIN worktree via the .git pointer file. */
const ts = (() => {
  const upward = (from) => {
    let dir = from;
    for (;;) {
      const cand = path.join(dir, "node_modules", "typescript", "package.json");
      if (existsSync(cand)) return createRequire(cand)("typescript");
      const up = path.dirname(dir);
      if (up === dir) return null;
      dir = up;
    }
  };
  const here = path.dirname(fileURLToPath(import.meta.url));
  let got = upward(here) ?? upward(process.cwd());
  if (got !== null) return got;
  let dir = here;
  for (;;) {
    const dot = path.join(dir, ".git");
    if (existsSync(dot) && statSync(dot).isFile()) {
      const m = /gitdir:\s*(.+)/.exec(readFileSync(dot, "utf8"));
      if (m !== null) {
        const gd = m[1].trim();
        const i = gd.lastIndexOf(path.sep + ".git" + path.sep);
        const main = i >= 0 ? gd.slice(0, i) : path.dirname(path.dirname(gd));
        got = upward(main);
        if (got !== null) return got;
      }
      break;
    }
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
})();
if (ts === null) { console.error("no typescript resolvable from this tree"); process.exit(2); }

const q = createRequire(import.meta.url)(path.resolve(BUNDLE)).waproto;
let fails = 0, checks = 0;
const ok = (name, cond, detail) => {
  checks++;
  if (!cond) { fails++; console.log("  FAIL  " + name + (detail ? "   " + detail : "")); }
  else console.log("  ok    " + name + (detail ? "   " + detail : ""));
};
const hex = (u) => Buffer.from(u).toString("hex");
const eq = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;

console.log("node " + process.version);

/* ---------------- part 1: one message, every observable ---------------- */
console.log("\n[1] a PARTIAL message: which fields are own after decode?");
const M = q.ADVDeviceIdentity;   // rawId, timestamp, keyIndex, accountType, deviceType
const wire = M.encode({ rawId: 5 }).finish();
console.log("    encode({rawId:5}) -> " + hex(wire));
const d = M.decode(wire);
for (const f of ["rawId", "timestamp", "keyIndex", "accountType", "deviceType"]) {
  const own = Object.prototype.hasOwnProperty.call(d, f);
  ok("hasOwnProperty(" + f + ") === " + (f === "rawId"), own === (f === "rawId"), "got " + own);
}
console.log("    Object.keys(decoded) = " + JSON.stringify(Object.keys(d)));

console.log("\n[2] THE COUPLING: re-encode a decoded partial message");
ok("re-encode is byte-identical", eq(wire, M.encode(d).finish()), hex(wire));

console.log("\n[3] $unknowns is defined NON-ENUMERABLE by makeProp");
// field 99, wiretype 0 -> tag 792 -> varint 0x98 0x06, then the value.
// NOTE: [99<<3, 7] truncates to 0x18, which is field 3 -- a KNOWN field. That
// mistake makes this whole section pass vacuously; do not "simplify" it back.
const unk = Buffer.concat([Buffer.from(wire), Buffer.from([0x98, 0x06, 0x07])]);
const du = M.decode(new Uint8Array(unk));
const hasUnk = Object.prototype.hasOwnProperty.call(du, "$unknowns");
ok("$unknowns is an own property after an unknown tag", hasUnk === true, "got " + hasUnk);
if (hasUnk) {
  ok("$unknowns enumerable === false",
     Object.getOwnPropertyDescriptor(du, "$unknowns").enumerable === false);
  ok("Object.keys omits $unknowns", !Object.keys(du).includes("$unknowns"),
     JSON.stringify(Object.keys(du)));
  ok("JSON.stringify omits $unknowns", !JSON.stringify(du).includes("$unknowns"),
     JSON.stringify(du));
}
ok("unknown field survives decode/encode", eq(unk, M.encode(du).finish()), hex(unk));

console.log("\n[4] caller-supplied target message (decode param 5)");
const target = new q.ADVDeviceIdentity({});
const d2 = M.decode(wire, undefined, undefined, 0, target);
ok("decode returns the object it was handed", d2 === target);
ok("target gained only the carried field",
   Object.prototype.hasOwnProperty.call(target, "rawId") &&
   !Object.prototype.hasOwnProperty.call(target, "timestamp"),
   JSON.stringify(Object.keys(target)));

/* ---------------- part 2: the null-slot claim, over every type ---------------- */
console.log("\n[5] NULL-DEFAULTED SLOTS vs ZERO-DEFAULTED, across every message type");

function guardedFields(fn) {           // AST only: no regex, deliberately
  const sf = ts.createSourceFile("f.js", "(" + fn.toString() + ")",
    ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);
  let node = null;
  (function w(n) {
    if (node === null && (ts.isFunctionExpression(n) || ts.isFunctionDeclaration(n))) node = n;
    ts.forEachChild(n, w);
  })(sf);
  if (node === null) return null;
  const par = node.parameters[0]?.name.getText();
  if (!par) return null;
  const out = new Set();
  (function w(n) {
    if (ts.isBinaryExpression(n) &&
        n.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsToken &&
        n.left.kind === ts.SyntaxKind.NullKeyword &&
        ts.isPropertyAccessExpression(n.right) &&
        ts.isIdentifier(n.right.expression) && n.right.expression.text === par) {
      const f = n.right.name.getText();
      if (f !== "$unknowns") out.add(f);
    }
    ts.forEachChild(n, w);
  })(node);
  return out;
}
function* walkNs(ns, depth) {
  if (depth > 6) return;
  for (const k of Object.keys(ns)) {
    let v; try { v = ns[k]; } catch { continue; }
    if (v && typeof v === "function" && typeof v.encode === "function" && typeof v.decode === "function")
      yield v;
    if (v && (typeof v === "object" || typeof v === "function")) yield* walkNs(v, depth + 1);
  }
}
const seen = new Set();
const types = [...walkNs(q, 0)].filter((v) => { if (seen.has(v)) return false; seen.add(v); return true; });
let noFields = 0, nullSame = 0, nullDiff = 0, zeroSame = 0, zeroDiff = 0, slots = 0, oneProduced = 0;
for (const T of types) {
  let base; try { base = T.encode({}).finish(); } catch { continue; }
  if (base.length !== 0) continue;
  const f = guardedFields(T.encode);
  if (f === null || f.size === 0) { noFields++; continue; }
  slots += f.size;
  const nul = {}, zer = {}, one = {};
  for (const k of f) { nul[k] = null; zer[k] = 0; one[k] = 1; }
  try { eq(base, T.encode(nul).finish()) ? nullSame++ : nullDiff++; } catch { nullDiff++; }
  try { eq(base, T.encode(zer).finish()) ? zeroSame++ : zeroDiff++; } catch { /* typed field rejects 0 */ }
  try { if (T.encode(one).finish().length > 0) oneProduced++; } catch { /* ditto */ }
}
console.log("    message types: " + types.length + "   with no guarded fields: " + noFields +
  "   field slots exercised: " + slots);
console.log("    ALL-FIELDS-NULL vs encode({}):  identical " + nullSame + "   DIFFERENT " + nullDiff);
console.log("    ALL-FIELDS-ZERO vs encode({}):  identical " + zeroSame + "   DIFFERENT " + zeroDiff);
ok("null-defaulted slots are byte-exact on every type", nullDiff === 0, nullDiff + " divergences");
ok("CONTROL: the harness can detect a difference at all", oneProduced > 0,
   "all-fields-set-to-1 produced bytes for " + oneProduced + " types");
ok("CONTROL: zero-defaulted slots DO diverge (the hazard is real)", zeroDiff > 0,
   zeroDiff + " types diverge");

console.log("\nchecks " + checks + "   failures " + fails);
console.log(
  "\nWHAT THIS MEANS\n" +
  "  The guard is `null != e.f && hasOwnProperty(e,\"f\")` and the NULL CHECK IS FIRST.\n" +
  "  So a static shape making every field an own property is harmless for the WIRE, as\n" +
  "  long as an absent slot reads as null. Presence does not need a side bitset; it needs\n" +
  "  nullable slots. A struct defaulting scalars to 0/false/\"\" is NOT byte-exact.\n" +
  "  NOT covered here: key enumeration. Object.keys(decoded) is only the carried fields\n" +
  "  today and a struct would widen it. Whether any program observes that is unmeasured.");
process.exit(fails === 0 ? 0 : 1);
