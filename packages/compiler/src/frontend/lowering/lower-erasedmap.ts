/* A `Map<K, unknown>` PARAMETER THAT NEVER LOOKS AT A VALUE, and the typed map that flows into it.
 *
 * zapo-js's sender-key store declares `onEntryAccess(entries: Map<string, unknown>, key)` and calls it with a
 * `Map<string, SenderKeyRecord>`. A typed map stores record pointers, a `Map<string, unknown>` stores dyn boxes, so the two
 * are different static types and the flow is refused. But the callee only compares the map by identity, asks `size`/`has`,
 * deletes a key or hands the map to another parameter of the same kind: none of that reads or writes a value, and the runtime
 * map operations behind them (has, delete, size, clear, the identity compare) work from the map's own adapters, whatever the
 * value kind is. So the SAME pointer is passed, retyped (the `mapEraseView` node).
 *
 * The gate is per parameter and it covers EVERY declaration the call can reach: the declaration itself and every
 * same-named method of a class related to its class by `extends` (a virtual call may land on any of them). A single use
 * that could read or write a value, a declaration with no body, or a related declaration whose parameter is not itself a
 * `Map<_, unknown>` makes the parameter non-oblivious, and the flow keeps its compile-time refusal exactly as before.
 * Nothing here can turn into a run-time throw: a program that writes a foreign value through the erased view never passes
 * the gate. */
import * as ts from "../ts7/adapter.js";
import type { Lowerer } from "./lowerer.js";
import { typeEquals, type IrExpr, type IrType } from "../../ir/nodes.js";
import { declDescendsFrom } from "./lower-classes.js";

type ParamDecl = { fn: ts.FunctionLikeDeclaration; index: number };

const memo = new WeakMap<Lowerer, Map<string, boolean>>();
const byName = new WeakMap<Lowerer, Map<string, ts.MethodDeclaration[]>>();

/** Is `t` `Map<K, unknown>` (the value argument exactly `unknown`)? */
function isMapOfUnknown(L: Lowerer, t: ts.Type): boolean {
  const sym = t.getSymbol();
  if (sym === undefined || sym.name !== "Map") return false;
  const args = L.checker.getTypeArguments(t as ts.TypeReference);
  return args.length === 2 && (args[1]!.flags & ts.TypeFlags.Unknown) !== 0;
}

/** Is `t` a `Map<K, V>` whose V is NOT unknown or any (the typed side of the flow)? */
function isTypedMap(L: Lowerer, t: ts.Type): boolean {
  const sym = t.getSymbol();
  if (sym === undefined || sym.name !== "Map") return false;
  const args = L.checker.getTypeArguments(t as ts.TypeReference);
  return args.length === 2 && (args[1]!.flags & (ts.TypeFlags.Unknown | ts.TypeFlags.Any)) === 0;
}

function allMethodsNamed(L: Lowerer, name: string): ts.MethodDeclaration[] {
  let idx = byName.get(L);
  if (idx === undefined) {
    idx = new Map();
    byName.set(L, idx);
    for (const sf of L.program.getSourceFiles()) {
      if (sf.isDeclarationFile) continue;
      const stack: ts.Node[] = [sf];
      while (stack.length > 0) {
        const n = stack.pop()!;
        if (ts.isMethodDeclaration(n) && (ts.isClassDeclaration(n.parent) || ts.isClassExpression(n.parent)) && n.name !== undefined && (ts.isIdentifier(n.name) || ts.isPrivateIdentifier(n.name))) {
          const key = n.name.text;
          const list = idx.get(key);
          if (list === undefined) idx.set(key, [n]);
          else list.push(n);
        }
        ts.forEachChild(n, (c) => {
          stack.push(c);
        });
      }
    }
  }
  return idx.get(name) ?? [];
}

/** The declarations a call to `decl` can reach: itself, plus the related same-named methods (a class family). A non-method
 * declaration stands alone. Null = the family cannot be established (decline). */
function reachableDecls(L: Lowerer, decl: ts.SignatureDeclaration): ts.FunctionLikeDeclaration[] | null {
  if (!ts.isMethodDeclaration(decl) || !(ts.isClassDeclaration(decl.parent) || ts.isClassExpression(decl.parent)) || decl.name === undefined || !(ts.isIdentifier(decl.name) || ts.isPrivateIdentifier(decl.name))) {
    return ts.isFunctionDeclaration(decl) || ts.isMethodDeclaration(decl) || ts.isConstructorDeclaration(decl) ? [decl] : null;
  }
  const out: ts.FunctionLikeDeclaration[] = [decl];
  for (const m of allMethodsNamed(L, decl.name.text)) {
    if (m === decl) continue;
    const a = decl.parent as ts.ClassLikeDeclaration;
    const b = m.parent as ts.ClassLikeDeclaration;
    if (declDescendsFrom(L, a, b) || declDescendsFrom(L, b, a)) out.push(m);
  }
  return out;
}

