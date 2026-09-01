// enum-observability.mjs — does any real code OBSERVE the difference between an
// absent protobuf field and a null-valued own slot?
//
// presence-coupling.mjs shows a null-defaulted static shape is byte-exact on the
// WIRE, because the encode guard tests `null != e.f` before `hasOwnProperty`.
// It explicitly does not cover the object surface. This does.
//
// 13 of 20 common expressions distinguish absent from null-valued:
//   SAFE       ?? | || | == null | ?. | Boolean() | Array.isArray()
//   DIVERGES   === undefined | !== undefined | === null | typeof | 'f' in x
//              hasOwnProperty | Object.keys/values/entries | JSON.stringify
//              spread {...x} | String(x.f) | x.f + 1
// but `x === null || x === undefined` and `x !== null && x !== undefined` are
// each equivalent to `x == null`, so those are SAFE and are classified as such.
//
// AST only. Three false results in this project came from scanning code with
// regexes, one of which CONFIRMED the hypothesis under test. Hence the SELF-TEST
// below: it asserts every detector fires on a fixture before any real file is
// read, because "0 findings" from a broken detector looks exactly like good news.
//
// Usage: node enum-observability.mjs <dir> [dir...]
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { existsSync, statSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

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

const ENUM_SINKS = new Set(["Object.keys", "Object.values", "Object.entries", "Object.assign",
  "JSON.stringify", "structuredClone"]);

function analyze(fileName, src) {
  const out = { bindings: 0, protoBindings: 0, escaping: 0, safePairs: 0, hits: [] };
  if (!src.includes(".decode(")) return out;
  const sf = ts.createSourceFile(fileName, src, ts.ScriptTarget.ESNext, true,
    /\.tsx?$/.test(fileName) ? ts.ScriptKind.TS : ts.ScriptKind.JS);
  const isDecodeCall = (n) => {
    const e = ts.isAwaitExpression(n) ? n.expression : n;
    return ts.isCallExpression(e) && ts.isPropertyAccessExpression(e.expression) &&
           e.expression.name.getText() === "decode";
  };
  const enclosingFn = (n) => {
    let c = n.parent;
    while (c && !ts.isFunctionDeclaration(c) && !ts.isFunctionExpression(c) &&
           !ts.isArrowFunction(c) && !ts.isMethodDeclaration(c) && !ts.isSourceFile(c)) c = c.parent;
    return c ?? null;
  };
  const bound = new Map();
  (function w(n) {
    if (ts.isVariableDeclaration(n) && n.initializer && ts.isIdentifier(n.name) &&
        isDecodeCall(n.initializer)) {
      const fn = enclosingFn(n);
      const span = fn && !ts.isSourceFile(fn) ? { lo: fn.getStart(), hi: fn.getEnd() }
                                              : { lo: 0, hi: src.length };
      if (!bound.has(n.name.text)) bound.set(n.name.text, []);
      bound.get(n.name.text).push(span);
      out.bindings++;
      // isDecodeCall matches ANY `.decode(` -- TextDecoder and base64 included.
      // That OVER-approximates on purpose: tracking too many variables can only
      // create false positives, never hide a real one, so a zero result is safe.
      // This second counter says how much of the set is actually protobuf.
      const call = ts.isAwaitExpression(n.initializer) ? n.initializer.expression : n.initializer;
      if (/proto/i.test(call.expression.expression.getText())) out.protoBindings++;
    }
    ts.forEachChild(n, w);
  })(sf);
  if (bound.size === 0) return out;
  const at = (n) => sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
  // SCOPE CHECK: a same-named variable in another function is not this one.
  const tracked = (n) => {
    if (!ts.isIdentifier(n)) return false;
    const spans = bound.get(n.text);
    if (!spans) return false;
    const p = n.getStart();
    return spans.some((s) => p >= s.lo && p <= s.hi);
  };
  // `x === undefined` inside a || chain that also tests `x === null` is the
  // `x == null` idiom, and likewise `!==` inside an && chain. Both are SAFE.
  const pairedWithNull = (cmp, propText) => {
    let top = cmp;
    while (top.parent && ts.isBinaryExpression(top.parent) &&
           (top.parent.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
            top.parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken)) top = top.parent;
    let found = false;
    (function w(n) {
      if (found) return;
      if (ts.isBinaryExpression(n) &&
          (n.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken ||
           n.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken)) {
        for (const [a, b] of [[n.left, n.right], [n.right, n.left]])
          if (b.kind === ts.SyntaxKind.NullKeyword && a.getText() === propText) found = true;
      }
      ts.forEachChild(n, w);
    })(top);
    return found;
  };
  (function w(n) {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) &&
        ENUM_SINKS.has(n.expression.getText()) && n.arguments.length > 0 && tracked(n.arguments[0]))
      out.hits.push([fileName, at(n), "ENUMERATION", n.expression.getText() + "(" + n.arguments[0].text + ")"]);
    if (ts.isForInStatement(n) && tracked(n.expression))
      out.hits.push([fileName, at(n), "ENUMERATION", "for..in " + n.expression.text]);
    if (ts.isSpreadAssignment(n) && tracked(n.expression))
      out.hits.push([fileName, at(n), "ENUMERATION", "spread {..." + n.expression.text + "}"]);
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.InKeyword && tracked(n.right))
      out.hits.push([fileName, at(n), "PRESENCE-OP", n.getText()]);
    if (ts.isBinaryExpression(n) &&
        (n.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken ||
         n.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken)) {
      for (const [a, b] of [[n.left, n.right], [n.right, n.left]]) {
        if (ts.isIdentifier(b) && b.text === "undefined" &&
            ts.isPropertyAccessExpression(a) && tracked(a.expression)) {
          if (pairedWithNull(n, a.getText())) out.safePairs++;
          else out.hits.push([fileName, at(n), "SOLO-UNDEF", n.getText()]);
        }
      }
    }
    if (ts.isTypeOfExpression(n) && ts.isPropertyAccessExpression(n.expression) &&
        tracked(n.expression.expression))
      out.hits.push([fileName, at(n), "TYPEOF", n.getText()]);
    if (ts.isReturnStatement(n) && n.expression && tracked(n.expression)) out.escaping++;
    ts.forEachChild(n, w);
  })(sf);
  return out;
}

