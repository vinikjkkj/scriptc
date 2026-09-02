/* proto-class-consume.ts -- turning a RECOGNISED prototype-class into a
 * registered ClassInfo, so `new K(a)` in a JavaScript file lowers as a CLASS
 * instead of as the per-use dyn box.
 *
 * The three modules split by what they need:
 *
 *   proto-class.ts        pure AST walk        "is this JS function a class?"
 *   proto-class-synth.ts  checker, injected    "what type does each slot hold?"
 *   THIS FILE             the Lowerer          "build and register the class"
 *
 * WHY IT MATTERS. lower-classes.ts lowers `new Klass(a)` in a .js file to a
 * fresh dyn OBJ linked to `Klass.prototype`, which makes every later
 * `inst.m()` a dynInvoke and every `inst.f` a dynKeyGet -- both unconditional
 * may-throw seeds. On zapo's protobuf bundle the reader/writer classes alone
 * are 9,594 of 23,359 seeds in the decode bodies (41.1%). This removes NO
 * exception epilogue on its own: computeMayThrow is per function and a body
 * keeps its epilogue while ANY seed remains, so the decode bodies stay
 * throwing until the namespace shape (4,108 seeds) and the 641 message shapes
 * (8,814) land too.
 *
 * WHAT IT CANNOT DO, AND WHY EACH IS A REFUSAL RATHER THAN A GUESS. Every one
 * of these was found by running the recognizer against the real bundle, not by
 * reading the plan:
 *
 *   - RUNTIME MERGES. protobufjs installs the 64-bit accessors with
 *     `merge(Reader.prototype, {int64, uint64, ...})` inside `_configure`, so
 *     they are absent from the statically visible prototype. A class that
 *     omits them has no slot for `r.int64()` to resolve against, and binding
 *     them statically is only sound if the merge PROVABLY ran. Neither is
 *     available here, so a class carrying mergedMethods is refused whole.
 *   - FOREIGN PROTOTYPE ALIASES. `s.prototype._slice = Array.prototype.subarray`
 *     is a METHOD reached by a second name whose body is a native intrinsic.
 *     Filing it as a data slot breaks `r._slice(...)`; refused whole.
 *   - SIBLING ALIASES are the one shape that IS resolved:
 *     `p.prototype.int64 = p.prototype.uint64` is two names for ONE body, and
 *     a second method-table entry pointing at that body is exactly right.
 *     Four of these in zapo's bundle (Writer's int64/sfixed32/sfixed64) and
 *     refusing them would drop Writer, which is most of the arm.
 *
 * NAMES COME FROM POSITION, NEVER FROM THE BINDING NAME. Minified bundles
 * reuse one-character identifiers across scopes: `n`, `o` and `s` EACH name
 * two distinct classes in zapo's bundle, and a name-keyed class merges one
 * chunk's methods with another chunk's fields -- a wrong shape that still
 * compiles. The IR name is `%pc<character offset>.<binding name>`, the same
 * shape classNamer already uses for class expressions (`%cx<start>`).
 */
import * as ts from "../ts7/adapter.js";
import type { IrType } from "../../ir/nodes.js";
import { locOf } from "../program.js";
import type { ClassInfo } from "./lower-classes.js";
import type { Lowerer } from "./lowerer.js";
import type { ProtoClass, ProtoMethod } from "./proto-class.js";
import { usableProtoClasses } from "./proto-class.js";
import { protoSlotTypes } from "./proto-class-synth.js";

/** Per-SourceFile recognizer results, keyed by the node a reference to the
 * class RESOLVES to. Two spellings reach one candidate:
 * `function S() {...}` (the FunctionDeclaration is the value declaration) and
 * `var S = function () {...}` (the VariableDeclaration is, and the recognizer's
 * `ctor` is its initializer), so both are keyed. */
const byFile = new WeakMap<ts.SourceFile, Map<ts.Node, ProtoClass>>();