/** Every use of parameter `p` in `fn`'s body is value-independent. `visiting` breaks mutual recursion (assumed oblivious). */
function usesAreValueFree(L: Lowerer, fn: ts.FunctionLikeDeclaration, p: ts.ParameterDeclaration, visiting: Set<string>): boolean {
  if (fn.body === undefined) return false;
  if (!ts.isIdentifier(p.name)) return false;
  const psym = L.checker.getSymbolAtLocation(p.name);
  if (psym === undefined) return false;
  let ok = true;
  const stack: ts.Node[] = [fn.body];
  while (ok && stack.length > 0) {
    const n = stack.pop()!;
    if (ts.isIdentifier(n) && n !== p.name && L.checker.getSymbolAtLocation(n) === psym) {
      if (!useIsValueFree(L, n, visiting)) ok = false;
      continue;
    }
    ts.forEachChild(n, (c) => {
      stack.push(c);
    });
  }
  return ok;
}

function useIsValueFree(L: Lowerer, id: ts.Identifier, visiting: Set<string>): boolean {
  const parent = id.parent;
  if (ts.isBinaryExpression(parent)) {
    const k = parent.operatorToken.kind;
    return k === ts.SyntaxKind.EqualsEqualsEqualsToken || k === ts.SyntaxKind.ExclamationEqualsEqualsToken ||
      k === ts.SyntaxKind.EqualsEqualsToken || k === ts.SyntaxKind.ExclamationEqualsToken;
  }
  if (ts.isPropertyAccessExpression(parent) && parent.expression === id) {
    const name = parent.name.text;
    if (name === "size") return true;
    if ((name === "has" || name === "delete" || name === "clear") && ts.isCallExpression(parent.parent) && parent.parent.expression === parent) return true;
    return false;
  }
  if ((ts.isCallExpression(parent) || ts.isNewExpression(parent)) && parent.expression !== id) {
    const args = parent.arguments;
    const i = args === undefined ? -1 : args.indexOf(id);
    if (i < 0) return false;
    const sig = L.checker.getResolvedSignature(parent);
    const d = sig === undefined ? undefined : L.checker.signatureDeclaration(sig);
    if (d === undefined) return false;
    return obliviousDecl(L, d as ts.SignatureDeclaration, i, visiting);
  }
  return false;
}

function obliviousDecl(L: Lowerer, decl: ts.SignatureDeclaration, index: number, visiting: Set<string>): boolean {
  const key = `${decl.getSourceFile().fileName}:${decl.pos}:${index}`;
  let cache = memo.get(L);
  if (cache === undefined) {
    cache = new Map();
    memo.set(L, cache);
  }
  const known = cache.get(key);
  if (known !== undefined) return known;
  if (visiting.has(key)) return true;
  visiting.add(key);
  let ok = true;
  const decls = reachableDecls(L, decl);
  if (decls === null) ok = false;
  else {
    for (const d of decls) {
      const param = d.parameters[index];
      if (param === undefined || param.dotDotDotToken !== undefined || !isMapOfUnknown(L, L.checker.getTypeAtLocation(param))) {
        ok = false;
        break;
      }
      if (!usesAreValueFree(L, d, param, visiting)) {
        ok = false;
        break;
      }
    }
  }
  visiting.delete(key);
  if (visiting.size === 0) cache.set(key, ok);
  return ok;
}

/** The argument `node` of a call whose resolved parameter is an oblivious `Map<K, unknown>` and whose own TS type is a typed
 * map: lower it as its own type and retype the SAME pointer. Null when the flow does not apply (the caller lowers as before). */
export function lowerErasedMapArg(L: Lowerer, node: ts.Expression, expected: IrType): IrExpr | null {
  if (expected.kind !== "map" || expected.value.kind !== "dyn" || expected.weak === true) return null;
  let at: ts.Node = node;
  while (ts.isParenthesizedExpression(at.parent)) at = at.parent;
  const call = at.parent;
  if (!(ts.isCallExpression(call) || ts.isNewExpression(call))) return null;
  const i = call.arguments?.indexOf(at as ts.Expression) ?? -1;
  if (i < 0) return null;
  if (!isTypedMap(L, L.checker.getTypeAtLocation(node))) return null;
  const sig = L.checker.getResolvedSignature(call);
  const d = sig === undefined ? undefined : L.checker.signatureDeclaration(sig);
  if (d === undefined || !obliviousDecl(L, d as ts.SignatureDeclaration, i, new Set())) {
    // The old refusal, with the reason: a typed map and a `Map<K, unknown>` are different representations, and the flow is
    // admitted only when no use of the parameter (in the callee or any override of it) can read or write a value.
    L.unsupported(
      "SC1090",
      node,
      `a '${L.fmt(L.mapTypeOf(L.checker.getTypeAtLocation(node)) ?? expected)}' passed to a 'Map<${L.fmt(expected.key)}, unknown>' parameter: the parameter is declared with unknown values, the typed map stores them unboxed, ` +
        `and the flow is only compiled when every use of the parameter (in the callee and in every override of it) is value-free (identity compare, size, has, delete, clear, or passing it on to another such parameter). ` +
        `This one reads or writes a value, has no body to inspect, or is not a method or function the compiler can resolve`,
    );
  }
  const inner = L.lowerExprExpecting(node, undefined);
  if (inner.type.kind !== "map" || inner.type.weak === true || !typeEquals(inner.type.key, expected.key)) {
    return L.coerceToExpected(inner, expected);
  }
  if (inner.type.value.kind === "dyn") return inner;
  return { kind: "mapEraseView", value: inner, type: expected, loc: inner.loc };
}
