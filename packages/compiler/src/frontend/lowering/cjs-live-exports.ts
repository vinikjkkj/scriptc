/* LIVE export objects (a CommonJS JS module whose export object is used as a VALUE).
 *
 * `exports` / `module.exports` passed, stored or aliased (`merge(exports, src)`,
 * `new Codec(opts, module.exports)`, `var alias = module.exports`) is the one
 * object Node shares between every writer and every reader. Writes through
 * a callee land in it after the module body ran, so a static per-member
 * global (the export table) would silently diverge from it. A LIVE module
 * keeps its whole export object in the module's exports bag (cjsExportsBagOf):
 * a dyn object created at module init. Every member write and read in the
 * module, every bare `exports` / `module.exports` value, and every member read,
 * call and bare value of a requirer's namespace binding goes through that bag.
 * No member gets a static global, so no reader can see a stale copy.
 *
 * Gates (any miss keeps today's behaviour): CommonJS JS file; no whole-export
 * replacement (`module.exports = X`, `exports = module.exports = X`) anywhere in
 * the file; `exports` / `module.exports` used as a value at least once. Shadowed
 * names are not the export object. Element-access spellings keep their fence.
 *
 * The walk is ITERATIVE (explicit stack): it can run before the compiler's depth
 * guard, and errors.test.ts compiles a 7000-level nested expression. */
import * as ts from "../ts7/adapter.js";
import { DYN, type IrExpr, type SrcLoc } from "../../ir/nodes.js";
import { cjsExportAssignmentOf, cjsWholeExportAssignmentOf, exportsRebindInnerOf, isCjsJsFile, isModuleExportsAccess } from "../program.js";
import type { Lowerer } from "./lowerer.js";
import { cjsExportsBagOf } from "./lower-exprs.js";

const liveMemo = new WeakMap<ts.SourceFile, boolean>();

/** True when `n` (an `exports` identifier or a `module.exports` access) is read as a
 * VALUE: not the object of a property/element access, not a property name, not
 * the target of an assignment. */
export function isValueUse(n: ts.Node): boolean {
  const p = n.parent;
  if (ts.isPropertyAccessExpression(p) && (p.expression === n || p.name === n)) return false;
  if (ts.isElementAccessExpression(p) && p.expression === n) return false;
  if (ts.isPropertyAssignment(p) && p.name === n) return false;
  if (ts.isBinaryExpression(p) && p.left === n && p.operatorToken.kind === ts.SyntaxKind.EqualsToken) return false;
  return true;
}

/** True when no function between `n` and its declaration shadows the free name `n` (context-free:
 * runs during global collection, before any function context exists). */
function unshadowed(L: Lowerer, n: ts.Identifier): boolean {
  const sym = L.checker.getSymbolAtLocation(n);
  if (sym === undefined) return true;
  for (const d of L.checker.declarationsOf(sym)) {
    for (let f: ts.Node | undefined = n.parent; f !== undefined && !ts.isSourceFile(f); f = f.parent) {
      if (ts.isFunctionLike(f) && d.pos >= f.pos && d.end <= f.end) return false;
    }
  }
  return true;
}

function computeLive(L: Lowerer, sf: ts.SourceFile): boolean {
  if (!isCjsJsFile(sf)) return false;
  for (const stmt of sf.statements) {
    if (cjsWholeExportAssignmentOf(stmt) !== null) return false;
    if (cjsExportAssignmentOf(stmt)?.kind === "table") return false;
    if (ts.isExpressionStatement(stmt) && exportsRebindInnerOf(stmt.expression) !== null) return false;
  }
  const stack: ts.Node[] = [sf];
  while (stack.length > 0) {
    const n = stack.pop()!;
    if (ts.isIdentifier(n) && n.text === "exports" && isValueUse(n) && unshadowed(L, n)) return true;
    if (isModuleExportsAccess(n as ts.Expression) && isValueUse(n)) {
      const m = (n as ts.PropertyAccessExpression).expression;
      if (ts.isIdentifier(m) && unshadowed(L, m)) return true;
    }
    ts.forEachChild(n, (c) => {
      stack.push(c);
    });
  }
  return false;
}

/** True when the file's export object is a live (bag-held) object. */
export function liveExportsOf(L: Lowerer, sf: ts.SourceFile): boolean {
  const known = liveMemo.get(sf);
  if (known !== undefined) return known;
  const r = computeLive(L, sf);
  liveMemo.set(sf, r);
  return r;
}

/** The bag of a live module as a DYN value (the module's export object). */
export function liveBagRef(L: Lowerer, sf: ts.SourceFile, loc: SrcLoc): IrExpr {
  return { kind: "varRef", localId: cjsExportsBagOf(L, sf), type: DYN, loc };
}

/** The live module a requirer's namespace binding (`const m = require("./x")`)
 * names, or null. The binding must be a CommonJS namespace binding
 * (cjsLocalModuleBindingOf) whose dep is live. */
export function liveDepOfBinding(L: Lowerer, recv: ts.Expression): ts.SourceFile | null {
  if (!ts.isIdentifier(recv) || !L.cjsLocalModuleBindingOf(recv)) return null;
  const dep = L.cjsBindingRequireDepOf(recv);
  if (dep === null) return null;
  return liveTwinOf(L, dep);
}

/** The LIVE compiled module a requirer's binding resolves to: the module itself when it is a
 * live CommonJS JS file, or its compiled twin when the binding resolved to the module's
 * declaration (`.d.ts`) and that twin is live. Null otherwise. */
export function liveTwinOf(L: Lowerer, sf: ts.SourceFile): ts.SourceFile | null {
  if (!sf.isDeclarationFile) return liveExportsOf(L, sf) ? sf : null;
  const twin = L.declTwinSourceOf(sf);
  return twin !== null && liveExportsOf(L, twin) ? twin : null;
}

/** The live module a NAMED import binding (`import { getDecoder } from "m"`, or a value
 * destructured from a declaration) names, read through the declaration's compiled twin. */
export function liveNamedTwinOf(L: Lowerer, sym: ts.Symbol): ts.SourceFile | null {
  const decls = L.checker.declarationsOf(sym);
  if (decls.length === 0) return null;
  const sf = decls[0]!.getSourceFile();
  if (!sf.isDeclarationFile) return null;
  return liveTwinOf(L, sf);
}

/** True when `init` evaluates to a live export object: the module's own `exports` / `module.exports`
 * (in a live file), or a requirer's namespace binding over a live module. */
export function isLiveExportValue(L: Lowerer, init: ts.Expression): boolean {
  let e: ts.Expression = init;
  while (ts.isParenthesizedExpression(e)) e = e.expression;
  if (ts.isIdentifier(e) && e.text === "exports" && isCjsJsFile(e.getSourceFile()) && unshadowed(L, e)) {
    return liveExportsOf(L, e.getSourceFile());
  }
  if (isModuleExportsAccess(e)) {
    const m = e.expression as ts.Identifier;
    return isCjsJsFile(e.getSourceFile()) && unshadowed(L, m) && liveExportsOf(L, e.getSourceFile());
  }
  if (ts.isIdentifier(e)) return liveDepOfBinding(L, e) !== null;
  return false;
}

/** A binding name whose initializer is a live export object: its storage is the DYN bag reference
 * (`var alias = module.exports`), not the checker's record of the export object. */
export function isLiveAliasName(L: Lowerer, name: ts.Identifier): boolean {
  const d = name.parent;
  if (!ts.isVariableDeclaration(d) || d.name !== name || d.initializer === undefined) return false;
  return isLiveExportValue(L, d.initializer);
}
