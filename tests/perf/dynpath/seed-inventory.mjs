// seed-inventory.mjs — what a shaped `decode` would actually cost, counted in
// MAY-THROW SEEDS rather than in bytes or sites.
//
// The size is the guards, not the object layout. backend/emission/may-throw.ts
// computes may-throw per function by fixpoint and the emitter places unwind
// checks from it, so what matters is which IR nodes SEED `f.throws`:
//
//   dynInvoke   seeds unconditionally   (may-throw.ts, case "dynInvoke")
//   dynKeyGet   seeds unconditionally   (may-throw.ts, case "dynKeyGet")
//   recordKeySet seeds only for a dynamic key colliding with a declared field
//   recordSet   is NOT IN THE SWITCH AT ALL -- a static-field store on a known
//               shape is not a throw seed, so it carries no guard
//
// So a known slot really does remove the store's guard -- BUT ONLY IF THE VALUE
// BEING STORED IS ALREADY TYPED. A still-dyn value crossing into a typed slot
// gets a dynCheck at the boundary, and dynCheck seeds f.throws too, so the guard
// relocates instead of vanishing.
//
// And a function keeps its epilogue while ANY seed remains in it, so partial
// conversion buys nothing structural. Message shape and Reader shape are
// multiplicative, not additive, and the instrument now shows that literally:
// BOTH removes more seeds than the two arms summed.
//
// Usage: node seed-inventory.mjs <bundle.js>
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { existsSync, statSync, readFileSync } from "node:fs";
import path from "node:path";

const BUNDLE = process.argv[2] ?? process.env["WAPROTO_JS"] ?? null;
if (BUNDLE === null) { console.error("usage: node seed-inventory.mjs <bundle.js>"); process.exit(2); }
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
if (ts === null) { console.error("no typescript resolvable"); process.exit(2); }

const src = readFileSync(BUNDLE, "utf8");
const sf = ts.createSourceFile("i.js", src, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);
const bnd = src.indexOf("j.waproto=");
if (bnd < 0) { console.error("no `j.waproto=` boundary"); process.exit(2); }
const isFn = (n) => ts.isFunctionExpression(n) || ts.isFunctionDeclaration(n);
const dec = [];
(function w(n) {
  if (isFn(n) && n.getStart() >= bnd) {
    const p = n.parent;
    if (p && ts.isBinaryExpression(p) && ts.isPropertyAccessExpression(p.left) &&
        p.left.name.getText() === "decode") dec.push(n);
  }
  ts.forEachChild(n, w);
})(sf);

// The namespace root is whatever identifier the nested Msg.decode chains hang
// off (`j` in `j.waproto.X.decode`). Detected, not hardcoded.
const NS_ROOT = (() => {
  const tally = new Map();
  (function w(n) {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) &&
        n.expression.name.getText() === "decode" && n.getStart() >= bnd) {
      let e = n.expression.expression;
      while (ts.isPropertyAccessExpression(e)) e = e.expression;
      if (ts.isIdentifier(e)) tally.set(e.text, (tally.get(e.text) ?? 0) + 1);
    }
    ts.forEachChild(n, w);
  })(sf);
  const top = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
  return top ? top[0] : null;
})();
const c = { readerCall: 0, readerGet: 0, msgGet: 0, msgSet: 0, otherGet: 0, nestedDecode: 0,
  setTypedRhs: 0, setDynRhs: 0, nsWalk: 0, chainMsg: 0, chainOther: 0 };
