/* EMPTY-COLLECTION PIN: a fresh `new Map()` / `new Set()` takes the type of the place it flows into.
 *
 * THE DEFECT. An untyped `new Map()` is `Map<any, any>` to the checker whenever nothing types it at the
 * expression: the checker's own contextual type there is the unbound `T` of a generic callee
 * (`this.withTransaction(async (conn) => ({ ..., indexValueMap: new Map() }))`, T inferred FROM that literal).
 * `Map<any, any>` has no static mapping (any keys), so the whole function's return type, and every use of the
 * result, was refused (SC2009). Node does not care: the map is empty, and the program only ever reads it as the
 * `ReadonlyMap<string, Uint8Array>` its declared result says.
 *
 * WHY THE REPAIR IS EXACT. The collection is FRESH and EMPTY: no key or value of any type is in it, so retyping it
 * to the Map<K, V> (Set<E>) its destination declares changes no value. The pin only fires where it can prove the
 * destination: it walks outward from the expression through an object literal member, a `return` / arrow body, and
 * an argument of a generic call, binding the callee's type parameters from the call's OWN expected type (the
 * declared return type of the enclosing function), and takes the member's declared type there. Anything it cannot
 * prove it leaves alone (the program keeps its refusal).
 *
 * The text edit is the retype pin's replacement form: `new Map()` becomes `new Map<string, Uint8Array>()`, and the
 * program is re-served so the checker types the binding that way everywhere it flows. */
import * as ts from "./ts7/adapter.js";
import type { RetypePin } from "./retype-pin.js";

const COLLECTIONS = new Set(["Map", "Set"]);
const MAX_DEPTH = 14;

