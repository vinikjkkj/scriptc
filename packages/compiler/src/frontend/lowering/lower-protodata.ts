/* PROTOTYPE DATA on ES classes: `C.prototype.name = <value>` at the top
 * level of the file declaring class C (a constant name; methods and
 * function-valued sources are the late-method machinery's, lower-classes.ts).
 *
 * JS semantics this lowering answers, per instance `o` of C (or of a
 * subclass that does not redeclare the name):
 *   - `o.name` with no own `name` reads the prototype value, and a later
 *     `C.prototype.name = v` is seen by every instance that has no own
 *     value;
 *   - an own write (`o.name = v`) shadows it for that instance only;
 *   - `'name' in o` is true.
 *
 * Representation: one module global per (class, name), the prototype
 * slot, stored by its top-level assignment statements. The class carries
 * an instance field of the name (declared, inferred, or a checked-dynamic
 * field added at layout time, lower-classes.ts): an unset field is
 * undefined, so a static instance read answers `field is undefined ? slot :
 * field`.
 *
 * Exactness: a slot whose every write is literal undefined is exact (unset
 * and own-undefined both read undefined). Any other value can be hidden by
 * an own undefined that an untyped or dynamic write stores, which the
 * program-wide scan cannot see one by one, so such a name is fenced when
 * undefined can be stored under it.
 *
 * Known residual (pre-existing, not this lowering): an untyped-assigned
 * field that was never written is listed by Object.keys, because the
 * field's undefined arm cannot tell "unset" from "own undefined".
 *
 * Fences (loud SC1090, never a silent answer): a dynamic (untyped) receiver
 * of a name written a non-undefined value anywhere in the program, a
 * receiver that is not a plain name or `this`, a read in init position
 * above the first write (the expando rule), a subclass that declares its
 * own field of the name (the static receiver type would hide that storage),
 * and a method or accessor of the name on the way up. */
import * as ts from "../ts7/adapter.js";
import type { Lowerer } from "./lowerer.js";
import type { ClassInfo } from "./lower-classes.js";
import { isJsSourceFile, locOf } from "../program.js";
import { BOOL, DYN, IrExpr, IrGlobal, IrStmt, IrType, UNDEFINED_T, isUnitType, typeEquals, type SrcLoc } from "../../ir/nodes.js";
import { dynFallbackType } from "./lowerer.js";

export interface ProtoDataSlot {
  /** The module global holding the prototype value. */
  global: IrGlobal;
  /** The slot's type: the instance field's type when the class carries one, else the written value's. */
  type: IrType;
  /** Start offset of the first (top-level) write, for the init-position fence. */
  firstWriteStart: number;
  file: ts.SourceFile;
}

/** Writes of a fenced prototype datum, with the refusal their statement reports. */
const fencedWrites = new Map<ts.Node, string>();

function isFunctionLikeRhs(e: ts.Expression): boolean {
  let x: ts.Expression = e;
  while (ts.isParenthesizedExpression(x)) x = x.expression;
  return ts.isFunctionExpression(x) || ts.isArrowFunction(x) || ts.isClassExpression(x);
}

/** A right-hand side that is DATA: not a function-valued source, and not a
 * borrowed member of another class's prototype (`C.prototype.n = D.prototype.m`
 * copies a method, which is the late-method machinery's or unsupported). */
function isDataRhs(e: ts.Expression): boolean {
  let x: ts.Expression = e;
  while (ts.isParenthesizedExpression(x)) x = x.expression;
  if (isFunctionLikeRhs(x)) return false;
  return !(ts.isPropertyAccessExpression(x) && ts.isPropertyAccessExpression(x.expression) && x.expression.name.text === "prototype");
}

function undefinedRhs(e: ts.Expression): boolean {
  let x: ts.Expression = e;
  while (ts.isParenthesizedExpression(x)) x = x.expression;
  return (ts.isIdentifier(x) && x.text === "undefined") || ts.isVoidExpression(x);
}

/** A receiver the read may evaluate twice: a plain name or `this`. A property
 * or element chain would evaluate its owner twice in the ternary, and a second
 * evaluation of an owned element read unbalances its reference count
 * (measured: a segfault in scr_collect_cycles at exit, corpus 10622). */
