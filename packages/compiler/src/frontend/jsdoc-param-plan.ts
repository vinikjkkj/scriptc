/* JSDoc scalar parameter claims in JavaScript sources.
 *
 * Node never enforces JSDoc. A `@param {string}` on a JS function declaration is the checker's type for the parameter, and an IR slot typed from it
 * would make the compiled program throw or trap where Node runs (an `undefined` arrives, a number arrives). The claim may only be an optimisation that
 * is PROVEN safe over the whole program:
 *  - "keep": the function does not escape as a value and every direct call passes an argument whose static type conforms to the claim;
 *  - "undef": the only extra that can arrive is undefined (an omitted argument, a `T | undefined` argument), or the function escapes as a value
 *    (a callee through a dyn box, a record or expando slot, an export), whose callers are open-world: the claim plus the undefined JS callers omit;
 *  - "dyn": a type other than the claim arrives at a function that does not escape.
 * The plans are computed once per program, before any type is mapped, because a function VALUE's type (a slot the function is stored in) spells the same
 * parameter types as the function itself.
 */
import * as ts from "./ts7/adapter.js";
import { isJsSourceFile } from "./program.js";

export type JsDocParamPlan = "keep" | "undef" | "dyn";

/** Parameters whose representation is not the claim's: "undef" or "dyn". Absent = "keep". */
export const JSDOC_PARAM_PLANS = new WeakMap<ts.Node, "undef" | "dyn">();
/** Function declarations whose value escapes (any reference other than a direct call, or an export). */
export const JSDOC_ESCAPING_FNS = new WeakSet<ts.Node>();
/** JS function declarations whose JSDoc scalar RETURN claim the body contradicts (a bare `return;`, a returned value whose own type admits undefined,
 * or the pass-through of another such function's result): their result is the scalar OR undefined, in the function and in every function VALUE built
 * from it. */
export const JSDOC_WIDENED_RETURNS = new WeakSet<ts.Node>();
const computed = new WeakSet<ts.Program>();

type Claim = "number" | "string" | "boolean";

function claimOf(checker: ts.TypeChecker, p: ts.ParameterDeclaration): Claim | null {
  if (!ts.isIdentifier(p.name) || p.dotDotDotToken || p.questionToken || p.initializer || p.name.text === "this") return null;
  const t = checker.getTypeAtLocation(p.name);
  if (t.isUnionType()) return null;
  if ((t.flags & ts.TypeFlags.StringLike) !== 0) return "string";
  if ((t.flags & ts.TypeFlags.NumberLike) !== 0) return "number";
  if ((t.flags & ts.TypeFlags.BooleanLike) !== 0) return "boolean";
  return null;
}

/** How the argument type `t` meets the scalar claim: "ok", "undef" (undefined is the only extra) or "other". */
function meets(t: ts.Type, claim: Claim): "ok" | "undef" | "other" {
  const wanted = claim === "number" ? ts.TypeFlags.NumberLike : claim === "string" ? ts.TypeFlags.StringLike : ts.TypeFlags.BooleanLike;
  const parts = t.isUnionType() ? ts.constituentTypes(t) : [t];
  let undef = false;
  for (const part of parts) {
    if ((part.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Void)) !== 0) {
      undef = true;
      continue;
    }
    if ((part.flags & wanted) === 0) return "other";
  }
  return undef ? "undef" : "ok";
}

export function computeJsDocParamPlans(program: ts.Program, checker: ts.TypeChecker): void {
  if (computed.has(program)) return;
  computed.add(program);
  const decls: ts.FunctionDeclaration[] = [];
  const byName = new Map<string, ts.Identifier[]>();
  const names = new Set<string>();
  for (const sf of program.getSourceFiles()) {
    if (sf.isDeclarationFile) continue;
    const js = isJsSourceFile(sf);
    const stack: ts.Node[] = [sf];
    while (stack.length > 0) {
      const n = stack.pop()!;
      if (js && ts.isFunctionDeclaration(n) && n.name !== undefined && n.body !== undefined && n.parameters.some((p) => claimOf(checker, p) !== null)) {
        decls.push(n);
        names.add(n.name.text);
      }
      if (ts.isIdentifier(n)) {
        const list = byName.get(n.text);
        if (list === undefined) byName.set(n.text, [n]);
        else list.push(n);
      }
      ts.forEachChild(n, (c) => {
        stack.push(c);
      });
    }
  }
  widenReturns(program, checker, byName);
  for (const decl of decls) {
    const sym = checker.getSymbolAtLocation(decl.name!);
    if (sym === undefined) continue;
    let escapes = decl.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword || m.kind === ts.SyntaxKind.DefaultKeyword) === true;
    const calls: ts.CallExpression[] = [];
    for (const id of byName.get(decl.name!.text) ?? []) {
      if (id === decl.name) continue;
      let target = checker.getSymbolAtLocation(id);
      if (target !== undefined && (target.flags & ts.SymbolFlags.Alias) !== 0) target = checker.getAliasedSymbol(target);
      if (target !== sym) continue;
      const par = id.parent;
      if (par !== undefined && ts.isCallExpression(par) && par.expression === id) calls.push(par);
      else escapes = true;
    }
    if (escapes) JSDOC_ESCAPING_FNS.add(decl);
    decl.parameters.forEach((p, i) => {
      const claim = claimOf(checker, p);
      if (claim === null) return;
      let extra: "ok" | "undef" | "other" = "ok";
      for (const call of calls) {
        if (call.arguments.some((a) => ts.isSpreadElement(a))) {
          extra = "other";
          break;
        }
        const arg = call.arguments[i];
        const m = arg === undefined ? "undef" : meets(checker.getTypeAtLocation(arg), claim);
        if (m === "other") {
          extra = "other";
          break;
        }
        if (m === "undef") extra = "undef";
      }
      const plan: JsDocParamPlan = extra === "other" ? (escapes ? "undef" : "dyn") : extra === "undef" || escapes ? "undef" : "keep";
      if (plan !== "keep") JSDOC_PARAM_PLANS.set(p, plan);
    });
  }
}

