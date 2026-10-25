/* The IMPLEMENTATION CLASS behind a declaration-file type.
 *
 * A package that ships `index.d.ts` beside `index.js` publishes two halves of
 * one module: the declaration names the types (mysql2's `Pool`, an interface
 * over a `declare class`) and the code builds the values (`PromisePool`, a
 * class the declaration never mentions). When the build compiles the code
 * (declTwinOf), every value of the declared type IS an instance of a class
 * in the twin, so mapping the declared type to a RECORD invents a second
 * representation of the same value: the instance has to be copied into it
 * (a snapshot: later field writes are lost and identity is gone) or refused.
 *
 * The declaration and the code agree through the module's exports, and that
 * is what is read here, from the checker alone and with no package names:
 *
 *   - a declared class/interface exported under the name the twin exports a
 *     class under is that class;
 *   - a declared function whose return type is a class/interface of the
 *     declaration (through Promise) and whose twin function returns an
 *     instance of one program class pairs the two;
 *   - a pair is followed through the members: a declared method returning
 *     another declaration type, matched by name against the impl class's
 *     method returning one program class, pairs those in turn.
 *
 * A declaration type with two different witnesses is ambiguous and keeps its
 * record mapping (no witness is better than a wrong one). */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import * as ts from "../ts7/adapter.js";
import type { Lowerer } from "./lowerer.js";

/** The runtime file a `require()` of a package's declaration file loads. The
 * checker resolves a bare specifier with the BUNDLER import condition, which can
 * name a different copy (long's root index.d.ts types an ESM twin); Node takes
 * the package's `exports` map under the "require" condition, and that branch's
 * `default` is the file the program compiles. `types` in the same branch is the
 * declaration the require pairs with. Returns null when the map has no require
 * branch (the caller keeps the checker's answer). */
