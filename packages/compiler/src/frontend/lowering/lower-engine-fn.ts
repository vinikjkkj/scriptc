/* Non-foldable Function-constructor sites (`new Function(...)` and
 * `Function(...)` whose text the desugar lane cannot fold to a native
 * function, frontend/fn-ctor-desugar.ts): the text runs on the embedded
 * QuickJS engine (scr_island.c). The engine's OWN Function constructor
 * builds the function, so the wrapper text, the parameter list, and the
 * SyntaxError messages are Node's by construction.
 *
 * Lowering: the constructor's arguments (native strings) marshal into the
 * engine (jsMarshal), `Function` is read from the engine's global
 * (jsOp globalGet), the constructor runs (jsOp construct), and the engine
 * function wraps as the checked-dynamic tree's by-reference kind
 * (dynFromJsval). A dyn-typed function is callable through the dyn call
 * surface, which the static lane already has for `Function`-typed values
 * (types.ts maps `Function` to a variadic dyn function).
 *
 * The jsOp globalGet with name "Function" is the link switch: a module
 * carrying one needs the engine (cc.ts, moduleUsesEngineFn). Sites whose
 * arguments are not plain strings keep the refusal (returns null). */
import type { Lowerer } from "./lowerer.js";
import * as ts from "../ts7/adapter.js";
import { DYN, IrExpr, JSVAL, SrcLoc } from "../../ir/nodes.js";

export function engineFunctionCtor(L: Lowerer, expr: ts.NewExpression | ts.CallExpression, loc: SrcLoc): IrExpr | null {
  const args = expr.arguments ?? [];
  if (args.length === 0) return null;
  if (args.some((a) => ts.isSpreadElement(a))) return null;
  const marshaled: IrExpr[] = [];
  for (const a of args) {
    const v = L.lowerExpr(a);
    if (v.type.kind !== "string") return null;
    marshaled.push({ kind: "jsMarshal", value: v, type: JSVAL, loc: v.loc });
  }
  const fnVal: IrExpr = { kind: "jsOp", op: "globalGet", name: "Function", args: [], type: JSVAL, loc };
  const made: IrExpr = { kind: "jsOp", op: "construct", args: [fnVal, ...marshaled], type: JSVAL, loc };
  return { kind: "dynFromJsval", value: made, type: DYN, loc, fnBox: true };
}

/* `Function.apply(null, <string[]>)` (generate-function's toFunction builds
 * the function as `Function.apply(null, keys.concat(src))`): the same engine
 * route as the constructor, with the argument list marshalled as one engine
 * array. Only the null receiver and a string-array argument list claim the
 * site; everything else keeps the refusal (returns null). The result is the
 * engine function, boxed like the constructor's. */
export function engineFunctionApply(L: Lowerer, expr: ts.CallExpression, loc: SrcLoc): IrExpr | null {
  const callee = expr.expression;
  if (!ts.isPropertyAccessExpression(callee) || callee.questionDotToken !== undefined) return null;
  if (callee.name.text !== "apply" || !ts.isIdentifier(callee.expression)) return null;
  if (callee.expression.text !== "Function") return null;
  const args = expr.arguments;
  if (args.length !== 2 || args.some((a) => ts.isSpreadElement(a))) return null;
  if (args[0]!.kind !== ts.SyntaxKind.NullKeyword) return null;
  const listType = L.mapTypeOf(L.typeOf(args[1]!));
  if (listType === null || listType.kind !== "array" || listType.elem.kind !== "string") return null;
  const list = L.lowerExpr(args[1]!);
  const fnVal: IrExpr = { kind: "jsOp", op: "globalGet", name: "Function", args: [], type: JSVAL, loc };
  const nullThis: IrExpr = { kind: "jsOp", op: "nullLit", args: [], type: JSVAL, loc };
  const made: IrExpr = {
    kind: "jsOp",
    op: "callMethod",
    name: "apply",
    args: [fnVal, nullThis, { kind: "jsMarshal", value: list, type: JSVAL, loc: list.loc }],
    type: JSVAL,
    loc,
  };
  return { kind: "dynFromJsval", value: made, type: DYN, loc, fnBox: true };
}
