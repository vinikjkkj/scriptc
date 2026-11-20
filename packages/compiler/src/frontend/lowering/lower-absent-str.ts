/* THE ABSENT-STRING GATE.
 *
 * A regex group that did not participate (`"Wx".match(/(W)(y)?/)[2]`), and the captures of a regex `split`, are Node's `undefined`; this
 * compiler keeps them in string-typed slots as one immortal marker (scr_str_absent). The checker types every such slot `string`, so
 * consumers that ask only the TYPE (typeof, `??`, `+`, `===`, `.length`) cannot tell the marker from "". Typing the slot `string |
 * undefined` instead was PROBED and refused (2026-11-20, cap1): every callback parameter, for-of binding and call argument takes its type from
 * the checker, so the IR union disagrees with tsc at those boundaries (SC2001 on `m.map(x => ...)`, SC2003 on `m[1].length`).
 *
 * So the consumers are made absent-aware instead, PER PROGRAM: a program whose sources contain a match/matchAll/exec/split that can leave a
 * group unfilled is gated (this scan, whole program, syntactic plus the checker's type of the receiver/argument); lowering then spells
 * typeof / `??` as marker tests, and the emitters select the `_u` runtime entries (scr_str_concat*_u, scr_str_eq_u, scr_str_recv_u) via
 * IrModule.absentStrings. Every other program lowers and emits exactly as before.
 *
 * The scan errs toward the gate: an unknown regex (a parameter, a property) may have an optional group. Over-gating costs only the cheaper
 * `_u` entries; under-gating would keep today's silent answers. */
import * as ts from "../ts7/adapter.js";
import type { Lowerer } from "./lowerer.js";
import { captureParticipationOfPattern, staticRegexTextOf } from "./lower-exprs.js";

const NAMES = /\b(?:match|matchAll|exec|split)\b/;

/** Can a successful match of this literal pattern leave a capture group unfilled? Unknown shapes answer true. */
function patternMayLeaveGroupUnfilled(pattern: string): boolean {
  const part = captureParticipationOfPattern(pattern);
  if (part === null) return true;
  for (let k = 1; k <= part.captureCount; k++) if (part.always.get(k) !== true) return true;
  return false;
}

export function absentStrRiskOf(L: Lowerer): boolean {
  if (L.absentStrMemo !== undefined) return L.absentStrMemo;
  const checker = L.checker;
  const typeText = (n: ts.Node): string => {
    try { return checker.typeToString(checker.getTypeAtLocation(n)); } catch { return "any"; }
  };
  /** A regex-valued expression: Some(literal pattern) when statically known, otherwise null (unknown regex). */
  const staticPattern = (e: ts.Expression, depth: number): string | null => {
    const t = staticRegexTextOf(L, e);
    if (t !== null) return t.pattern;
    let x = e;
    while (ts.isParenthesizedExpression(x) || ts.isNonNullExpression(x) || ts.isAsExpression(x)) x = x.expression;
    if (ts.isIdentifier(x) && depth < 3) {
      const sym = checker.getSymbolAtLocation(x);
      const decl = sym === undefined ? undefined : checker.valueDeclarationOf(sym);
      if (decl !== undefined && ts.isVariableDeclaration(decl) && decl.initializer !== undefined && (decl.parent.flags & ts.NodeFlags.Const) !== 0) {
        return staticPattern(decl.initializer, depth + 1);
      }
    }
    return null;
  };
  const callRisk = (c: ts.CallExpression): boolean => {
    const callee = c.expression;
    let name: string;
    let recv: ts.Expression;
    if (ts.isPropertyAccessExpression(callee)) { name = callee.name.text; recv = callee.expression; }
    else if (ts.isElementAccessExpression(callee) && ts.isStringLiteralLike(callee.argumentExpression)) { name = callee.argumentExpression.text; recv = callee.expression; }
    else return false;
    const a0 = c.arguments[0];
    if (name === "split") {
      if (a0 === undefined) return false;
      if (ts.isStringLiteralLike(a0)) return false;
      const p = staticPattern(a0, 0);
      if (p !== null) return patternMayLeaveGroupUnfilled(p);
      const t = typeText(a0);
      return t.includes("RegExp") || t === "any" || t === "unknown";
    }
    if (name === "match" || name === "matchAll") {
      if (a0 === undefined) return false;
      if (ts.isStringLiteralLike(a0)) return patternMayLeaveGroupUnfilled(a0.text);
      const p = staticPattern(a0, 0);
      if (p !== null) return patternMayLeaveGroupUnfilled(p);
      return true;
    }
    if (name === "exec") {
      const p = staticPattern(recv, 0);
      if (p !== null) return patternMayLeaveGroupUnfilled(p);
      const t = typeText(recv);
      return t.includes("RegExp") || t === "any" || t === "unknown";
    }
    return false;
  };
  let risk = false;
  for (const sf of L.program.getSourceFiles()) {
    if (sf.isDeclarationFile) continue;
    if (!NAMES.test(sf.text)) continue;
    const stack: ts.Node[] = [sf];
    while (stack.length > 0) {
      const n = stack.pop()!;
      if (ts.isCallExpression(n) && callRisk(n)) { risk = true; break; }
      ts.forEachChild(n, (c) => { stack.push(c); });
    }
    if (risk) break;
  }
  L.absentStrMemo = risk;
  return risk;
}

/** Can this string-typed IR expression evaluate to the absent marker? A literal cannot, and neither can a read with NO operands (`navigator.userAgent`,
 * `process.platform`): nothing the program holds flows into it, so it is never a regex capture. Keeping these foldable matters: pg's
 * `typeof navigator.userAgent === 'string'` is statically true and the code after its early return (`new Response`) must stay dead. */
export function operandMayHoldAbsent(e: { kind: string; args?: readonly unknown[] }): boolean {
  if (e.kind === "strLit") return false;
  return !(e.kind === "libCall" && e.args !== undefined && e.args.length === 0);
}
