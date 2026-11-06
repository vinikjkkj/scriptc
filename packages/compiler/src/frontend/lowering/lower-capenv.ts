/* Class EVALUATIONS of lifted local classes that capture locals.
 *
 * A class declared inside a function is minted afresh by every evaluation of
 * its scope. The lowerer lifts it to one module-level class whose instances
 * carry COPIES of the captured bindings (hidden `%capN.x` fields). That is
 * exact for everything an instance does itself, but a METHOD VALUE read off an
 * instance (`const { m } = inst`, `inst.m`) is the function of ONE evaluation:
 * `m.call(otherInstance)` runs with the captures of the evaluation `m` came
 * from, `a1.m === a2.m` holds within an evaluation and `a.m === b.m` fails
 * across two.
 *
 * So a capturing lifted class mints one EVALUATION OBJECT per evaluation of
 * its declaration (`%C.%env`, fields = the captured bindings), every instance
 * points at it (`%env`), and a method value is a closure over it, memoized in
 * the evaluation object (lazily added `%mv.<m>` slots). The copies stay: a
 * direct method call reads `this.%capN` exactly as before, so the hot path is
 * byte-identical; only values that escape as functions go through the
 * evaluation.
 */
import * as ts from "../ts7/adapter.js";
import type { Lowerer } from "./lowerer.js";
import type { ClassInfo } from "./lower-classes.js";
import type { IrExpr, IrParam, IrStmt, IrType } from "../../ir/nodes.js";
import { BOOL, DYN, funcOf } from "../../ir/nodes.js";
import { attachedEnvMethod, detachedMethodVariant } from "./lower-classes.js";
import { unboundMethodThunk } from "./lower-exprs.js";
import { detachedDeclinable, implicitEnvInstance, type GenericFnInfo } from "./lower-calls.js";
import { locOf } from "../program.js";

export interface LiftEnvPlan {
  /** The evaluation object's class. */
  envName: string;
  /** The instance class (the capturing lifted class). */
  clsName: string;
  /** Sentinel binding the evaluation object's local is registered under (the class statement's scope). */
  envSym: ts.Symbol;
  /** Sentinel binding the evaluation object is registered under inside an evaluation-carrying method body (its trailing parameter). */
  paramSym: ts.Symbol;
  /** The captured bindings (symbol, field on both the evaluation object and the instance copies, type). */
  caps: { sym: ts.Symbol; field: string; type: IrType }[];
  /** True when every captured binding is initialized before the class statement: the evaluation object is minted there. */
  atStatement: boolean;
  /** The hidden INSTANCE field pointing at the evaluation object. */
  instField: string;
  /** A per-evaluation class (a class expression): its evaluation object is the class value itself. */
  evalClass?: true;
  /** The STATIC side of a per-evaluation class: the evaluation object is the receiver of the read (`K.sm`), not a field of it. */
  selfEnv?: true;
  /** Prefix of the memo slots on the evaluation object (instance and static methods of one name keep distinct slots). */
  slotPrefix: string;
}

/** The hidden instance field holding the evaluation object. */
export const LIFT_ENV_FIELD = "%env";

const planBySym = new WeakMap<object, LiftEnvPlan>();

export function liftEnvPlanOfSym(sym: ts.Symbol): LiftEnvPlan | undefined {
  return planBySym.get(sym as unknown as object);
}

/** The plan for a lifted capturing class, before its ClassInfo exists (collection adds the instance field). */
export function newLiftEnvPlan(L: Lowerer, decl: ts.ClassDeclaration, className: string,
  caps: { sym: ts.Symbol; field: string; type: IrType }[]): LiftEnvPlan {
  const envName = `${className}.%env`;
  const envSym = { name: `%liftEnv.${className}`, escapedName: `%liftEnv.${className}` } as unknown as ts.Symbol;
  // The class statement is the evaluation point: every capture must be initialized by then, or minting there would read
  // a binding still in its temporal dead zone.
  let atStatement = true;
  for (const c of caps) {
    for (const d of L.checker.declarationsOf(c.sym)) {
      if (d.getSourceFile() === decl.getSourceFile() && d.end > decl.pos) atStatement = false;
    }
  }
  const paramSym = { name: `%liftEnvParam.${className}`, escapedName: `%liftEnvParam.${className}` } as unknown as ts.Symbol;
  const plan: LiftEnvPlan = { envName, clsName: className, envSym, paramSym, caps, atStatement, instField: LIFT_ENV_FIELD, slotPrefix: "%mv." };
  planBySym.set(envSym as unknown as object, plan);
  return plan;
}