function pureReceiver(e: ts.Expression): boolean {
  let x: ts.Expression = e;
  while (ts.isParenthesizedExpression(x) || ts.isNonNullExpression(x)) x = x.expression;
  return x.kind === ts.SyntaxKind.ThisKeyword || ts.isIdentifier(x);
}

/** The undefined-arm tag of a union type, or -1 when the type has none. */
function undefTagOf(L: Lowerer, t: IrType): number {
  if (t.kind !== "union") return -1;
  const def = L.unions.get(t.unionId);
  if (!def || !def.arms.some((a) => a.kind === "undefinedT")) return -1;
  return L.armTag(t.unionId, UNDEFINED_T);
}

/** `ref` as a value of union `target`: wrapped into the arm it is, when the
 * target has that arm; null when it cannot be represented there. */
function asUnionArm(L: Lowerer, ref: IrExpr, target: IrType, loc: SrcLoc): IrExpr | null {
  if (target.kind !== "union" || ref.type.kind === "union") return ref;
  const tag = L.armTag(target.unionId, ref.type);
  if (tag < 0) return null;
  return { kind: "unionWrap", unionId: target.unionId, tag, value: ref, type: target, loc };
}

/** The one non-undefined arm of an undefined-armed union, or null. */
function undefArmedValueType(L: Lowerer, t: IrType): IrType | null {
  if (t.kind !== "union") return null;
  const def = L.unions.get(t.unionId);
  if (!def || !def.arms.some((a) => a.kind === "undefinedT")) return null;
  const real = def.arms.filter((a) => !isUnitType(a));
  return real.length === 1 ? real[0]! : null;
}

/** The type a write's right-hand side has, as far as the checker says. */
function valueTypeOfRhs(L: Lowerer, e: ts.Expression, fallback: IrType): IrType {
  const t = L.mapTypeOf(L.checker.getBaseTypeOfLiteralType(L.checker.getTypeAtLocation(e)));
  return t ?? fallback;
}

/** The top-level prototype-data write statements of `sf` whose receiver
 * `classOf` accepts, as (name, statement) pairs. */
function topLevelProtoWrites(
  sf: ts.SourceFile,
  classOf: (recv: ts.Expression) => boolean,
): { name: string; stmt: ts.BinaryExpression }[] {
  const out: { name: string; stmt: ts.BinaryExpression }[] = [];
  for (const stmt of sf.statements) {
    if (!ts.isExpressionStatement(stmt)) continue;
    const e = stmt.expression;
    if (!ts.isBinaryExpression(e) || e.operatorToken.kind !== ts.SyntaxKind.EqualsToken) continue;
    const lhs = e.left;
    if (
      !ts.isPropertyAccessExpression(lhs) || !ts.isIdentifier(lhs.name) ||
      !ts.isPropertyAccessExpression(lhs.expression) || lhs.expression.name.text !== "prototype" ||
      !ts.isIdentifier(lhs.expression.expression)
    ) {
      continue;
    }
    if (!classOf(lhs.expression.expression)) continue;
    out.push({ name: lhs.name.text, stmt: e });
  }
  return out;
}

/** Program-wide scan of a JS file's top-level prototype-data writes: the
 * names written a non-undefined value (L.protoDataNonUndef). Runs before the
 * file's statements lower, so a dynamic-receiver read of such a name can be
 * fenced wherever it appears. */
export function collectProtoDataNames(L: Lowerer, sf: ts.SourceFile): void {
  if (!isJsSourceFile(sf)) return;
  const isClassRecv = (recv: ts.Expression): boolean => {
    if (!ts.isIdentifier(recv)) return false;
    const sym = L.resolveValueSymbol(recv);
    const d = sym ? L.checker.valueDeclarationOf(sym) : undefined;
    return d !== undefined && ts.isClassDeclaration(d);
  };
  for (const w of topLevelProtoWrites(sf, isClassRecv)) {
    if (isDataRhs(w.stmt.right) && !undefinedRhs(w.stmt.right)) L.protoDataNonUndef.add(w.name);
  }
}

/** The names of the top-level prototype-data writes of class `decl`, for the
 * class's field layout: every write that is data (`isMethodRhs` answers the
 * late-method sources, which are methods). */
