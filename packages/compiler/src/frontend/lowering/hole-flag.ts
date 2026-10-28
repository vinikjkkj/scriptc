// The per-symbol "may hold hole" flag for number[] locals (STEP 2a).
//
// A local whose declared element type is number is FLAGGED when the program
// writes `S.length = <expr>` on it: growing such an array fills the new
// slots with the absent number (SCR_NUM_HOLE, scr_runtime.h). The flag is a
// fact about the SYMBOL, not the type: the IR type of every flagged array is
// the ordinary arrayOf(number), so the checker-typed memoisation is untouched.
//
// A flagged symbol may appear ONLY in these shapes, each checked against the
// identifier's parent node:
//   S[i]            element read or write (the index is any expression)
//   S.length        read, or the target of `S.length = n`
//   S.fill(...)     as a whole expression statement (its value is S itself,
//                   so a value position would alias the array)
// Any other appearance (argument, return, assignment source, spread, for-of,
// `in`, console.log, JSON, another method) would let the holes escape, and is
// refused at compile time (SC2020, with the reason).
import * as ts from "../ts7/adapter.js";
import type { Lowerer } from "./lowerer.js";

const FLAGGED = new WeakMap<ts.SourceFile, Set<ts.Symbol>>();

function isNumberArrayReceiver(L: Lowerer, node: ts.Expression): boolean {
  const t = L.mapTypeOf(L.typeOf(node));
  return t !== null && t.kind === "array" && t.elem.kind === "f64";
}

/** The flagged symbols of one source file: every identifier X such that the
 * file contains `X.length = <expr>` with X a number[]. Locals and their uses
 * share a file, so one file's scan decides them all. Iterative (explicit
 * stack), so it cannot exceed the depth guard. */
function flaggedSymbolsOf(L: Lowerer, sf: ts.SourceFile): Set<ts.Symbol> {
  const memo = FLAGGED.get(sf);
  if (memo) return memo;
  const out = new Set<ts.Symbol>();
  const stack: ts.Node[] = [sf];
  while (stack.length > 0) {
    const n = stack.pop()!;
    if (
      ts.isBinaryExpression(n) &&
      n.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(n.left) &&
      n.left.name.text === "length" &&
      !n.left.questionDotToken &&
      ts.isIdentifier(n.left.expression) &&
      isNumberArrayReceiver(L, n.left.expression)
    ) {
      const sym = L.checker.getSymbolAtLocation(n.left.expression);
      if (sym) out.add(sym);
    }
    ts.forEachChild(n, (c) => {
      stack.push(c);
      return undefined;
    });
  }
  FLAGGED.set(sf, out);
  return out;
}

/** Is this identifier a use of a flagged symbol? */
export function isHoleFlaggedRef(L: Lowerer, id: ts.Expression): boolean {
  if (!ts.isIdentifier(id)) return false;
  const sym = L.checker.getSymbolAtLocation(id);
  if (!sym) return false;
  return flaggedSymbolsOf(L, id.getSourceFile()).has(sym);
}

/** Refuse a use of a flagged symbol that is not one of the allowed shapes. */
export function checkHoleFlaggedUse(L: Lowerer, id: ts.Identifier): void {
  if (!isHoleFlaggedRef(L, id)) return;
  const p = id.parent;
  if (ts.isElementAccessExpression(p) && p.expression === id) return;
  if (ts.isPropertyAccessExpression(p) && p.expression === id) {
    if (p.name.text === "length") return;
    if (
      p.name.text === "fill" &&
      ts.isCallExpression(p.parent) &&
      p.parent.expression === p &&
      ts.isExpressionStatement(p.parent.parent)
    ) {
      return;
    }
  }
  L.noLowering(
    `'${id.text}' (a number[] the program grows with '.length =', so its holes are tracked)`,
    id,
    "it may only be indexed, measured, filled as a statement, or grown with '.length =' — " +
      "passing, returning, assigning, spreading or iterating it would let the holes escape",
  );
}
