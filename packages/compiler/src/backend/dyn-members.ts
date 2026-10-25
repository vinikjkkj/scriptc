/* WHICH members a boxed class instance answers for — computed ONCE, for
 * both backends.
 *
 * A class instance boxes into the checked-dynamic tree by reference, and
 * until the member table the box carried no way to reach a member at all:
 * `x.get()` through an untyped parameter answered Node's "x.get is not a
 * function" for a method the object plainly has, and `x.v` answered the
 * loud property-read fence. The methods were never dropped anywhere — a
 * class's methods are static functions in the emitted TU, and nothing the
 * descriptor carried could name one.
 *
 * The RENDERING of the table differs per lane (C emits wrapper functions
 * and a static array; LLVM emits the same two in .ll), but WHICH rows
 * exist must not: a name one lane answers and the other refuses is the
 * two-lanes-one-question defect this whole emission layer is arranged to
 * avoid. So the filters live here, in one place, and each emitter renders
 * what this returns.
 *
 * Every filter below is a SKIP that leaves the name exactly the answer it
 * has today — the fence, or the call ladder's tail — rather than a new
 * one. That is what makes the table strictly additive: it can turn a
 * wrong answer into a right one, and it can turn no right answer into
 * anything else.
 */
import {
  CLASS_PROPS_FIELD,
  parseOwnShadowField,
  canConvertToDyn,
  canDynCheckTo,
  RUNTIME_EMITTER_CLASS,
  RUNTIME_ERROR_CLASSES,
  RUNTIME_STREAM_CLASSES,
  type IrClassDef,
  type IrFunction,
  type IrRecordShape,
  type IrType,
  type IrUnionDef,
} from "../ir/nodes.js";

/** What both emitters' per-class graph nodes have in common. CEmitter's
 * ClassMeta and the LLVM lane's LlClassMeta both satisfy it; taking the
 * structural shape rather than either concrete type is what lets this
 * module be the single answer without either backend importing the
 * other. */
export interface DynMemberClass {
  readonly def: IrClassDef;
  readonly base: DynMemberClass | null;
}

export type DynMemberRow =
  /** A declared FIELD: the emitter reads the struct slot and boxes it
   * through the toDyn walker the type already has. Enumerable — this is
   * what Object.keys and JSON.stringify report. */
  | { kind: "field"; name: string; type: IrType; absentWhenUndefined: boolean }
  /** A GETTER (`get:prop`): the emitter calls `fn` with the instance and
   * boxes the result. NOT enumerable, matching JS. */
  | { kind: "accessor"; name: string; fn: IrFunction; isStatic?: true; enumerable?: true }
  /** A METHOD: the emitter checks the dyn arguments into `fn`'s declared
   * parameter types and calls it with the instance as the receiver. NOT
   * enumerable — a class method is non-enumerable in JS, which is why
   * `Object.keys(new Box(7))` is ["v"] and not ["v","get"]. */
  | { kind: "method"; name: string; fn: IrFunction; isStatic?: true }
  /** An OWN property that shadows the method `name` with the method `target`
   * of the same class (ir/nodes.ts OwnShadow): enumerable and present while the
   * private boolean `flag` is set, its value the function `target`. The row
   * sits where the property was created among the own keys, which is BEFORE
   * the method rows, so a read by name must never find it: the runtime skips
   * these rows (enumerable 3) when it looks a member up and answers the
   * method, whose body forwards to `target` while the flag is set. */
  | { kind: "shadow"; name: string; target: string; flag: string; flagType: IrType };

/**
 * The member table rows for one class, FLATTENED over its base chain with
 * own members first and overrides winning.
 *
 * Flattened, and not walked at run time, for two reasons that are really
 * one: the lookup becomes a single linear scan, and the row names the
 * implementation THIS class has — which is what makes a virtual method
 * come out right with no vtable involved. The table is per concrete
 * class, and the runtime resolves the instance's own class (from its
 * run-time preorder position, the fact `instanceof` reads) before reading
 * one.
 *
 * Returns [] when nothing survives the filters; a class with no members
 * needs no table, and an empty C array is not a C array.
 */
