/* Expando function members (`function foo() {}; foo.bar = 12` — the
 * namespace-object idiom tsc binds as members ON the function's own
 * symbol/type) and property members of module-level CALLABLE consts
 * (`const c: Combo = () => 1; c.p = {}` — an interface member written
 * through the const's name).
 *
 * The lowering: each written member is a MODULE GLOBAL keyed by
 * (function symbol × member key), registered during collection by
 * scanning the file for member-assignment statements whose receiver is a
 * direct reference to a module-level function declaration or a
 * function-valued const. Reads and writes through the function's NAME
 * route to that global — the checker's declared member type is the
 * slot's type, and JS object identity holds because only references that
 * RESOLVE to the declaring symbol route this way (a structurally-typed
 * alias keeps its fences: a different function value could satisfy the
 * same type, so symbol identity, not type identity, is the routing key).
 *
 * JAVASCRIPT files are in, and their members' types come from the same
 * checked-dynamic fallback their file-scope bindings take. This is where
 * the idiom actually LIVES — it predates ES6 classes and every untyped
 * CJS package still writes it — and a `--npm-static` / provenance JS file
 * is a compiled program module like any other, so "the island or the dyn
 * keyed write owns those members" was never true of it: the write reached
 * no lowering at all.
 *
 * Two SPELLINGS of the receiver reach one storage: the local name, and
 * the CJS export table's member (`pkg.parse.VERSION` — resolveValueSymbol
 * re-resolves an export-table property to the local declaration it names,
 * which is the same function OBJECT). Both are needed together: with the
 * write routed and the read not, an importer's member read becomes a hard
 * "reading 'X' from a value of type '{ (…): …; X: … }'" error — strictly
 * worse than the fence it replaced.
 *
 * NOT covered, and the reason is representational rather than syntactic:
 * a function declaration NESTED in another function (each call creates a
 * fresh function object, so one module global would alias every
 * instantiation), and `<fn>.prototype.<member> = v` (a prototype is an
 * object instances inherit through — a module global is not on any
 * instance's lookup path, and seeding own properties instead would make
 * `Object.hasOwnProperty.call(m, k)` answer true where Node answers
 * false). Those two shapes are what pbjs `--target static-module` output
 * is built out of; see estado-propassign.md for the census.
 *
 * Honesty guards, mirroring the namespace-member stance:
 * - reads in INIT-EXECUTING position textually above the member's FIRST
 *   assignment fence (JS would answer undefined; the global would answer
 *   a later write's value);
 * - writes to the READ-ONLY function members (`length`, `name`,
 *   `caller`, `arguments`) fence: strict-mode JS (every module) throws
 *   TypeError there, and a global slot would silently succeed. WRITABLE
 *   Function.prototype members (`apply`, `call`, `bind`, `toString`)
 *   shadow through an own property in JS and lower like any other member
 *   — reads route to the registry, so the shadowed value is what reads
 *   and calls observe;
 * - member keys are spelled names, folded computed keys
 *   (foldedStringKeyOf's contract), or statically-resolvable
 *   unique-symbol consts (uniqueSymbolKeyOf — the class symbol-field
 *   precedent); runtime-valued keys keep their fences. */
import * as ts from "../ts7/adapter.js";
import { dynFallbackType, type Lowerer } from "./lowerer.js";
import { IrExpr, IrGlobal, IrStmt, IrType } from "../../ir/nodes.js";
import { isJsSourceFile, locOf } from "../program.js";
import { isUnitOnlyTsType, unitOnlyUnion } from "../types.js";

/** The registry entry for one expando member slot. */
export interface ExpandoMember {
  global: IrGlobal;
  /** Source start of the FIRST assignment in the declaring file — the
   * init-position read guard's boundary. */
  firstWriteStart: number;
  /** The declaring file (guards apply to same-file init reads only —
   * importers evaluate after the exporter's init, the module-globals
   * stance). */
  file: ts.SourceFile;
}

/** Function members JS refuses to assign in strict mode (every module is
 * strict): non-writable own properties of functions plus the poisoned
 * caller/arguments pair. A global slot would silently succeed where Node
 * throws TypeError, so writes fence by name. */
const READONLY_FN_MEMBERS = new Set(["length", "name", "caller", "arguments", "prototype"]);

/** The member key of an assignment target / read site: a spelled or
 * folded string name, a unique-symbol const's ts.Symbol, or null (not a
 * routable key). */
function memberKeyOf(L: Lowerer, expr: ts.PropertyAccessExpression | ts.ElementAccessExpression): string | ts.Symbol | null {
  if (ts.isPropertyAccessExpression(expr)) {
    return ts.isIdentifier(expr.name) ? expr.name.text : null;
  }
  const sym = L.uniqueSymbolKeyOf(expr.argumentExpression);
  if (sym) return sym.sym;
  return L.foldedStringKeyOf(expr.argumentExpression);
}

