/* RUN-TIME COMPUTED PROTOTYPE MEMBERS: `C.prototype[k] = v` with a run-time key (ioredis Commander: a forEach over the
 * constant @ioredis/commands list writes `Commander.prototype[commandName] = generateFunction(...)`).
 *
 * Node semantics: the write creates (or replaces) an own, enumerable data property of C's prototype object. Every
 * instance of C and of a subclass reaches it through the chain: `inst[k]` / `inst.name` answer it unless the instance
 * has an own property of that name or a class below C declares one. A name C itself declares as a method is REPLACED
 * (the sq7 slot).
 *
 * Mechanism: ONE module global per written class (the "prototype table", a run-time property table as an instance's
 * `%props` is). A write stores the value under the key there. A key naming a method C declares is first
 * compared (the names are a compile-time set) and stored in that method's replacement slot (lower-protoslots.ts), the
 * exact `C.prototype.m = f` semantic. A read of a name the receiver's class chain never declares ends its chain at the
 * table (lowerSubclassFieldRead / the keyed read): own property table first, then the prototype table.
 *
 * Exactness gates (a loud, named SC1090 at the write, never a silent answer): the class is a JS class; no ancestor
 * declared in the program, and no runtime base, carries members the table would have to order against; the class
 * declares no accessor; every method it declares can take a replacement slot; no other class of its family also
 * writes computed prototype members. */
import * as ts from "../ts7/adapter.js";
import { ENTRY_NAME, PoisonError, dynUndefinedExpr, type Lowerer } from "./lowerer.js";
import type { ClassInfo } from "./lower-classes.js";
import { isJsSourceFile, locOf } from "../program.js";
import { protoRecvClass, registerProtoSlot, protoSlotOf, protoSlotSlottable } from "./lower-protoslots.js";
import { BOOL, DYN, STRING, VOID, type IrExpr, type IrFunction, type IrGlobal, type IrStmt } from "../../ir/nodes.js";

/** `X.prototype[k] = rhs` -> { recv: X, key }, else null. */
export function protoKeyedWriteShape(e: ts.Node): { recv: ts.Expression; key: ts.Expression } | null {
  if (!ts.isBinaryExpression(e) || e.operatorToken.kind !== ts.SyntaxKind.EqualsToken) return null;
  const l = e.left;
  if (!ts.isElementAccessExpression(l) || l.questionDotToken !== undefined) return null;
  let p: ts.Expression = l.expression;
  while (ts.isParenthesizedExpression(p) || ts.isAsExpression(p) || ts.isNonNullExpression(p)) p = p.expression;
  if (!ts.isPropertyAccessExpression(p) || p.name.text !== "prototype") return null;
  return { recv: p.expression, key: l.argumentExpression };
}

/** The table global of class `cls`, or null when no statement of the program writes computed members of it. */
export function protoTabOf(L: Lowerer, cls: string): IrGlobal | null {
  return L.protoTabs.get(cls) ?? null;
}

/** The tables of `info`'s class chain, nearest first. */
export function protoTabChain(L: Lowerer, info: ClassInfo): IrGlobal[] {
  if (L.protoTabs.size === 0) return [];
  const out: IrGlobal[] = [];
  for (let c: ClassInfo | null | undefined = info; c; c = c.base) {
    const g = L.protoTabs.get(c.def.name);
    if (g !== undefined) out.push(g);
  }
  return out;
}

/** True when `info` or a class of its chain owns a table. */
export function hasProtoTab(L: Lowerer, info: ClassInfo): boolean {
  return L.protoTabs.size > 0 && protoTabChain(L, info).length > 0;
}

/** Program-wide pre-scan (before any body lowers): every statement `X.prototype[k] = ...` whose X is a class registers the
 * class's table and the replacement slots of every method it declares. Iterative walk (the 7000-level guard runs after this). */
/** The declared method names of `info` itself (typed and generic), accessors excluded. */
function ownMethodNames(info: ClassInfo): string[] {
  const out: string[] = [];
  for (const m of [...info.methods.keys(), ...(info.genericMethods?.keys() ?? [])]) {
    if (!m.startsWith("get:") && !m.startsWith("set:") && !out.includes(m)) out.push(m);
  }
  return out;
}