export function dynMemberRows(
  cls: DynMemberClass,
  fnByName: ReadonlyMap<string, IrFunction>,
  getRecord: (id: string) => IrRecordShape | undefined,
  getUnion: (id: string) => IrUnionDef | undefined,
): DynMemberRow[] {
  return dynMemberTable(cls, fnByName, getRecord, getUnion).rows;
}

/** The rows, plus whether the table is the class's WHOLE member set.
 *
 * `opaque` is true when some member the class has is NOT a row: a field or
 * method this table skipped (no dyn form for its type, an async or
 * generator body, a pruned implementation), or a chain that roots in a
 * runtime builtin whose members the table does not carry. It rides the
 * descriptor, and it is what lets a keyed read that misses the table answer
 * `undefined` (Node's answer for an absent property) exactly when no
 * skipped member could be the one asked for: `opaque` classes keep the loud
 * ladder instead. One computation for both lanes, like the rows. */
/** True when the class's chain reaches the runtime EventEmitter or a runtime stream class: the
 * descriptor declares the class not enumerable (the flag a class with a run-time property
 * table carries), so Object.keys, both JSON writers, util.inspect and Object.assign keep
 * the loud or empty answer they had. */
export function dynEnumerationFenced(cls: DynMemberClass): boolean {
  for (let c: DynMemberClass | null = cls; c !== null; c = c.base) {
    if (RUNTIME_STREAM_CLASSES.has(c.def.name) || c.def.name === RUNTIME_EMITTER_CLASS) return true;
  }
  return false;
}

/** 1 when the chain reaches the runtime EventEmitter and no runtime stream class, 2 when it
 * reaches a runtime stream class (their own-key prefix is far larger than the emitter's three
 * keys), else 0. */
/** Does this class's chain root in a runtime Error class (`class DB extends
 * Error`)? Its instances carry the Error hierarchy's vtable prefix, and a
 * caught or rejected one must cross as the instance itself: the error
 * encoding would answer Error.prototype for it (the registry interns the
 * descriptor of every such class so the runtime finds it by position). */
export function isErrorRootedClass(cls: DynMemberClass): boolean {
  for (let c: DynMemberClass | null = cls; c !== null; c = c.base) if (RUNTIME_ERROR_CLASSES.has(c.def.name)) return true;
  return false;
}

export function dynRuntimeRoot(cls: DynMemberClass): number {
  let emitter = false;
  // An Error-rooted instance has its own walk (errorRooted), whatever its property table holds.
  for (let c: DynMemberClass | null = cls; c !== null; c = c.base) if (RUNTIME_ERROR_CLASSES.has(c.def.name)) return 0;
  for (let c: DynMemberClass | null = cls; c !== null; c = c.base) {
    // A run-time property table holds keys no row names: the key list is not a fact of the class.
    if (RUNTIME_STREAM_CLASSES.has(c.def.name) || c.def.fields.some((f) => f.name === CLASS_PROPS_FIELD)) return 2;
    if (c.def.name === RUNTIME_EMITTER_CLASS) emitter = true;
  }
  return emitter ? 1 : 0;
}

