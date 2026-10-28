/* ABSENT REQUIRE MEMBERS: `new X(...)` and `X(...)` where X is a member that
 * Node's own resolution of the required module does not define.
 *
 *   const { CloudflareSocket } = require('pg-cloudflare')   // const binding
 *   new CloudflareSocket(ssl)                                // Node: TypeError
 *   const ns = require('pg-cloudflare'); new ns.CloudflareSocket(ssl)
 *
 * pg-cloudflare's package.json maps "exports" to a workerd-only entry and a
 * "default" entry (dist/empty.js: `exports.default = {}`). Under Node's
 * require conditions that empty module is what loads, so `CloudflareSocket`
 * is undefined and the construction throws Node's
 * "CloudflareSocket is not a constructor". The checker still sees the
 * package's declarations, so without this module the construction is a
 * generic "constructing values other than classes declared in the program"
 * refusal at the site.
 *
 * The answer is exact only when every premise holds, and each one is
 * checked (anything else keeps the refusal it has):
 *   - the callee is a `const` binding (BindingElement of a const object
 *     pattern, or a const identifier) whose initializer is a literal-spec
 *     `require(spec)`, with no default value and no rest element;
 *   - the resolved file under Node's require conditions is read and its
 *     complete export surface is KNOWN: every top-level statement that
 *     touches `exports` is `exports.NAME = ...` or
 *     `Object.defineProperty(exports, "NAME", ...)`, and nothing else in the
 *     file mentions `exports`, `module` or a top-level `this`;
 *   - the name is not a property of Object.prototype (those resolve on every
 *     object);
 *   - the module OBJECT cannot be reached except through the const reads:
 *     every literal require in the program that resolves to the same file is
 *     the initializer of a const binding and used only for reads (an object
 *     destructuring of plain identifiers, or `ns.NAME` reads of a const
 *     namespace); no ESM import/export or literal dynamic import names it. A
 *     run-time specifier (require or import()) is a compile refusal wherever
 *     it is lowered, so it is no second path. The
 *     module's own file writes nothing beyond the surface above, so no other
 *     write can define NAME.
 *
 * Node evaluates the arguments first and throws at the call (measured on
 * v24.15.0): `new X(f())` runs f, then throws. The lowering therefore
 * evaluates the arguments into the dynamic pack and hands an undefined
 * callee to the dynamic construct/call op, whose "<text> is not a
 * constructor" / "<text> is not a function" TypeError is Node's text for the
 * callee spelled as written (outer parentheses dropped). Spread arguments keep
 * their refusal. All walks are iterative (explicit stacks), so they stay clear
 * of the compiler's nesting-depth guard. */
import * as ts from "../ts7/adapter.js";
import { dirname, isAbsolute, join, resolve as resolvePath } from "node:path";
import type { Lowerer } from "./lowerer.js";
import { dynUndefinedExpr } from "./lowerer.js";
import { DYN, IrExpr, SrcLoc, STRING } from "../../ir/nodes.js";
import { locOf, requireSpecOf } from "../program.js";
import { canonicalBuiltinModule, isRelativeSpecifier } from "../shared.js";
import { completeCjsExportNames } from "../cjs-lexer.js";
import { resolveBareModule } from "../resolve.js";
import { resolveExports } from "../npm.js";
import { trackedFileExists, trackedReadFile } from "../input-tracker.js";
import { provenanceInstalledCounterpart } from "../provenance-registry.js";

interface AbsentSite {
  /** The member Node looks up on the required module. */
  member: string;
  /** The callee spelled the way V8 prints it in the TypeError. */
  text: string;
  /** The require specifier. */
  spec: string;
  /** The file the site is written in (the require resolves from here). */
  from: string;
}