function scalarClaim(t: ts.Type): boolean {
  return !t.isUnionType() && (t.flags & (ts.TypeFlags.StringLike | ts.TypeFlags.NumberLike | ts.TypeFlags.BooleanLike)) !== 0;
}

function unwrap(e: ts.Expression): ts.Expression {
  let n = e;
  while (ts.isParenthesizedExpression(n) || ts.isNonNullExpression(n) || ts.isAsExpression(n)) n = n.expression;
  return n;
}

/** Fixpoint over the program's JS function declarations that claim a scalar return. */
function widenReturns(program: ts.Program, checker: ts.TypeChecker, byName: Map<string, ts.Identifier[]>): void {
  const cands: ts.FunctionDeclaration[] = [];
  for (const sf of program.getSourceFiles()) {
    if (sf.isDeclarationFile || !isJsSourceFile(sf)) continue;
    const stack: ts.Node[] = [sf];
    while (stack.length > 0) {
      const n = stack.pop()!;
      if (ts.isFunctionDeclaration(n) && n.name !== undefined && n.body !== undefined && ts.isBlock(n.body) && n.asteriskToken === undefined) {
        const sig = checker.getSignatureFromDeclaration(n);
        if (sig !== undefined && scalarClaim(checker.getReturnTypeOfSignature(sig))) cands.push(n);
      }
      ts.forEachChild(n, (c) => {
        stack.push(c);
      });
    }
  }
  if (cands.length === 0) return;
  const declOfCall = (call: ts.CallExpression): ts.FunctionDeclaration | undefined => {
    if (!ts.isIdentifier(call.expression)) return undefined;
    const sym = checker.getSymbolAtLocation(call.expression);
    const d = sym === undefined ? undefined : checker.valueDeclarationOf(sym);
    return d !== undefined && ts.isFunctionDeclaration(d) ? d : undefined;
  };
  const widenedValue = (e: ts.Expression): boolean => {
    const n = unwrap(e);
    if (ts.isCallExpression(n)) {
      const d = declOfCall(n);
      return d !== undefined && JSDOC_WIDENED_RETURNS.has(d);
    }
    if (ts.isIdentifier(n)) {
      const sym = checker.getSymbolAtLocation(n);
      const d = sym === undefined ? undefined : checker.valueDeclarationOf(sym);
      if (d !== undefined && ts.isVariableDeclaration(d) && d.initializer !== undefined && scalarClaim(checker.getTypeAtLocation(d.name))) {
        const init = unwrap(d.initializer);
        if (ts.isCallExpression(init)) {
          const dd = declOfCall(init);
          return dd !== undefined && JSDOC_WIDENED_RETURNS.has(dd);
        }
      }
    }
    return false;
  };
  const mayBeUndefined = (e: ts.Expression): boolean => {
    const t = checker.getTypeAtLocation(e);
    return t.isUnionType() && ts.constituentTypes(t).some((p) => (p.flags & ts.TypeFlags.Undefined) !== 0);
  };
  let changed = true;
  while (changed) {
    changed = false;
    for (const decl of cands) {
      if (JSDOC_WIDENED_RETURNS.has(decl)) continue;
      let hit = false;
      const walk = (n: ts.Node): void => {
        if (hit) return;
        if (ts.isReturnStatement(n)) {
          if (n.expression === undefined || widenedValue(n.expression) || mayBeUndefined(n.expression)) hit = true;
          return;
        }
        if (ts.isFunctionLike(n) || ts.isClassDeclaration(n) || ts.isClassExpression(n)) return;
        ts.forEachChild(n, walk);
      };
      ts.forEachChild(decl.body!, walk);
      if (hit) {
        JSDOC_WIDENED_RETURNS.add(decl);
        changed = true;
      }
    }
  }
  void byName;
}