/* ---------------- SELF-TEST: every detector must fire on a fixture ----------- */
const FIXTURE = [
  "function a(buf) {",
  "  const m = proto.X.decode(buf);",
  "  Object.keys(m); JSON.stringify(m); Object.entries(m);",
  "  for (const k in m) { void k; }",
  "  const c = { ...m };",
  "  if ('f' in m) { void c; }",
  "  if (m.f === undefined) { void 0; }",          // SOLO -> unsafe
  "  if (typeof m.g === 'string') { void 0; }",
  "  return m;",
  "}",
  "function b(buf) {",
  "  const m = proto.X.decode(buf);",
  "  if (m.f === null || m.f === undefined) { void 0; }",   // paired -> safe
  "  if (m.g !== null && m.g !== undefined) { void 0; }",   // paired -> safe
  "}",
  "function c(node) {",
  "  const m = decodeBinaryNode(node);",   // NOT a proto decode, same name
  "  Object.keys(m);",                     // must NOT be reported
  "}",
].join("\n");
const st = analyze("fixture.ts", FIXTURE);
const kinds = {};
for (const h of st.hits) kinds[h[2]] = (kinds[h[2]] || 0) + 1;
const want = { ENUMERATION: 5, "PRESENCE-OP": 1, "SOLO-UNDEF": 1, TYPEOF: 1 };
let stFail = 0;
console.log("SELF-TEST (must pass before any real file is read)");
for (const k of Object.keys(want)) {
  const got = kinds[k] ?? 0;
  const good = got === want[k];
  if (!good) stFail++;
  console.log("  " + (good ? "ok   " : "FAIL ") + k.padEnd(12) + " expected " + want[k] + ", got " + got);
}
const chk = (name, cond) => { if (!cond) stFail++; console.log("  " + (cond ? "ok   " : "FAIL ") + name); };
chk("2 proto-decode bindings tracked, the decodeBinaryNode one ignored", st.bindings === 2);
chk("paired null/undefined counted SAFE (expected 2, got " + st.safePairs + ")", st.safePairs === 2);
chk("same-named non-proto variable in another scope NOT reported",
  !st.hits.some((h) => h[1] >= 17));
chk("escape (return m) detected", st.escaping === 1);
chk("protobuf bindings distinguished from other .decode( calls (got " +
  st.protoBindings + ")", st.protoBindings === 2);
if (stFail > 0) { console.error("\nSELF-TEST FAILED — findings below would be meaningless."); process.exit(1); }

/* ---------------- the real scan ---------------- */
const ROOTS = process.argv.slice(2);
if (ROOTS.length === 0) { console.error("\nusage: node enum-observability.mjs <dir> [dir...]"); process.exit(2); }
const files = [];
for (const r of ROOTS) {
  if (!existsSync(r)) continue;
  (function walk(d) {
    let ents; try { ents = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (["node_modules", ".git", "dist"].includes(e.name)) continue; walk(p); }
      else if (/\.(ts|tsx|mts|cts|js|mjs|cjs)$/.test(e.name) && !e.name.endsWith(".d.ts")) files.push(p);
    }
  })(r);
}
let bindings = 0, protoBindings = 0, escaping = 0, safePairs = 0;
const hits = [];
for (const f of files) {
  let src; try { src = readFileSync(f, "utf8"); } catch { continue; }
  const r = analyze(f, src);
  bindings += r.bindings; escaping += r.escaping; safePairs += r.safePairs;
  protoBindings += r.protoBindings;
  for (const h of r.hits) hits.push(h);
}
console.log("\nfiles scanned: " + files.length);
console.log("decode-bound locals: " + bindings + "  (of which a protobuf decode: " +
  protoBindings + ")   returned/escaping: " + escaping);
console.log("null/undefined pairs classified SAFE: " + safePairs);
const byKind = {};
for (const h of hits) byKind[h[2]] = (byKind[h[2]] || 0) + 1;
console.log("\nOBSERVATIONS that would change under a null-defaulted shape: " + hits.length +
  " " + JSON.stringify(byKind));
for (const [f, l, k, d] of hits)
  console.log("  " + k.padEnd(12) + String(f).replace(/\\/g, "/") + ":" + l + "  " + d);
console.log("\n" + (hits.length === 0
  ? "No observation found. The " + escaping + " escaping value(s) are NOT covered by this scan."
  : hits.length + " site(s) must be reviewed before a null-defaulted shape can ship."));