/** The plan of a per-evaluation class (lower-evalclass.ts): the evaluation object IS its static side, the instance's `%cls`. */
export function evalLiftPlan(className: string, staticName: string,
  caps: { sym: ts.Symbol; field: string; type: IrType }[]): LiftEnvPlan {
  const sym = (n: string): ts.Symbol => ({ name: n, escapedName: n }) as unknown as ts.Symbol;
  return {
    envName: staticName, clsName: className, envSym: sym(`%evalEnv.${className}`), paramSym: sym(`%evalEnvParam.${className}`),
    caps, atStatement: false, instField: "%cls", evalClass: true, slotPrefix: "%mv.",
  };
}

/** The plan of the STATIC side of a per-evaluation class: its methods are the methods of the evaluation object, whose `this` is
 * the evaluation (the receiver of a `K.sm` read). */
export function evalStaticLiftPlan(inst: LiftEnvPlan, staticName: string): LiftEnvPlan {
  return { ...inst, clsName: staticName, selfEnv: true, slotPrefix: "%mvs." };
}

/** Registers the evaluation object's class beside the instance class. */
export function registerLiftEnvClass(L: Lowerer, info: ClassInfo, plan: LiftEnvPlan): void {
  const loc = locOf(info.decl!);
  const fields = new Map<string, IrType>();
  for (const c of plan.caps) fields.set(c.field, c.type);
  const envInfo: ClassInfo = {
    def: {
      name: plan.envName,
      jsName: "",
      fields: plan.caps.map((c) => ({ name: c.field, type: c.type })),
      loc,
    },
    fields,
    fieldOrder: plan.caps.map((c) => ({ name: c.field, type: c.type, initializer: undefined })),
    methods: new Map(),
    decl: info.decl,
    ctor: null,
    ctorParams: [],
    base: null,
    subclasses: [],
    throwingSetters: [],
    staticFields: [],
    captures: plan.caps.map((c) => ({ sym: c.sym, field: c.field, type: c.type })),
  };
  info.liftEnv = plan;
  L.classes.set(plan.envName, envInfo);
  L.exprClasses.push(envInfo);
  L.onExprClassCollected?.(envInfo);
}

function envType(plan: LiftEnvPlan): IrType {
  return { kind: "object", className: plan.envName };
}

/** `new %C.%env(captured values...)` at `at`, reading each captured binding where it is in scope. */
function buildEnv(L: Lowerer, plan: LiftEnvPlan, at: ts.Node): IrExpr {
  const loc = locOf(at);
  L.noteEdge(`%${plan.envName}.constructor`);
  const args = plan.caps.map((c) => L.lowerCapturedValue(c.sym, c.type, at));
  return { kind: "new", className: plan.envName, args, type: envType(plan), loc };
}

/** The class STATEMENT of a lifted capturing class: mints this evaluation's object into a hidden local registered under the
 * plan's sentinel, so `new C()` sites (also inside closures declared after it) pass the same object. A class whose captured
 * bindings are initialized only AFTER its statement declares the local empty; the first `new C()` of the evaluation fills it. */
export function mintLiftEnv(L: Lowerer, stmt: ts.ClassDeclaration, plan: LiftEnvPlan): IrStmt[] {
  const loc = locOf(stmt);
  const local = L.declareHiddenLocal(`env.${plan.clsName}`, envType(plan));
  L.ctx.scopes[L.ctx.scopes.length - 1]!.set(plan.envSym, local);
  if (!plan.atStatement) {
    local.mutable = true;
    return [{ kind: "varDecl", localId: local.id, init: null, loc }];
  }
  return [{ kind: "varDecl", localId: local.id, init: buildEnv(L, plan, stmt), loc }];
}

