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
import { BOOL, F64, STRING, type IrExpr, type IrFunction, type IrLocal, type IrType } from "../../ir/nodes.js";
import { locOf } from "../program.js";
import { pinnableSlot, type ClassInfo } from "./lower-classes.js";
import type { Lowerer } from "./lowerer.js";
import type { ProtoClass, ProtoMethod } from "./proto-class.js";
import { usableProtoClasses } from "./proto-class.js";
import { cjsModuleExportsDecl, dtsWitnessClassOf, requiredTwinOf } from "./lower-twin-witness.js";
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

/** The specifier of `const X = require('spec')` a binding was declared by, or null. */
function requireSpecOf(L: Lowerer, sym: ts.Symbol): string | null {
  for (const d of L.checker.declarationsOf(sym)) {
    if (!ts.isVariableDeclaration(d) || d.initializer === undefined) continue;
    const init = d.initializer;
    if (ts.isCallExpression(init) && ts.isIdentifier(init.expression) && init.expression.text === "require" &&
        init.arguments[0] !== undefined && ts.isStringLiteralLike(init.arguments[0])) return init.arguments[0].text;
  }
  return null;
}

/** The specifier of the file-level `const <callee> = require('spec')` the callee
 * names, when the checker has already followed the binding to the module. Only a
 * single such declaration in the callee's file counts. */
function requireSpecOfName(callee: ts.Identifier): string | null {
  const specs: string[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === callee.text &&
        n.initializer !== undefined && ts.isCallExpression(n.initializer) &&
        ts.isIdentifier(n.initializer.expression) && n.initializer.expression.text === "require" &&
        n.initializer.arguments[0] !== undefined && ts.isStringLiteralLike(n.initializer.arguments[0])) {
      specs.push(n.initializer.arguments[0].text);
    }
    ts.forEachChild(n, visit);
  };
  visit(callee.getSourceFile());
  return specs.length === 1 ? specs[0]! : null;
}

/** The declaration a constructor callee names. A binding bound by require() is
 * an alias (`const Long = require('long')`): the declaration is the value the
 * module assigns with `module.exports = X`, read through the checker. */
function ctorDeclOf(L: Lowerer, callee: ts.Expression): ts.Node | null {
  if (!ts.isIdentifier(callee)) return null;
  let sym = L.resolveValueSymbol(callee) ?? L.checker.getSymbolAtLocation(callee) ?? undefined;
  // The require() specifier, read off the binding before the alias is followed.
  const spec = (sym ? requireSpecOf(L, sym) : null) ?? requireSpecOfName(callee);
  if (sym && (sym.flags & ts.SymbolFlags.Alias) !== 0) sym = L.checker.getAliasedSymbol(sym);
  if (sym === undefined || sym === null) return null;
  // 7's Symbol carries declarations as NodeHandles; the checker facade owns
  // the resolve into the client AST (never symbol.valueDeclaration directly).
  const decl = L.checker.valueDeclarationOf(sym) ?? L.checker.declarationsOf(sym)[0] ?? null;
  // A required MODULE (the checker answers its source file): the value is what
  // the module assigns to module.exports, read from its compiled twin.
  if (decl !== null && ts.isSourceFile(decl)) {
    // The runtime file is the require branch's JS (requiredTwinOf), not the
    // checker's import-condition declaration twin.
    const js = decl.isDeclarationFile && spec !== null ? requiredTwinOf(L, decl, spec) : null;
    const twin = js ?? (decl.isDeclarationFile ? L.declTwinSourceOf(decl) : decl);
    return twin ? cjsModuleExportsDecl(L, twin) : null;
  }
  return decl;
}

/** The recognized prototype-class a `new <expr>(...)` callee names, or null.
 * Resolution goes through the CHECKER's symbol rather than by name, which is
 * what keeps two same-named classes in different scopes apart. */
