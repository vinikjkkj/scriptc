/* A module NAMESPACE chosen at runtime — `const transport = parsed.protocol
 * === 'https:' ? https : http`, then `transport.request(...)`.
 *
 * Node's value here is a module object, and a compiled binary has none: a
 * namespace binding is compile-time plumbing that keys the lowering
 * tables (builtinNamespaceModuleOf). So the conditional is not lowered as
 * a VALUE at all. It is lowered as the SELECTOR it really is:
 *
 *   - the DECLARATION lowers to its condition — the binding's slot holds
 *     a `bool`, so the condition evaluates exactly ONCE, in source order,
 *     exactly where Node evaluates it. That is the whole reason the
 *     selector lives at the declaration rather than being re-read per
 *     use the way the `const requestFn = tls ? https.request :
 *     http.request` registry re-reads its condition: THAT one admits
 *     only a bare identifier over a never-reassigned binding, and zapo's
 *     condition is an expression over a URL member. Nothing has to be
 *     proved pure when the value is computed once.
 *
 *   - each USE lowers the member operation TWICE, once per arm, under a
 *     per-symbol module override, and wraps the two in a `ternary` on the
 *     selector. The arms are mutually exclusive, so duplicating the
 *     ARGUMENTS across them still evaluates each of them exactly once at
 *     runtime; the cost is compile-time size, one copy of the operation
 *     per arm.
 *
 *   - every OTHER use of the binding fences by name. The slot holds a
 *     bool, and nothing else about a module object survives — printing
 *     it, passing it, `typeof`-ing it would all read the selector and
 *     silently answer something Node never says.
 *
 * WHAT IS NOT BUILT, so the next reader need not re-derive it:
 *
 *   - only the member-CALL use lowers. A member READ through the binding
 *     (`transport.globalAgent`) has the same shape and the same soundness
 *     story — two arms over one selector — but a value position needs the
 *     two arms' IR types to agree, which the call path checks and no read
 *     path exists yet to check. It fences by name.
 *
 *   - a FILE-SCOPE selector still fences (SC2009 on the binding's own
 *     type). collectGlobals decides a module global's IR type from the
 *     DECLARED type before any initializer lowers, so there is no point
 *     at which lowerNamespaceConditionalDecl could hand it the bool the
 *     way lowerVarDecl's block-scoped path takes it. Closing it means
 *     teaching collectGlobals the same rule — the registration would have
 *     to move to collection time, where the promisify binding's already
 *     is (lower-modules.ts's `isPromisifyCall` arm).
 */
import * as ts from "../ts7/adapter.js";
import type { Lowerer } from "./lowerer.js";
import type { IrExpr } from "../../ir/nodes.js";
import { locOf } from "../program.js";

/** The two modules a registered selector picks between. */
export interface NamespaceConditional {
  /** The module the TRUE arm names. */
  trueModule: string;
  falseModule: string;
}

const registry = new WeakMap<Lowerer, Map<ts.Symbol, NamespaceConditional>>();
const overrides = new WeakMap<Lowerer, Map<ts.Symbol, string>>();
/** Nonzero while the selector's own slot is being READ (the ternary's
 * condition) — the one reference of the binding that is not a fence. */
const selectorReads = new WeakMap<Lowerer, number>();

export function namespaceConditionalOf(L: Lowerer, sym: ts.Symbol): NamespaceConditional | undefined {
  return registry.get(L)?.get(sym);
}

/** The module a per-symbol override is pinning right now, for
 * builtinNamespaceModuleOf's identifier arm. */
export function namespaceOverrideOf(L: Lowerer, sym: ts.Symbol): string | undefined {
  return overrides.get(L)?.get(sym);
}

/** True while ANY arm of a namespace conditional is being lowered. One
 * source options record serves both arms, so an option only one module
 * carries (https.request's rejectUnauthorized/ca) must not fence on the
 * OTHER arm — Node ignores TLS options on http.request, and this is the
 * requestFn binding's `secureish` rule with the arms spelled out. Only
 * SIDE-EFFECT-FREE values may be ignored: the arms duplicate the record,
 * so a dropped expression would never evaluate on the arm that drops it. */
export function inNamespaceConditionalArm(L: Lowerer): boolean {
  const map = overrides.get(L);
  return map !== undefined && map.size > 0;
}

function unwrap(e: ts.Expression): ts.Expression {
  let x = e;
  while (ts.isParenthesizedExpression(x)) x = x.expression;
  return x;
}

/** `cond ? nsA : nsB` over two DIFFERENT supported builtin module
 * namespaces — the shape this file exists for. Null for everything else
 * (the ordinary ternary lowering and its per-arm fences apply). */
export function namespaceConditionalArmsOf(
  L: Lowerer, expr: ts.ConditionalExpression,
): NamespaceConditional | null {
  const t = L.builtinNamespaceModuleOf(unwrap(expr.whenTrue));
  if (t === null) return null;
  const f = L.builtinNamespaceModuleOf(unwrap(expr.whenFalse));
  if (f === null || f === t) return null;
  return { trueModule: t, falseModule: f };
}