/** The evaluation object at a `new C()` site (or any read of the plan's sentinel). Inside an evaluation-carrying method body it
 * is that body's parameter; inside any other member of the class it is the instance's; elsewhere the local the class statement
 * minted; a site the statement does not reach builds its own. */
export function liftEnvRead(L: Lowerer, plan: LiftEnvPlan, at: ts.Node): IrExpr {
  const loc = locOf(at);
  const param = L.resolveKey(plan.paramSym, undefined, at);
  if (param) return { kind: "varRef", localId: param.id, type: param.type, loc };
  const cur = L.currentClass;
  if (cur !== null && cur !== undefined && cur.liftEnv === plan && cur.evalStaticOf === undefined) {
    const th = L.resolveThis(at);
    if (th && th.type.kind === "object" && th.type.className === cur.def.name) {
      return { kind: "fieldGet", obj: { kind: "varRef", localId: th.id, type: th.type, loc }, className: cur.def.name, field: plan.instField, type: envType(plan), loc };
    }
  }
  const local = L.resolveKey(plan.envSym, undefined, at);
  if (local) {
    const ref: IrExpr = { kind: "varRef", localId: local.id, type: local.type, loc };
    if (plan.atStatement) return ref;
    // Minted lazily: the first construction of this evaluation reads the bindings (initialized by now) into the object.
    return {
      kind: "ternary",
      cond: { kind: "varRef", localId: local.id, type: BOOL, nullTest: true, loc },
      then: { kind: "seqExpr", stmts: [{ kind: "assign", localId: local.id, value: buildEnv(L, plan, at), loc }], result: ref, type: local.type, loc },
      else_: ref,
      type: local.type,
      loc,
    };
  }
  return buildEnv(L, plan, at);
}

/** Registers the evaluation object as the trailing parameter of the method body being lowered (lowerMethodBodyInner, envMode). */
export function declareLiftEnvParam(L: Lowerer, info: ClassInfo): IrParam {
  const plan = info.liftEnv!;
  const local = L.declareHiddenLocal("env", envType(plan));
  L.ctx.scopes[L.ctx.scopes.length - 1]!.set(plan.paramSym, local);
  return { localId: local.id, name: "env", type: local.type };
}

/** A captured binding read inside an evaluation-carrying body: the parameter's field. Null elsewhere. */
export function liftEnvFieldRead(L: Lowerer, info: ClassInfo, c: { field: string; type: IrType }, at: ts.Node): IrExpr | null {
  const plan = info.liftEnv;
  if (plan === undefined) return null;
  const param = L.resolveKey(plan.paramSym, undefined, at);
  if (!param) return null;
  const loc = locOf(at);
  return { kind: "fieldGet", obj: { kind: "varRef", localId: param.id, type: param.type, loc }, className: plan.envName, field: c.field, type: c.type, loc };
}

/** The statement of a lifted local class: nothing to run unless the class captures (then it mints its evaluation). */
export function mintLocalClassEnv(L: Lowerer, stmt: ts.ClassDeclaration): IrStmt[] {
  const info = L.classes.get(L.classNamer(stmt));
  return info?.liftEnv === undefined ? [] : mintLiftEnv(L, stmt, info.liftEnv);
}

function addMemoSlot(L: Lowerer, plan: LiftEnvPlan, slot: string, fnT: IrType): void {
  const envInfo = L.classes.get(plan.envName)!;
  if (envInfo.fields.has(slot)) return;
  envInfo.fields.set(slot, fnT);
  envInfo.fieldOrder.push({ name: slot, type: fnT, initializer: undefined });
  envInfo.def.fields.push({ name: slot, type: fnT });
}

const memoInProgress = new Set<string>();

/** The functions this module has pushed onto a lowerer's lifted list, by name (a list scan per request would be quadratic). */
const builtBy = new WeakMap<Lowerer, Set<string>>();
function built(L: Lowerer, name: string): boolean {
  return builtBy.get(L)?.has(name) === true;
}
function noteBuilt(L: Lowerer, name: string): void {
  let s = builtBy.get(L);
  if (s === undefined) builtBy.set(L, (s = new Set()));
  s.add(name);
}