export function requireBranchOf(pkgDir: string, subpath: string): { js: string; types: string | null } | null {
  let pkg: { exports?: unknown } | null = null;
  try {
    pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8")) as { exports?: unknown };
  } catch {
    return null;
  }
  const exp = pkg.exports as Record<string, unknown> | string | undefined;
  if (exp === undefined || exp === null) return null;
  const isSubpathMap = typeof exp === "object" && Object.keys(exp).some((k) => k.startsWith("."));
  let target: unknown = isSubpathMap ? (exp as Record<string, unknown>)[subpath] : subpath === "." ? exp : undefined;
  if (target === undefined) return null;
  if (typeof target === "object" && target !== null && !Array.isArray(target)) {
    target = (target as Record<string, unknown>)["require"];
  } else {
    return null;
  }
  const abs = (p: string): string => join(pkgDir, p.replace(/^\.\//, ""));
  if (typeof target === "string") return { js: abs(target), types: null };
  if (typeof target === "object" && target !== null) {
    const r = target as Record<string, unknown>;
    if (typeof r["default"] === "string") {
      return { js: abs(r["default"]), types: typeof r["types"] === "string" ? abs(r["types"]) : null };
    }
  }
  return null;
}

/** The nearest package root above `file` (the directory holding package.json). */
export function packageRootOf(file: string): string | null {
  let d = dirname(file);
  for (;;) {
    if (existsSync(join(d, "package.json"))) return d;
    const up = dirname(d);
    if (up === d) return null;
    d = up;
  }
}

/** The program's compiled source file the require of declaration file `dts`
 * under `spec` runs: its `require`-branch JS, found among the lowered files. */
export function requiredTwinOf(L: Lowerer, dts: ts.SourceFile, spec: string): ts.SourceFile | null {
  const pkgDir = packageRootOf(dts.fileName);
  if (pkgDir === null) return null;
  const parts = spec.split("/");
  const pkgName = spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]!;
  const rest = spec.slice(pkgName.length).replace(/^\//, "");
  const branch = requireBranchOf(pkgDir, rest === "" ? "." : `./${rest}`);
  if (branch === null) return null;
  for (const f of L.fileTag.keys()) {
    if (f.fileName === branch.js) return f;
  }
  return null;
}

/** null = conflicted (two different classes claimed it). */
type Witness = ts.ClassDeclaration | ts.FunctionDeclaration | null;

const tables = new WeakMap<Lowerer, Map<ts.Symbol, Witness>>();

function isExported(n: ts.Node): boolean {
  return ((n as { modifiers?: readonly ts.Node[] }).modifiers ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}

function resolveDecl(L: Lowerer, e: ts.Expression): ts.Node | null {
  let x: ts.Expression = e;
  while (ts.isParenthesizedExpression(x)) x = x.expression;
  if (ts.isFunctionExpression(x) || ts.isArrowFunction(x) || ts.isClassExpression(x)) return x;
  if (!ts.isIdentifier(x)) return null;
  let sym = L.checker.getSymbolAtLocation(x);
  // `const PromisePool = require('./lib/promise/pool.js')`: the binding is an
  // alias of the required module's export, and the class lives behind
  // `module.exports = PromisePool` over there.
  if (sym !== undefined && (sym.flags & ts.SymbolFlags.Alias) !== 0) sym = L.checker.getAliasedSymbol(sym);
  const d = sym ? L.checker.valueDeclarationOf(sym) : undefined;
  if (d === undefined) return null;
  if (ts.isFunctionDeclaration(d) || ts.isClassDeclaration(d)) return d;
  // `module.exports = Cls` / `export = Cls`: the class is the assigned value.
  if (ts.isBinaryExpression(d) && d.operatorToken.kind === ts.SyntaxKind.EqualsToken && d.left !== e) return resolveDecl(L, d.right);
  if (ts.isExportAssignment(d)) return resolveDecl(L, d.expression);
  if (ts.isVariableDeclaration(d) && d.initializer !== undefined) return resolveDecl(L, d.initializer);
  return null;
}

/** The names a twin module exports, each with the declaration behind it. */
function twinExports(L: Lowerer, twin: ts.SourceFile): Map<string, ts.Node> {
  const out = new Map<string, ts.Node>();
  const exportsTarget = (n: ts.Expression): string | null | "*" => {
    if (ts.isPropertyAccessExpression(n)) {
      const base = n.expression;
      if (ts.isIdentifier(base) && base.text === "exports") return n.name.text;
      if (
        ts.isPropertyAccessExpression(base) && ts.isIdentifier(base.expression) &&
        base.expression.text === "module" && base.name.text === "exports"
      ) {
        return n.name.text;
      }
      if (ts.isIdentifier(base) && base.text === "module" && n.name.text === "exports") return "*";
    }
    return null;
  };
  for (const st of twin.statements) {
    if ((ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st)) && st.name !== undefined && isExported(st)) {
      out.set(st.name.text, st);
      continue;
    }
    if (!ts.isExpressionStatement(st) || !ts.isBinaryExpression(st.expression)) continue;
    const be = st.expression;
    if (be.operatorToken.kind !== ts.SyntaxKind.EqualsToken) continue;
    const target = exportsTarget(be.left);
    if (target === null) continue;
    if (target === "*") {
      let r: ts.Expression = be.right;
      while (ts.isParenthesizedExpression(r)) r = r.expression;
      if (!ts.isObjectLiteralExpression(r)) continue;
      for (const p of r.properties) {
        if (ts.isShorthandPropertyAssignment(p) && ts.isIdentifier(p.name)) {
          const sym = L.checker.getShorthandAssignmentValueSymbol(p);
          const d = sym ? L.checker.valueDeclarationOf(sym) : undefined;
          if (d !== undefined && (ts.isFunctionDeclaration(d) || ts.isClassDeclaration(d))) out.set(p.name.text, d);
        } else if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name)) {
          const d = resolveDecl(L, p.initializer);
          if (d !== null) out.set(p.name.text, d);
        }
      }
      continue;
    }
    const d = resolveDecl(L, be.right);
    if (d !== null) out.set(target, d);
  }
  return out;
}

function awaited(L: Lowerer, t: ts.Type): ts.Type {
  const a = L.checker.getAwaitedType(t);
  return a ?? t;
}

