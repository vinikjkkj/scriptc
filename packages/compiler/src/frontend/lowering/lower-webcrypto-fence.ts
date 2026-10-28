/* The WebCrypto value-flow fence. A WebCrypto value (the Crypto singleton, its
 * SubtleCrypto, or a CryptoKey) may flow only into places whose uses the compiler
 * can see: a statically resolved callee whose parameter is typed, a typed binding,
 * a typed return. Every other flow is refused at compile time, by name:
 *   E1  an argument to a dynamic or unresolved callee (its uses are not visible);
 *   E2  an argument bound to an any- or unknown-typed parameter;
 *   E3  a store into an any-typed target, or into a record or array literal;
 *   E4  a return through a function whose return annotation is any or unknown.
 * A SubtleCrypto importKey promise must be awaited (the key it carries escapes
 * otherwise). The observers below render or enumerate a value through a runtime
 * path the compiler models exactly (console, JSON.stringify, String), so they are
 * not escapes. */
import * as ts from "../ts7/adapter.js";
import type { Lowerer } from "./lowerer.js";
import { webCryptoKindOf } from "./lower-exprs.js";

const OBSERVERS: ReadonlySet<string> = new Set([
  "console.log", "console.info", "console.warn", "console.error", "console.debug", "JSON.stringify", "String",
  "Object.prototype.toString.call",
]);

/** The dotted spelling of a plain callee (`a.b.c`), or null. */
function calleeText(c: ts.Expression): string | null {
  if (ts.isIdentifier(c)) return c.text;
  if (ts.isPropertyAccessExpression(c)) {
    const head = calleeText(c.expression);
    return head === null ? null : `${head}.${c.name.text}`;
  }
  return null;
}

function isAnyish(L: Lowerer, n: ts.Node): boolean {
  return (L.typeOf(n).flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) !== 0;
}

function skipParens(n: ts.Node): ts.Node {
  let p = n;
  while (ts.isParenthesizedExpression(p.parent)) p = p.parent;
  return p.parent;
}

/** A call (or new) whose WebCrypto-valued arguments reach only visible uses. */
function checkCall(L: Lowerer, call: ts.CallExpression | ts.NewExpression): void {
  const args: readonly ts.Expression[] = call.arguments ?? [];
  const withKind = args.filter((a) => webCryptoKindOf(L, a) !== null);
  if (ts.isCallExpression(call) && ts.isPropertyAccessExpression(call.expression) && call.expression.name.text === "importKey" &&
      webCryptoKindOf(L, call.expression.expression) === "SubtleCrypto") {
    const parent = skipParens(call);
    if (!ts.isAwaitExpression(parent)) {
      L.unsupported("SC1090", call, "SubtleCrypto.importKey outside an await (the CryptoKey of an unawaited promise is a flow the compiler cannot see)");
    }
  }
  if (withKind.length === 0) return;
  if (ts.isCallExpression(call) && ts.isPropertyAccessExpression(call.expression) &&
      (webCryptoKindOf(L, call.expression.expression) === "SubtleCrypto" || webCryptoKindOf(L, call.expression.expression) === "Crypto")) {
    return; // a lowered WebCrypto member: the runtime checks its arguments
  }
  const text = ts.isCallExpression(call) ? calleeText(call.expression) : null;
  if (text !== null && OBSERVERS.has(text)) return;
  const sig = L.checker.getResolvedSignature(call);
  const decl = sig === undefined ? undefined : L.checker.signatureDeclaration(sig);
  // A library member is declared as a signature (`keys(o: {}): string[]` in ObjectConstructor): its typed parameters are checked the same way.
  const fnLike = decl !== undefined && (ts.isFunctionDeclaration(decl) || ts.isMethodDeclaration(decl) ||
    decl.kind === ts.SyntaxKind.MethodSignature || ts.isCallSignatureDeclaration(decl) || ts.isConstructSignatureDeclaration(decl) ||
    ts.isFunctionExpression(decl) || ts.isArrowFunction(decl) || ts.isConstructorDeclaration(decl));
  for (const a of withKind) {
    if (!fnLike) {
      L.unsupported("SC1090", a, "a WebCrypto value passed to a dynamic or unresolved callee (its uses are not visible to the compiler)");
      continue;
    }
    const params = (decl as ts.SignatureDeclaration).parameters;
    const i = args.indexOf(a);
    const param = i < params.length ? params[i] : params[params.length - 1];
    if (param === undefined || (i >= params.length && param.dotDotDotToken === undefined)) continue; // an unbound extra argument
    if (isAnyish(L, param.name)) {
      L.unsupported("SC1090", a, "a WebCrypto value passed to an any- or unknown-typed parameter (its uses are not visible to the compiler)");
    }
  }
}