/** What an evaluation-carrying closure runs: a compiled body taking the receiver first, then the arguments, then the evaluation. */
interface CapBody {
  callee: string;
  /** The receiver goes in raw (the body checks it where it touches `this`); else it is checked up front. */
  detached: boolean;
  paramTypes: IrType[];
  ret: IrType;
}

/** `%mv.C.m(env)`: the METHOD VALUE of `m` for the evaluation `env` -- a closure over the evaluation, memoized in the
 * evaluation's `%mv.m` slot, so every instance of one evaluation reads the same function and two evaluations never share one.
 * Calling it runs the body against the evaluation's captures and the call's receiver (`.call(other)` keeps its receiver, a
 * detached call keeps Node's: the TypeError comes where the body touches `this`). */
function capClosureFn(L: Lowerer, info: ClassInfo, mName: string, body: CapBody,
  loc: import("../../ir/nodes.js").SrcLoc): { name: string; fnT: IrType } {
  const plan = info.liftEnv!;
  L.capEnvRequested.add(info.def.name);
  const name = `%mv.${info.def.name}.${mName}`;
  const fnT = funcOf(body.paramTypes, body.ret);
  if (built(L, name)) return { name, fnT };
  noteBuilt(L, name);
  const slot = `${plan.slotPrefix}${mName}`;
  addMemoSlot(L, plan, slot, fnT);
  const envT = envType(plan);
  const irParams: IrParam[] = body.paramTypes.map((t, i) => ({ localId: `p.${i}`, name: `p${i}`, type: t }));
  const args: IrExpr[] = irParams.map((p) => ({ kind: "varRef" as const, localId: p.localId, type: p.type, loc }));
  const envRef: IrExpr = { kind: "varRef", localId: "env.0", type: envT, loc };
  const selfT: IrType = { kind: "object", className: info.def.name };
  const rawThis: IrExpr = { kind: "libCall", fn: "dyn.this", args: [], type: DYN, loc };
  const call: IrExpr = {
    kind: "call",
    callee: body.callee,
    args: [body.detached ? rawThis : { kind: "varRef", localId: "self.0", type: selfT, loc }, ...args, envRef],
    type: body.ret,
    loc,
  };
  const implName = `%mvi.${info.def.name}.${mName}`;
  const implBody: IrStmt[] = [];
  if (!body.detached) {
    implBody.push({ kind: "varDecl", localId: "self.0", init: { kind: "dynCheck", value: rawThis, type: selfT, loc }, loc });
  }
  implBody.push(body.ret.kind === "void" ? { kind: "exprStmt", expr: call, loc } : { kind: "return", value: call, loc });
  L.liftedFns.push({
    name: implName,
    jsName: mName,
    valueCode: 4,
    params: irParams,
    returnType: body.ret,
    captures: [{ localId: "env.0", name: "env", type: envT }],
    locals: [
      { id: "env.0", name: "env", type: envT, mutable: false, boxed: true },
      ...(body.detached ? [] : [{ id: "self.0", name: "self", type: selfT, mutable: false }]),
      ...irParams.map((p) => ({ id: p.localId, name: p.name, type: p.type, mutable: false })),
    ],
    body: implBody,
    loc,
  });
  const slotGet = (nullTest: boolean): IrExpr => ({
    kind: "fieldGet", obj: envRef, className: plan.envName, field: slot,
    type: nullTest ? BOOL : fnT, ...(nullTest ? { nullTest: true as const } : {}), loc,
  });
  L.liftedFns.push({
    name,
    jsName: mName,
    params: [{ localId: "env.0", name: "env", type: envT }],
    returnType: fnT,
    locals: [{ id: "env.0", name: "env", type: envT, mutable: false, boxed: true }],
    body: [
      {
        kind: "if",
        cond: slotGet(true),
        then: [{ kind: "fieldSet", obj: envRef, className: plan.envName, field: slot, value: { kind: "closure", fnName: implName, captures: ["env.0"], type: fnT, loc }, loc }],
        else_: null,
        loc,
      },
      { kind: "return", value: slotGet(false), loc },
    ],
    loc,
  });
  return { name, fnT };
}

