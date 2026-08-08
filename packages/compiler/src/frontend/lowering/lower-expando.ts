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
import { canConvertToDyn, canDynCheckTo, DYN, funcOf, IrExpr, IrFunction, IrGlobal, IrStmt, IrType, VOID } from "../../ir/nodes.js";
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
 * throws TypeError, so writes fence by name.
 *
 * `prototype` is NOT one of them, and saying it was made this diagnostic
 * a false statement about the language: on a function DECLARATION
 * `prototype` is a writable own data property, so `F.prototype = {…}`
 * succeeds in Node — the runtime's own keyed-write arm has said so in a
 * comment since the write landed. It stays out of the EXPANDO set below
 * (a module global would be the wrong home — the prototype object lives
 * in the function value's own-property table, where scr_dyn_fn_prototype
 * mints it and `new` reads it back), so an unfenced write here simply
 * falls through to the dyn keyed write that already stores it. */
const READONLY_FN_MEMBERS = new Set(["length", "name", "caller", "arguments"]);

/** Members that never become expando GLOBALS: the read-only set, plus
 * `prototype`, whose home is the function value's own-property table. */
const NON_EXPANDO_FN_MEMBERS = new Set([...READONLY_FN_MEMBERS, "prototype"]);

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
export const expandoCounters = {
  jsDecl: 0,
  jsDynSlot: 0,
  viaExport: 0,
  /** The MEMBER accounting, and it is a PARTITION on purpose: every slot
   * this module registers either gets its dyn-box accessor pair (`bound`)
   * or lands in exactly one named skip. The four numbers are asserted to
   * add up at the end of every lowering (assertExpandoAccounting), so the
   * corpus lane is the accounting test: a future skip added without a
   * counter stops the sum from balancing on the first program that takes
   * it, instead of silently restoring the two-storage split this module's
   * second half exists to close. */
  members: 0,
  bound: 0,
  /** A unique-symbol member key: no spelling a dyn keyed read can arrive
   * with, so there is nothing for a box to ask for. */
  skipSymbolKey: 0,
  /** The registering receiver is not an identifier in the DECLARING file
   * (the CJS export-table spelling — `pkg.parse.VERSION`): it reaches the
   * same global through the same routing, and the declaring file's own
   * bind already covers the box. */
  skipForeignRecv: 0,
  /** The slot's type has no dyn representation OUT (canConvertToDyn), so
   * a getter could not be written; see the section header for why this
   * one stays silent rather than fencing. */
  skipNotBoxable: 0,
  /** Bound, but with a FENCED setter: the type boxes out and cannot be
   * checked back (canDynCheckTo). A subset of `bound`. */
  writeFenced: 0,
  /** Counted at BIND-EMISSION time, not registration: the accessor pair
   * exists but the function VALUE itself does not lower at the bind site
   * (the exact-arity value rule is the one that reaches this), so the
   * member keeps today's box behavior rather than making the program stop
   * compiling. A subset of `bound` — the partition above is about
   * registration and stays exact. */
  bindDeclined: 0,
  /** Also emission-time: the member's FIRST write is inside a function
   * body, so no module-scope position can know the slot is real. Binding
   * anyway would put the box route into the unassigned-slot hole the
   * name-spelled route already has (bindPositionOf's header). A subset of
   * `bound`. */
  bindNoInitWrite: 0,
};

/** The partition above must be exhaustive. Exported so a test can arm the
 * detector with a deliberately broken tally rather than trusting that a
 * green corpus proves the check runs. */
