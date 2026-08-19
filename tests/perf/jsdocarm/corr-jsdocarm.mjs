/**
 * corr-jsdocarm.mjs - the declared-member <-> function-expression
 * correspondence over a minified `.d.ts` + `.js` twin, measured.
 *
 * The question: a `.d.ts` declares members; the `.js` beside it is an
 * esbuild+terser bundle whose every local name is one letter. If the
 * compiler is to type a body FROM its declaration it must first know which
 * function expression implements which declared member. This instrument
 * builds that correspondence from the AST alone and prints its match rate,
 * its false positives and its false negatives - plus, for every matched
 * pair, whether the DECLARED SIGNATURE and the BODY agree on arity, which
 * is the thing that decides whether the correspondence is usable.
 *
 * It reads nothing but the two files. It resolves scopes properly, because
 * the bundle shadows: `e.ImageMessage = function () { function e(e) {...} }`
 * has three different `e`s in three scopes.
 *
 * Usage: node corr-jsdocarm.mjs <index.js> <index.d.ts> [--json out.json]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const ts = require(process.env.SCRIPTC_TS_MODULE ?? "typescript");

const positional = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const jsonFlagAt = process.argv.indexOf("--json");
const jsonAt = jsonFlagAt < 0 ? null : process.argv[jsonFlagAt + 1];
const [jsPath, dtsPath] = positional.filter((a) => a !== jsonAt);
if (!jsPath || !dtsPath) {
  console.error("usage: corr-jsdocarm.mjs <index.js> <index.d.ts> [--json out.json]");
  process.exit(2);
}

/* ---------------------------------------------------------------- the .d.ts */

const dtsSrc = readFileSync(dtsPath, "utf8");
const dts = ts.createSourceFile(dtsPath, dtsSrc, ts.ScriptTarget.ES2020, true, ts.ScriptKind.TS);

/** key "waproto.Message.ImageMessage" -> record */
const declared = new Map();
const declaredEnums = new Set();

function paramRec(p) {
  return {
    name: p.name.getText(dts),
    optional: !!p.questionToken || !!p.initializer,
    type: p.type ? p.type.getText(dts) : null,
    rest: !!p.dotDotDotToken,
  };
}

function declWalk(node, path) {
  ts.forEachChild(node, (n) => {
    if (ts.isModuleDeclaration(n)) {
      const name = ts.isIdentifier(n.name) ? n.name.text : n.name.text;
      const p = path ? path + "." + name : name;
      if (n.body) declWalk(n.body, p);
      return;
    }
    if (ts.isModuleBlock(n)) { declWalk(n, path); return; }
    if (ts.isEnumDeclaration(n)) {
      declaredEnums.add(path ? path + "." + n.name.text : n.name.text);
      return;
    }
    if (ts.isClassDeclaration(n) && n.name) {
      const key = path ? path + "." + n.name.text : n.name.text;
      const rec = { key, statics: new Map(), instanceMethods: new Map(), ctorParams: null, props: [] };
      for (const m of n.members) {
        const isStatic = (ts.getCombinedModifierFlags(m) & ts.ModifierFlags.Static) !== 0;
        if (ts.isConstructorDeclaration(m)) { rec.ctorParams = m.parameters.map(paramRec); continue; }
        if (ts.isMethodDeclaration(m) || ts.isMethodSignature(m)) {
          const info = { params: m.parameters.map(paramRec), ret: m.type ? m.type.getText(dts) : null };
          (isStatic ? rec.statics : rec.instanceMethods).set(m.name.getText(dts), info);
          continue;
        }
        if (ts.isPropertyDeclaration(m)) {
          rec.props.push({
            name: m.name.getText(dts), static: isStatic,
            optional: !!m.questionToken, type: m.type ? m.type.getText(dts) : null,
          });
        }
      }
      declared.set(key, rec);
      return;
    }
    declWalk(n, path);
  });
}
declWalk(dts, "");