function nameableArg(text: string): boolean {
  return !/\bany\b|\bunknown\b|typeof |import\(|\bthis\b|\{|=>/.test(text) && /^[A-Za-z0-9_$<>[\]|, .]+$/.test(text);
}

export function computeEmptyCollectionPins(program: ts.Program): Map<string, RetypePin[]> {
  const checker = program.getTypeChecker();
  const out = new Map<string, RetypePin[]>();

  const refName = (t: ts.Type): string | undefined => t.getSymbol()?.name;
  const typeArgsOf = (t: ts.Type): readonly ts.Type[] => {
    try {
      return checker.getTypeArguments(t as ts.TypeReference);
    } catch {
      return [];
    }
  };
  /** The declared type of member `name` of `t`, or of the one type every union arm that has it agrees on. */
  const memberType = (t: ts.Type, name: string): ts.Type | undefined => {
    const arms = t.isUnionType() ? ts.constituentTypes(t) : [t];
    let found: ts.Type | undefined;
    for (const a of arms) {
      const sym = checker.getPropertyOfType(a, name);
      if (sym === undefined) continue;
      const mt = checker.getNonNullableType(checker.getTypeOfSymbol(sym));
      if (found !== undefined && checker.typeToString(found) !== checker.typeToString(mt)) return undefined;
      found = mt;
    }
    return found;
  };
  const awaitedOf = (t: ts.Type): ts.Type => {
    if (refName(t) === "Promise") {
      const a = typeArgsOf(t);
      if (a.length === 1) return a[0]!;
    }
    return t;
  };
  const isAsync = (fn: ts.Node): boolean => {
    const mods = (fn as { modifiers?: readonly { kind: number }[] }).modifiers;
    return mods?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) ?? false;
  };

  /** Binds the type parameters named in `declType` against `expected` (Promise<T> vs Promise<X>, T vs X, U[] vs X[]). */
  const bind = (declType: ts.Node | undefined, expected: ts.Type, tparams: Set<string>, into: Map<string, ts.Type>): void => {
    if (declType === undefined) return;
    if (ts.isTypeReferenceNode(declType)) {
      const n = declType.typeName.getText();
      if (tparams.has(n)) {
        if (!into.has(n)) into.set(n, expected);
        return;
      }
      const args = declType.typeArguments;
      if (args !== undefined && args.length === 1 && n === "Promise") {
        // A Promise<X> result in an async function's return position is expected as the awaited type itself.
        bind(args[0], refName(expected) === "Promise" ? typeArgsOf(expected)[0]! : expected, tparams, into);
      }
      return;
    }
    if (ts.isArrayTypeNode(declType) && (checker.isArrayType(expected) || refName(expected) === "ReadonlyArray" || refName(expected) === "Array")) {
      const a = typeArgsOf(expected);
      if (a.length === 1) bind(declType.elementType, a[0]!, tparams, into);
    }
  };
  const resolveNode = (node: ts.Node | undefined, bound: Map<string, ts.Type>): { type: ts.Type; promise: boolean } | undefined => {
    if (node === undefined || !ts.isTypeReferenceNode(node)) return undefined;
    const n = node.typeName.getText();
    const hit = bound.get(n);
    if (hit !== undefined) return { type: hit, promise: false };
    if (n === "Promise" && node.typeArguments?.length === 1) {
      const inner = resolveNode(node.typeArguments[0], bound);
      return inner === undefined ? undefined : { type: inner.type, promise: true };
    }
    return undefined;
  };

  /** The type the value of `n` is expected to have where it lands, or undefined when it cannot be proved. */
  const expectedOf = (n: ts.Node, depth: number): ts.Type | undefined => {
    if (depth > MAX_DEPTH) return undefined;
    const p = n.parent;
    if (p === undefined) return undefined;
    if (ts.isParenthesizedExpression(p) || ts.isNonNullExpression(p) || ts.isAwaitExpression(p)) {
      return expectedOf(p, depth + 1);
    }
    if (ts.isPropertyAssignment(p) && p.initializer === n && ts.isObjectLiteralExpression(p.parent)) {
      const name = ts.isIdentifier(p.name) || ts.isStringLiteral(p.name) ? p.name.text : undefined;
      if (name === undefined) return undefined;
      const host = expectedOf(p.parent, depth + 1);
      return host === undefined ? undefined : memberType(host, name);
    }
    if (ts.isShorthandPropertyAssignment(p)) return undefined;
    if (ts.isVariableDeclaration(p) && p.initializer === n && p.type !== undefined) return checker.getTypeFromTypeNode(p.type);
    // A returned value (a `return` statement or an arrow's expression body).
    let fn: ts.Node | undefined;
    if (ts.isReturnStatement(p)) {
      for (let q: ts.Node | undefined = p.parent; q !== undefined; q = q.parent) {
        if (ts.isFunctionLike(q)) {
          fn = q;
          break;
        }
      }
    } else if (ts.isArrowFunction(p) && p.body === n) {
      fn = p;
    }
    if (fn === undefined) return undefined;
    const declared = (fn as { type?: ts.Node }).type;
    if (declared !== undefined) {
      const t = checker.getTypeFromTypeNode(declared);
      return isAsync(fn) ? awaitedOf(t) : t;
    }
    // An unannotated function expression passed to a generic call: bind the callee's type parameters from the
    // call's own expected type, then take the parameter's declared return.
    const call = fn.parent;
    if (call === undefined || !ts.isCallExpression(call) || call.arguments === undefined) return undefined;
    const argIndex = call.arguments.indexOf(fn as never);
    if (argIndex < 0) return undefined;
    const sig = checker.getResolvedSignature(call);
    const decl = sig === undefined ? undefined : checker.signatureDeclaration(sig);
    if (decl === undefined || !ts.isFunctionLike(decl)) return undefined;
    const d = decl as unknown as { typeParameters?: readonly { name: { text: string } }[]; parameters: readonly { type?: ts.Node }[]; type?: ts.Node };
    const tparams = new Set((d.typeParameters ?? []).map((tp) => tp.name.text));
    if (tparams.size === 0) return undefined;
    const callExpected = expectedOf(call, depth + 1);
    if (callExpected === undefined) return undefined;
    const bound = new Map<string, ts.Type>();
    bind(d.type, callExpected, tparams, bound);
    const paramType = d.parameters[argIndex]?.type;
    if (paramType === undefined || !ts.isFunctionTypeNode(paramType)) return undefined;
    const r = resolveNode((paramType as unknown as { type: ts.Node }).type, bound);
    if (r === undefined) return undefined;
    return isAsync(fn) && !r.promise ? r.type : r.type;
  };

  for (const sf of program.getSourceFiles()) {
    if (!/new (Map|Set)\(\)/.test(sf.text)) continue;
    if (sf.isDeclarationFile || /[\\/]node_modules[\\/]typescript[\\/]/.test(sf.fileName) || !/\.(m|c)?tsx?$/.test(sf.fileName)) continue;
    const pins: RetypePin[] = [];
    ts.walkPreorder(sf, (n) => {
      if (
        !ts.isNewExpression(n) || !ts.isIdentifier(n.expression) || !COLLECTIONS.has(n.expression.text) ||
        (n.arguments?.length ?? 0) !== 0 || n.typeArguments !== undefined
      ) {
        return undefined;
      }
      const want = n.expression.text === "Map" ? "Map<any, any>" : "Set<any>";
      if (checker.typeToString(checker.getTypeAtLocation(n)) !== want) return undefined;
      const expected = expectedOf(n, 0);
      if (process.env["SCRIPTC_EMPTY_PIN_WHY"] !== undefined) {
        process.stderr.write(`[emptypin] ${sf.fileName}:${n.getStart()} expected=${expected === undefined ? "none" : checker.typeToString(expected)}\n`);
      }
      if (expected === undefined) return undefined;
      const nm = refName(expected);
      const args = typeArgsOf(expected);
      const wantArity = n.expression.text === "Map" ? 2 : 1;
      const ok =
        (n.expression.text === "Map" && (nm === "Map" || nm === "ReadonlyMap")) ||
        (n.expression.text === "Set" && (nm === "Set" || nm === "ReadonlySet"));
      if (!ok || args.length !== wantArity) return undefined;
      const texts = args.map((a) => checker.typeToString(a));
      if (!texts.every(nameableArg)) return undefined;
      const start = n.getStart();
      pins.push({
        start,
        end: n.getEnd(),
        text: n.getText(),
        why: `an empty ${n.expression.text} takes the ${nm}<${texts.join(", ")}> its destination declares`,
        replacement: `new ${n.expression.text}<${texts.join(", ")}>()`,
      });
      return undefined;
    });
    if (pins.length > 0) out.set(sf.fileName, pins);
  }
  return out;
}