function candidatesIn(sf: ts.SourceFile): Map<ts.Node, ProtoClass> {
  const cached = byFile.get(sf);
  if (cached) return cached;
  const m = new Map<ts.Node, ProtoClass>();
  for (const c of usableProtoClasses(sf)) {
    m.set(c.ctor, c);
    const p: ts.Node | undefined = c.ctor.parent;
    if (p && ts.isVariableDeclaration(p) && p.initializer === c.ctor) m.set(p, c);
  }
  byFile.set(sf, m);
  return m;
}

/** The recognized prototype-class a `new <expr>(...)` callee names, or null.
 * Resolution goes through the CHECKER's symbol rather than by name, which is
 * what keeps two same-named classes in different scopes apart. */
function protoClassOf(L: Lowerer, callee: ts.Expression): ProtoClass | null {
  if (!ts.isIdentifier(callee)) return null;
  const sym = L.resolveValueSymbol(callee);
  // 7's Symbol carries declarations as NodeHandles; the checker facade owns
  // the resolve into the client AST (never symbol.valueDeclaration directly).
  const decl = sym ? L.checker.valueDeclarationOf(sym) ?? L.checker.declarationsOf(sym)[0] : undefined;
  if (!decl) return null;
  // The DECLARATION's file, not the call site's: a class recognized in one
  // module and constructed from another still resolves.
  const cands = candidatesIn(decl.getSourceFile());
  return cands.get(decl) ?? null;
}

/** A sibling alias `C.prototype.a = C.prototype.b`, resolved to the method it
 * names. Returns null for anything else -- a foreign alias
 * (`Array.prototype.subarray`), a plain data value, an alias to a name this
 * class does not declare. */
function siblingAlias(c: ProtoClass, init: ts.Expression): ProtoMethod | null {
  if (!ts.isPropertyAccessExpression(init)) return null;
  const inner = init.expression;
  if (!ts.isPropertyAccessExpression(inner)) return null;
  if (inner.name.getText() !== "prototype") return null;
  if (!ts.isIdentifier(inner.expression) || inner.expression.text !== c.name) return null;
  return c.methods.find((m) => m.name === init.name.getText()) ?? null;
}

/** Why this recognized class still cannot become an IrClassDef, or null. */
function consumeBailout(c: ProtoClass): string | null {
  if (c.mergedMethods.length > 0) {
    return (
      `${c.mergedMethods.length} method(s) installed at RUN TIME by merge(prototype, {...}) ` +
      `(${c.mergedMethods.map((m) => m.name).join(", ")}): the class has no slot for them, and ` +
      "binding them statically is sound only if the merge provably ran"
    );
  }
  if (!c.ctor.body) return "the constructor has no body";
  for (const k of c.protoConsts) {
    if (siblingAlias(c, k.init) === null) {
      return (
        `prototype member '${k.name}' is neither a method nor a sibling alias of one ` +
        "(a foreign alias such as Array.prototype.subarray is a METHOD whose body is an " +
        "intrinsic, and filing it as a data slot breaks every call through it)"
      );
    }
  }
  return null;
}

export interface ProtoClassBuild {
  info: ClassInfo;
  /** Every method body to lower as `%<class>.<name>`, INCLUDING the sibling
   * aliases -- two names for one FunctionExpression, which lower as two module
   * functions over the same source body. */
  bodies: Map<string, ts.FunctionExpression>;
}

/** Build (once per Lowerer) the ClassInfo for a recognized prototype-class,
 * or null if it refuses. Registration is the caller's, because the two passes
 * register differently (see lower-classes.ts's arm). */