/* ------------------------------------------------------------------ the .js */

const jsSrc = readFileSync(jsPath, "utf8");
const js = ts.createSourceFile(jsPath, jsSrc, ts.ScriptTarget.ES2020, true, ts.ScriptKind.JS);

function newScope(parent) { return { vars: new Map(), parent }; }
function lookup(scope, name) {
  for (let s = scope; s; s = s.parent) if (s.vars.has(name)) return s.vars.get(name);
  return null;
}

const found = new Map();
const orphanAssign = [];
let iifeTypes = 0;

function recFor(path) {
  let r = found.get(path);
  if (!r) { r = { path, statics: new Map(), ctorParams: null, protoProps: [] }; found.set(path, r); }
  return r;
}

/** the generated shape: `function () { function C(..) {..} ... return C }()` */
function iifeCtorInfo(expr) {
  if (!ts.isCallExpression(expr)) return null;
  let fn = expr.expression;
  while (ts.isParenthesizedExpression(fn)) fn = fn.expression;
  if (!ts.isFunctionExpression(fn)) return null;
  if (expr.arguments.length !== 0) return null;
  if (!fn.body || !ts.isBlock(fn.body)) return null;
  let retName = null;
  for (const st of fn.body.statements) {
    if (ts.isReturnStatement(st) && st.expression) {
      let e = st.expression;
      while (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.CommaToken) e = e.right;
      if (ts.isIdentifier(e)) retName = e.text;
    }
  }
  return { fn, retName };
}

function paramsOf(fnExpr) {
  return fnExpr.parameters.map((p) => ({
    name: ts.isIdentifier(p.name) ? p.name.text : p.name.getText(js),
    rest: !!p.dotDotDotToken, init: !!p.initializer,
  }));
}

function objPathOf(expr, scope) {
  while (ts.isParenthesizedExpression(expr)) expr = expr.expression;
  /* `(n = {}).X` - terser's way of creating and naming the namespace object
   * in one expression. The value of `n = {}` is `n`. */
  if (ts.isBinaryExpression(expr) && expr.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(expr.left)) {
    return objPathOf(expr.left, scope);
  }
  if (ts.isIdentifier(expr)) {
    const b = lookup(scope, expr.text);
    return b ? b.path : null;
  }
  if (ts.isPropertyAccessExpression(expr)) {
    const base = objPathOf(expr.expression, scope);
    return base === null ? null : (base ? base + "." + expr.name.text : expr.name.text);
  }
  return null;
}

/** the value of a comma sequence is its rightmost operand */
function rightmostOperand(expr) {
  let e = expr;
  for (;;) {
    while (ts.isParenthesizedExpression(e)) e = e.expression;
    if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.CommaToken) { e = e.right; continue; }
    return e;
  }
}