/** How many sites each of the three JS-side branches CLAIMED, so a probe
 * can read the numbers in the same run as the result they produced:
 * `jsDecl` a receiver that resolved to a JS-file function declaration or
 * function-valued const, `jsDynSlot` a member slot whose type came from
 * the checked-dynamic fallback, `viaExport` a receiver spelled through a
 * CJS export table. Monotonic per process; the suite reads deltas. */
export const expandoCounters = { jsDecl: 0, jsDynSlot: 0, viaExport: 0 };

/** The module-level function-ish symbol a receiver expression resolves
 * to, or null: a top-level FunctionDeclaration, or a top-level `const`
 * variable whose checker type is callable (arrow/function-expression
 * consts, interface-typed callable consts).
 *
 * Routing is by SYMBOL identity, and two spellings reach the same symbol:
 * a direct identifier reference, and the CJS export-table member spelling
 * (`pkg.parse.VERSION` — resolveValueSymbol already re-resolves an export
 * table's property to the LOCAL declaration it names, which is the same
 * function OBJECT, so the importer's reads and the exporter's writes must
 * meet at one storage; without this the write lands in the slot and the
 * read becomes a hard "reading 'X' from a value of type '{ (…): …; X: … }'"
 * error, which is strictly worse than the fence it replaced). */
function expandoFnSymbolOf(L: Lowerer, recv: ts.Expression): ts.Symbol | null {
  if (!ts.isIdentifier(recv)) {
    if (
      !ts.isPropertyAccessExpression(recv) || recv.questionDotToken !== undefined ||
      !ts.isIdentifier(recv.name)
    ) {
      return null;
    }
    const viaExport = L.resolveValueSymbol(recv.name);
    if (!viaExport) return null;
    // Only a symbol the registry ALREADY carries members for routes this
    // way: collection runs identifier-receiver-only and over every file
    // before any statement lowers, so the registry is complete here and a
    // miss means this receiver is not a member-carrying function at all.
    if (!L.expandoMembers.has(viaExport)) return null;
    const d = L.checker.valueDeclarationOf(viaExport);
    if (!d || d.getSourceFile().isDeclarationFile) return null;
    if (!ts.isFunctionDeclaration(d) || !ts.isSourceFile(d.parent)) return null;
    expandoCounters.viaExport++;
    return viaExport;
  }
  // Island and checked-dynamic receivers never qualify by construction:
  // the declaration-shape checks below (a function DECLARATION, or a
  // const whose initializer is a function/arrow LITERAL) exclude import
  // bindings and call results — their member stories (engine property
  // writes, dyn keyed writes) stay put.
  const sym = L.resolveValueSymbol(recv);
  if (!sym) return null;
  const decl = L.checker.valueDeclarationOf(sym);
  if (!decl || decl.getSourceFile().isDeclarationFile) return null;
  // JS files were excluded wholesale on the theory that their member
  // stories are the island's or the dyn keyed write's. MEASURED false for
  // the lane that matters: a `--npm-static` / provenance JS file IS a
  // compiled program module, its function declarations ARE compiled
  // functions, and `parse.VERSION = "1.2.3"` there reaches no other
  // lowering — it falls through to "assignment to non-variables", and
  // every read of the member is a hard compile error. Same symbol
  // identity, same storage rule.
  const js = isJsSourceFile(decl.getSourceFile());
  if (ts.isFunctionDeclaration(decl)) {
    // A NESTED function declaration stays out, in JS exactly as in TS:
    // each call of the enclosing function creates a fresh function
    // object, and one module global would alias every instantiation.
    if (!ts.isSourceFile(decl.parent)) return null;
    if (js) expandoCounters.jsDecl++;
    return sym;
  }
  if (ts.isVariableDeclaration(decl)) {
    if (!ts.isVariableStatement(decl.parent.parent) || !ts.isSourceFile(decl.parent.parent.parent)) return null;
    if ((ts.getCombinedNodeFlags(decl) & ts.NodeFlags.Const) === 0) return null;
    // The const's VALUE must be a function created here (arrow/function
    // initializer) — a callable TYPE alone can be satisfied by island
    // handles and other values whose members live elsewhere.
    let init = decl.initializer;
    while (init !== undefined && (ts.isParenthesizedExpression(init) || ts.isAsExpression(init) || ts.isTypeAssertion(init))) init = init.expression;
    if (init === undefined || (!ts.isArrowFunction(init) && !ts.isFunctionExpression(init))) return null;
    if (L.checker.getCallSignatures(L.checker.getTypeOfSymbol(sym)).length === 0) return null;
    if (js) expandoCounters.jsDecl++;
    return sym;
  }
  return null;
}

