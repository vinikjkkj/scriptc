/* OWN PROPERTIES THAT SHADOW A PROTOTYPE METHOD, written under a RUN-TIME key: `this[name] = fn` in a class whose
 * instances carry the run-time property table (ioredis Commander.defineCommand / addBuiltinCommand, Pipeline's copy of the
 * client's commands). When `name` is a method of the instance's class chain, Node stores an OWN property: `x.name` and
 * `x.name(...)` answer it from then on, `super.name(...)` and the prototype's own function value do not.
 *
 * A statically spelled method call cannot know the key, so every method of the FAMILY (the whole tree below the root
 * class of a receiver that takes such a write) becomes a small dispatcher: `own table holds m ? call it with this = the
 * instance : the original body`. The original body is `%C.m%ns`. `super.m()` calls and the detached prototype-function
 * thunks (`%unbound.*`) must NOT see the own property, so the former call `%ns` directly and the latter raise a one-shot
 * bypass flag the dispatcher consumes first. Value reads (`x.m` as a value) answer the own property when present. The dyn
 * side (a boxed instance) answers through scr_dyn_objinst_member, which declines a method row when the table holds the
 * name. A method no write could shadow is not in a family and keeps its direct body byte for byte.
 *
 * Gates (a loud, named SC1090 at the keyed write): the receiver's class is typed at the write (a family registered by the
 * pre-scan), the whole family is JS classes carrying the table, and no member of the family is a generator or abstract (the
 * dispatcher forwards through the checked-dynamic call). An async member's dispatcher answers the promise its body's call
 * answers, and a replacement's answer adopts into it. */
import { PoisonError, newFnCtx, type Lowerer } from "./lowerer.js";
import type { ClassInfo } from "./lower-classes.js";
import { CLASS_PROPS_FIELD } from "./lower-classes.js";
import { isJsSourceFile } from "../program.js";
import { dynCallWithThis } from "./lower-calls.js";
import { dispatcherResult, dispatcherReturnType, protoSlotSlottable } from "./lower-protoslots.js";
import { unsupportedDiag } from "../../diagnostics/diagnostic.js";
import { BOOL, DYN, STRING, VOID, type IrExpr, type IrFunction, type IrGlobal, type IrLocal, type IrType, type IrParam, type IrStmt, type SrcLoc } from "../../ir/nodes.js";

/** The roots of the families whose instances take a run-time keyed write the lowering lowered. Module-level so the discovery pass's
 * answer is complete when the emit pass starts (class names are the same in both); cleared at the start of every lowering. */
export const OWN_SHADOW_ROOTS = new Set<string>();

/** The root (topmost program class) of `info`'s chain. */
export function ownShadowRootOf(info: ClassInfo): ClassInfo {
  let c = info;
  while (c.base !== null && c.base !== undefined && c.base.builtinEmitter !== true && c.base.builtinError !== true && c.base.def.runtime !== true) c = c.base;
  return c;
}

/** Registers the family of `info` (a keyed write on one of its instances is being lowered). */
export function registerOwnShadowFamily(info: ClassInfo): void {
  OWN_SHADOW_ROOTS.add(ownShadowRootOf(info).def.name);
}

/** Is `info` in a registered family? */
export function inOwnShadowFamily(L: Lowerer, info: ClassInfo): boolean {
  return L.ownShadowRoots.size > 0 && L.ownShadowRoots.has(ownShadowRootOf(info).def.name);
}

function familyOf(root: ClassInfo): ClassInfo[] {
  const out: ClassInfo[] = [];
  const stack: ClassInfo[] = [root];
  while (stack.length > 0) {
    const c = stack.pop()!;
    out.push(c);
    stack.push(...c.subclasses);
  }
  return out;
}

/** The declared (non-accessor) method names of one class, typed and generic. */
export function ownMethodNamesOf(info: ClassInfo): string[] {
  const out: string[] = [];
  for (const m of [...info.methods.keys(), ...(info.genericMethods?.keys() ?? [])]) {
    if (!m.startsWith("get:") && !m.startsWith("set:") && !m.startsWith("%") && !out.includes(m)) out.push(m);
  }
  return out;
}