export function buildProtoClass(L: Lowerer, c: ProtoClass): ProtoClassBuild | null {
  if (consumeBailout(c) !== null) return null;

  const sf = c.ctor.getSourceFile();
  const className = L.qualify(sf, `%pc${c.ctor.getStart()}.${c.name}`);

  // SLOT TYPES. The checker types a this-property from the CONSTRUCTOR's
  // initializer alone -- prototype-method writes never widen it -- so a
  // checker-typed slot is one the first method write violates. protoSlotTypes
  // unions the initializer with every recorded method write.
  const slots = protoSlotTypes(
    {
      irTypeOf: (n) => L.irTypeOf(n),
      unionArms: (id) => L.unions.get(id)?.arms,
      internUnion: (arms) => L.unions.intern(arms),
    },
    c,
  );
  if (!slots.ok) return null;

  // METHOD SIGNATURES. lambdaSignature already accepts a FunctionExpression
  // and answers the same {shapes, funcType} a plain JS function gets, so
  // nothing about JS arity conventions is invented here.
  const methods: ClassInfo["methods"] = new Map();
  const bodies = new Map<string, ts.FunctionExpression>();
  const order: string[] = [];
  const addMethod = (name: string, fn: ts.FunctionExpression): boolean => {
    if (methods.has(name)) return false; // a duplicate name is the recognizer's bailout
    const sig = L.lambdaSignature(fn);
    // An async or generator prototype method would need its spawn wrapper and
    // its `gen` channel filled in; the recognizer has never produced one and
    // guessing the entry shape is exactly the silent-wrong-answer this path
    // refuses.
    if (fn.asteriskToken || sig.funcType.ret.kind === "generator") return false;
    methods.set(name, { params: sig.shapes, ret: sig.funcType.ret });
    bodies.set(name, fn);
    order.push(name);
    return true;
  };
  for (const m of c.methods) if (!addMethod(m.name, m.fn)) return null;
  // Sibling aliases AFTER the real methods, so the alias always finds its
  // target however the bundle ordered the two assignments.
  for (const k of c.protoConsts) {
    const target = siblingAlias(c, k.init);
    if (!target || !addMethod(k.name, target.fn)) return null;
  }

  const fieldTypes: [string, IrType][] = slots.slots.map((s) => [s.name, s.type]);
  const info: ClassInfo = {
    def: {
      name: className,
      jsName: c.name,
      fields: fieldTypes.map(([name, type]) => ({ name, type })),
      methods: order,
      loc: locOf(c.ctor),
    },
    fields: new Map(fieldTypes),
    // INITIALIZER MUST BE undefined. A prototype-class's field assignments are
    // STATEMENTS IN THE CONSTRUCTOR BODY and lower there; giving fieldOrder
    // real initializers would initialize every field twice.
    fieldOrder: fieldTypes.map(([name, type]) => ({ name, type, initializer: undefined })),
    methods,
    // No ts.ClassLikeDeclaration exists. classMethodMembers returns early on
    // this, which is CORRECT -- there are no decl.members to walk -- so the
    // method units register from `bodies` instead.
    decl: null,
    protoClass: true,
    ctor: c.ctor,
    ctorParams: L.lambdaSignature(c.ctor).shapes,
    base: null,
    subclasses: [],
    throwingSetters: [],
    staticFields: [],
  };
  return { info, bodies };
}

/** Is the prototype-class arm ON? `SCRIPTC_PROTOCLASS=1`.
 *
 * Read per call, not cached, so a test can score the same program in both
 * states in one process -- which is the only way the OFF state can be proved
 * to be today's behaviour rather than asserted to be.
 *
 * The blocker is NOT in this file and NOT in the recognizer. It is that a
 * class instance coerced into a DYN slot loses its methods: `use(new Box(7))`
 * where `use(x)` is an untyped JavaScript parameter throws
 * `x.get is not a function` while Node answers 7 -- measured on main, with a
 * DECLARED `class`, no part of this change involved. The per-use dyn box this
 * arm replaces dispatches that call correctly, so a default-on arm would take
 * a program from MATCH to WRONG. */
export function protoClassArmOn(): boolean {
  return process.env["SCRIPTC_PROTOCLASS"] === "1";
}
/** Reentrancy guard. Building a class asks the checker for the type of every
 * field initializer and every method write, and one of those can name the very
 * class being built (`this.next = this`) -- which re-enters the type hook. A
 * class in progress answers null, exactly as a refusal does, so the inner site
 * keeps the dyn lowering it would have had; the OUTER build still completes and
 * every later site sees the class. */
const building = new WeakSet<ts.Node>();

/** Build-and-register once per Lowerer, keyed by the constructor node.
 * Discovery and emit are separate Lowerer instances, so each builds its own --
 * the IR name is minted from the constructor's character offset, which is why
 * they agree. */