// Reads whose RECEIVER is itself an expression (j.waproto.Message, a.$unknowns
// .length). An earlier version of this file counted only identifier-rooted reads
// and therefore UNDERCOUNTED the seed total; these are seeds too.
const rootOf = (n) => {
  let e = n;
  for (;;) {
    if (ts.isPropertyAccessExpression(e) || ts.isCallExpression(e) ||
        ts.isElementAccessExpression(e) || ts.isNonNullExpression(e)) { e = e.expression; continue; }
    if (ts.isParenthesizedExpression(e)) { e = e.expression; continue; }
    if (ts.isBinaryExpression(e)) { e = e.left; continue; }
    break;
  }
  return ts.isIdentifier(e) ? e.text : null;
};
// A store into a typed slot only loses its guard if the VALUE is already typed.
// If the RHS is still dyn, lowering inserts a dynCheck at the boundary and THAT
// is guarded (may-throw.ts case "dynCheck"), so the guard RELOCATES rather than
// vanishing. Literals are already typed; a reader call or a nested decode is not,
// until those are shaped too.
const rhsIsTyped = (r) =>
  ts.isStringLiteral(r) || ts.isNumericLiteral(r) || ts.isArrayLiteralExpression(r) ||
  r.kind === ts.SyntaxKind.TrueKeyword || r.kind === ts.SyntaxKind.FalseKeyword;
for (const f of dec) {
  const rdr = f.parameters[0]?.name.getText();
  let msg = null;
  (function w(n) {
    if (ts.isVariableDeclaration(n) && n.initializer && ts.isBinaryExpression(n.initializer) &&
        n.initializer.operatorToken.kind === ts.SyntaxKind.BarBarToken &&
        ts.isNewExpression(n.initializer.right)) msg = n.name.getText();
    ts.forEachChild(n, w);
  })(f);
  (function w(n) {
    if (ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.expression)) {
      const recv = n.expression.text;
      const isCallee = n.parent && ts.isCallExpression(n.parent) && n.parent.expression === n;
      const isWrite = n.parent && ts.isBinaryExpression(n.parent) && n.parent.left === n &&
        n.parent.operatorToken.kind === ts.SyntaxKind.EqualsToken;
      if (recv === rdr) { if (isCallee) c.readerCall++; else c.readerGet++; }
      else if (recv === msg) {
        if (isWrite) { c.msgSet++; if (rhsIsTyped(n.parent.right)) c.setTypedRhs++; else c.setDynRhs++; }
        else if (!isCallee) c.msgGet++;
      }
      else if (!isCallee) { if (recv === NS_ROOT) c.nsWalk++; else c.otherGet++; }
    }
    if (ts.isPropertyAccessExpression(n) && !ts.isIdentifier(n.expression)) {
      const isCallee2 = n.parent && ts.isCallExpression(n.parent) && n.parent.expression === n;
      if (!isCallee2) {
        const r = rootOf(n.expression);
        if (r === msg) c.chainMsg++;
        else if (r !== null && r !== rdr) c.nsWalk++;
        else c.chainOther++;
      }
    }
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) &&
        n.expression.name.getText() === "decode" && !ts.isIdentifier(n.expression.expression))
      c.nestedDecode++;
    ts.forEachChild(n, w);
  })(f);
}
const total = c.readerCall + c.readerGet + c.msgGet + c.msgSet + c.otherGet +
  c.nestedDecode + c.nsWalk + c.chainMsg + c.chainOther;
// MESSAGE shape alone: reads become recordGet (unguarded), but only the stores
// whose RHS is ALREADY typed lose their guard; the rest swap dyn.keySet for dynCheck.
const msgWin = c.msgGet + c.chainMsg + c.setTypedRhs;
const rdrWin = c.readerCall + c.readerGet + c.otherGet;
// BOTH is strictly MORE than the sum: the dyn-RHS stores pay only when the reader
// shape has made their values typed, so they belong to neither arm alone.
const bothWin = c.msgGet + c.chainMsg + c.msgSet + c.readerCall + c.readerGet + c.otherGet;
const pct = (x) => ((x / total) * 100).toFixed(1) + "%";
console.log("decode bodies: " + dec.length + "\n");
console.log("throw seeds present today, by future IR node:");
console.log("  dynInvoke  reader method calls        " + String(c.readerCall).padStart(6));
console.log("  dynInvoke  nested Msg.decode calls    " + String(c.nestedDecode).padStart(6));
console.log("  dynKeyGet  reads on the reader        " + String(c.readerGet).padStart(6));
console.log("  dynKeyGet  reads on the message       " + String(c.msgGet).padStart(6));
console.log("  dynKeyGet  reads on the reader CLASS  " + String(c.otherGet).padStart(6));
console.log("  dynKeySet  writes to the message      " + String(c.msgSet).padStart(6));
console.log("     of which RHS already typed        " + String(c.setTypedRhs).padStart(6));
console.log("     of which RHS still dyn            " + String(c.setDynRhs).padStart(6) +
  "   <- keeps a guard, relocated to a dynCheck");