export function protoDataFieldNames(
  L: Lowerer,
  decl: ts.ClassDeclaration,
  classSymbol: ts.Symbol,
  isMethodRhs: (rhs: ts.Expression) => boolean,
): string[] {
  const out: string[] = [];
  const isThisClass = (recv: ts.Expression): boolean => L.checker.getSymbolAtLocation(recv) === classSymbol;
  for (const w of topLevelProtoWrites(decl.getSourceFile(), isThisClass)) {
    if (!isDataRhs(w.stmt.right) || isMethodRhs(w.stmt.right)) continue;
    if (!out.includes(w.name)) out.push(w.name);
  }
  return out;
}

/** Collection: register the top-level prototype-data writes of class `info`
 * (declared as `decl` with `classSymbol`) and their slots. Runs after the
 * class's fields and methods are collected. `ownUndefinedPossible(name)` is
 * the program-wide answer "some assignment can store undefined under this
 * name" (lower-classes.ts). */
export function registerProtoData(
  L: Lowerer,
  info: ClassInfo,
  decl: ts.ClassDeclaration,
  classSymbol: ts.Symbol,
  ownUndefinedPossible: (name: string) => boolean,
): void {
  const sf = decl.getSourceFile();
  if (!isJsSourceFile(sf)) return;
  // Every top-level write, grouped by name (a name written twice is one slot).
  const writes = new Map<string, ts.BinaryExpression[]>();
  for (const w of topLevelProtoWrites(sf, (recv) => L.checker.getSymbolAtLocation(recv) === classSymbol)) {
    const name = w.name;
    // Methods and function-valued sources are the late-method machinery's.
    if (info.methods.has(name) || info.methods.has(`get:${name}`) || info.methods.has(`set:${name}`)) continue;
    if (!isDataRhs(w.stmt.right) || L.lateMethodAssigns.has(w.stmt)) continue;
    const list = writes.get(name) ?? [];
    list.push(w.stmt);
    writes.set(name, list);
  }
  for (const [name, list] of writes) {
    const fieldT = info.fields.get(name) ?? null;
    const first = list[0]!;
    let type: IrType | null = fieldT;
    if (type === null) {
      const tsType = L.typeOf(first.left);
      try {
        type = L.mapTypeOf(tsType);
      } catch {
        type = null;
      }
      if (!type && isJsSourceFile(sf)) type = dynFallbackType(L, first.left, tsType);
    }
    if (!type || type.kind === "void") {
      L.unsupported("SC1090", first.left, `the prototype member '${name}' of class '${info.def.name}' has no storage type (give the value a type the program can hold)`);
      continue;
    }
    // Exactness. A slot whose every value is undefined is exact against an
    // unset or own-undefined instance field alike: undefined is undefined.
    const undefinedOnly = list.every((w) => undefinedRhs(w.right));
    const ownUndef = ownUndefinedPossible(name);
    let fenceWhy: string | null = null;
    if (!undefinedOnly && ownUndef) {
      fenceWhy = `the program can store an own undefined to '${name}', which would hide the prototype's non-undefined value`;
    }
    if (fenceWhy !== null) {
      const msg = `the prototype member '${name}' of class '${info.def.name}' (${fenceWhy})`;
      L.protoDataFenced.set(`${info.def.name}.${name}`, msg);
      for (const w of list) fencedWrites.set(w, msg);
      continue;
    }
    if (fieldT !== null && fieldT.kind === "dyn") type = DYN;
    // Every write stores a non-undefined value of the field's one value arm:
    // the slot holds that arm alone, and the field's undefined arm is only
    // its unset state.
    if (fieldT !== null && !undefinedOnly) {
      const arm = undefArmedValueType(L, fieldT);
      if (arm !== null && list.every((w) => typeEquals(valueTypeOfRhs(L, w.right, arm), arm))) type = arm;
    }
    const rawTag = L.fileTag.get(sf) ?? "";
    const tag = rawTag === "" ? "e." : rawTag.replace(/^%/, "");
    const g: IrGlobal = {
      id: `%g.${tag}${info.def.name}%.pd.${name}`,
      name: `${info.def.jsName ?? info.def.name}.prototype.${name}`,
      type,
      mutable: true,
    };
    L.globalsList.push(g);
    let slots = L.protoDataSlots.get(info.def.name);
    if (!slots) {
      slots = new Map();
      L.protoDataSlots.set(info.def.name, slots);
    }
    const slot: ProtoDataSlot = { global: g, type, firstWriteStart: first.getStart(), file: sf };
    slots.set(name, slot);
    for (const w of list) {
      if (w.getStart() < slot.firstWriteStart) slot.firstWriteStart = w.getStart();
      L.protoDataAssigns.set(w, slot);
    }
  }
}