/** The program class an expression of type `t` is an instance of, or null. */
function implClassOf(L: Lowerer, t: ts.Type): ts.ClassDeclaration | null {
  const sym = t.getSymbol();
  const d = sym ? L.checker.valueDeclarationOf(sym) : undefined;
  if (d === undefined || !ts.isClassDeclaration(d) || d.getSourceFile().isDeclarationFile) return null;
  if (d.typeParameters !== undefined || d.name === undefined) return null;
  if (L.checker.getConstructSignatures(t).length > 0) return null; // the static side
  return d;
}

function returnClassOfFn(L: Lowerer, fn: ts.Node): ts.ClassDeclaration | null {
  if (!(ts.isFunctionDeclaration(fn) || ts.isFunctionExpression(fn) || ts.isArrowFunction(fn))) return null;
  const sig = L.checker.getSignatureFromDeclaration(fn);
  if (sig === undefined) return null;
  return implClassOf(L, awaited(L, L.checker.getReturnTypeOfSignature(sig)));
}

function declTypeSymbol(L: Lowerer, t: ts.Type): ts.Symbol | null {
  const sym = t.getSymbol();
  if (sym === undefined) return null;
  const decls = L.checker.declarationsOf(sym);
  if (decls.length === 0) return null;
  const ok = decls.every(
    (d) =>
      (ts.isClassDeclaration(d) || ts.isInterfaceDeclaration(d)) &&
      d.typeParameters === undefined &&
      d.getSourceFile().isDeclarationFile &&
      !L.isStdlibFile(d.getSourceFile()) &&
      L.declTwinCompiled(d.getSourceFile()),
  );
  return ok ? sym : null;
}

/** The class a declaration file's `export = X` names (X an imported or local
 * declared class), as its type symbol, or null. The class need not live in the
 * declaration file that holds the `export =` (umd/index.d.ts re-exports the
 * class declared in types.d.ts), and its own file has no twin of its own. */
function exportEqualsClassSymbol(L: Lowerer, e: ts.Expression): ts.Symbol | null {
  let sym = L.checker.getSymbolAtLocation(e);
  if (sym !== undefined && (sym.flags & ts.SymbolFlags.Alias) !== 0) sym = L.checker.getAliasedSymbol(sym);
  if (sym === undefined) return null;
  const decls = L.checker.declarationsOf(sym);
  const ok = decls.length > 0 && decls.every(
    (d) => ts.isClassDeclaration(d) && d.typeParameters === undefined && d.getSourceFile().isDeclarationFile &&
      !L.isStdlibFile(d.getSourceFile()),
  );
  if (!ok) return null;
  return sym;
}

/** The declaration the twin's `module.exports = X` assigns (X a function or
 * class declared in the twin), or null. */
export function cjsModuleExportsDecl(L: Lowerer, twin: ts.SourceFile): ts.Node | null {
  for (const st of twin.statements) {
    if (!ts.isExpressionStatement(st) || !ts.isBinaryExpression(st.expression)) continue;
    const be = st.expression;
    if (be.operatorToken.kind !== ts.SyntaxKind.EqualsToken) continue;
    const l = be.left;
    if (!ts.isPropertyAccessExpression(l) || l.name.text !== "exports" || !ts.isIdentifier(l.expression) ||
        l.expression.text !== "module") continue;
    const d = resolveDecl(L, be.right);
    if (d !== null && (ts.isFunctionDeclaration(d) || ts.isClassDeclaration(d)) && !d.getSourceFile().isDeclarationFile) return d;
    return null;
  }
  return null;
}