/** The declaration this ternary initializes, when it is the `const x =
 * <ternary>` shape the selector needs. A namespace conditional anywhere
 * else has no slot to hold the selector, so it fences here rather than
 * lowering to a bool nothing named. */
function selectorDeclOf(expr: ts.ConditionalExpression): ts.VariableDeclaration | null {
  let n: ts.Node = expr;
  while (ts.isParenthesizedExpression(n.parent)) n = n.parent;
  const p = n.parent;
  if (!ts.isVariableDeclaration(p) || p.initializer !== n || !ts.isIdentifier(p.name)) return null;
  if ((ts.getCombinedNodeFlags(p) & ts.NodeFlags.Const) === 0) return null;
  return p;
}

/** lowerTernary's claim: `const t = cond ? https : http` lowers to the
 * CONDITION, and the binding's slot becomes the selector. Returns the
 * bool IR, or null when this ternary is not the recognized shape. */
export function lowerNamespaceConditionalDecl(L: Lowerer, expr: ts.ConditionalExpression): IrExpr | null {
  const arms = namespaceConditionalArmsOf(L, expr);
  if (arms === null) return null;
  const decl = selectorDeclOf(expr);
  if (decl === null) {
    L.noLowering(
      "a module-namespace conditional outside a const declaration",
      expr,
      "bind it first — `const t = cond ? a : b` — and use `t.member(...)`; the binding holds the CHOICE, not a module object",
    );
  }
  const sym = L.checker.getSymbolAtLocation(decl.name);
  if (sym) {
    let map = registry.get(L);
    if (!map) {
      map = new Map();
      registry.set(L, map);
    }
    map.set(sym, arms);
  }
  return L.lowerCondition(expr.condition);
}

/** A reference to a registered selector that is NOT the object of a
 * member call: the slot holds a bool, and a module object has no other
 * lowering. Called from the identifier path. */
export function fenceNamespaceConditionalValue(L: Lowerer, expr: ts.Identifier, sym: ts.Symbol): void {
  if ((selectorReads.get(L) ?? 0) > 0) return;
  const reg = namespaceConditionalOf(L, sym);
  if (!reg) return;
  L.noLowering(
    `'${expr.text}' as a value (it names one of two module namespaces, chosen at runtime)`,
    expr,
    `call a member on it — \`${expr.text}.member(...)\` lowers to one call per arm; the binding itself holds only the choice between '${reg.trueModule}' and '${reg.falseModule}'`,
  );
}

/** `t.member(...)` on a registered selector: the SAME call lowered once
 * per arm under a module override, wrapped in a ternary on the selector.
 * Null when the callee is not such a member call (the call chain keeps
 * trying). */
export function lowerNamespaceConditionalCall(
  L: Lowerer, call: ts.CallExpression, access: ts.PropertyAccessExpression,
): IrExpr | null {
  if (!ts.isIdentifier(access.expression)) return null;
  const sym = L.checker.getSymbolAtLocation(access.expression);
  const reg = sym ? namespaceConditionalOf(L, sym) : undefined;
  if (!sym || !reg) return null;
  // Already INSIDE one of this selector's arms: the override pins the
  // module and the ordinary namespace dispatch owns the call. Without
  // this the arm would re-enter here forever.
  if (namespaceOverrideOf(L, sym) !== undefined) return null;
  const loc = locOf(call);
  // The selector's own slot read — the one reference the value fence lets
  // through.
  selectorReads.set(L, (selectorReads.get(L) ?? 0) + 1);
  let sel: IrExpr;
  try {
    sel = L.lowerExpr(access.expression);
  } finally {
    selectorReads.set(L, (selectorReads.get(L) ?? 0) - 1);
  }
  if (sel.type.kind !== "bool") {
    L.noLowering(
      "a module-namespace selector that did not lower to its condition",
      access.expression,
      "declare it as `const t = cond ? a : b` in the same scope as its uses",
    );
  }
  let map = overrides.get(L);
  if (!map) {
    map = new Map();
    overrides.set(L, map);
  }
  const armFor = (module: string): IrExpr => {
    const prev = map.get(sym);
    map.set(sym, module);
    try {
      const e = L.lowerNamespaceBuiltinCall(call, access);
      if (e === null) {
        L.noLowering(
          `'${access.name.text}' through a module-namespace conditional`,
          access,
          `${module}.${access.name.text} has no lowering — both arms of the conditional must lower`,
        );
      }
      return e;
    } finally {
      if (prev === undefined) map.delete(sym);
      else map.set(sym, prev);
    }
  };
  const then = armFor(reg.trueModule);
  const else_ = armFor(reg.falseModule);
  if (L.fmt(then.type) !== L.fmt(else_.type)) {
    L.noLowering(
      `'${access.name.text}' through a module-namespace conditional whose arms answer different types`,
      access,
      `'${reg.trueModule}' answers '${L.fmt(then.type)}' and '${reg.falseModule}' answers '${L.fmt(else_.type)}' — the two arms must agree`,
    );
  }
  return { kind: "ternary", cond: sel, then, else_, type: then.type, loc };
}