function walkExpr(node, scope) {
  if (!node) return;
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(node.left)) {
    const memberName = node.left.name.text;
    const basePath = objPathOf(node.left.expression, scope);
    let rhs = node.right;
    while (ts.isParenthesizedExpression(rhs)) rhs = rhs.expression;
    if (basePath !== null) {
      const info = iifeCtorInfo(rhs);
      if (info) {
        const path = basePath ? basePath + "." + memberName : memberName;
        iifeTypes++;
        const inner = newScope(scope);
        if (info.retName) inner.vars.set(info.retName, { kind: "ctor", path });
        for (const st of info.fn.body.statements) {
          if (ts.isFunctionDeclaration(st) && st.name && st.name.text === info.retName) {
            const r = recFor(path);
            r.ctorParams = paramsOf(st);
            r.ctorPos = st.getStart(js);
            r.ctorEnd = st.getEnd();
            r.iifeStart = rhs.getStart(js);
            r.iifeEnd = rhs.getEnd();
          }
        }
        walkBlock(info.fn.body, inner);
        return;
      }
      if (ts.isPropertyAccessExpression(node.left.expression) &&
          node.left.expression.name.text === "prototype") {
        const p = objPathOf(node.left.expression.expression, scope);
        if (p !== null) recFor(p).protoProps.push(memberName);
        walkExpr(rhs, scope);
        return;
      }
      if (ts.isFunctionExpression(rhs) || ts.isArrowFunction(rhs)) {
        recFor(basePath).statics.set(memberName, {
          params: paramsOf(rhs), pos: rhs.getStart(js), end: rhs.getEnd(),
        });
        walkFn(rhs, scope);
        return;
      }
      if (ts.isIdentifier(rhs) || ts.isPropertyAccessExpression(rhs)) {
        recFor(basePath).statics.set(memberName, { params: null, alias: rhs.getText(js).slice(0, 60) });
        return;
      }
      /* `A.B = (v = {}, v.X = ..., v)` - a namespace object built and
       * returned by a comma sequence. Its VALUE is the rightmost operand,
       * so that identifier denotes A.B for the rest of the sequence. */
      if (ts.isBinaryExpression(rhs) && rhs.operatorToken.kind === ts.SyntaxKind.CommaToken) {
        const v = rightmostOperand(rhs);
        const path = basePath ? basePath + "." + memberName : memberName;
        const inner = newScope(scope);
        if (ts.isIdentifier(v)) inner.vars.set(v.text, { kind: "ns", path });
        walkExpr(rhs, inner);
        return;
      }
    } else {
      orphanAssign.push({ member: memberName, at: node.getStart(js) });
    }
  }
  ts.forEachChild(node, (c) => {
    if (ts.isFunctionExpression(c) || ts.isFunctionDeclaration(c) || ts.isArrowFunction(c)) { walkFn(c, scope); return; }
    walkExpr(c, scope);
  });
}

function walkFn(fn, scope) {
  const inner = newScope(scope);
  if (fn.body) { if (ts.isBlock(fn.body)) walkBlock(fn.body, inner); else walkExpr(fn.body, inner); }
}

function walkBlock(block, scope) {
  for (const st of block.statements) {
    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (!ts.isIdentifier(d.name) || !d.initializer) continue;
        const p = objPathOf(d.initializer, scope);
        if (p !== null) { scope.vars.set(d.name.text, { kind: "ns", path: p }); continue; }
        walkExpr(d.initializer, scope);
      }
      continue;
    }
    if (ts.isFunctionDeclaration(st)) { walkFn(st, scope); continue; }
    walkExpr(st, scope);
  }
}

/* Seed. The bundle assigns the exported namespace object onto some root
 * identifier: `<id>.waproto = ...`. We bind every such root to the EMPTY
 * path, so `<id>.waproto.Foo` resolves as "waproto.Foo" - the same key the
 * `.d.ts` walk produces. */
const rootScope = newScope(null);
{
  const re = /([A-Za-z_$][\w$]*)\.waproto\s*=/g;
  let m; const roots = new Set();
  while ((m = re.exec(jsSrc))) roots.add(m[1]);
  for (const r of roots) rootScope.vars.set(r, { kind: "ns", path: "" });
}
walkBlock(js, rootScope);

/* --------------------------------------------------------------- the report */

const rows = [];
let matchedClasses = 0, missingClasses = 0;
let declMembers = 0, matchedMembers = 0, missingMembers = 0, aliasMembers = 0;
let arityOK = 0, arityBodyMore = 0, arityBodyFewer = 0;
const arityDetail = new Map();
const bodyOnly = new Set();