/** The nearest prototype-data slot of `name` on the prototype chain from
 * `start` up, or null. A method or accessor of the name on the way up is
 * the class's own answer and returns "fence". */
function slotFrom(L: Lowerer, start: ClassInfo | null, name: string): ProtoDataSlot | "fence" | null {
  for (let c = start; c; c = c.base) {
    if (c.methods.has(name) || c.methods.has(`get:${name}`) || c.methods.has(`set:${name}`)) return "fence";
    const s = L.protoDataSlots.get(c.def.name)?.get(name);
    if (s !== undefined) return s;
  }
  return null;
}

/** True when a SUBCLASS of `info` declares its own instance field or slot of
 * `name`: a static receiver of `info` would hide that storage. */
function subclassDeclares(L: Lowerer, info: ClassInfo, name: string): boolean {
  for (const sub of info.subclasses) {
    const ownField = sub.fieldOrder.some((f) => f.name === name && f.redeclared !== true);
    if (ownField || L.protoDataSlots.get(sub.def.name)?.has(name) === true) return true;
    if (subclassDeclares(L, sub, name)) return true;
  }
  return false;
}

function isInitPosition(node: ts.Node): boolean {
  for (let p: ts.Node | undefined = node.parent; p !== undefined; p = p.parent) {
    if (ts.isFunctionLike(p)) return false;
    if (ts.isSourceFile(p)) break;
  }
  return true;
}

function typesEqualSlot(a: IrType, b: IrType): boolean {
  return a.kind === b.kind && (a.kind !== "union" || (b.kind === "union" && a.unionId === b.unionId));
}

/** Static read `recv.name` of a prototype-data member, or null when the
 * name is not one (the caller continues with the ordinary read). */