/** A member-assignment statement's pieces (`<fn>.<key> = <value>` /
 * `<fn>[KEY] = <value>` under any assignment operator), or null. */
function expandoWriteOf(
  L: Lowerer,
  node: ts.Node,
): { fnSym: ts.Symbol; key: string | ts.Symbol; access: ts.PropertyAccessExpression | ts.ElementAccessExpression } | null {
  if (!ts.isBinaryExpression(node)) return null;
  const op = node.operatorToken.kind;
  if (op !== ts.SyntaxKind.EqualsToken && (op < ts.SyntaxKind.FirstCompoundAssignment || op > ts.SyntaxKind.LastCompoundAssignment)) {
    return null;
  }
  const left = node.left;
  if (!ts.isPropertyAccessExpression(left) && !ts.isElementAccessExpression(left)) return null;
  if (ts.isPropertyAccessExpression(left) && left.questionDotToken) return null;
  const fnSym = expandoFnSymbolOf(L, left.expression);
  if (!fnSym) return null;
  const key = memberKeyOf(L, left);
  if (key === null) return null;
  return { fnSym, key, access: left };
}

/** Collection: walk one file for expando member assignments and register
 * a module global per (function symbol × member key). Runs with
 * collectGlobals — before any statement lowers — so reads inside earlier
 * function bodies resolve. Registration failures (unmappable member
 * types) register nothing: the write statement's own lowering fences. */
export function collectExpandoMembers(L: Lowerer, sf: ts.SourceFile): void {
  const rawTag = L.fileTag.get(sf) ?? "";
  const tag = rawTag === "" ? "e." : rawTag.replace(/^%/, "");
  // Worklist walk, not recursion: pathologically deep expressions (the
  // 7000-level nesting fixtures) must reach their own named fences, not
  // blow the collection pass's stack.
  const queue: ts.Node[] = [];
  const process = (node: ts.Node): void => {
    const w = expandoWriteOf(L, node);
    if (w) {
      let members = L.expandoMembers.get(w.fnSym);
      if (!members) {
        members = new Map();
        L.expandoMembers.set(w.fnSym, members);
      }
      const existing = members.get(w.key);
      if (existing) {
        existing.firstWriteStart = Math.min(existing.firstWriteStart, node.getStart());
      } else if (!(typeof w.key === "string" && READONLY_FN_MEMBERS.has(w.key)) && !nsOwnedMember(L, w.access)) {
        // The member slot's type is the checker's DECLARED member type at
        // the access (expando members widen across all assignments;
        // interface members carry their declared type). Mapping failures
        // register nothing and drop their collection-time diagnostics —
        // the write statement's own lowering re-diagnoses in context.
        const diagsBefore = L.diags.length;
        const tsType = L.typeOf(w.access);
        let type: IrType | null;
        try {
          type = L.mapTypeOf(tsType);
        } catch {
          L.diags.splice(diagsBefore); // PoisonError — the statement re-diagnoses
          type = null;
        }
        if (type?.kind === "void" && isUnitOnlyTsType(tsType)) type = unitOnlyUnion(L.unions);
        // A JS member whose declared type is inference RESIDUE (`(v: any)
        // => any`, `any` — every member of an untyped CJS package, where
        // mapTypeOf answers null and the slot would never be registered):
        // the checked-dynamic fallback the JS file-scope bindings already
        // take (dynFallbackType — a pure single-signature function keeps
        // its func-ness with dyn pieces, so direct calls through the
        // member stay static calls; everything else is dyn storage).
        // Collection-time diagnostics drop either way: the write
        // statement's own lowering re-diagnoses in context.
        if (!type && isJsSourceFile(sf)) {
          try {
            type = dynFallbackType(L, w.access, tsType);
          } catch {
            type = null;
          }
          L.diags.splice(diagsBefore);
          if (type) expandoCounters.jsDynSlot++;
        }
        if (type && type.kind !== "void") {
          const fnName = w.fnSym.name;
          const memberName = typeof w.key === "string" ? w.key : `sym%${w.key.name}%${L.checker.declarationsOf(w.key)[0]?.getStart() ?? 0}`;
          const g: IrGlobal = {
            id: `%g.${tag}${fnName}%.${memberName}`,
            name: `${fnName}.${memberName}`,
            type,
            mutable: true,
          };
          members.set(w.key, { global: g, firstWriteStart: node.getStart(), file: sf });
          L.globalsList.push(g);
        }
      }
    }
    ts.forEachChild(node, (c) => {
      queue.push(c);
    });
  };
  ts.forEachChild(sf, (c) => {
    queue.push(c);
  });
  while (queue.length > 0) process(queue.pop()!);
}