for (const key of declared.keys()) {
  const d = declared.get(key);
  const f = found.get(key);
  const own = d.statics.size + (d.ctorParams ? 1 : 0);
  if (!f) {
    missingClasses++; declMembers += own; missingMembers += own;
    rows.push({ key, status: "CLASS-MISSING" });
    continue;
  }
  matchedClasses++;
  if (d.ctorParams) {
    declMembers++;
    if (f.ctorParams) {
      matchedMembers++;
      const dn = d.ctorParams.length, bn = f.ctorParams.length;
      if (dn === bn) arityOK++; else if (bn > dn) arityBodyMore++; else arityBodyFewer++;
      const k = `constructor ${dn}->${bn}`; arityDetail.set(k, (arityDetail.get(k) ?? 0) + 1);
    } else { missingMembers++; rows.push({ key, member: "constructor", status: "MEMBER-MISSING" }); }
  }
  for (const [name, info] of d.statics) {
    declMembers++;
    const b = f.statics.get(name);
    if (!b) { missingMembers++; rows.push({ key, member: name, status: "MEMBER-MISSING" }); continue; }
    matchedMembers++;
    if (b.params === null) { aliasMembers++; rows.push({ key, member: name, status: "ALIAS", alias: b.alias }); continue; }
    const dn = info.params.length, bn = b.params.length;
    if (dn === bn) arityOK++; else if (bn > dn) arityBodyMore++; else arityBodyFewer++;
    const k = `${name} ${dn}->${bn}`; arityDetail.set(k, (arityDetail.get(k) ?? 0) + 1);
  }
}
for (const [path, f] of found) {
  const d = declared.get(path);
  for (const name of f.statics.keys()) if (!d || !d.statics.has(name)) bodyOnly.add(`${path}.${name}`);
}

const out = {
  dts: { path: dtsPath, bytes: dtsSrc.length, classes: declared.size, enums: declaredEnums.size },
  js: { path: jsPath, bytes: jsSrc.length, iifeTypes, resolvedObjects: found.size },
  classes: { declared: declared.size, matched: matchedClasses, missing: missingClasses },
  members: { declared: declMembers, matched: matchedMembers, missing: missingMembers, alias: aliasMembers },
  arity: { same: arityOK, bodyMore: arityBodyMore, bodyFewer: arityBodyFewer },
  arityDetail: [...arityDetail.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30),
  bodyOnlyMembers: bodyOnly.size,
  bodyOnlySample: [...bodyOnly].slice(0, 20),
  missingSample: rows.filter((r) => r.status !== "ALIAS").slice(0, 20),
  aliasSample: rows.filter((r) => r.status === "ALIAS").slice(0, 10),
  orphanAssignments: orphanAssign.length,
};
/* the machine-readable correspondence, keyed exactly as the Node oracle
 * keys it, so corr-diff-jsdocarm.mjs can subtract the two. */
const astMembers = {};
let containmentViolations = 0, overlapViolations = 0;
const spans = [];
for (const [path, f] of found) {
  if (!declared.has(path)) continue;
  const rec = {};
  if (f.ctorParams) rec["#ctor"] = { arity: f.ctorParams.length, pos: f.ctorPos ?? -1, end: f.ctorEnd };
  for (const [name, b] of f.statics) {
    if (b.params === null) { rec[name] = { arity: -1, alias: b.alias }; continue; }
    rec[name] = { arity: b.params.length, pos: b.pos, end: b.end };
    /* every member must lie INSIDE its own type's IIFE: a correspondence
     * that points outside the type it names is not a correspondence. */
    if (f.iifeStart !== undefined && !(b.pos >= f.iifeStart && b.end <= f.iifeEnd)) containmentViolations++;
    spans.push([b.pos, b.end, path + "." + name]);
  }
  astMembers[path] = rec;
}
spans.sort((a, b) => a[0] - b[0]);
for (let i = 1; i < spans.length; i++) if (spans[i][0] < spans[i - 1][1]) overlapViolations++;
out.containmentViolations = containmentViolations;
out.overlapViolations = overlapViolations;
out.memberSpanBytes = spans.reduce((n, s) => n + (s[1] - s[0]), 0);

console.log(JSON.stringify(out, null, 2));
if (jsonAt) writeFileSync(jsonAt, JSON.stringify({ ...out, rows, astMembers, foundPaths: [...found.keys()] }, null, 2));