/** The memoized evaluation closure of a TYPED method of a capturing lifted class. Null when no evaluation-carrying body exists. */
export function capMethodValueFn(L: Lowerer, info: ClassInfo, mName: string,
  sig: { params: { type: IrType }[]; ret: IrType }, loc: import("../../ir/nodes.js").SrcLoc): { name: string; fnT: IrType } | null {
  if (info.liftEnv === undefined) return null;
  const name = `%mv.${info.def.name}.${mName}`;
  const paramTypes = sig.params.map((p) => p.type);
  if (built(L, name) || memoInProgress.has(name)) return { name, fnT: funcOf(paramTypes, sig.ret) };
  memoInProgress.add(name);
  try {
    // The body this closure runs: the detached variant (the receiver is checked where the body touches `this`) when the method
    // allows one, else the attached body behind an up-front receiver check.
    const detachedName = detachedMethodVariant(L, info, mName, true);
    const attachedName = detachedName === null ? attachedEnvMethod(L, info, mName) : null;
    if (detachedName === null && attachedName === null) return null;
    return capClosureFn(L, info, mName, { callee: (detachedName ?? attachedName)!, detached: detachedName !== null, paramTypes, ret: sig.ret }, loc);
  } finally {
    memoInProgress.delete(name);
  }
}

/** The memoized evaluation closure of an IMPLICIT-ANY (monomorphized) method of a capturing lifted class: the detached
 * evaluation-carrying instance when the body allows one, else the default one behind an up-front receiver check. */
export function capGenericValueFn(L: Lowerer, blame: ts.Node, info: ClassInfo, g: GenericFnInfo, mName: string,
  loc: import("../../ir/nodes.js").SrcLoc): { name: string; fnT: IrType } | null {
  if (info.liftEnv === undefined || g.implicitParams === undefined) return null;
  const detach = detachedDeclinable(g.decl);
  const inst = implicitEnvInstance(L, blame, g, detach);
  // A body that reads its own method as a value asks while its instance is still lowering: the closure type it takes is the pin.
  if (inst.implicitState === "lowering" && inst.implicitInferReturn === true) inst.returnPinned = true;
  return capClosureFn(L, info, mName, { callee: inst.name, detached: detach, paramTypes: inst.params.map((p) => p.type), ret: inst.returnType }, loc);
}

/** The value of `recv.m` for an instance `recv` of the capturing lifted class `info`: the memoized closure of the evaluation
 * `recv` points at. */
export function capMethodValue(L: Lowerer, info: ClassInfo, mName: string,
  sig: { params: { type: IrType }[]; ret: IrType }, recv: IrExpr, loc: import("../../ir/nodes.js").SrcLoc): IrExpr | null {
  const fn = capMethodValueFn(L, info, mName, sig, loc);
  if (fn === null) return null;
  return { kind: "call", callee: fn.name, args: [envOfReceiver(info.liftEnv!, info, recv, loc)], type: fn.fnT, loc };
}

/** The evaluation object a receiver `recv` of class `info` points at: its `%env`/`%cls` field, or the receiver itself on the static
 * side of a per-evaluation class. */
function envOfReceiver(plan: LiftEnvPlan, info: ClassInfo, recv: IrExpr, loc: import("../../ir/nodes.js").SrcLoc): IrExpr {
  if (plan.selfEnv === true) return recv;
  return { kind: "fieldGet", obj: recv, className: info.def.name, field: plan.instField, type: envType(plan), loc };
}

/** `K.prototype.m` of a per-evaluation class: the method of the evaluation `K` itself. */
export function capMethodValueOfEnv(L: Lowerer, info: ClassInfo, mName: string,
  sig: { params: { type: IrType }[]; ret: IrType }, env: IrExpr, loc: import("../../ir/nodes.js").SrcLoc): IrExpr | null {
  const fn = capMethodValueFn(L, info, mName, sig, loc);
  return fn === null ? null : { kind: "call", callee: fn.name, args: [env], type: fn.fnT, loc };
}

/** The method row's VALUE function for a dyn-boxed instance (`const { m } = anyTypedInstance`): `%mvdyn.C.m()` reads the
 * receiver the runtime parks as the ambient `this` for the read and answers the dyn box of that instance's memoized closure.
 * A class that captures nothing keeps its interned unbound thunk. */