/** A member the NAMESPACE machinery owns storage for: the member symbol
 * declares as a variable inside a NON-AMBIENT namespace block (a real
 * function+namespace merge — those members have namespace globals and
 * nsWritableTarget routes them). Ambient (`declare namespace`) members
 * have no storage anywhere and are exactly the declared-expando idiom
 * this module lowers. */
function nsOwnedMember(L: Lowerer, access: ts.PropertyAccessExpression | ts.ElementAccessExpression): boolean {
  const nameNode = ts.isPropertyAccessExpression(access) ? access.name : access.argumentExpression;
  const sym = L.checker.getSymbolAtLocation(nameNode);
  if (!sym) return false;
  for (const d of L.checker.declarationsOf(sym)) {
    for (let p: ts.Node | undefined = d.parent; p !== undefined && !ts.isSourceFile(p); p = p.parent) {
      if (ts.isModuleDeclaration(p)) {
        return !(p.modifiers?.some((m) => m.kind === ts.SyntaxKind.DeclareKeyword) || p.getSourceFile().isDeclarationFile);
      }
    }
  }
  return false;
}

/** True when `node` executes during module INIT (top-level statement
 * position, not inside any function-like body) — the read-guard test,
 * mirroring the namespace stance. */
function initExecutingPosition(node: ts.Node): boolean {
  for (let p: ts.Node | undefined = node.parent; p !== undefined; p = p.parent) {
    if (ts.isFunctionLike(p)) return false;
    if (ts.isSourceFile(p)) break;
  }
  return true;
}

/** Assignment-target resolution for expando member writes: the member's
 * module global. Fences read-only function members by name. Null when
 * the access is not an expando member at all. */
export function expandoWritableTarget(
  L: Lowerer,
  access: ts.PropertyAccessExpression | ts.ElementAccessExpression,
): { id: string; type: IrType } | null {
  if (ts.isPropertyAccessExpression(access) && access.questionDotToken) return null;
  const fnSym = expandoFnSymbolOf(L, access.expression);
  if (!fnSym) return null;
  const key = memberKeyOf(L, access);
  if (key === null) return null;
  if (typeof key === "string" && READONLY_FN_MEMBERS.has(key)) {
    L.unsupported(
      "SC1090",
      access,
      `assigning the read-only function member '${key}' (strict-mode JS — every module — throws TypeError here)`,
    );
  }
  const member = L.expandoMembers.get(fnSym)?.get(key);
  if (!member) return null;
  return { id: member.global.id, type: member.global.type };
}

/** Read resolution for expando member accesses: a varRef of the member's
 * global, guarded against init-position reads above the first write
 * (Node answers undefined there — the global would answer a later
 * write's value). Null when not an expando member read. */
export function expandoMemberRead(
  L: Lowerer,
  access: ts.PropertyAccessExpression | ts.ElementAccessExpression,
): IrExpr | null {
  if (ts.isPropertyAccessExpression(access) && access.questionDotToken) return null;
  if (ts.isElementAccessExpression(access) && access.questionDotToken) return null;
  const fnSym = expandoFnSymbolOf(L, access.expression);
  if (!fnSym) return null;
  const key = memberKeyOf(L, access);
  if (key === null) return null;
  const member = L.expandoMembers.get(fnSym)?.get(key);
  if (!member) return null;
  if (
    access.getSourceFile() === member.file &&
    initExecutingPosition(access) &&
    access.getStart() < member.firstWriteStart
  ) {
    const name = typeof key === "string" ? key : key.name;
    L.unsupported(
      "SC1090",
      access,
      `reading the function member '${name}' above its first assignment (JS answers undefined there, which the member's type cannot hold — move the read below the assignment)`,
    );
  }
  return { kind: "varRef", localId: member.global.id, type: member.global.type, loc: locOf(access) };
}

/** The statement lowering for `<fn>.<key> = <value>`: an ordinary global
 * assign with the usual RHS coercion. Null when not an expando write. */
export function lowerExpandoAssignStmt(L: Lowerer, expr: ts.BinaryExpression): IrStmt | null {
  if (expr.operatorToken.kind !== ts.SyntaxKind.EqualsToken) return null;
  const left = expr.left;
  if (!ts.isPropertyAccessExpression(left) && !ts.isElementAccessExpression(left)) return null;
  const target = expandoWritableTarget(L, left);
  if (!target) return null;
  const value = L.lowerExprExpecting(expr.right, target.type);
  return { kind: "assign", localId: target.id, value, loc: locOf(expr) };
}