export function dynMemberTable(
  cls: DynMemberClass,
  fnByName: ReadonlyMap<string, IrFunction>,
  getRecord: (id: string) => IrRecordShape | undefined,
  getUnion: (id: string) => IrUnionDef | undefined,
): { rows: DynMemberRow[]; opaque: boolean; errorRooted: boolean } {
  let opaque = false;
  let errorRooted = false;
  // The cells the runtime's ScrError base lays out ahead of a user Error
  // subclass's own fields (name, message, code, stack, the expando bag).
  const prefix = new Set<string>();
  // A class whose chain reaches a RUNTIME-PROVIDED base gets no table at
  // all, and this one is not a scruple -- it is a regression caught by a
  // probe, written down.
  //
  // A user Error subclass's layout PREFIX is ScrError's own cells, so
  // `def.fields` lists name/message/code beside the user's own fields and
  // nothing here can tell them apart. Node makes `name` and `message`
  // own NON-ENUMERABLE properties, so Object.keys(new MyErr()) is
  // ["code"] and JSON.stringify is {"code":"X"} -- measured on v25.9.0.
  // With a table the boxed instance answered
  // `name,message,code | {"name":"Error","message":"boom","code":"X"}`,
  // at exit 0. That took JSON.stringify from a LOUD fence to a SILENTLY
  // WRONG object, which is a regression in kind and the one direction
  // this feature is not allowed to move.
  //
  // The same reasoning covers the emitter and stream hierarchies, whose
  // prefixes are internal cells (_events, _eventsCount, _maxListeners)
  // that Node does list -- but with values this representation does not
  // hold, which is the same wrong answer with the sign flipped.
  //
  // The cost is stated rather than hidden: a method on an Error or
  // EventEmitter subclass is still lost across the crossing. That is the
  // PRE-EXISTING behaviour, unchanged, and a narrower gap than the one
  // this whole change closes.
  //
  // THE ERROR HIERARCHY IS THE ONE EXCEPTION, and only for the surfaces that
  // read or write ONE named member. Its prefix cells are not rows (the
  // runtime answers message/name/code/stack and the expando bag itself,
  // from the ScrError the box holds), so what the table carries is the
  // user's own fields and methods, and `errorRooted` tells every ENUMERATING
  // surface (Object.keys, JSON, inspect, assign) to keep its fence: which
  // names Node lists for an error (name only when assigned, never message
  // or stack) is not something the cells can say.
  for (let c: DynMemberClass | null = cls; c !== null; c = c.base) {
    if (RUNTIME_ERROR_CLASSES.has(c.def.name)) {
      errorRooted = true;
      for (const f of c.def.fields) prefix.add(f.name);
      continue;
    }
    // The EventEmitter and stream hierarchies keep a table of the program's own members (their
    // runtime prefix is not in `def.fields`), so a METHOD CALL or field read through an untyped
    // receiver finds its member (mysql2's PromiseConnection holds a Connection, which extends
    // EventEmitter, in an untyped field). The table is `opaque` (a miss keeps the loud ladder:
    // on/emit/... are the runtime's) and the descriptor is not enumerable (dynEnumerationFenced):
    // the prefix Node lists (_events, _eventsCount, _maxListeners) is not something rows can state.
    if (RUNTIME_STREAM_CLASSES.has(c.def.name) || c.def.name === RUNTIME_EMITTER_CLASS) {
      opaque = true;
      continue;
    }
    if (c.def.runtime === true) return { rows: [], opaque: true, errorRooted: false };
  }
  const rows: DynMemberRow[] = [];
  const seen = new Set<string>();

  // FIELDS, in layout order. A subclass's layout opens with its base
  // chain's fields as an identical prefix (that is what makes an upcast a
  // reinterpret), so one GEP through the derived struct reaches a base
  // field and `def.fields` is already the whole list.
  const shadows = cls.def.fields.flatMap((f) => {
    const sh = parseOwnShadowField(f.name);
    return sh === null ? [] : [{ f, sh }];
  });
  const pushed = new Set<string>();
  const pushShadows = (after: string | null): void => {
    for (const { f, sh } of shadows) {
      if (pushed.has(f.name) || (after !== null && sh.after !== after) || seen.has(sh.method)) continue;
      pushed.add(f.name);
      // The row is the property's; the name is not marked seen, because the
      // method row of the same name must still be emitted after it.
      rows.push({ kind: "shadow", name: sh.method, target: sh.target, flag: f.name, flagType: f.type });
    }
  };
  pushShadows("");
  for (const f of cls.def.fields) {
    // The internal '%'-prefixed slots (%props and its family): no program
    // can spell one, so answering for it would invent a key Node does not
    // have.
    if (f.name.startsWith("%")) continue;
    // A #PRIVATE field is not an own property in JS: Object.keys(new C(1))
    // is ["v"], not ["v","#h"] -- measured on v25.9.0. The frontend keys
    // privates by their spelled name, which no public identifier can
    // collide with, so the test is on the sigil exactly as the '%' one is.
    if (f.name.startsWith("#")) continue;
    if (prefix.has(f.name)) continue;
    if (seen.has(f.name)) continue;
    // A field whose type has no dyn representation at all keeps the
    // fence. Fabricating `undefined` for it would be the silent wrong
    // answer the fence exists to refuse.
    if (!canConvertToDyn(f.type, getRecord, getUnion)) {
      opaque = true;
      continue;
    }
    seen.add(f.name);
    rows.push({ kind: "field", name: f.name, type: f.type, absentWhenUndefined: cls.def.absentFields?.includes(f.name) === true });
    pushShadows(f.name);
  }
  // A property whose predecessor field has no dyn row still exists; it goes
  // after the last field row.
  pushShadows(null);

  /** The implementation of `m` for THIS class: the nearest declarer at or
   * above it carrying an emitted function. Null for an abstract slot, for
   * a body the dead-stripper pruned, and for a name no ancestor
   * declares. */
  const implOf = (m: string): IrFunction | null => {
    for (let c: DynMemberClass | null = cls; c !== null; c = c.base) {
      const implicit = c.def.dynMethods?.find((d) => d.name === m);
      if (implicit !== undefined) return fnByName.get(implicit.fn) ?? null;
      if (!(c.def.methods?.includes(m) ?? false)) continue;
      if (c.def.abstractMethods?.includes(m) ?? false) return null;
      return fnByName.get(`%${c.def.name}.${m}`) ?? null;
    }
    return null;
  };

  const names: string[] = [];
  for (let c: DynMemberClass | null = cls; c !== null; c = c.base) {
    // A runtime-provided base's methods (Error.prototype.toString) are the
    // runtime's to answer, not rows.
    if (c.def.runtime !== true) {
      for (const m of c.def.methods ?? []) if (!names.includes(m)) names.push(m);
    }
    for (const d of c.def.dynMethods ?? []) if (!names.includes(d.name)) names.push(d.name);
  }

  for (const raw of names) {
    // The WRITE path is not this table's: `x.v = 1` through a box is its
    // own question with its own fence, and half-answering it here would
    // make a setter run for a read.
    if (raw.startsWith("set:")) continue;
    // A #private method is no property of the instance (its name is not a
    // string key any program can read), so it can neither be a row nor make
    // the table incomplete.
    if (raw.startsWith("#")) continue;
    const accessor = raw.startsWith("get:");
    const name = accessor ? raw.slice(4) : raw;
    // A field of the same name already answers (a class cannot declare
    // both, but a base field and a derived accessor can collide).
    if (seen.has(name)) continue;
    const fn = implOf(raw);
    if (fn === null) {
      opaque = true;
      continue;
    }
    // An async or generator method answers a ScrPromise/ScrGen, which is
    // not a dyn value. Skipped rather than mis-boxed: claiming otherwise
    // is exactly the silent wrong answer this table exists to remove.
    if (fn.async === true || fn.generator !== undefined) {
      opaque = true;
      continue;
    }
    // No receiver parameter: not an instance method (a static rides its
    // own unit name and never reaches here, but the shape is checked
    // rather than assumed — the emitter GEPs through this).
    if (fn.params.length === 0 || fn.params[0]!.type.kind !== "object") {
      opaque = true;
      continue;
    }
    // Every parameter beyond the receiver must be reachable OUT of a dyn
    // argument, and the result must be boxable back INTO one.
    const rest = fn.params.slice(1);
    if (rest.some((p) => p.type.kind !== "dyn" && !canDynCheckTo(p.type, getRecord, getUnion))) {
      opaque = true;
      continue;
    }
    const ret = fn.returnType;
    if (ret.kind !== "void" && ret.kind !== "dyn" && !canConvertToDyn(ret, getRecord, getUnion)) {
      opaque = true;
      continue;
    }
    seen.add(name);
    rows.push(accessor ? { kind: "accessor", name, fn } : { kind: "method", name, fn });
  }

  return { rows, opaque, errorRooted };
}