function registered(L: Lowerer, c: ProtoClass): ClassInfo | null {
  const hit = L.protoClassByCtor.get(c.ctor);
  if (hit !== undefined) return hit;
  if (building.has(c.ctor)) return null;
  building.add(c.ctor);
  let built: ProtoClassBuild | null = null;
  try {
    built = buildProtoClass(L, c);
  } catch {
    // A slot type the checker cannot map, a signature that does not lower: the
    // per-use dyn box below the arm is still a CORRECT lowering, so a refusal
    // here costs size and never an answer.
    built = null;
  } finally {
    building.delete(c.ctor);
  }
  L.protoClassByCtor.set(c.ctor, built?.info ?? null);
  if (!built) return null;
  L.classes.set(built.info.def.name, built.info);
  L.protoClassBodies.set(built.info.def.name, built.bodies);
  // The registration a CLASS EXPRESSION gets, and for the same reason: this is
  // a class collected WHILE A BODY LOWERS. The emit pass drains exprClasses;
  // the discovery pass registers the member units through onExprClassCollected
  // the moment collection finishes, before any edge to them can fire. A method
  // that never becomes a unit is pruned and then fails validation at its call
  // -- tests/harness/proto-class-methods.test.ts is the guard.
  L.exprClasses.push(built.info);
  L.onExprClassCollected?.(built.info);
  return built.info;
}

/** The `new K(a)` arm's resolver: the registered ClassInfo for this callee, or
 * null. */
export function protoClassInfoFor(L: Lowerer, callee: ts.Expression): ClassInfo | null {
  const c = protoClassOf(L, callee);
  return c ? registered(L, c) : null;
}

/** mapType's hook (MapCtx.protoClassInstance): the object type for instances of
 * a recognized prototype-class, given the declaration the checker resolved.
 *
 * THIS IS THE HALF THAT MAKES THE ARM WORTH ANYTHING, and it was measured, not
 * predicted: with the arm alone the class is built and registered and NOTHING
 * is typed at it. The checker types `this` inside the constructor, the result
 * of `new S(b)`, and every narrowed binding nominally against the FUNCTION's
 * declaration -- a node the ClassDeclaration arm in types.ts does not admit --
 * so `this.buf = b` fell all the way to "assignment to non-variables" (a
 * poisoned constructor that threw at run time) and every `inst.m()` stayed a
 * dynInvoke over the boxed prototype. */
export function protoClassInstanceType(L: Lowerer, decl: ts.Node): IrType | null {
  // Gated with the arm, so the feature is INERT when off rather than merely
  // unused: an ungated hook would still map instance types to a synthesized
  // class and change what a program compiles to with the arm switched off.
  if (!protoClassArmOn()) return null;
  const c = candidatesIn(decl.getSourceFile()).get(decl);
  if (!c) return null;
  const info = registered(L, c);
  return info ? { kind: "object", className: info.def.name } : null;
}

/** The receiver type for `this` inside a SYNTHESIZED prototype-class body,
 * or null anywhere else.
 *
 * The checker cannot supply it. MEASURED under checkJs: for
 * `function Box(v) { this.v = v }` it answers `this: any`, which maps to
 * nothing -- so `this.v = v` reached neither the field path nor the dyn keyed
 * path and fenced as "assignment to non-variables", lowering the constructor
 * as a guaranteed throw while the class, its struct and its `new` site were
 * all correct. The body's `this` LOCAL does carry the type (declareThis sets
 * it to the class's object type); this is that value, read as a type.
 *
 * Narrow on purpose: only the `this` KEYWORD, only inside a class this module
 * synthesized, and only where the checker answered nothing at all. A declared
 * class's `this` is typed by the checker already and keeps that path. */
export function protoThisType(L: Lowerer, node: ts.Node): IrType | null {
  return node.kind === ts.SyntaxKind.ThisKeyword && L.currentClass?.protoClass === true
    ? { kind: "object", className: L.currentClass.def.name }
    : null;
}
/** Every recognized prototype-class in a file, for SCRIPTC_PROTOCLASS_WHY and
 * for tests. Re-exported here so a caller needs one import. */
export { usableProtoClasses };