/** The constant-binding require behind a callee identifier, or null. */
function bindingSiteOfIdentifier(L: Lowerer, id: ts.Identifier): AbsentSite | null {
  const sym = L.checker.getSymbolAtLocation(id);
  const decl = sym ? L.checker.declarationsOf(sym)[0] : undefined;
  if (decl === undefined) return null;
  if (ts.isBindingElement(decl)) {
    if (decl.name === undefined || !ts.isIdentifier(decl.name) || decl.name.text !== id.text) return null;
    if (decl.dotDotDotToken !== undefined || decl.initializer !== undefined) return null;
    const pattern = decl.parent;
    if (!ts.isObjectBindingPattern(pattern)) return null;
    const vd = pattern.parent;
    if (!ts.isVariableDeclaration(vd) || vd.initializer === undefined || vd.name === undefined || !ts.isObjectBindingPattern(vd.name)) return null;
    if (!isConstDeclaration(vd)) return null;
    const spec = requireSpecOf(vd.initializer);
    if (spec === null) return null;
    let member = decl.name.text;
    const pn = decl.propertyName;
    if (pn !== undefined) {
      if (ts.isIdentifier(pn) || ts.isStringLiteral(pn)) member = pn.text;
      else return null;
    }
    return { member, text: id.text, spec, from: id.getSourceFile().fileName };
  }
  return null;
}

/** The constant namespace binding `const ns = require(spec)` behind `ns`. */
function namespaceSpecOf(L: Lowerer, id: ts.Identifier): string | null {
  const sym = L.checker.getSymbolAtLocation(id);
  const decl = sym ? L.checker.declarationsOf(sym)[0] : undefined;
  if (decl === undefined || !ts.isVariableDeclaration(decl)) return null;
  if (decl.name === undefined || !ts.isIdentifier(decl.name) || decl.initializer === undefined) return null;
  if (!isConstDeclaration(decl)) return null;
  return requireSpecOf(decl.initializer);
}

function isConstDeclaration(vd: ts.VariableDeclaration): boolean {
  const list = vd.parent;
  return ts.isVariableDeclarationList(list) && (ts.getCombinedNodeFlags(list) & ts.NodeFlags.Const) !== 0;
}

/** The site a `new`/call callee names, or null. `new (ns.X)` spells as
 * `ns.X` in V8's message, so parentheses drop. */
function absentSiteOf(L: Lowerer, callee: ts.Expression): AbsentSite | null {
  let e = callee;
  while (ts.isParenthesizedExpression(e)) e = e.expression;
  if (ts.isIdentifier(e)) return bindingSiteOfIdentifier(L, e);
  if (
    ts.isPropertyAccessExpression(e) &&
    e.questionDotToken === undefined &&
    ts.isIdentifier(e.expression) &&
    ts.isIdentifier(e.name)
  ) {
    const spec = namespaceSpecOf(L, e.expression);
    if (spec === null) return null;
    return { member: e.name.text, text: `${e.expression.text}.${e.name.text}`, spec, from: e.getSourceFile().fileName };
  }
  return null;
}

/** Node's require target for `spec` from `fromFile`, or null when this module
 * cannot name it exactly. Relative specifiers take the exact file or `.js`;
 * bare specifiers take the package's "exports" entry under the require
 * conditions (the same table npm.ts answers the runtime with). */