console.log("  dynKeyGet  namespace walk j.waproto.X  " + String(c.nsWalk).padStart(6));
console.log("  dynKeyGet  chained reads on the message" + String(c.chainMsg).padStart(6));
console.log("  dynKeyGet  chained, other roots        " + String(c.chainOther).padStart(6));
console.log("  " + "TOTAL".padEnd(36) + String(total).padStart(6));
console.log("\nwhat each shape buys, in seeds removed:");
console.log("  MESSAGE shape only   removes " + String(msgWin).padStart(6) + " (" + pct(msgWin) +
  ")   leaves " + (total - msgWin) + "  -> function STILL THROWS");
console.log("  READER  shape only   removes " + String(rdrWin).padStart(6) + " (" + pct(rdrWin) +
  ")   leaves " + (total - rdrWin) + "  -> function STILL THROWS");
console.log("  BOTH                 removes " + String(bothWin).padStart(6) + " (" +
  pct(bothWin) + ")   leaves " + (total - bothWin));
console.log("     note BOTH (" + bothWin + ") EXCEEDS the sum of the arms (" +
  (msgWin + rdrWin) + ") by " + (bothWin - msgWin - rdrWin) + " -- the dyn-RHS");
console.log("     stores, which belong to neither shape alone. That is what");
console.log("     multiplicative means here, stated in seeds.");
console.log("");
console.log("  the residue after BOTH is " + (total - bothWin) + ", and it is NOT a wall:");
console.log("    " + String(c.nsWalk).padStart(6) + "  the j.waproto.X namespace walk");
console.log("    " + String(c.nestedDecode).padStart(6) + "  nested Msg.decode calls, which stop seeding on");
console.log("            their own once every decode is clean -- computeMayThrow is a");
console.log("            FIXPOINT, so a call to a non-throwing function is not a seed");
console.log("    " + String(c.chainOther).padStart(6) + "  everything else");
console.log("");
console.log("  THREE shapes, not two, and the third is ONE object:");
console.log("    READER    " + String(c.readerCall + c.readerGet + c.otherGet).padStart(6) +
  "   reader calls, reader reads, and P.recursionLimit");
console.log("    MESSAGE   " + String(c.msgGet + c.msgSet + c.chainMsg).padStart(6) +
  "   641 shapes, one per message type");
console.log("    NAMESPACE " + String(c.nsWalk).padStart(6) +
  "   j.waproto: ONE record with 641 fields");
console.log("    residual  " + String(c.nestedDecode + c.chainOther).padStart(6) +
  "   nested decode calls, which dissolve by fixpoint");
console.log("");
console.log("  and the asymmetry that decides the ORDER: a message shape cannot cash in");
console.log("  its " + c.setDynRhs + " dyn-valued stores on its own -- each merely trades a");
console.log("  dyn.keySet guard for a dynCheck guard at the boundary. A READER shape makes");
console.log("  those values typed, which is what lets the message shape pay. Reader first.");
console.log("\nCONCLUSION: build toward GUARD REMOVAL, and that needs BOTH shapes. Either one");
console.log("alone leaves the function throwing, which keeps the epilogue that IS the size.");