function protoClassOf(L: Lowerer, callee: ts.Expression): ProtoClass | null {
  const decl = ctorDeclOf(L, callee);
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
  // `P.m` where P is an alias of `C.prototype` (`var P = C.prototype`).
  if (ts.isIdentifier(inner)) {
    const aliased = c.aliases.some((a) =>
      a.name === inner.text && init.getStart() >= a.scope.getStart() && init.getEnd() <= a.scope.getEnd());
    if (!aliased) return null;
    return c.methods.find((m) => m.name === init.name.getText()) ?? null;
  }
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

  // Method and static RETURNS keep the checker's type (dyn). A typed instance
  // return was tried (returnsOwnInstance) and REGRESSED a compiling shape: an
  // object value stored in a dyn binding loses its prototype link, so
  // `const q = Point.make(5, 6); q instanceof Point` printed false where Node and
  // the base compiler print true. Typing returns waits for an object-to-dyn
  // crossing that keeps the prototype.
  const instanceRet = (_fn: ts.FunctionExpression | ts.FunctionDeclaration, ret: IrType): IrType => ret;

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
    methods.set(name, { params: sig.shapes, ret: instanceRet(fn, sig.funcType.ret) });
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

  // Static functions: module functions reached as `C.m(...)`, with no receiver.
  // Their bodies may not name `this` (lowerStaticMethod refuses it).
  const staticMethods: NonNullable<ClassInfo["staticMethods"]> = new Map();
  for (const s of c.staticFns) {
    const sig = L.lambdaSignature(s.fn as ts.FunctionExpression);
    if (sig.funcType.ret.kind === "generator") return null;
    // The checker types a JavaScript `return new C(...)` as any; when every return
    // of the static is such a construction, its result IS an instance of this class.
    const ret: IrType = instanceRet(s.fn, sig.funcType.ret);
    staticMethods.set(s.name, { params: sig.shapes, ret, member: s.fn as unknown as ts.MethodDeclaration });
  }

  const fieldTypes: [string, IrType][] = slots.slots.map((s) => [s.name, s.type]);
  // Each slot's constructor initializer is a dyn-pin candidate exactly like an
  // inferred field of a declared class (see DynPins): a pre-class constructor's
  // `this.v = v` is an UNANNOTATED inference, and untyped code may write or
  // delete it.
  for (const s of slots.slots) {
    if (s.initializer !== undefined && pinnableSlot(L, s.type)) L.noteInferredField(className, s.name, s.type, s.initializer);
  }
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
    staticMethods,
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

/** Constant prototype data of each registered prototype-class, by its IR class name. */
const protoDataByClass = new Map<string, Map<string, ts.Expression>>();

/** The literal value a prototype-class instance reads for `name` when it has
 * no own slot of that name: the prototype's constant, lowered in place. Null when
 * the class has no such prototype data. */
export function protoDataReadOf(L: Lowerer, className: string, name: string): IrExpr | null {
  const init = protoDataByClass.get(className)?.get(name);
  if (init === undefined) return null;
  return L.lowerExpr(init);
}

/** Is `name` prototype data of any recognized prototype-class in the program? */
export function protoDataNameAnywhere(name: string): boolean {
  for (const m of protoDataByClass.values()) if (m.has(name)) return true;
  return false;
}

/** The names of a class's prototype data (constants it answers by inheritance). */
export function protoDataNamesOf(className: string): string[] {
  return [...(protoDataByClass.get(className)?.keys() ?? [])];
}

/** The prototype's constant data of a class as dyn-readable member getters. A
 * boxed instance reads `obj.name` through the member table, and the table has no
 * row for a name the prototype (not the instance) holds, so the read answered
 * undefined where Node answers the constant (`Object.defineProperty(P, 'isPoint',
 * { value: true })`). Each constant becomes a synthesized `%C.get:name` accessor
 * (non-enumerable, as a defineProperty default is) that the class lists in its
 * dynMethods. Returns [] when the class has no prototype data. */
export function protoDataGetterFns(info: ClassInfo): IrFunction[] {
  const data = protoDataByClass.get(info.def.name);
  if (data === undefined) return [];
  const className = info.def.name;
  const thisType: IrType = { kind: "object", className };
  const out: IrFunction[] = [];
  for (const [name, init] of data) {
    const loc = locOf(init);
    let lit: IrExpr;
    if (ts.isNumericLiteral(init)) lit = { kind: "numLit", value: Number(init.text), type: F64, loc };
    else if (ts.isStringLiteralLike(init)) lit = { kind: "strLit", value: init.text, type: STRING, loc };
    else if (init.kind === ts.SyntaxKind.TrueKeyword) lit = { kind: "boolLit", value: true, type: BOOL, loc };
    else if (init.kind === ts.SyntaxKind.FalseKeyword) lit = { kind: "boolLit", value: false, type: BOOL, loc };
    else throw new Error(`emitter bug: prototype datum '${name}' is not a literal the recognizer accepts`);
    const locals: IrLocal[] = [{ id: "this.0", name: "this", type: thisType, mutable: false }];
    out.push({
      name: `%${className}.get:${name}`,
      params: [{ localId: "this.0", name: "this", type: thisType }],
      returnType: lit.type,
      locals,
      body: [{ kind: "return", value: lit, loc }],
      loc,
    });
  }
  return out;
}

/** The export= / require pairing lowering is ON (its env gate SCRIPTC_PAIRED_CLASS is
 * removed). A declaration-file class paired with the constructor another module
 * declares (`export =`, or a require binding) lowers as that constructor's protoclass
 * object. Its instances keep the prototype's data through dyn boxes, and a read or
 * test the lowering cannot place statically refuses (SC1090) rather than answering
 * the absent value. Measured on the probes in ~/sc/blocks/longpair/lab (C and LLVM). */
export function pairedClassEnabled(): boolean {
  return true;
}

/** The ClassInfo a value expression names when that value is a declaration-file
 * class paired with a constructor the program compiles (`export =`, or a require
 * binding to one), or null. */
export function pairedProtoClassOfValue(L: Lowerer, rhs: ts.Expression): ClassInfo | null {
  if (!pairedClassEnabled() || !ts.isIdentifier(rhs)) return null;
  let sym = L.checker.getSymbolAtLocation(rhs) ?? L.resolveValueSymbol(rhs) ?? undefined;
  if (sym === undefined || sym === null) return null;
  if (sym.flags & ts.SymbolFlags.Alias) sym = L.checker.getAliasedSymbol(sym) ?? undefined;
  if (sym === undefined) return null;
  const decls = L.checker.declarationsOf(sym);
  // The module's own value: the twin's constructor function, when that function
  // is what its file assigns to module.exports (the value a require binds).
  if (decls.length === 1 && ts.isFunctionDeclaration(decls[0]!) && !decls[0]!.getSourceFile().isDeclarationFile &&
      decls[0]!.getSourceFile() !== rhs.getSourceFile()) {
    const fn = decls[0]!;
    if (cjsModuleExportsDecl(L, fn.getSourceFile()) !== fn) return null;
    const c = candidatesIn(fn.getSourceFile()).get(fn);
    return c ? registered(L, c) : null;
  }
  if (decls.length === 0 || !decls.every((d) => ts.isClassDeclaration(d) && d.getSourceFile().isDeclarationFile)) return null;
  const w = dtsWitnessClassOf(L, L.checker.getDeclaredTypeOfSymbol(sym));
  if (!w || !ts.isFunctionDeclaration(w)) return null;
  const c = candidatesIn(w.getSourceFile()).get(w);
  return c ? registered(L, c) : null;
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
  if (c.protoData.length > 0) {
    protoDataByClass.set(built.info.def.name, new Map(c.protoData.map((d) => [d.name, d.value] as const)));
  }
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

/** The instance type of a constructor function paired with a declaration-file
 * class through `export =` (lower-twin-witness.ts). NOT gated by the arm: the
 * pairing is the reason the class exists, and it is only present when a
 * declaration file names the twin's `module.exports` value. */
export function pairedProtoInstanceType(L: Lowerer, decl: ts.Node): IrType | null {
  if (!pairedClassEnabled()) return null;
  const c = candidatesIn(decl.getSourceFile()).get(decl);
  if (!c) return null;
  const info = registered(L, c);
  return info ? { kind: "object", className: info.def.name } : null;
}

/** The ClassInfo a `new X(...)` whose instance type is a paired declaration-file
 * class constructs, or null. The callee's instance type is read from the checker
 * (the d.ts class), not from the callee's own declaration. */
export function pairedProtoClassInfoFor(L: Lowerer, expr: ts.NewExpression): ClassInfo | null {
  if (!pairedClassEnabled()) return null;
  // The value the callee names: a require() binding is the module's value
  // (the JS twin's constructor), which needs no declaration-file type at all.
  // Only a constructor REACHED THROUGH A require() binding: an in-program
  // function constructor (a bundle's `function s(){}`) is not a declaration-file
  // pairing, and recognizing it here would turn a compiling `new s()` into a
  // refusal (measured on the mysql2 rig through zapo-js's protobuf bundle).
  const viaValue = ctorDeclOf(L, expr.expression);
  // A constructor the program declares in the SAME file is not a pairing: only one
  // another module declares (the require's twin) pairs with the declaration file.
  const crossFile = viaValue !== null && viaValue.getSourceFile() !== expr.expression.getSourceFile();
  if (crossFile && viaValue !== null && ts.isFunctionDeclaration(viaValue)) {
    const c = candidatesIn(viaValue.getSourceFile()).get(viaValue);
    if (c) return registered(L, c);
  }
  // Otherwise the d.ts instance type pairs the class (export =).
  const w = dtsWitnessClassOf(L, L.typeOf(expr));
  if (!w || !ts.isFunctionDeclaration(w)) return null;
  const c = candidatesIn(w.getSourceFile()).get(w);
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
