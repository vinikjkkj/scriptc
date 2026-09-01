// decode-shape.mjs — can the message shapes be recovered from the BODIES, which
// is the only source npm-static.ts's doctrine permits, and what would break if
// they were?
//
// waproto-split.mjs establishes that the .d.ts does not describe these bodies.
// This asks the follow-on: the generated encode/decode are two code-generator
// templates, so is the field set of each message statically enumerable from the
// template alone -- and is a static shape SAFE, which is the question that
// decides whether any of it can ship.
//
// Usage: node decode-shape.mjs <bundle.js>
import { readFileSync } from "node:fs";

const JS = process.argv[2] ?? process.env["WAPROTO_JS"] ?? null;
if (JS === null) {
  console.error("usage: node decode-shape.mjs <bundle.js>");
  process.exit(2);
}

/* typescript resolves from this repo; a git worktree has no node_modules of its
 * own, so fall back to the MAIN worktree via the .git pointer file. */
const ts = await (async () => {
  const { createRequire } = await import("node:module");
  const { fileURLToPath } = await import("node:url");
  const { existsSync, statSync, readFileSync: rf } = await import("node:fs");
  const path = await import("node:path");
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
      const m = /gitdir:\s*(.+)/.exec(rf(dot, "utf8"));
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
if (ts === null) {
  console.error("no typescript resolvable from this tree; run from a checkout with node_modules");
  process.exit(2);
}

const src = readFileSync(JS, "utf8");
const sf = ts.createSourceFile("i.js", src, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);
const bnd = src.indexOf("j.waproto=");
if (bnd < 0) { console.error("no `j.waproto=` in this bundle"); process.exit(2); }

const isFn = (n) => ts.isFunctionExpression(n) || ts.isFunctionDeclaration(n);
const bodies = [];
(function w(n) {
  if (isFn(n) && n.getStart() >= bnd) {
    const p = n.parent;
    if (p && ts.isBinaryExpression(p) && ts.isPropertyAccessExpression(p.left)) {
      const k = p.left.name.getText();
      if (k === "encode" || k === "decode") bodies.push({ kind: k, node: n });
    }
  }
  ts.forEachChild(n, w);
})(sf);
const dec = bodies.filter((b) => b.kind === "decode");
const enc = bodies.filter((b) => b.kind === "encode");

/* Only bodies AFTER `j.waproto=` are message codecs. protobufjs ships its own
 * `base64.decode`, which is a name collision and not a 642nd message. */
console.log("message codec bodies after `j.waproto=`:  encode " + enc.length + "  decode " + dec.length);
const shape = (f) => f.node.body.statements.map((s) => ts.SyntaxKind[s.kind]).join(",");
for (const [label, list] of [["encode", enc], ["decode", dec]]) {
  const c = new Map();
  for (const f of list) c.set(shape(f), (c.get(shape(f)) ?? 0) + 1);
  const top = [...c.entries()].sort((a, b) => b[1] - a[1]);
  console.log("  " + label + ": " + c.size + " distinct top-level shapes; largest " + top[0][1] +
    " (" + ((top[0][1] / list.length) * 100).toFixed(1) + "%)  [" + top[0][0] + "]");
}

/* ---- is each decode's field set statically enumerable? ---- */
const READER = new Set(["uint32", "int32", "int64", "uint64", "sint32", "sint64", "bool", "fixed32",
  "sfixed32", "fixed64", "sfixed64", "float", "double", "bytes", "string"]);
let enumerable = 0; const fail = [];
let usesMakeProp = 0, usesTargetParam = 0, oneofMarkers = 0, nestedRefs = 0;
for (const b of dec) {
  const rdr = b.node.parameters[0]?.name.getText();
  let msgLocal = null, msgType = null, sw = null;
  (function w(n) {
    if (ts.isVariableDeclaration(n) && n.initializer && ts.isBinaryExpression(n.initializer) &&
        n.initializer.operatorToken.kind === ts.SyntaxKind.BarBarToken &&
        ts.isNewExpression(n.initializer.right)) {
      msgLocal = n.name.getText();
      const m = /^j\.waproto\.([A-Za-z_][\w.]*)$/.exec(n.initializer.right.expression.getText());
      msgType = m !== null ? m[1] : n.initializer.right.expression.getText();
    }
    if (ts.isSwitchStatement(n) && sw === null) sw = n;
    ts.forEachChild(n, w);
  })(b.node);
  const text = src.slice(b.node.getStart(), b.node.getEnd());
  if (text.includes("makeProp")) usesMakeProp++;
  if (msgLocal !== null && text.includes("||new ")) usesTargetParam++;
  if (sw === null) { fail.push([msgType, "no switch: message declares no fields"]); continue; }
  let why = null;
  for (const cl of sw.caseBlock.clauses) {
    if (ts.isDefaultClause(cl)) { if (why === null) why = "default clause: tag set not closed"; continue; }
    if (!ts.isNumericLiteral(cl.expression) && why === null) why = "non-literal case tag";
    (function w(n) {
      if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
          ts.isPropertyAccessExpression(n.left) && ts.isIdentifier(n.left.expression) &&
          n.left.expression.text === msgLocal) {
        const fname = n.left.name.getText(), r = n.right;
        if (fname.startsWith("_") && ts.isStringLiteral(r)) { oneofMarkers++; return; }
        if (ts.isArrayLiteralExpression(r)) return;
        if (ts.isCallExpression(r) && ts.isPropertyAccessExpression(r.expression)) {
          const m = r.expression.name.getText();
          if (m === "decode") { nestedRefs++; return; }
          if (READER.has(m) && r.expression.expression.getText() === rdr) return;
        }
        if (why === null) why = "field `" + fname + "` initialised from " + ts.SyntaxKind[r.kind];
      }
      ts.forEachChild(n, w);
    })(cl);
  }
  if (why === null) enumerable++; else fail.push([msgType, why]);
}
console.log("");
console.log("decode field sets statically enumerable from the template: " + enumerable + " of " +
  dec.length + "  (" + ((enumerable / dec.length) * 100).toFixed(1) + "%)");
console.log("  oneof discriminator assignments (`a._x = \"x\"`): " + oneofMarkers);
console.log("  nested message references (a.f = Y.decode(...)):  " + nestedRefs);
for (const [n, why] of fail) console.log("  NOT ENUMERABLE  " + String(n).padEnd(34) + why);

/* ---- what a static shape would have to preserve ---- */
const tally = { encode: { r: 0, w: 0, hop: 0 }, decode: { r: 0, w: 0, hop: 0 } };
for (const b of bodies) {
  (function w(n) {
    if (ts.isPropertyAccessExpression(n)) {
      const isCallee = n.parent && ts.isCallExpression(n.parent) && n.parent.expression === n;
      if (!isCallee) {
        const isWrite = n.parent && ts.isBinaryExpression(n.parent) && n.parent.left === n &&
          n.parent.operatorToken.kind === ts.SyntaxKind.EqualsToken;
        tally[b.kind][isWrite ? "w" : "r"]++;
      }
    }
    if (ts.isCallExpression(n) && /hasOwnProperty/.test(n.expression.getText())) tally[b.kind].hop++;
    ts.forEachChild(n, w);
  })(b.node);
}
console.log("");
console.log("property traffic, split by template (reads are the key_get shape, writes key_set):");
for (const k of ["encode", "decode"])
  console.log("  " + k.padEnd(7) + " reads " + String(tally[k].r).padStart(6) +
    "  writes " + String(tally[k].w).padStart(6) +
    "  hasOwnProperty guards " + String(tally[k].hop).padStart(5));
console.log("");
console.log("SAFETY, and it is the whole question:");
console.log("  decode builds its own object, so its shape is its own to choose.");
console.log("  encode READS a caller-supplied plain object -- `X.encode({ a: 1 })` -- and uses");
console.log("  `null != e.f && hasOwnProperty(e,\"f\")` as the PRESENCE test that decides whether");
console.log("  field f goes on the wire. A static struct makes every field own, so every");
console.log("  hasOwnProperty answers true and encode emits fields the caller never set:");
console.log("  DIFFERENT BYTES ON THE WIRE. Presence must be modelled explicitly before the");
console.log("  encode half can be attempted at all.");
console.log("  " + usesMakeProp + " decode bodies call M.makeProp(a,\"$unknowns\",false) --");
console.log("  Object.defineProperty with enumerable:false, so JSON.stringify omits $unknowns.");
console.log("  A shape that makes it enumerable changes JSON output; also observable.");
console.log("  " + usesTargetParam + " decode bodies accept a caller-supplied target (`a = r || new X`),");
console.log("  so the object decode fills is not always one it allocated.");
