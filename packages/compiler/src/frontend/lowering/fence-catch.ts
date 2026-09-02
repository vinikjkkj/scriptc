/* WHO CATCHES A DEFERRED FENCE — the classifier behind the
 * SCRIPTC_FENCE_CATCH_WHY probe (the SCRIPTC_SPLIT_WHY precedent, one
 * screen from deferredFenceStmt).
 *
 * A deferred fence is a THROW, and a throw is CATCHABLE. That is the point
 * of --best-effort for a path the program never takes, and it is a hazard
 * for a path the program takes inside a `try`: protobufjs's own `inquire()`
 * wraps its `require` in try/catch and RETURNS NULL, so
 * `require("buffer")` answers null where Node answers a module — exit 0,
 * no diagnostic, nobody told. The fence is not the safeguard there; the
 * deadness of that call in that bundle is.
 *
 * "Catchable" is four classes, not one, and only the last is safe:
 *
 *   try       — lexical, same function. Sub-classified, because the class
 *               alone does not say whether the answer is wrong: a catch
 *               that SWALLOWS (empty/comment-only) or RETURNS A PLAUSIBLE
 *               VALUE hands the program a lie; one that rethrows or logs
 *               does not.
 *   async-fn  — the throw becomes a rejection; whoever awaits takes it.
 *   promise-cb— the enclosing function is a .then/.catch/.finally argument.
 *               This is the codec's shape and it is NOT a `try` node, so a
 *               syntactic try scan reports it as ABSENT. That is exactly
 *               the false green this module exists to prevent.
 *   none      — the refusal reaches the user. The only safe case.
 *
 * SCOPE, stated so no number taken from this is over-read: the walk stops
 * at the ENCLOSING FUNCTION. A fence classified `none` can still be caught
 * by a caller's try — this is a LOWER bound on catching, i.e. an UPPER
 * bound on how many refusals reach the user. It is syntax, not reachability:
 * a `try` that the fence's statement never executes still classifies as
 * `try`. */
import * as ts from "../ts7/adapter.js";

/** How a catch clause DISPOSES of what it caught — the half that decides
 * whether the class is a hazard. */
export type CatchDisposition =
  /** empty or comment-only body: the error vanishes and control continues */
  | "swallow"
  /** returns a value that is not a rethrow: the caller gets a plausible lie */
  | "return-value"
  /** throw/rethrow somewhere in the body: the refusal survives */
  | "rethrow"
  /** neither of the above (logs, assigns, calls) — control continues but
   * something was said; not scored as a hazard, not scored as safe */
  | "other";

export interface FenceCatchClass {
  readonly cls: "try" | "async-fn" | "promise-cb" | "none";
  /** Only for `try`. */
  readonly disposition?: CatchDisposition;
  /** For `promise-cb`: which method took the function (`then`/`catch`/…). */
  readonly via?: string;
}

/** True when the block has no statements at all (a comment-only body parses
 * to exactly this). */
function isEmptyBlock(b: ts.Block): boolean {
  return b.statements.length === 0;
}

/** Does any statement in this subtree throw, without crossing into a nested
 * function (a throw inside a callback is that callback's throw, not this
 * catch's)? */
function containsThrow(node: ts.Node): boolean {
  let found = false;
  const walk = (n: ts.Node): void => {
    if (found) return;
    if (ts.isThrowStatement(n)) {
      found = true;
      return;
    }
    if (n !== node && ts.isFunctionLike(n)) return;
    ts.forEachChild(n, walk);
  };
  walk(node);
  return found;
}

/** Does any statement in this subtree `return`, without crossing into a
 * nested function? A bare `return;` counts: `undefined` where Node had a
 * module is exactly the shape this measures. */
function containsReturn(node: ts.Node): boolean {
  let found = false;
  const walk = (n: ts.Node): void => {
    if (found) return;
    if (ts.isReturnStatement(n)) {
      found = true;
      return;
    }
    if (n !== node && ts.isFunctionLike(n)) return;
    ts.forEachChild(n, walk);
  };
  walk(node);
  return found;
}

function dispositionOf(cc: ts.CatchClause): CatchDisposition {
  if (isEmptyBlock(cc.block)) return "swallow";
  if (containsThrow(cc.block)) return "rethrow";
  if (containsReturn(cc.block)) return "return-value";
  return "other";
}

/** The `.then(fn)` / `.catch(fn)` shape: `fn` is an ARGUMENT of a call whose
 * callee is a property access, and the property is one of the promise
 * combinators. Returns the method name, or null. */
function promiseCallbackVia(fn: ts.Node): string | null {
  const call = fn.parent;
  if (call === undefined || !ts.isCallExpression(call)) return null;
  if (!call.arguments.some((a) => a === fn)) return null;
  const callee = call.expression;
  if (!ts.isPropertyAccessExpression(callee)) return null;
  const name = callee.name.text;
  return name === "then" || name === "catch" || name === "finally" ? name : null;
}

/** Classify the context that would take the throw a fence at `node` emits.
 *
 * The walk goes UP. The first `try` whose TRY BLOCK (not its catch, not its
 * finally) contains the node, and which has a catch clause, wins — that is
 * the handler the throw actually reaches. A try with only `finally` does
 * NOT catch, so the walk continues past it. The walk stops at the first
 * function boundary and classifies the function itself. */
export function classifyFenceCatch(node: ts.Node): FenceCatchClass {
  let child: ts.Node = node;
  let parent: ts.Node | undefined = node.parent;
  while (parent !== undefined) {
    if (ts.isTryStatement(parent) && parent.tryBlock === child && parent.catchClause !== undefined) {
      return { cls: "try", disposition: dispositionOf(parent.catchClause) };
    }
    if (ts.isFunctionLike(parent)) {
      const via = promiseCallbackVia(parent);
      if (via !== null) return { cls: "promise-cb", via };
      const mods = ts.canHaveModifiers(parent) ? ts.getModifiers(parent) : undefined;
      if (mods?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)) return { cls: "async-fn" };
      return { cls: "none" };
    }
    child = parent;
    parent = parent.parent;
  }
  return { cls: "none" };
}

/** One tab-separated probe line per fence, on stderr, when
 * SCRIPTC_FENCE_CATCH_WHY is set. Off by default and it emits nothing —
 * the SCRIPTC_SPLIT_WHY contract. */
export function fenceCatchProbe(kind: string, node: ts.Node, file: string, line: number): void {
  if (!process.env["SCRIPTC_FENCE_CATCH_WHY"]) return;
  const c = classifyFenceCatch(node);
  process.stderr.write(
    `FENCE-CATCH\t${kind}\t${c.cls}\t${c.disposition ?? c.via ?? "-"}\t${file}:${line}\n`,
  );
}