/** The rows of the STATIC side of a class (the table behind its class value:
 * `x.constructor`, a class passed to untyped code), flattened over the base
 * chain, derived first, from IrClassDef.dynStatics. Every row is
 * receiver-free (`isStatic`): the emitters call the function with the dyn
 * arguments checked into its parameters and nothing else.
 *
 * `opaque` has the instance table's meaning: some member of the static side
 * was skipped (an async static, a signature with no dyn form, a pruned
 * body), so a miss cannot be called absent. */
export function dynStaticTable(
  cls: DynMemberClass,
  fnByName: ReadonlyMap<string, IrFunction>,
  getRecord: (id: string) => IrRecordShape | undefined,
  getUnion: (id: string) => IrUnionDef | undefined,
): { rows: DynMemberRow[]; opaque: boolean } {
  const rows: DynMemberRow[] = [];
  const seen = new Set<string>();
  let opaque = false;
  for (let c: DynMemberClass | null = cls; c !== null; c = c.base) {
    for (const entry of c.def.dynStatics ?? []) {
      // The synthesized members (%dynStaticSet, %dynNew) belong to ONE class:
      // inheriting a base's would write the base's statics and construct the
      // base for a derived class value.
      if (c !== cls && entry.name.startsWith("%")) continue;
      // `get:` a static getter (non-enumerable, like a class accessor),
      // `field:` a static field read (an own ENUMERABLE data property).
      const isField = entry.name.startsWith("field:");
      const accessor = isField || entry.name.startsWith("get:");
      const name = accessor ? entry.name.slice(isField ? 6 : 4) : entry.name;
      // A name is ONE member: the chain's first spelling of it wins.
      if (seen.has(name)) continue;
      seen.add(name);
      const fn = fnByName.get(entry.fn);
      if (fn === undefined) {
        opaque = true;
        continue;
      }
      if (fn.async === true || fn.generator !== undefined) {
        opaque = true;
        continue;
      }
      if (fn.params.some((p) => p.type.kind !== "dyn" && !canDynCheckTo(p.type, getRecord, getUnion))) {
        opaque = true;
        continue;
      }
      const ret = fn.returnType;
      if (ret.kind !== "void" && ret.kind !== "dyn" && !canConvertToDyn(ret, getRecord, getUnion)) {
        opaque = true;
        continue;
      }
      if (accessor && ret.kind === "void") {
        opaque = true;
        continue;
      }
      rows.push(
        accessor
          // An INHERITED static field is the base class object's own property,
          // not this one's: it reads through, and no own-key surface lists it.
          ? { kind: "accessor", name, fn, isStatic: true, ...(isField && c === cls ? { enumerable: true as const } : {}) }
          : { kind: "method", name, fn, isStatic: true },
      );
    }
  }
  return { rows, opaque };
}