/** A const binding is tracked by its initializer (webCryptoKindOf follows it), so
 * its any-typed declaration is not an untracked store. */
function isTrackedConst(target: ts.Node): boolean {
  const d = target.parent;
  return ts.isVariableDeclaration(d) && ts.isVariableDeclarationList(d.parent) && (d.parent.flags & ts.NodeFlags.Const) !== 0;
}

/** A store (assignment or declaration) of a WebCrypto value into an any-typed target. */
function checkStore(L: Lowerer, target: ts.Node, value: ts.Expression): void {
  if (webCryptoKindOf(L, value) === null) return;
  if (isAnyish(L, target) && !isTrackedConst(target)) {
    L.unsupported("SC1090", value, "a WebCrypto value stored into an any- or unknown-typed target (its uses are not visible to the compiler)");
  }
}

/** A record or array literal holding a WebCrypto value: its uses are not tracked. */
function checkLiteral(L: Lowerer, lit: ts.ObjectLiteralExpression | ts.ArrayLiteralExpression): void {
  const members: ts.Node[] = ts.isObjectLiteralExpression(lit)
    ? lit.properties.map((p) => (ts.isPropertyAssignment(p) ? p.initializer : ts.isShorthandPropertyAssignment(p) ? p.name : ts.isSpreadAssignment(p) ? p.expression : p))
    : [...lit.elements];
  for (const m of members) {
    const e: ts.Node = m;
    if (ts.isExpression(e) && webCryptoKindOf(L, e) !== null) {
      L.unsupported("SC1090", e, "a WebCrypto value stored in a record or array literal (its uses are not tracked)");
    }
  }
}

function enclosingFunction(n: ts.Node): ts.SignatureDeclaration | undefined {
  let p: ts.Node | undefined = n.parent;
  while (p !== undefined) {
    if (ts.isFunctionDeclaration(p) || ts.isFunctionExpression(p) || ts.isArrowFunction(p) || ts.isMethodDeclaration(p)) return p;
    p = p.parent;
  }
  return undefined;
}

/** A WebCrypto kind read from the checker's declared type alone (no spelling or const chain). */
function declaredKindOf(L: Lowerer, e: ts.Expression): string | null {
  const sym = L.typeOf(e).getSymbol();
  return sym !== undefined && (sym.name === "SubtleCrypto" || sym.name === "Crypto" || sym.name === "CryptoKey") ? sym.name : null;
}

/** A WebCrypto value returned from a function annotated any or unknown. */
function checkReturn(L: Lowerer, value: ts.Expression, fn: ts.SignatureDeclaration | undefined): void {
  if (fn === undefined) return;
  if (webCryptoKindOf(L, value) === null) return;
  // An unannotated function returns its inferred type; a value typed by its own
  // declared type (not by its spelling) keeps its uses visible to the caller.
  const typed = fn.type === undefined
    ? declaredKindOf(L, value) !== null
    : !isAnyish(L, fn.type);
  if (!typed) {
    L.unsupported("SC1090", value, "a WebCrypto value returned through a function whose return type is any or unknown (its uses are not visible)");
  }
}

/** The dispatcher: called for every expression and for the statements that bind or return. */
export function refuseWebCryptoFlowsAt(L: Lowerer, n: ts.Node): void {
  if (ts.isCallExpression(n) || ts.isNewExpression(n)) {
    checkCall(L, n);
  } else if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
    checkStore(L, n.left, n.right);
  } else if (ts.isObjectLiteralExpression(n) || ts.isArrayLiteralExpression(n)) {
    checkLiteral(L, n);
  } else if (ts.isVariableDeclaration(n) && n.initializer !== undefined && ts.isIdentifier(n.name)) {
    checkStore(L, n.name, n.initializer);
  } else if (ts.isReturnStatement(n) && n.expression !== undefined) {
    checkReturn(L, n.expression, enclosingFunction(n));
  } else if (ts.isArrowFunction(n) && !ts.isBlock(n.body)) {
    checkReturn(L, n.body, n);
  }
}