function buildTable(L: Lowerer): Map<ts.Symbol, Witness> {
  const table = new Map<ts.Symbol, Witness>();
  const work: [ts.Symbol, ts.ClassDeclaration | ts.FunctionDeclaration][] = [];
  const pairUp = (x: ts.Symbol, c: ts.ClassDeclaration | ts.FunctionDeclaration): void => {
    if (!table.has(x)) {
      table.set(x, c);
      work.push([x, c]);
    } else if (table.get(x) !== c) {
      table.set(x, null);
    }
  };
  for (const D of L.moduleOrder) {
    if (!D.isDeclarationFile) continue;
    const T = L.declTwinSourceOf(D);
    if (T === null) continue;
    const exp = twinExports(L, T);
    for (const st of D.statements) {
      // `export = X` pairs the declared class with the twin's `module.exports`
      // value, which is what the import binds (a CJS constructor function
      // carries its prototype methods; the d.ts class is its surface).
      if (ts.isExportAssignment(st) && st.isExportEquals) {
        const xs = exportEqualsClassSymbol(L, st.expression);
        const impl = cjsModuleExportsDecl(L, T);
        if (xs !== null && impl !== null && (ts.isFunctionDeclaration(impl) || ts.isClassDeclaration(impl))) pairUp(xs, impl);
        continue;
      }
      if (!isExported(st)) continue;
      if ((ts.isClassDeclaration(st) || ts.isInterfaceDeclaration(st)) && st.name !== undefined) {
        const impl = exp.get(st.name.text);
        if (impl !== undefined && ts.isClassDeclaration(impl) && !impl.getSourceFile().isDeclarationFile) {
          const sym = L.checker.getSymbolAtLocation(st.name);
          const ty = sym ? L.checker.getDeclaredTypeOfSymbol(sym) : undefined;
          const xs = ty ? declTypeSymbol(L, ty) : null;
          if (xs !== null && impl.typeParameters === undefined) pairUp(xs, impl);
        }
        continue;
      }
      if (ts.isFunctionDeclaration(st) && st.name !== undefined) {
        const implFn = exp.get(st.name.text);
        if (implFn === undefined) continue;
        const cls = returnClassOfFn(L, implFn);
        if (cls === null) continue;
        const sig = L.checker.getSignatureFromDeclaration(st);
        if (sig === undefined) continue;
        const ys = declTypeSymbol(L, awaited(L, L.checker.getReturnTypeOfSignature(sig)));
        if (ys !== null) pairUp(ys, cls);
      }
    }
  }
  while (work.length > 0) {
    const [x, c] = work.pop()!;
    // A constructor function pairs as a whole value; its members are not walked.
    if (!ts.isClassDeclaration(c)) continue;
    const xType = L.checker.getDeclaredTypeOfSymbol(x);
    const cSym = c.name !== undefined ? L.checker.getSymbolAtLocation(c.name) : undefined;
    if (cSym === undefined) continue;
    const cType = L.checker.getDeclaredTypeOfSymbol(cSym);
    for (const p of L.checker.getPropertiesOfType(xType)) {
      const sigs = L.checker.getCallSignatures(L.checker.getTypeOfSymbol(p));
      if (sigs.length === 0) continue;
      const q = L.checker.getPropertyOfType(cType, p.name);
      if (q === undefined) continue;
      const qsigs = L.checker.getCallSignatures(L.checker.getTypeOfSymbol(q));
      if (qsigs.length === 0) continue;
      const qCls = implClassOf(L, awaited(L, L.checker.getReturnTypeOfSignature(qsigs[0]!)));
      if (qCls === null) continue;
      for (const sg of sigs) {
        const ys = declTypeSymbol(L, awaited(L, L.checker.getReturnTypeOfSignature(sg)));
        if (ys !== null) pairUp(ys, qCls);
      }
    }
  }
  return table;
}

/** The implementation class of the declaration-file type `t`, or null. */
export function dtsWitnessClassOf(L: Lowerer, t: ts.Type): ts.ClassDeclaration | ts.FunctionDeclaration | null {
  const sym = t.getSymbol();
  if (sym === undefined) return null;
  const decls = L.checker.declarationsOf(sym);
  if (decls.length === 0 || !decls.every((d) => d.getSourceFile().isDeclarationFile)) return null;
  let table = tables.get(L);
  if (table === undefined) {
    table = new Map();
    tables.set(L, table);
    for (const [k, v] of buildTable(L)) table.set(k, v);
  }
  return table.get(sym) ?? null;
}