function nodeRequireTargetOf(fromFile: string, spec: string): string | null {
  if (isRelativeSpecifier(spec)) {
    const base = resolvePath(dirname(fromFile), spec);
    for (const cand of [base, `${base}.js`]) {
      if (trackedFileExists(cand) && /\.(c?js)$/.test(cand)) return cand;
    }
    return null;
  }
  if (spec.startsWith("#") || spec.startsWith("node:")) return null;
  // A provenance-mapped source file (a cache checkout with no node_modules)
  // resolves its bare requires where the package is INSTALLED: the same
  // answer provenance.ts gives the package's own bare imports.
  const requirer = provenanceInstalledCounterpart(fromFile) ?? fromFile;
  const resolved = resolveBareModule(requirer, spec);
  if (resolved === null) return null;
  // The types file sits inside the package; walk up to its package.json.
  let dir = dirname(resolved.typesFile);
  for (;;) {
    const text = trackedReadFile(join(dir, "package.json"));
    if (text !== null) {
      let pkg: { name?: unknown; exports?: unknown } | null = null;
      try {
        pkg = JSON.parse(text) as { name?: unknown; exports?: unknown };
      } catch {
        return null;
      }
      if (pkg.name !== resolved.packageName || pkg.exports === undefined) return null;
      const rest = spec.slice(resolved.packageName.length).replace(/^\//, "");
      const subpath = rest === "" ? "." : `./${rest}`;
      const target = resolveExports(pkg.exports, subpath, "require");
      if (target === null || !isPackageTarget(target)) return null;
      const file = join(dir, target);
      if (!/\.(c?js)$/.test(file) || !trackedFileExists(file)) return null;
      return file;
    }
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

function isPackageTarget(target: string): boolean {
  return target.startsWith("./") && !isAbsolute(target) && !target.includes("..");
}

/** Every node under `root`, root included (explicit stack, pre-order). */
function nodesOf(root: ts.Node): ts.Node[] {
  const out: ts.Node[] = [];
  const stack: ts.Node[] = [root];
  while (stack.length > 0) {
    const n = stack.pop()!;
    out.push(n);
    const kids: ts.Node[] = [];
    ts.forEachChild(n, (c) => {
      kids.push(c);
    });
    for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]!);
  }
  return out;
}

/** Node identity across the adapter: its child and parent accessors hand out
 * fresh handles, so `===` between two of them is false for one node. */
function sameNode(a: ts.Node | undefined, b: ts.Node): boolean {
  return a !== undefined && a.kind === b.kind && a.pos === b.pos && a.end === b.end;
}

/** The declaration a symbol-bearing identifier refers to, or undefined. */
function declOfIdentifier(L: Lowerer, id: ts.Identifier): ts.Node | undefined {
  const sym = L.checker.getSymbolAtLocation(id);
  return sym ? L.checker.declarationsOf(sym)[0] : undefined;
}

/** True when a const require value (the call `call`) is used for reads only:
 * an object destructuring of plain identifiers, or a const namespace every
 * reference of which is a `ns.NAME` read (not an assignment, delete, or
 * update). */
function requireValueUsedForReads(L: Lowerer, call: ts.CallExpression): boolean {
  const p = call.parent;
  if (p === undefined || !ts.isVariableDeclaration(p) || p.initializer === undefined) return false;
  if (!sameNode(p.initializer, call) || !isConstDeclaration(p)) return false;
  const name = p.name;
  if (name === undefined) return false;
  if (ts.isObjectBindingPattern(name)) {
    return name.elements.every(
      (el) => el.dotDotDotToken === undefined && el.initializer === undefined && el.name !== undefined && ts.isIdentifier(el.name),
    );
  }
  if (!ts.isIdentifier(name)) return false;
  const bound: ts.Identifier = name;
  for (const sf of L.program.getSourceFiles()) {
    if (!sf.text.includes(bound.text)) continue;
    for (const n of nodesOf(sf)) {
      if (!ts.isIdentifier(n) || n.text !== bound.text || sameNode(bound, n)) continue;
      if (!sameDecl(declOfIdentifier(L, n), p)) continue;
      const q = n.parent;
      if (q === undefined || !ts.isPropertyAccessExpression(q) || !sameNode(q.expression, n)) return false;
      const up = q.parent;
      if (up === undefined) continue;
      if (
        (ts.isBinaryExpression(up) && sameNode(up.left, q) &&
          up.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && up.operatorToken.kind <= ts.SyntaxKind.LastAssignment) ||
        ts.isPrefixUnaryExpression(up) || ts.isPostfixUnaryExpression(up) || ts.isDeleteExpression(up)
      ) {
        return false;
      }
    }
  }
  return true;
}

function sameDecl(a: ts.Node | undefined, b: ts.Node): boolean {
  return a !== undefined && sameNode(a, b);
}

/** True when the program could reach the module object of `target` other
 * than through the const reads of `requireValueUsedForReads`: an ESM import
 * or export-from of it, a dynamic import of it, a literal require of it used
 * any other way, or a non-literal require (which could name anything). */
function moduleObjectEscapes(L: Lowerer, target: string): boolean {
  for (const sf of L.program.getSourceFiles()) {
    for (const n of nodesOf(sf)) {
      if (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) {
        const m = n.moduleSpecifier;
        if (m !== undefined && ts.isStringLiteral(m) && escapesVia(sf.fileName, m.text, target)) return true;
        continue;
      }
      if (ts.isImportEqualsDeclaration(n) && ts.isExternalModuleReference(n.moduleReference)) {
        const x = n.moduleReference.expression;
        if (x !== undefined && ts.isStringLiteral(x) && escapesVia(sf.fileName, x.text, target)) return true;
        continue;
      }
      if (!ts.isCallExpression(n)) continue;
      const callee = n.expression;
      const isDynamicImport = callee.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(callee) && callee.text === "require";
      if (!isDynamicImport && !isRequire) continue;
      const arg = n.arguments[0];
      // A run-time specifier (require or import()) is a compile refusal wherever
      // it is lowered (lower-builtins runtimeSpecifierRequire for require; a
      // lowered import() of a non-literal is SC2012, measured on this box), so
      // it cannot be a silent second path to the object. Where it is not
      // lowered it never runs.
      if (arg === undefined || !ts.isStringLiteral(arg)) continue;
      if (!escapesVia(sf.fileName, arg.text, target)) continue;
      if (isRequire && requireValueUsedForReads(L, n)) continue;
      return true;
    }
  }
  return false;
}

/** True when `spec` from `fromFile` names the target file under Node's own
 * resolution. Builtins are Node's modules, never a program file. */
function escapesVia(fromFile: string, spec: string, target: string): boolean {
  if (canonicalBuiltinModule(spec) !== null) return false;
  return nodeRequireTargetOf(fromFile, spec) === target;
}

/** The statically absent member behind a construct/call callee, or null. */
function absentMemberOf(L: Lowerer, callee: ts.Expression): AbsentSite | null {
  const site = absentSiteOf(L, callee);
  if (site === null) return null;
  if (site.member in Object.prototype) return null;
  const target = nodeRequireTargetOf(site.from, site.spec);
  if (target === null) return null;
  const text = trackedReadFile(target);
  if (text === null) return null;
  const names = completeCjsExportNames(text, target);
  if (names === null || names.has(site.member)) return null;
  if (moduleObjectEscapes(L, target)) return null;
  return site;
}

/** `new X(...)` with X statically absent from its required module. */
export function lowerAbsentRequireNew(L: Lowerer, expr: ts.NewExpression, loc: SrcLoc): IrExpr | null {
  if (L.dynamic) return null;
  const args = expr.arguments ?? [];
  if (args.some((a) => ts.isSpreadElement(a))) return null;
  const site = absentMemberOf(L, expr.expression);
  if (site === null) return null;
  const pack: IrExpr = { kind: "dynArrLit", elems: args.map((a) => L.lowerExprExpecting(a, DYN)), type: DYN, loc };
  return {
    kind: "libCall",
    fn: "dyn.construct",
    args: [dynUndefinedExpr(loc), pack, { kind: "strLit", value: site.text, type: STRING, loc }],
    type: DYN,
    loc,
  };
}

/** `X(...)` with X statically absent from its required module. */
export function lowerAbsentRequireCall(L: Lowerer, expr: ts.CallExpression): IrExpr | null {
  if (L.dynamic) return null;
  if (expr.arguments.some((a) => ts.isSpreadElement(a))) return null;
  if (ts.isPropertyAccessExpression(expr.expression) && expr.expression.questionDotToken !== undefined) return null;
  const site = absentMemberOf(L, expr.expression);
  if (site === null) return null;
  return {
    kind: "dynCall",
    callee: dynUndefinedExpr(locOf(expr)),
    calleeName: site.text,
    args: expr.arguments.map((a) => L.lowerExprExpecting(a, DYN)),
    type: DYN,
    loc: locOf(expr),
  };
}