export function dynRowValue(L: Lowerer, info: ClassInfo, mName: string,
  found: { declarer: ClassInfo; sig: { params: { type: IrType }[]; ret: IrType } }, loc: import("../../ir/nodes.js").SrcLoc): void {
  if (info.liftEnv === undefined) {
    unboundMethodThunk(L, info, mName, found as never, loc, true);
    return;
  }
  const name = `%mvdyn.${info.def.name}.${mName}`;
  if (built(L, name)) return;
  noteBuilt(L, name);
  const selfT: IrType = { kind: "object", className: info.def.name };
  const self: IrExpr = { kind: "varRef", localId: "self.0", type: selfT, loc };
  const v = capMethodValue(L, info, mName, found.sig, self, loc);
  if (v === null) return;
  L.liftedFns.push({
    name,
    params: [],
    returnType: v.type,
    locals: [{ id: "self.0", name: "self", type: selfT, mutable: false }],
    body: [
      { kind: "varDecl", localId: "self.0", init: { kind: "dynCheck", value: { kind: "libCall", fn: "dyn.this", args: [], type: DYN, loc }, type: selfT, loc }, loc },
      { kind: "return", value: v, loc },
    ],
    loc,
  });
}

/** The value of `recv.m` for an instance `recv` of the capturing lifted class `info`, `m` an implicit-any method. */
export function capGenericValue(L: Lowerer, blame: ts.Node, info: ClassInfo, g: GenericFnInfo, mName: string,
  recv: IrExpr, loc: import("../../ir/nodes.js").SrcLoc): IrExpr | null {
  const fn = capGenericValueFn(L, blame, info, g, mName, loc);
  if (fn === null) return null;
  return { kind: "call", callee: fn.name, args: [envOfReceiver(info.liftEnv!, info, recv, loc)], type: fn.fnT, loc };
}

/** The dyn row value function `%mvdyn.<row fn>()` of an implicit-any method (the row's function is its default instance). */
export function dynGenericRowValue(L: Lowerer, info: ClassInfo, mName: string, rowFn: string,
  g: GenericFnInfo, loc: import("../../ir/nodes.js").SrcLoc): void {
  if (info.liftEnv === undefined) return;
  const name = `%mvdyn.${rowFn.slice(1)}`;
  if (built(L, name)) return;
  noteBuilt(L, name);
  const selfT: IrType = { kind: "object", className: info.def.name };
  const self: IrExpr = { kind: "varRef", localId: "self.0", type: selfT, loc };
  const v = capGenericValue(L, g.decl, info, g, mName, self, loc);
  if (v === null) return;
  L.liftedFns.push({
    name,
    params: [],
    returnType: v.type,
    locals: [{ id: "self.0", name: "self", type: selfT, mutable: false }],
    body: [
      { kind: "varDecl", localId: "self.0", init: { kind: "dynCheck", value: { kind: "libCall", fn: "dyn.this", args: [], type: DYN, loc }, type: selfT, loc }, loc },
      { kind: "return", value: v, loc },
    ],
    loc,
  });
}

/** Inside an evaluation-carrying body of a PER-EVALUATION class: the class's own evaluation object (the body's parameter), or a
 * captured binding read off it. `sym` null asks for the evaluation itself (the class's own name, an `EVAL_ENV_SYM` read). */
export function evalEnvBodyRead(L: Lowerer, cls: ClassInfo, sym: ts.Symbol | null, at: ts.Node): IrExpr | null {
  const plan = cls.liftEnv;
  if (plan === undefined || plan.evalClass !== true) return null;
  const param = L.resolveKey(plan.paramSym, undefined, at);
  if (!param) return null;
  const loc = locOf(at);
  const self: IrExpr = { kind: "varRef", localId: param.id, type: param.type, loc };
  const ec = cls.evalClass ?? cls.evalStaticOf?.evalClass;
  if (sym === null || ec?.selfAlias === sym) return self;
  const ev = ec?.caps.find((x) => x.sym === sym);
  if (ev === undefined) return null;
  return { kind: "fieldGet", obj: self, className: plan.envName, field: ev.field, type: ev.type, loc };
}
