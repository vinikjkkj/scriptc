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
  | { kind: "field"; name: string; type: IrType }
  /** A GETTER (`get:prop`): the emitter calls `fn` with the instance and
   * boxes the result. NOT enumerable, matching JS. */
  | { kind: "accessor"; name: string; fn: IrFunction }
  /** A METHOD: the emitter checks the dyn arguments into `fn`'s declared
   * parameter types and calls it with the instance as the receiver. NOT
   * enumerable — a class method is non-enumerable in JS, which is why
   * `Object.keys(new Box(7))` is ["v"] and not ["v","get"]. */
  | { kind: "method"; name: string; fn: IrFunction };

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
  for (let c: DynMemberClass | null = cls; c !== null; c = c.base) {
    if (c.def.runtime === true) return [];
    if (RUNTIME_ERROR_CLASSES.has(c.def.name)) return [];
    if (RUNTIME_STREAM_CLASSES.has(c.def.name)) return [];
    if (c.def.name === RUNTIME_EMITTER_CLASS) return [];
  }
  const rows: DynMemberRow[] = [];
  const seen = new Set<string>();

  // FIELDS, in layout order. A subclass's layout opens with its base
  // chain's fields as an identical prefix (that is what makes an upcast a
  // reinterpret), so one GEP through the derived struct reaches a base
  // field and `def.fields` is already the whole list.
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
    if (seen.has(f.name)) continue;
    // A field whose type has no dyn representation at all keeps the
    // fence. Fabricating `undefined` for it would be the silent wrong
    // answer the fence exists to refuse.
    if (!canConvertToDyn(f.type, getRecord, getUnion)) continue;
    seen.add(f.name);
    rows.push({ kind: "field", name: f.name, type: f.type });
  }

  /** The implementation of `m` for THIS class: the nearest declarer at or
   * above it carrying an emitted function. Null for an abstract slot, for
   * a body the dead-stripper pruned, and for a name no ancestor
   * declares. */
  const implOf = (m: string): IrFunction | null => {
    for (let c: DynMemberClass | null = cls; c !== null; c = c.base) {
      if (!(c.def.methods?.includes(m) ?? false)) continue;
      if (c.def.abstractMethods?.includes(m) ?? false) return null;
      return fnByName.get(`%${c.def.name}.${m}`) ?? null;
    }
    return null;
  };

  const names: string[] = [];
  for (let c: DynMemberClass | null = cls; c !== null; c = c.base) {
    for (const m of c.def.methods ?? []) if (!names.includes(m)) names.push(m);
  }

  for (const raw of names) {
    // The WRITE path is not this table's: `x.v = 1` through a box is its
    // own question with its own fence, and half-answering it here would
    // make a setter run for a read.
    if (raw.startsWith("set:")) continue;
    const accessor = raw.startsWith("get:");
    const name = accessor ? raw.slice(4) : raw;
    // A field of the same name already answers (a class cannot declare
    // both, but a base field and a derived accessor can collide).
    if (seen.has(name)) continue;
    const fn = implOf(raw);
    if (fn === null) continue;
    // An async or generator method answers a ScrPromise/ScrGen, which is
    // not a dyn value. Skipped rather than mis-boxed: claiming otherwise
    // is exactly the silent wrong answer this table exists to remove.
    if (fn.async === true || fn.generator !== undefined) continue;
    // No receiver parameter: not an instance method (a static rides its
    // own unit name and never reaches here, but the shape is checked
    // rather than assumed — the emitter GEPs through this).
    if (fn.params.length === 0) continue;
    if (fn.params[0]!.type.kind !== "object") continue;
    // Every parameter beyond the receiver must be reachable OUT of a dyn
    // argument, and the result must be boxable back INTO one.
    const rest = fn.params.slice(1);
    if (rest.some((p) => p.type.kind !== "dyn" && !canDynCheckTo(p.type, getRecord, getUnion))) continue;
    const ret = fn.returnType;
    if (ret.kind !== "void" && ret.kind !== "dyn" && !canConvertToDyn(ret, getRecord, getUnion)) continue;
    seen.add(name);
    rows.push(accessor ? { kind: "accessor", name, fn } : { kind: "method", name, fn });
  }

  return rows;
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