/** Why the family of `info` cannot take own-shadow dispatch, or null. */
export function ownShadowWhy(L: Lowerer, info: ClassInfo): string | null {
  const root = ownShadowRootOf(info);
  for (const c of familyOf(root)) {
    if (c.decl === null || !isJsSourceFile(c.decl.getSourceFile())) return `the class '${c.def.jsName ?? c.def.name}' is not a JavaScript class`;
    if (c.hasPropsTable !== true) return `the class '${c.def.jsName ?? c.def.name}' carries no run-time property table`;
    if (c.evalClass !== undefined) return `the class '${c.def.jsName ?? c.def.name}' is created by an evaluation`;
    for (const m of ownMethodNamesOf(c)) {
      if (!protoSlotSlottable(c, m)) return `the class '${c.def.jsName ?? c.def.name}' declares the method '${m}' (abstract or a generator: an own property of that name could not be dispatched)`;
    }
  }
  return null;
}

/** Boxes the lowering itself builds to reach an instance's member table (keyed reads, writes, calls and the method dispatchers):
 * they never leave the instance's own code, so the enumeration fence below does not count them. */
export function internalBox<T extends IrExpr>(L: Lowerer, box: T): T {
  L.internalBoxes.add(box);
  (box as unknown as { ownTable?: true }).ownTable = true; // survives the clones later passes make
  return box;
}

/** The dynFrom sites that box an instance of a registered family (other than the lowering's own). */
export function ownShadowBoxSites(L: Lowerer, functions: readonly IrFunction[]): { loc: SrcLoc; className: string; fn: string }[] {
  const names = new Set<string>();
  for (const r of L.ownShadowRoots) {
    const root = L.classes.get(r);
    if (root !== undefined) for (const c of familyOf(root)) names.add(c.def.name);
  }
  const out: { loc: SrcLoc; className: string; fn: string }[] = [];
  const fnNames = new Set(functions.map((f) => f.name));
  for (const f of functions) {
  // the replacement-slot dispatcher a method with a `%raw` body became (lower-protoslots.ts) boxes its receiver to call the slot
  if (f.name.endsWith("%ns") && fnNames.has(`${f.name.slice(0, -3)}%raw`)) continue;
  if (f.name.includes(".%dyn")) continue; // the member-table rows (clone, new, ...) the runtime reaches an instance through
  const stack: unknown[] = [f.body];
  while (stack.length > 0) {
    const v = stack.pop();
    if (v === null || typeof v !== "object") continue;
    if (Array.isArray(v)) {
      for (const x of v) stack.push(x);
      continue;
    }
    const n = v as { kind?: string; value?: { type?: { kind?: string; className?: string } }; loc?: SrcLoc; ownTable?: true };
    if (n.kind === "dynFrom" && n.value?.type?.kind === "object" && typeof n.value.type.className === "string" && names.has(n.value.type.className) && n.loc !== undefined && n.ownTable !== true) {
      out.push({ loc: n.loc, className: n.value.type.className, fn: f.name });
    }
    for (const k of Object.keys(v)) stack.push((v as Record<string, unknown>)[k]);
  }
  }
  return out;
}

const bypassGlobal = (L: Lowerer): IrGlobal => {
  let g = L.globalsList.find((x) => x.id === "%g.%osbypass");
  if (g === undefined) {
    g = { id: "%g.%osbypass", name: "own-shadow bypass", type: BOOL, mutable: true };
    L.globalsList.push(g);
  }
  return g;
};

/** The call-site text of the method call that is entering a dispatcher, for the TypeError Node throws when an own property that is
 * not a function shadows the method (`b.hello is not a function`). A call site stores the text and the validity flag just before
 * it calls; the dispatcher reads and clears the flag first thing, so a call that did not store one (a thunk, a virtual entry)
 * falls back to the class-qualified spelling. */
const siteGlobals = (L: Lowerer): { text: IrGlobal; valid: IrGlobal } => {
  let text = L.globalsList.find((x) => x.id === "%g.%ossite");
  if (text === undefined) {
    text = { id: "%g.%ossite", name: "own-shadow call site", type: STRING, mutable: true };
    L.globalsList.push(text);
  }
  let valid = L.globalsList.find((x) => x.id === "%g.%ossitevalid");
  if (valid === undefined) {
    valid = { id: "%g.%ossitevalid", name: "own-shadow call site valid", type: BOOL, mutable: true };
    L.globalsList.push(valid);
  }
  return { text, valid };
};

/** Splits every method of every registered family into the dispatcher `%C.m` and the body `%C.m%ns`. Runs after
 * applyProtoSlots, before the lifted functions are appended (the dispatchers' helpers land in L.liftedFns). */
