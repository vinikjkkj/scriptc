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
import * as ts from "../ts7/adapter.js";
import type { Lowerer } from "./lowerer.js";

/** null = conflicted (two different classes claimed it). */
type Witness = ts.ClassDeclaration | null;

const tables = new WeakMap<Lowerer, Map<ts.Symbol, Witness>>();

function isExported(n: ts.Node): boolean {
  return ((n as { modifiers?: readonly ts.Node[] }).modifiers ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}

function resolveDecl(L: Lowerer, e: ts.Expression): ts.Node | null {
  let x: ts.Expression = e;
  while (ts.isParenthesizedExpression(x)) x = x.expression;
  if (ts.isFunctionExpression(x) || ts.isArrowFunction(x) || ts.isClassExpression(x)) return x;
  if (!ts.isIdentifier(x)) return null;
  const sym = L.checker.getSymbolAtLocation(x);
  const d = sym ? L.checker.valueDeclarationOf(sym) : undefined;
  if (d === undefined) return null;
  if (ts.isFunctionDeclaration(d) || ts.isClassDeclaration(d)) return d;
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

function buildTable(L: Lowerer): Map<ts.Symbol, Witness> {
  const table = new Map<ts.Symbol, Witness>();
  const work: [ts.Symbol, ts.ClassDeclaration][] = [];
  const pairUp = (x: ts.Symbol, c: ts.ClassDeclaration): void => {
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
export function dtsWitnessClassOf(L: Lowerer, t: ts.Type): ts.ClassDeclaration | null {
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