/** The DISPLAY NAME a `ScrDynClass` descriptor carries: the string every
 * "on a dynamic X" fence prints and, since util.inspect joined the member
 * table, the one that goes before the brace (`Box { v: 7 }`).
 *
 * `def.name` is the IR name, and an IR name is a COMPILER name. It is
 * program-qualified, and for a class EXPRESSION it is `%cx<character
 * offset>.<binding name>` — so
 *
 *     const Box = class { constructor(v) { this.v = v } get() {...} }
 *     function see(x) { return require("node:util").inspect(x) }
 *     console.log(see(new Box(7)))
 *
 * printed `cx44. { v: 7 }` at EXIT 0 where node v25.9.0 prints
 * `Box { v: 7 }` — the compiler's own internal name, on stdout, in the
 * most ordinary thing a program does with a value. A class the frontend
 * synthesizes from a JavaScript pre-class constructor is the same fact
 * with a different prefix (`%pc<offset>.<name>`), and there the string
 * was a function of where in the file the constructor happened to sit.
 *
 * `def.jsName` is the JS-VISIBLE name — `C.name`, the value the `.name`
 * property lowering already folds to, following NamedEvaluation — which
 * is what Node prints and what an error text about a program's own value
 * should say. Empty for a truly anonymous class expression and absent on
 * the runtime-provided defs, which is why this falls back rather than
 * trusting it: there the IR name is the only name there is.
 *
 * Here, and not in either emitter, for the reason the member rows are
 * here: a name one lane prints and the other spells differently is the
 * two-lanes-one-question defect, and both emitters call this. */
export function dynClassDisplayName(def: IrClassDef): string {
  const js = def.jsName ?? "";
  if (js !== "") return js;
  return def.name.startsWith("%") ? def.name.slice(1) : def.name;
}