export function applyOwnShadows(L: Lowerer, fnLists: IrFunction[][]): void {
  if (L.ownShadowRoots.size === 0) return;
  const byName = new Map<string, { fn: IrFunction; list: IrFunction[] }>();
  for (const list of fnLists) for (const f of list) byName.set(f.name, { fn: f, list });
  const nsOf = new Map<string, string>();
  const todo: { fn: IrFunction; list: IrFunction[]; cls: ClassInfo; method: string }[] = [];
  for (const rootName of L.ownShadowRoots) {
    const root = L.classes.get(rootName);
    if (root === undefined) continue;
    for (const c of familyOf(root)) {
      for (const m of ownMethodNamesOf(c)) {
        const names: string[] = [];
        if (c.methods.has(m)) names.push(`%${c.def.name}.${m}`);
        const gm = c.genericMethods?.get(m);
        if (gm !== undefined) for (const inst of gm.instances.values()) if (inst.detachedThis !== true) names.push(inst.name);
        for (const nm of names) {
          const hit = byName.get(nm);
          if (hit !== undefined && !todo.some((x) => x.fn === hit.fn)) todo.push({ fn: hit.fn, list: hit.list, cls: c, method: m });
        }
      }
    }
  }
  if (todo.length === 0) return;
  const bypass = bypassGlobal(L);
  const dispatchers: { list: IrFunction[]; fn: IrFunction }[] = [];
  const pairs = new Set<string>();
  for (const t of todo) {
    const raw = t.fn;
    if (raw.params.length === 0) continue;
    const loc = raw.loc;
    try {
      const nsName = `${raw.name}%ns`;
      const params: IrParam[] = raw.params;
      const ref = (p: IrParam): IrExpr => ({ kind: "varRef", localId: p.localId, type: p.type, loc });
      const selfP = params[0]!;
      const selfT = selfP.type;
      if (selfT.kind !== "object") continue;
      const bagOf = (): IrExpr => ({ kind: "fieldGet", obj: ref(selfP), className: selfT.className, field: CLASS_PROPS_FIELD, type: DYN, loc });
      const key: IrExpr = { kind: "strLit", value: t.method, type: STRING, loc };
      const recv = internalBox(L, L.coerceToExpected(ref(selfP), DYN));
      const args = params.slice(1).map((p) => L.coerceToExpected(ref(p), DYN));
      const ownId = `${raw.name}%own`;
      const okId = `${raw.name}%siteok`;
      const ownRef = (): IrExpr => ({ kind: "varRef", localId: ownId, type: DYN, loc });
      const own = { kind: "libCall", fn: "cls.propsRead", args: [bagOf(), { ...key }], type: DYN, loc } as IrExpr;
      const label = `${t.cls.def.jsName ?? t.cls.def.name}.prototype.${t.method}`;
      const via = dynCallWithThis(L, recv, ownRef(), args, label, loc);
      const rt = dispatcherReturnType(raw);
      // The result's coercion (a Promise adopts a checked-dynamic value through hidden locals) needs a function frame: this pass runs
      // after every body is down, so it opens one and hands its locals to the dispatcher.
      const ctxLocals: IrLocal[] = [];
      const coerceInCtx = (e: IrExpr, to: IrType): IrExpr => {
        const ctx = newFnCtx(true, null, null, to);
        L.fnStack.push(ctx);
        try {
          return dispatcherResult(L, e, to);
        } finally {
          L.fnStack.pop();
          ctxLocals.push(...ctx.locals);
        }
      };
      const sg = siteGlobals(L);
      const siteText: IrExpr = {
        kind: "ternary",
        cond: { kind: "varRef", localId: okId, type: BOOL, loc },
        then: { kind: "varRef", localId: sg.text.id, type: STRING, loc },
        else_: { kind: "strLit", value: label, type: STRING, loc },
        type: STRING,
        loc,
      };
      // The own property is read once; a function runs as the method's replacement, anything else is Node's TypeError naming the call.
      const notFn: IrStmt = {
        kind: "throw",
        value: {
          kind: "libCall",
          fn: "error.new",
          args: [{ kind: "strConcat", left: siteText, right: { kind: "strLit", value: " is not a function", type: STRING, loc }, type: STRING, loc }],
          type: { kind: "object", className: "%TypeError" },
          loc,
        },
        loc,
      };
      const call: IrStmt[] =
        rt.kind === "void"
          ? [{ kind: "exprStmt", expr: via, loc }, { kind: "return", value: null, loc }]
          : [{ kind: "return", value: coerceInCtx(via, rt), loc }];
      const slow: IrStmt[] = [
        { kind: "varDecl", localId: ownId, init: own, loc },
        { kind: "if", cond: { kind: "dynTest", test: "function", value: ownRef(), type: BOOL, loc }, then: call, else_: [notFn], loc },
      ];
      const direct: IrExpr = { kind: "call", callee: nsName, args: params.map(ref), type: rt, loc };
      const fast: IrStmt = rt.kind === "void" ? { kind: "exprStmt", expr: direct, loc } : { kind: "return", value: direct, loc };
      const bypassRef = (): IrExpr => ({ kind: "varRef", localId: bypass.id, type: BOOL, loc });
      const dispatcher: IrFunction = {
        name: raw.name,
        ...(raw.jsName !== undefined && { jsName: raw.jsName }),
        params,
        returnType: rt,
        locals: [
          ...params.map((p) => ({ id: p.localId, name: p.name, type: p.type, mutable: false })),
          { id: ownId, name: "own", type: DYN, mutable: false },
          { id: okId, name: "siteOk", type: BOOL, mutable: false },
          ...ctxLocals,
        ],
        body: [
          // the call site's text, if it stored one, is read and cleared before anything can run another call
          { kind: "varDecl", localId: okId, init: { kind: "varRef", localId: sg.valid.id, type: BOOL, loc }, loc },
          { kind: "assign", localId: sg.valid.id, value: { kind: "boolLit", value: false, type: BOOL, loc }, loc },
          // a detached prototype-function thunk raised the flag: this one call runs the body
          { kind: "if", cond: bypassRef(), then: [{ kind: "assign", localId: bypass.id, value: { kind: "boolLit", value: false, type: BOOL, loc }, loc }, fast], else_: null, loc },
          { kind: "if", cond: { kind: "libCall", fn: "cls.propsHas", args: [bagOf(), { ...key }], type: BOOL, loc }, then: slow, else_: null, loc },
          fast,
        ],
        loc,
      };
      nsOf.set(raw.name, nsName);
      pairs.add(`${t.cls.def.name}.${t.method}`);
      raw.name = nsName;
      dispatchers.push({ list: t.list, fn: dispatcher });
    } catch (e) {
      if (!(e instanceof PoisonError)) throw e;
    }
  }
  for (const d of dispatchers) d.list.push(d.fn);
  if (nsOf.size === 0) return;
  // super calls reach the body; detached thunks raise the bypass flag before calling a dispatched method
  const FN_FIELDS = new Set(["loc", "type"]);
  const rewriteSuper = (root: unknown): void => {
    const stack: unknown[] = [root];
    while (stack.length > 0) {
      const n = stack.pop();
      if (n === null || typeof n !== "object") continue;
      if (Array.isArray(n)) {
        for (const x of n) stack.push(x);
        continue;
      }
      const o = n as Record<string, unknown>;
      if (o["kind"] === "call" && typeof o["callee"] === "string" && L.superCalls.has(o as unknown as IrExpr) && nsOf.has(o["callee"])) o["callee"] = nsOf.get(o["callee"]);
      for (const [k, v] of Object.entries(o)) if (!FN_FIELDS.has(k)) stack.push(v);
    }
  };
  for (const list of [...fnLists, L.liftedFns]) for (const f of list) rewriteSuper(f.body);
  // A detached prototype-function thunk IS the original function: a direct thunk calls the body, a virtual one raises the
  // one-shot flag its dispatcher consumes.
  const isThunkOfPair = (name: string): boolean => {
    if (!name.startsWith("%unbound.")) return false;
    let rest = name.slice("%unbound.".length);
    for (const suf of ["%generic", "%direct"]) if (rest.endsWith(suf)) rest = rest.slice(0, -suf.length);
    return pairs.has(rest);
  };
  const hasKind = (root: unknown, kind: string): boolean => {
    const stack: unknown[] = [root];
    while (stack.length > 0) {
      const n = stack.pop();
      if (n === null || typeof n !== "object") continue;
      if (Array.isArray(n)) {
        for (const x of n) stack.push(x);
        continue;
      }
      const o = n as Record<string, unknown>;
      if (o["kind"] === kind) return true;
      for (const [k, v] of Object.entries(o)) if (!FN_FIELDS.has(k)) stack.push(v);
    }
    return false;
  };
  for (const list of [...fnLists, L.liftedFns]) {
    for (const f of list) {
      if (!isThunkOfPair(f.name)) continue;
      const loc = f.loc;
      const stack: unknown[] = [f.body];
      while (stack.length > 0) {
        const n = stack.pop();
        if (n === null || typeof n !== "object") continue;
        if (Array.isArray(n)) {
          for (const x of n) stack.push(x);
          continue;
        }
        const o = n as Record<string, unknown>;
        if (o["kind"] === "call" && typeof o["callee"] === "string" && nsOf.has(o["callee"])) o["callee"] = nsOf.get(o["callee"]);
        for (const [k, v] of Object.entries(o)) if (!FN_FIELDS.has(k)) stack.push(v);
      }
      if (hasKind(f.body, "virtualCall")) {
        const at = f.body.findIndex((st) => hasKind(st, "virtualCall"));
        if (at >= 0) f.body.splice(at, 0, { kind: "assign", localId: bypass.id, value: { kind: "boolLit", value: true, type: BOOL, loc }, loc });
      }
    }
  }
  // Each call of a dispatched method that has a plain callee spelling (`b.hello(...)`, `this.total(...)`) stores that text just
  // before it calls, so a non-function own property shadowing the method throws Node's `b.hello is not a function`. A call whose
  // arguments hold another call keeps the fallback spelling (the inner call would store its own text first).
  const sg = siteGlobals(L);
  const texts = new Map<string, string>();
  for (const sf of L.program.getSourceFiles()) texts.set(sf.fileName, sf.text);
  const dispatched = new Set(nsOf.keys());
  const methodNames = new Set(todo.map((t) => t.method));
  const done = new WeakSet<object>();
  const callsIn = (root: unknown): boolean => {
    const stack: unknown[] = [root];
    while (stack.length > 0) {
      const n = stack.pop();
      if (n === null || typeof n !== "object") continue;
      if (Array.isArray(n)) {
        for (const x of n) stack.push(x);
        continue;
      }
      const o = n as Record<string, unknown>;
      const k = o["kind"];
      if (k === "call" || k === "virtualCall" || k === "dynCall" || k === "closureCall" || k === "new") return true;
      for (const [kk, v] of Object.entries(o)) if (!FN_FIELDS.has(kk)) stack.push(v);
    }
    return false;
  };
  const wrapSites = (root: unknown): void => {
    const stack: unknown[] = [root];
    while (stack.length > 0) {
      const n = stack.pop();
      if (n === null || typeof n !== "object") continue;
      if (Array.isArray(n)) {
        for (const x of n) stack.push(x);
        continue;
      }
      const o = n as Record<string, unknown>;
      const isDispatched =
        (o["kind"] === "call" && typeof o["callee"] === "string" && dispatched.has(o["callee"])) ||
        (o["kind"] === "virtualCall" && typeof o["method"] === "string" && methodNames.has(o["method"]));
      if (isDispatched && !done.has(o)) {
        done.add(o);
        const loc = o["loc"] as SrcLoc;
        const src = texts.get(loc.file)?.slice(loc.start, loc.end);
        const callee = src === undefined ? null : /^([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\(/.exec(src);
        if (callee !== null && !callsIn(o["args"])) {
          const inner = { ...o } as unknown as IrExpr;
          done.add(inner);
          for (const k of Object.keys(o)) delete o[k];
          Object.assign(o, {
            kind: "seqExpr",
            stmts: [
              { kind: "assign", localId: sg.text.id, value: { kind: "strLit", value: callee[1]!, type: STRING, loc }, loc },
              { kind: "assign", localId: sg.valid.id, value: { kind: "boolLit", value: true, type: BOOL, loc }, loc },
            ],
            result: inner,
            type: inner.type,
            loc,
          });
        }
      }
      for (const [k, v] of Object.entries(o)) if (!FN_FIELDS.has(k)) stack.push(v);
    }
  };
  for (const list of [...fnLists, L.liftedFns]) for (const f of list) wrapSites(f.body);

}

/** The own-key CREATION ORDER of a family's instances (the run-time table's insertion order is the order). After every body is
 * down, each store that CREATES an own field of a family class (`fieldSet`, and the `ordNote` of a field Node defines as undefined
 * at construction) is followed by a `cls.propsNote` of the field's name on the instance's table (ensured first), so a field
 * enters the order at its first assignment, exactly when Node creates it, and a declared field never assigned never appears.
 * Private (#x) and symbol-keyed fields are not string keys and are not noted. A store whose receiver is not a plain local
 * is refused here, named, rather than left out of the order. */
export function applyFieldNotes(L: Lowerer, fnLists: IrFunction[][]): void {
  if (L.ownShadowRoots.size === 0) return;
  const names = new Set<string>();
  for (const r of L.ownShadowRoots) {
    const root = L.classes.get(r);
    if (root !== undefined) for (const c of familyOf(root)) names.add(c.def.name);
  }
  const plain = (e: IrExpr): boolean => {
    let x: IrExpr = e;
    while ((x.kind === "downcast" || x.kind === "upcast") && "value" in x) x = (x as { value: IrExpr }).value;
    return x.kind === "varRef";
  };
  const FN_FIELDS = new Set(["loc", "type"]);
  const gaps = new Set<string>();
  let tmpCount = 0;
  for (const list of [...fnLists, L.liftedFns]) for (const f of list) {
  const stack: unknown[] = [f.body];
  while (stack.length > 0) {
    const n = stack.pop();
    if (n === null || typeof n !== "object") continue;
    if (Array.isArray(n)) {
      for (let i = 0; i < n.length; i++) {
        const st = n[i] as { kind?: string; obj?: IrExpr; className?: string; field?: string; unset?: true; loc?: SrcLoc };
        if (st !== null && typeof st === "object" && (st.kind === "fieldSet" || st.kind === "ordNote") && st.unset !== true && typeof st.className === "string" &&
            names.has(st.className) && typeof st.field === "string" && !st.field.startsWith("#") && !st.field.startsWith("%") && !st.field.startsWith("Symbol(")) {
          const info = L.classes.get(st.className);
          if (info === undefined || !info.fields.has(CLASS_PROPS_FIELD)) continue;
          const loc = st.loc as SrcLoc;
          if (!plain(st.obj as IrExpr)) {
            // A receiver that is an expression (a checked `this`, a call's result): evaluated ONCE into a hidden local ahead of the store
            // (JS evaluates the receiver before the right-hand side), and the store and its notes name the local.
            const objT = (st.obj as IrExpr).type;
            if (objT.kind !== "object") {
              gaps.add(`${loc.file}@${loc.start}`);
              continue;
            }
            const id = `%fnote.${tmpCount++}`;
            f.locals.push({ id, name: "%fnote", type: objT, mutable: false });
            n.splice(i, 0, { kind: "varDecl", localId: id, init: st.obj, loc } as unknown);
            i++;
            st.obj = { kind: "varRef", localId: id, type: objT, loc } as IrExpr;
          }
          const cls = st.className;
          const objOf = (): IrExpr => ({ ...(st.obj as IrExpr) } as IrExpr);
          const bag = (): IrExpr => ({ kind: "fieldGet", obj: objOf(), className: cls, field: CLASS_PROPS_FIELD, type: DYN, loc });
          const note: IrStmt[] = [
            { kind: "fieldSet", obj: objOf(), className: cls, field: CLASS_PROPS_FIELD, value: { kind: "libCall", fn: "cls.propsEnsure", args: [bag()], type: DYN, loc }, loc },
            { kind: "exprStmt", expr: { kind: "libCall", fn: "cls.propsNote", args: [bag(), { kind: "strLit", value: st.field, type: STRING, loc }], type: VOID, loc }, loc },
          ];
          n.splice(i + 1, 0, ...(note as unknown[]));
          i += note.length;
        }
      }
    }
    const o = n as Record<string, unknown>;
    if (Array.isArray(n)) { for (const x of n) stack.push(x); continue; }
    for (const [k, v] of Object.entries(o)) if (!FN_FIELDS.has(k)) stack.push(v);
  }
  }
  for (const g of gaps) {
    const [file, start] = g.split("@");
    L.pushDiag(unsupportedDiag("SC1090", { file: file!, start: Number(start), end: Number(start) }, "storing an own field of an instance that takes own properties under run-time keys through a receiver that is not a plain local (the field's place in the instance's key order could not be recorded)"));
  }
}