export function scanProtoTabs(L: Lowerer, files: readonly ts.SourceFile[]): void {
  for (const sf of files) {
    if (sf.isDeclarationFile || !sf.text.includes("prototype")) continue;
    const stack: ts.Node[] = [sf];
    while (stack.length > 0) {
      const n = stack.pop()!;
      const w = protoKeyedWriteShape(n);
      if (w !== null && ts.isIdentifier(w.recv)) {
        let info: ClassInfo | null = null;
        try {
          info = protoRecvClass(L, w.recv);
        } catch (e) {
          if (!(e instanceof PoisonError)) throw e;
        }
        if (info !== null && info.evalClass === undefined && !L.protoTabs.has(info.def.name)) {
          const g: IrGlobal = { id: `%g.%ptab.${info.def.name}`, name: `${info.def.jsName ?? info.def.name}.prototype`, type: DYN, mutable: true };
          L.globalsList.push(g);
          L.protoTabs.set(info.def.name, g);
          for (const m of ownMethodNames(info)) registerProtoSlot(L, info.def.name, info, m);
        }
      }
      n.forEachChild((c) => {
        stack.push(c);
      });
    }
  }
}

/** The reason `info`'s computed prototype writes cannot be exact, or null. */
function tabWhy(L: Lowerer, info: ClassInfo): string | null {
  if (!isJsSourceFile(info.decl?.getSourceFile() ?? ({} as ts.SourceFile))) return "the class is not a JavaScript class";
  if (info.evalClass !== undefined) return "the class is created by an evaluation";
  for (let c: ClassInfo | null | undefined = info.base; c; c = c.base) {
    if (c.builtinEmitter === true || c.builtinError || c.builtinStream !== undefined || c.def.runtime === true) {
      return `the class extends the runtime base '${c.def.name}', whose members the table cannot be ordered against`;
    }
    for (const m of [...c.methods.keys(), ...(c.genericMethods?.keys() ?? [])]) return `its ancestor '${c.def.jsName ?? c.def.name}' declares the member '${m}' (a prototype write on the subclass would shadow it, which the slot cannot express)`;
  }
  for (const m of [...info.methods.keys(), ...(info.genericMethods?.keys() ?? [])]) {
    if (m.startsWith("get:") || m.startsWith("set:")) return `the class declares the accessor '${m.slice(4)}'`;
  }
  const stack: ClassInfo[] = [...info.subclasses];
  while (stack.length > 0) {
    const s = stack.pop()!;
    if (L.protoTabs.has(s.def.name)) return `its subclass '${s.def.jsName ?? s.def.name}' also writes computed prototype members`;
    stack.push(...s.subclasses);
  }
  for (const m of ownMethodNames(info)) {
    if (protoSlotOf(L, info.def.name, m) === null || !protoSlotSlottable(info, m)) {
      return `the class declares the method '${m}', which cannot take a replacement slot (abstract, async or generator)`;
    }
  }
  return null;
}

/** A run-time property key as a string: a string as is, a number through the JS-exact formatter, anything else boxed and ToString'd
 * (a symbol key would throw where Node stores a symbol-keyed property: that boundary is the checked-dynamic tier's standing one).
 * Null when the value cannot be boxed. */
export function keyAsString(L: Lowerer, key: IrExpr, node: ts.Node): IrExpr | null {
  if (key.type.kind === "string") return key;
  if (key.type.kind === "f64") return L.ensureString(key, node);
  const loc = key.loc;
  const d = key.type.kind === "dyn" ? key : L.coerceToExpected(key, DYN);
  if (d.type.kind !== "dyn") return null;
  return { kind: "toString", operand: d, type: STRING, loc };
}

/** `X.prototype[k] = v` in statement position for a table class: the table store, with the replacement slot of a method name
 * taking its own write. Null when the statement is not this shape. */