export function assertExpandoAccounting(c: typeof expandoCounters): void {
  const parts = c.bound + c.skipSymbolKey + c.skipForeignRecv + c.skipNotBoxable;
  if (parts !== c.members) {
    throw new Error(
      `lowerer bug: expando member accounting — ${c.members} registered but ` +
        `${c.bound} bound + ${c.skipSymbolKey} symbol-keyed + ${c.skipForeignRecv} foreign-receiver + ` +
        `${c.skipNotBoxable} unboxable = ${parts}. A member that is neither bound nor named here reads ` +
        `undefined through every dyn box, which is the split lower-expando.ts closes.`,
    );
  }
}

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
      } else if (!(typeof w.key === "string" && NON_EXPANDO_FN_MEMBERS.has(w.key)) && !nsOwnedMember(L, w.access)) {
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
          // The dyn-box half of the same storage (see below).
          expandoCounters.members++;
          const fnDecl = L.checker.valueDeclarationOf(w.fnSym);
          if (typeof w.key !== "string") expandoCounters.skipSymbolKey++;
          else if (!fnDecl) expandoCounters.skipForeignRecv++;
          else bindExpandoAccessors(L, sf, w.access.expression, w.key, members.get(w.key)!, fnDecl);
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

/* ── the other spelling of the same member: a DYN BOX ─────────────────
 *
 * Everything above routes by SYMBOL: a member read or written through the
 * function's NAME finds the module global. Nothing routes when the
 * function VALUE is reached some other way — `holder.f`, `arr[0]`, a
 * parameter, a local alias, `F.prototype.constructor`, `new F()
 * .constructor`, an importer's `const p = pkg.parse`. Each of those boxes
 * the function into a dyn, and a FUNC box's own-property table hangs off
 * the CLOSURE, which knows nothing about a module global. Measured, on
 * the tree this landed against: every one of those reads answered
 * `undefined` (or threw the checked conversion on the way out of it)
 * where Node answers the member, and — the worse half — a WRITE through
 * one of them landed in the table, where no name-spelled read could ever
 * see it. Two storages for one JavaScript fact, disagreeing in both
 * directions. Nested function declarations never had the split because
 * they are excluded from lifting above: their members live in the table
 * and every route meets there, which is the shape this restores.
 *
 * The unification keeps the GLOBAL as the one storage — deleting it
 * instead would cost every name-spelled read its static type, and a TS
 * importer of a JS package its lowering — and gives the box a way in: one
 * accessor PAIR per member, compiled like any other function, bound to
 * the closure at module init (scr_dyn_expando_bind). The runtime's keyed
 * read asks the getter when its table misses; the keyed write asks the
 * setter instead of storing beside the global. Both spellings then end at
 * the same slot and cannot disagree.
 *
 * What the getter answers is the boundary's OWN stance, inherited rather
 * than invented here: a typed value crossing into dyn boxes through
 * `dynFrom`, which for a func value carries the closure (so identity and
 * the shared property table survive) and for a RECORD builds a dyn copy.
 * So `holder.f.opts.deep` now reads the member where it read `undefined`,
 * but `holder.f.opts` is not the same object as `Writer.opts` and a
 * mutation through one is not seen by the other. That is the same copy
 * every other static→dyn crossing in the compiler makes, not a new rule
 * of this registry — and it is strictly closer to Node than the
 * `undefined` it replaces.
 *
 * The two directions are gated separately, and asymmetrically on purpose.
 * A member whose type cannot be boxed OUT (canConvertToDyn) binds
 * nothing: `scr_dyn_fn_get` is a read the runtime treats as
 * non-throwing — `scr_dyn_fn_has` and the `in`/hasOwn pair ask it — so a
 * refusal there would leak a pending exception into callers that never
 * check for one, and the honest cheap answer is to leave that member
 * exactly as it reads today. A member that boxes out but cannot be
 * checked BACK (canDynCheckTo) binds a real getter and a fenced setter:
 * the keyed WRITE is already in the may-throw seed set, so a refusal
 * naming the member is free there and beats a write that silently lands
 * somewhere no static read can see. */
export interface ExpandoBind {
  /** The registered slot, read at EMISSION time for its final
   * `firstWriteStart` — collection may lower that boundary after this
   * record is made (a later-walked write earlier in the file). */
  member: ExpandoMember;
  /** A receiver spelling that resolves to the function value, lowered in
   * the init context to produce it. */
  recv: ts.Identifier;
  /** The callable const's declaration end, or 0 for a hoisted function
   * declaration: the bind can never run BEFORE the function value exists,
   * whatever the member's first write says. */
  valueReady: number;
  key: string;
  getter: string;
  setter: string;
}

/** Where in the declaring file a member's bind must run: after the
 * top-level statement carrying its FIRST write, and never before the
 * function value itself exists. Null when the first write is inside a
 * function body.
 *
 * Binding at the first write rather than at module entry is what keeps a
 * box read HONEST before the member exists. An unassigned pointer-backed
 * global is a NULL slot, and reading one is a crash — the pre-existing
 * hole that `function F(){}; function e(){return F.tag} e(); F.tag="t"`
 * already falls into through the NAME (measured: segfault at `fdcf308`).
 * An accessor bound at module entry would drag the BOX route into that
 * same hole, turning `h.f.tag` before the write from Node's `undefined`
 * into a crash. Bound after the write, the box finds no accessor until
 * the slot is real and answers `undefined` exactly like Node — and from
 * there on the two routes are as safe as each other, which is the most
 * this can claim without closing the underlying hole.
 *
 * A first write inside a FUNCTION body binds nothing: nothing at module
 * scope can know whether that function ran, so any placement would either
 * be too early (the NULL slot again) or arbitrary. */
function bindPositionOf(sf: ts.SourceFile, b: ExpandoBind): number | null {
  const at = b.member.firstWriteStart;
  const stmt = sf.statements.find((s) => s.getStart() <= at && at < s.getEnd());
  if (stmt === undefined) return null;
  return Math.max(stmt.getEnd(), b.valueReady);
}

/** Function-value type of the accessors, so the bind site can spell the
 * closure without re-deriving it. */
const EXPANDO_GET_T: IrType = funcOf([], DYN);
const EXPANDO_SET_T: IrType = funcOf([DYN], VOID);

/** Synthesizes the accessor pair for one registered member and records
 * the bind. Called from collection, where the slot's type is settled and
 * the module globals list is still open. Silent (never diagnoses): a
 * member that cannot be bound keeps exactly today's behavior at every
 * name-spelled site, which is the only place it was ever right. */
function bindExpandoAccessors(
  L: Lowerer,
  sf: ts.SourceFile,
  recv: ts.Expression,
  key: string,
  member: ExpandoMember,
  decl: ts.Node,
): void {
  const g = member.global;
  // Only the DECLARING file's own identifier spelling can produce the
  // function value in that file's %init. The CJS export-table spelling
  // (`pkg.parse.VERSION`) reaches the same storage through the same
  // global and needs no second bind.
  if (!ts.isIdentifier(recv) || recv.getSourceFile() !== sf || decl.getSourceFile() !== sf) {
    expandoCounters.skipForeignRecv++;
    return;
  }
  const loc = locOf(recv);
  const getName = `%xget${g.id}`;
  const setName = `%xset${g.id}`;
  const getRecord = (id: string) => L.shapes.get(id);
  const getUnion = (id: string) => L.unions.get(id);
  const isDyn = g.type.kind === "dyn";
  if (!isDyn && !canConvertToDyn(g.type, getRecord, getUnion)) {
    expandoCounters.skipNotBoxable++;
    return;
  }
  const writable = isDyn || canDynCheckTo(g.type, getRecord, getUnion);
  expandoCounters.bound++;
  if (!writable) expandoCounters.writeFenced++;
  const slot: IrExpr = { kind: "varRef", localId: g.id, type: g.type, loc };
  const vId = `%xv.0`;
  const getter: IrFunction = {
    name: getName,
    params: [],
    returnType: DYN,
    locals: [],
    body: [{ kind: "return", value: isDyn ? slot : { kind: "dynFrom", value: slot, type: DYN, loc }, loc }],
    loc,
  };
  const setter: IrFunction = {
    name: setName,
    params: [{ localId: vId, name: "v", type: DYN }],
    returnType: VOID,
    locals: [{ id: vId, name: "v", type: DYN, mutable: false }],
    body: writable
      ? [
          {
            kind: "assign",
            localId: g.id,
            value: isDyn
              ? { kind: "varRef", localId: vId, type: DYN, loc }
              : { kind: "dynCheck", value: { kind: "varRef", localId: vId, type: DYN, loc }, type: g.type, loc },
            loc,
          },
        ]
      : [
          {
            kind: "runtimeFence",
            code: "SC1090",
            message:
              `writing the function member '${g.name}' through a DYNAMIC reference to the function ` +
              `(its storage is a module global of type '${L.fmt(g.type)}', which no dyn value can be ` +
              `checked back into — write it through the function's name instead) is not supported yet`,
            loc,
          },
        ],
    loc,
  };
  L.implicitFns.push(getter, setter);
  const binds = L.expandoBinds.get(sf) ?? [];
  L.expandoBinds.set(sf, binds);
  binds.push({
    member,
    recv,
    valueReady: ts.isFunctionDeclaration(decl) ? 0 : decl.getEnd(),
    key,
    getter: getName,
    setter: setName,
  });
}

/** The `dyn.expandoBind` statements for one file's members whose bind
 * position (bindPositionOf) falls at or after `from` and before `to` —
 * lowerFileInit walks the window forward one top-level statement at a
 * time, so each member binds immediately after the statement that first
 * writes it. */
export function expandoBindStmts(L: Lowerer, sf: ts.SourceFile, from: number, to: number): IrStmt[] {
  const binds = L.expandoBinds.get(sf);
  if (binds === undefined) return [];
  const out: IrStmt[] = [];
  for (const b of binds) {
    const pos = bindPositionOf(sf, b);
    if (pos === null) {
      // Counted once, not once per window: the emitter walks the whole
      // list on every statement boundary.
      if (from === 0) expandoCounters.bindNoInitWrite++;
      continue;
    }
    if (pos < from || pos >= to) continue;
    const loc = locOf(b.recv);
    // Taking the function as a VALUE can itself fence (the exact-arity
    // value rule). A member whose function cannot be boxed keeps today's
    // behavior rather than making the program stop compiling: drop the
    // bind and the diagnostics it produced.
    const before = L.diags.length;
    let recvIr: IrExpr;
    try {
      recvIr = L.lowerExpr(b.recv);
    } catch {
      L.diags.splice(before);
      expandoCounters.bindDeclined++;
      continue;
    }
    if (L.diags.length > before) {
      L.diags.splice(before);
      expandoCounters.bindDeclined++;
      continue;
    }
    if (recvIr.type.kind !== "func" && recvIr.type.kind !== "dyn") {
      expandoCounters.bindDeclined++;
      continue;
    }
    const box: IrExpr =
      recvIr.type.kind === "dyn" ? recvIr : { kind: "dynFrom", value: recvIr, type: DYN, loc };
    const accessor = (name: string, t: IrType): IrExpr => ({
      kind: "dynFrom",
      value: { kind: "closure", fnName: name, captures: [], type: t, loc },
      type: DYN,
      loc,
    });
    out.push({
      kind: "exprStmt",
      expr: {
        kind: "libCall",
        fn: "dyn.expandoBind",
        args: [
          box,
          { kind: "strLit", value: b.key, type: { kind: "string" }, loc },
          accessor(b.getter, EXPANDO_GET_T),
          accessor(b.setter, EXPANDO_SET_T),
        ],
        type: VOID,
        loc,
      },
      loc,
    });
  }
  return out;
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
