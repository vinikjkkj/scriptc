// WHERE EACH SEED BUCKET'S RECEIVER COMES FROM.
//
// The seed table names three buckets (READER 9,594 / MESSAGE 8,814 /
// NAMESPACE 4,108) and a prototype-class arm was built to attack them. That arm
// types the result of a `new K(...)` expression and the bindings that adopt one.
// Whether it can reach a bucket therefore depends on a fact nobody had counted:
// what SPELLING produces the value each bucket's seeds are read off.
//
// This reads the bundle and answers it per bucket, with the per-shape tallies
// printed rather than summarised, so a claim like "the arm cannot reach READER"
// is a count and not a reading of the code.
//
// usage: node bucket-origin.mjs <bundle.js>
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const BUNDLE = process.argv[2];
if (!BUNDLE) { console.error("usage: node bucket-origin.mjs <bundle.js>"); process.exit(2); }
const ts = (() => {
  let dir = process.cwd();
  for (;;) {
    const cand = path.join(dir, "node_modules", "typescript", "package.json");
    if (existsSync(cand)) return createRequire(cand)("typescript");
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
})();
if (ts === null) { console.error("no typescript resolvable from cwd"); process.exit(2); }

const src = readFileSync(BUNDLE, "utf8");
const sf = ts.createSourceFile("i.js", src, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);
const bnd = src.indexOf("j.waproto=");
if (bnd < 0) { console.error("no `j.waproto=` boundary -- wrong bundle"); process.exit(2); }

const bodies = (member) => {
  const out = [];
  (function w(n) {
    if ((ts.isFunctionExpression(n) || ts.isFunctionDeclaration(n)) && n.getStart() >= bnd) {
      const p = n.parent;
      if (p && ts.isBinaryExpression(p) && ts.isPropertyAccessExpression(p.left) &&
          p.left.name.getText() === member) out.push(n);
    }
    ts.forEachChild(n, w);
  })(sf);
  return out;
};

const dec = bodies("decode");
if (dec.length === 0) { console.error("SELF-TEST FAILED: zero decode bodies found"); process.exit(2); }

/* For each decode body: the READER binding is parameter 0, and the MESSAGE
 * binding is the `var a = r || new ...` declaration the seed instrument keys
 * on. Classify what each is INITIALISED FROM. */
const readerOrigin = new Map();
const msgOrigin = new Map();
const bump = (m, k) => m.set(k, (m.get(k) ?? 0) + 1);
let readerSeeds = 0, msgSeeds = 0;

for (const f of dec) {
  const p0 = f.parameters[0];
  bump(readerOrigin, p0 === undefined ? "<no parameter 0>"
    : ts.isIdentifier(p0.name) ? (p0.initializer ? "parameter with a default" : "an untyped FUNCTION PARAMETER")
    : "a destructuring parameter");
  const rdr = p0 && ts.isIdentifier(p0.name) ? p0.name.text : null;

  let msgDecl = null;
  (function w(n) {
    if (msgDecl === null && ts.isVariableDeclaration(n) && n.initializer &&
        ts.isBinaryExpression(n.initializer) &&
        n.initializer.operatorToken.kind === ts.SyntaxKind.BarBarToken &&
        ts.isNewExpression(n.initializer.right)) msgDecl = n;
    ts.forEachChild(n, w);
  })(f);
  if (msgDecl === null) bump(msgOrigin, "<no `x || new ...` declaration>");
  else {
    const ne = msgDecl.initializer.right;
    const kind = msgDecl.parent && ts.isVariableDeclarationList(msgDecl.parent)
      ? (msgDecl.parent.flags & ts.NodeFlags.Const ? "const" : msgDecl.parent.flags & ts.NodeFlags.Let ? "let" : "var")
      : "?";
    const callee = ne.expression;
    const calleeShape = ts.isIdentifier(callee) ? "a plain IDENTIFIER"
      : ts.isPropertyAccessExpression(callee) ? "a NAMESPACE MEMBER (" + callee.getText().split(".").slice(0, 2).join(".") + ".*)"
      : ts.SyntaxKind[callee.kind];
    bump(msgOrigin, `${kind} binding = <param> || new ${calleeShape}`);
  }
  const msg = msgDecl ? msgDecl.name.getText() : null;

  (function w(n) {
    if (ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.expression)) {
      if (n.expression.text === rdr) readerSeeds++;
      else if (n.expression.text === msg) msgSeeds++;
    }
    ts.forEachChild(n, w);
  })(f);
}

const table = (title, m, total) => {
  console.log("\n" + title);
  for (const [k, v] of [...m.entries()].sort((a, b) => b[1] - a[1])) {
    console.log("  " + String(v).padStart(5) + "  " + ((v / total) * 100).toFixed(1).padStart(5) + "%  " + k);
  }
};

console.log(`decode bodies: ${dec.length}`);
console.log(`property accesses rooted at the READER binding:  ${readerSeeds}`);
console.log(`property accesses rooted at the MESSAGE binding: ${msgSeeds}`);
table("READER receiver, by what produces it:", readerOrigin, dec.length);
table("MESSAGE receiver, by what produces it:", msgOrigin, dec.length);

/* And the third fact the arm's reach depends on: do the 641 message TYPES have
 * prototype methods at all? A constructor with none is a record factory, which
 * the recognizer refuses by rule ("no prototype methods") -- so if that is what
 * they are, the MESSAGE bucket was never this arm's to take. */
let protoAssignsAfterBoundary = 0;
const protoTargets = new Set();
(function w(n) {
  if (n.getStart() >= bnd && ts.isBinaryExpression(n) &&
      n.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(n.left)) {
    const inner = n.left.expression;
    if (ts.isPropertyAccessExpression(inner) && inner.name.getText() === "prototype") {
      protoAssignsAfterBoundary++;
      protoTargets.add(inner.expression.getText().slice(0, 40));
    }
  }
  ts.forEachChild(n, w);
})(sf);
console.log(`\nprototype-member assignments AFTER the j.waproto boundary: ${protoAssignsAfterBoundary}`);
console.log(`distinct prototype targets there: ${protoTargets.size}` +
  (protoTargets.size > 0 ? " -> " + [...protoTargets].slice(0, 6).join(", ") : ""));