export function protoTabWriteStmt(L: Lowerer, expr: ts.Expression): IrStmt | null {
  if (L.protoTabs.size === 0) return null;
  const w = protoKeyedWriteShape(expr);
  if (w === null || !ts.isIdentifier(w.recv)) return null;
  const info = protoRecvClass(L, w.recv);
  if (info === null) return null;
  const g = protoTabOf(L, info.def.name);
  if (g === null) return null;
  const e = expr as ts.BinaryExpression;
  const why = tabWhy(L, info);
  if (why !== null) L.unsupported("SC1090", e, `writing computed members of '${info.def.jsName ?? info.def.name}.prototype' at run time: ${why}`);
  const loc = locOf(expr);
  const key = keyAsString(L, L.lowerExpr(w.key), w.key);
  if (key === null) L.unsupported("SC1090", w.key, "a computed prototype key that is not a string, a number or a value the checked-dynamic tree holds");
  void key;
  const value = L.lowerExprExpecting(e.right, DYN);
  if (value.type.kind !== "dyn") {
    L.unsupported("SC1101", e.right, `storing '${L.fmt(value.type)}' values in a prototype table (the value cannot convert into the checked-dynamic tree)`);
  }
  const kTmp = L.declareHiddenLocal("%ptabKey", STRING);
  const vTmp = L.declareHiddenLocal("%ptabVal", DYN);
  const kRef = (): IrExpr => ({ kind: "varRef", localId: kTmp.id, type: STRING, loc });
  const vRef = (): IrExpr => ({ kind: "varRef", localId: vTmp.id, type: DYN, loc });
  const gRef = (): IrExpr => ({ kind: "varRef", localId: g.id, type: DYN, loc });
  let tail: IrStmt[] = [
    { kind: "exprStmt", expr: { kind: "libCall", fn: "cls.propsSet", args: [gRef(), kRef(), vRef()], type: VOID, loc }, loc },
  ];
  const names = ownMethodNames(info);
  for (let i = names.length - 1; i >= 0; i--) {
    const m = names[i]!;
    const slot = protoSlotOf(L, info.def.name, m)!;
    tail = [
      {
        kind: "if",
        cond: { kind: "strEq", negated: false, left: kRef(), right: { kind: "strLit", value: m, type: STRING, loc }, type: BOOL, loc },
        then: [{ kind: "assign", localId: slot.id, value: vRef(), loc }],
        else_: tail,
        loc,
      },
    ];
  }
  return {
    kind: "block",
    body: [
      { kind: "varDecl", localId: kTmp.id, init: key!, loc },
      { kind: "varDecl", localId: vTmp.id, init: value, loc },
      ...tail,
    ],
    loc,
  };
}

/** Initializes every table global to an empty run-time property table at the start of %main. */
export function applyProtoTabs(L: Lowerer, fnLists: IrFunction[][]): void {
  if (L.protoTabs.size === 0) return;
  const main = fnLists.flatMap((l) => l).find((f) => f.name === ENTRY_NAME);
  if (main === undefined) return;
  const mloc = main.loc;
  const inits: IrStmt[] = [];
  for (const g of L.protoTabs.values()) {
    inits.push({
      kind: "assign",
      localId: g.id,
      value: { kind: "libCall", fn: "cls.propsEnsure", args: [dynUndefinedExpr(mloc)], type: DYN, loc: mloc },
      loc: mloc,
    });
  }
  main.body.unshift(...inits);
}

/** The end of an undeclared-name read chain: `has(own table, k) ? read : has(proto table, k) ? read : undefined`. `bag` is
 * the instance's own run-time property table (a pure read, evaluated more than once) or null; `key` must be pure too. */
export function protoTabReadChain(L: Lowerer, info: ClassInfo, key: IrExpr, bag: IrExpr | null, loc: IrExpr["loc"]): IrExpr {
  const has = (t: IrExpr): IrExpr => ({ kind: "libCall", fn: "cls.propsHas", args: [t, key], type: BOOL, loc });
  const read = (t: IrExpr): IrExpr => ({ kind: "libCall", fn: "cls.propsRead", args: [t, key], type: DYN, loc });
  let chain: IrExpr = dynUndefinedExpr(loc);
  const tabs = protoTabChain(L, info);
  for (let i = tabs.length - 1; i >= 0; i--) {
    const t = (): IrExpr => ({ kind: "varRef", localId: tabs[i]!.id, type: DYN, loc });
    chain = { kind: "ternary", cond: has(t()), then: read(t()), else_: chain, type: DYN, loc };
  }
  return bag === null ? chain : { kind: "ternary", cond: has(bag), then: read(bag), else_: chain, type: DYN, loc };
}

/** `answer || key in <prototype tables of the class chain>` (the `in` operator over an instance whose class chain has run-time
 * prototype members); `answer` itself when there are none. `key` must be a pure expression. */
export function protoTabHasOr(L: Lowerer, info: ClassInfo, key: IrExpr, answer: IrExpr | null, loc: IrExpr["loc"]): IrExpr | null {
  let out: IrExpr | null = answer;
  for (const g of protoTabChain(L, info)) {
    const has: IrExpr = { kind: "libCall", fn: "cls.propsHas", args: [{ kind: "varRef", localId: g.id, type: DYN, loc }, key], type: BOOL, loc };
    out = out === null ? has : { kind: "logical", op: "||", left: out, right: has, type: BOOL, loc };
  }
  return out;
}