export function protoDataMemberRead(L: Lowerer, expr: ts.PropertyAccessExpression): IrExpr | null {
  if (expr.questionDotToken !== undefined || !ts.isIdentifier(expr.name)) return null;
  const name = expr.name.text;
  const loc = locOf(expr);
  // `C.prototype.name`: the prototype's own value, the slot itself.
  if (ts.isPropertyAccessExpression(expr.expression) && expr.expression.name.text === "prototype" &&
      expr.expression.questionDotToken === undefined && ts.isIdentifier(expr.expression.expression)) {
    const csym = L.resolveValueSymbol(expr.expression.expression);
    const cinfo = csym ? L.classBySymbol.get(csym) ?? null : null;
    if (cinfo === null) return null;
    for (let c: ClassInfo | null = cinfo; c; c = c.base) {
      const why = L.protoDataFenced.get(`${c.def.name}.${name}`);
      if (why !== undefined) L.unsupported("SC1090", expr, why);
    }
    const pslot = slotFrom(L, cinfo, name);
    if (pslot === null || pslot === "fence") return null;
    if (pslot.file === expr.getSourceFile() && isInitPosition(expr) && expr.getStart() < pslot.firstWriteStart) {
      L.unsupported("SC1090", expr, `reading the prototype member '${name}' above its first assignment (JS answers undefined there, which the slot's type may not hold — move the read below the assignment)`);
    }
    const ref: IrExpr = { kind: "varRef", localId: pslot.global.id, type: pslot.type, loc };
    const checked = L.mapTypeOf(L.typeOf(expr));
    if (checked !== null && checked.kind === "union" && ref.type.kind !== "union") {
      const wrapped = asUnionArm(L, ref, checked, loc);
      if (wrapped !== null) return wrapped;
    }
    return ref;
  }
  // A dynamic receiver answers from the box, which holds the instance field
  // (undefined when unset), never the prototype's value.
  const recvTs = L.checker.getBaseTypeOfLiteralType(L.typeOf(expr.expression));
  const untypedRecv = (recvTs.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) !== 0;
  if (untypedRecv && L.protoDataNonUndef.has(name)) {
    L.unsupported("SC1090", expr, `reading the prototype member '${name}' through an untyped value (the box answers the instance field, not the prototype's value; give the receiver a class type)`);
  }
  const recvT = L.mapTypeOf(L.typeOf(expr.expression));
  if (recvT?.kind !== "object") return null;
  const start = L.classes.get(recvT.className) ?? null;
  if (start === null) return null;
  for (let c: ClassInfo | null = start; c; c = c.base) {
    const why = L.protoDataFenced.get(`${c.def.name}.${name}`);
    if (why !== undefined) L.unsupported("SC1090", expr, why);
  }
  const slot = slotFrom(L, start, name);
  if (slot === null || slot === "fence") return null;
  if (subclassDeclares(L, start, name)) {
    L.unsupported("SC1090", expr, `reading the prototype member '${name}' through a class whose subclass declares its own '${name}' (the static receiver type hides that storage)`);
  }
  if (!pureReceiver(expr.expression)) {
    L.unsupported("SC1090", expr, `reading the prototype member '${name}' off a receiver that is not a plain name or 'this' (bind the instance to a const first)`);
  }
  if (slot.file === expr.getSourceFile() && isInitPosition(expr) && expr.getStart() < slot.firstWriteStart) {
    L.unsupported("SC1090", expr, `reading the prototype member '${name}' above its first assignment (JS answers undefined there, which the slot's type may not hold — move the read below the assignment)`);
  }
  const slotRef: IrExpr = { kind: "varRef", localId: slot.global.id, type: slot.type, loc };
  // The own-field case: the instance field answers when it is set.
  const own = start.fields.has(name) ? start.fields.get(name)! : null;
  if (own === null) return slotRef;
  const target = L.fieldTarget(expr);
  if (!target) return null;
  const fieldRead = L.fieldGetExpr(target, loc, expr);
  if (own.kind === "dyn") {
    // Checked-dynamic field: the unset state is the undefined value.
    if (slot.type.kind !== "dyn") {
      L.unsupported("SC1090", expr, `reading the prototype member '${name}' whose slot type is not checked-dynamic like its instance field`);
    }
    const isSet: IrExpr = { kind: "dynTest", test: "undefined", negated: true, value: fieldRead, type: BOOL, loc };
    return { kind: "ternary", cond: isSet, then: fieldRead, else_: slotRef, type: own, loc };
  }
  const tag = undefTagOf(L, own);
  if (tag < 0) {
    // The field always holds a value (a constructor-set field): the prototype is never seen.
    return null;
  }
  if (own.kind !== "union") return null;
  const ownUid = own.unionId;
  const isSet: IrExpr = { kind: "unionIsTag", unionId: ownUid, tag, negated: true, value: fieldRead, type: BOOL, loc };
  // The read keeps the instance field's union type (the checker's type for
  // the member); the slot's value arm is wrapped into it when the slot holds
  // the arm alone.
  const elseArm = asUnionArm(L, slotRef, own, loc);
  if (elseArm === null) {
    L.unsupported("SC1090", expr, `reading the prototype member '${name}' whose slot type differs from the instance field's`);
  }
  return { kind: "ternary", cond: isSet, then: fieldRead, else_: elseArm, type: own, loc };
}

/** `recv` (an instance of a class with prototype data `key` on its chain) has
 * the name inherited. False when there is no such slot (or the receiver is
 * not a plain name or `this`, whose evaluation the answer would drop). */
export function protoDataHasKey(L: Lowerer, recv: ts.Expression, key: string): boolean {
  const recvT = L.mapTypeOf(L.typeOf(recv));
  if (recvT?.kind !== "object" || !pureReceiver(recv)) return false;
  const start = L.classes.get(recvT.className) ?? null;
  if (start === null) return false;
  const slot = slotFrom(L, start, key);
  return slot !== null && slot !== "fence";
}

/** The lowered statement for a registered prototype-data write, or null. */
export function protoDataAssignStmt(L: Lowerer, expr: ts.BinaryExpression): IrStmt | null {
  const fenced = fencedWrites.get(expr);
  if (fenced !== undefined) L.unsupported("SC1090", expr, fenced);
  const slot = L.protoDataAssigns.get(expr);
  if (!slot) return null;
  const value = L.lowerExprExpecting(expr.right, slot.type);
  return { kind: "assign", localId: slot.global.id, value, loc: locOf(expr) };
}
