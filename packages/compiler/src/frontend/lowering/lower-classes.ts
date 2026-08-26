/* Class lowering: shape collection over the single-inheritance graph
 * (fields, methods, accessors, overrides), constructor/member lowering with
 * synthesized derived ctors and field initializers, super calls and super
 * accessor access, upcasts, `new` expressions, and the builtin Error
 * hierarchy registration. */
import * as ts from "../ts7/adapter.js";
import type { Lowerer } from "./lowerer.js";
import { BOOL, CLASS_PROPS_FIELD as IR_CLASS_PROPS_FIELD, DYN, F64, bytesOf, IrClassDef, IrExpr, IrFunction, IrLocal, IrParam, IrStmt, IrType, JSVAL, RUNTIME_EMITTER_CLASS, RUNTIME_ERROR_CLASSES, RUNTIME_STREAM_CLASSES, STRING, SrcLoc, UNDEFINED_T, URL_T, VOID, arrayOf, isRefCounted, isSupportedMapKey, isSupportedMapValue, isSupportedSetElem, isUnitType, mapOf, setOf, typeEquals } from "../../ir/nodes.js";
import { lowerAbortControllerNew } from "./lower-abort.js";
import { MAX_GENERIC_INSTANCES, bindingNeverReassigned, genericCallInstance, implicitAnyParamSymbolsOf, implicitCallInstance, implicitMonoFile, omittedArgFor, type GenericFnInfo, type ParamShape } from "./lower-calls.js";
import { isGenericCallableMemberType, runtimeStreamClassOf, typeKey } from "../types.js";
import { cjsClassExprWholeExportOf, isCjsJsFile, isJsSourceFile, isModuleExportsAccess, locOf } from "../program.js";
import { PoisonError, dynFallbackType, dynUndefinedExpr, newFnCtx, own } from "./lowerer.js";
import { bufEncoding, lowerMapCloneNew, lowerMapSeedArrayNew } from "./lower-containers.js";
import { fnOwnCounters, fnOwnPropBox, fnOwnWhy, probeLower, pureReemittable } from "./lower-exprs.js";
import { lowerSearchParamsNew } from "./lower-builtins.js";
import { requiresDynamicPackageDiag, unsupportedDiag } from "../../diagnostics/diagnostic.js";
import { lowerSqliteNew } from "./lower-sqlite.js";
import { STREAM_API_MEMBERS, STREAM_PROP_MEMBERS, UNDERSCORE_METHODS, lowerStreamNew, lowerStreamSuperCall, streamCtorShape } from "./lower-stream.js";
import { erasableSuperDelegation } from "./lower-emitter.js";
import { emitOverrideShapeReason, emitSpecSuperForward, emitterRooted, lowerEmitterSuperCall, type EmitOverrideRec } from "./lower-emitter.js";
import { declSymbolOf } from "./lower-modules.js";
import { uniqueSymbolKeyOf } from "./lower-exprs.js";
import { lowerHttpAgentNew, lowerHttpServerNew } from "./lower-server.js";
import { ambientNsRootOf, ambientUndefReadType, ambientUndefVarRootOf, ambientUndefinedClassSymbolOf, ambientUndefinedFnSymbolOf, fenceEarlyAliasUse, fenceEarlyNsMemberRef, nsMemberIdentOf, nsUndefRead } from "./lower-namespaces.js";
import { mixinResultBindingClassOf, type MixinInstanceInfo } from "./lower-mixins.js";

/** The weak collections' constructor hints. Shared: the stdlib `new`
 * chokepoint reads them out of its ctorHints table, and the Map branch —
 * which claims the WeakMap symbol so a class-instance-keyed WeakMap can
 * ride the identity Map — routes the non-riding shapes here rather than
 * report them as Map key errors. */
const WEAK_COLLECTION_HINTS = {
  WeakMap: "weak collections observe garbage collection, which reference counting never exposes — a strong Map behaves identically in-language: use Map",
  WeakSet: "weak collections observe garbage collection, which reference counting never exposes — a strong Set behaves identically in-language: use Set",
} as const;

export interface ClassInfo {
  def: IrClassDef;
  /** ALL fields visible on instances — the inherited ones included — for
   * receiver-side lookup (def.fields carries the layout order). */
  fields: Map<string, IrType>;
  /** OWN fields only (declaration order) with their initializers: the
   * class's constructor runs exactly these — inherited fields initialize in
   * the base constructor, before/via super(). */
  fieldOrder: { name: string; type: IrType; initializer: ts.Expression | undefined; /** Redeclared INHERITED field: the initializer assigns the base slot at this position; no new slot (def.fields excludes it). */ redeclared?: true }[];
  /** OWN declared methods only — inherited lookups walk the base chain
   * (findMethodOn). An `abstract` entry is a signature with no body (and
   * no module function): it declares the vtable slot; concrete subclasses
   * fill it (tsc guarantees every instantiable class implements).
   * #PRIVATE members key by their spelled name ('#m', "get:#x") — no
   * public identifier can collide, subclass redeclarations of an
   * inherited private name are fenced at collection, and tsc confines
   * every access site to the declaring class's body, so the base-chain
   * walk IS lexical resolution and privates never join vtables (JS's
   * no-dynamic-dispatch semantics by construction). A `gen` entry is a
   * #private GENERATOR method: the body is a generator IrFunction and
   * calls enter through its gen-spawn wrapper. */
  methods: Map<string, { params: ParamShape[]; ret: IrType; abstract?: true; async?: true; gen?: { yieldT: IrType; nextT: IrType } }>;
  /** OWN GENERIC instance methods (own type parameters — `m<T>(x: T)`),
   * monomorphized per call site like top-level generic functions: instance
   * `n` is the module function `%C.m%n` taking `this` as param 0. They
   * never enter `methods` (no single ABI signature, no vtable slot), so
   * dispatch is STATIC — calls resolve the nearest declarer on the
   * receiver's static class, and a receiver whose runtime class could
   * override (genericOverrideBelow) must be exact or fences. Inherited
   * lookups walk the base chain (findGenericMethodOn). */
  genericMethods?: Map<string, GenericFnInfo>;
  /** OWN GENERIC static methods — `%C.static:m%n` module functions, the
   * generic twin of staticMethods (same this/super fence, same
   * through-a-VALUE shadowing rules via staticShadowBelow). */
  genericStatics?: Map<string, GenericFnInfo>;
  /** DEFERRED-INIT fields (inherited included, like `fields`): a
   * `stream!: T` definite-assignment assertion (or an SPI-off
   * initializer-less field) whose first assignment happens past the
   * constructor's top level. The SLOT is the undefined-armed union —
   * allocation writes the interned undefined, exactly Node's
   * pre-assignment read — writes wrap into the arm, and every READ is a
   * CHECKED extraction back to the declared type: a genuinely
   * unassigned read throws the catchable TypeError instead of yielding
   * an undefined the declared type cannot hold (SEMANTICS.md). */
  deferredInitFields?: Set<string>;
  /** JS instance properties this class has ONLY because the constructor
   * scan COLLECTED them: assigned in a method, or in a conditional
   * constructor position, and never declared in the class body. They are
   * the only fields whose slot can be occupied while the PROPERTY does not
   * exist -- Node creates it at the first write -- so they are the only
   * ones for which `k in instance` has to read the slot's undefined arm
   * instead of folding to the layout's constant `true`.
   *
   * A DECLARED field is not one of these, and the distinction is the whole
   * point. `class D { optional?: string }` defines `optional` on every
   * instance as `undefined` under class-fields semantics, so Node answers
   * `true` for it before anything is assigned; tests/corpus/4272 asserts
   * exactly that, and an `in` rule keyed on "the slot has an undefined
   * arm" got it wrong. Inherited entries are carried down like
   * deferredInitFields'. */
  collectedFields?: Set<string>;
  /** The subset of `collectedFields` whose undefined arm means ABSENT and
   * nothing else — the slots every ENUMERATION surface has to skip while
   * the arm is live, because in Node the property does not exist until its
   * write runs (`util.inspect` prints `C { a: 1 }`, not
   * `C { a: 1, b: undefined }`).
   *
   * Membership is decided by the program's ASSIGNMENTS, not by the
   * property's type — see undefArmIsAbsenceOnly and
   * undefWrittenPropNames. The checker's own type cannot decide it: tsc
   * arms a conditionally-assigned JS property itself (`if (f) this.b = 2`
   * types `b` as `number | undefined`), so an undefined arm there says
   * "the write may not have run", which is the very thing the slot
   * represents rather than evidence against it.
   *
   * The two kinds deliberately left out both keep printing the arm,
   * because a wrong answer in the other direction is no better than the
   * one this fixes:
   *
   *   - a CHECKED-DYNAMIC slot (the implicit-`any` field —
   *     `this._connectionCallback = callback`), where `undefined` is a dyn
   *     KIND that an explicit `obj.connect(undefined)` writes just as the
   *     initializer does, and nothing distinguishes them;
   *   - a name some assignment ANYWHERE in the program can store
   *     undefined into, including from outside the class.
   *
   * Inherited entries seed from the base like `collectedFields`. */
  absentTrackedFields?: Set<string>;
  /** null for the builtin error classes (runtime-provided; no source).
   * Class EXPRESSIONS carry their ts.ClassExpression here — members,
   * accessors, and locs read identically off either form. */
  decl: ts.ClassLikeDeclaration | null;
  /** Runtime-provided builtin (the Error hierarchy): no bodies lower, `new`
   * and super() calls become error.* libCalls, toString is the runtime's. */
  builtinError?: true;
  /** Runtime-provided node:events EventEmitter: no bodies lower, `new` and
   * super() become emitter.* libCalls, and the whole method surface
   * (on/emit/...) lowers through lower-emitter.ts over any class rooted
   * here. Subclass structs embed the ScrEmitter prefix. */
  builtinEmitter?: true;
  /** Runtime-provided node:stream class (Readable/Writable/Duplex/
   * Transform/PassThrough — emitter-rooted): no bodies lower, `new`
   * becomes a stream constructor libCall, the stream method/property
   * surface lowers through lower-stream.ts, and the emitter surface rides
   * the base chain. The value names which SIDES the class carries. User
   * `extends` of these classes is fenced at the declaration (phase 1). */
  builtinStream?: "r" | "w" | "rw";
  /** This class's own `emit` override in the FORWARDING SHAPE (the one
   * EventEmitter member a subclass may re-declare): never in `methods` —
   * emit calls keep routing through the emitter spoke, which lowers the
   * body once per event name as the specialization method `emit:<event>`
   * (lower-emitter.ts's emit-overrides block has the whole story). */
  emitOverride?: EmitOverrideRec;
  ctor: ts.ConstructorDeclaration | null;
  /** PARAMETER PROPERTIES (`constructor(public x: number)`), in parameter
   * order: each declares a field (placed BEFORE the class's declared
   * fields in the layout — Node's transform hoists the definitions to the
   * top of the class body, verified) and assigns it from the parameter's
   * body local AFTER the field initializers run (Node's order: super() →
   * field initializers → parameter-property assignments → ctor body). */
  paramProps?: { name: string; type: IrType; param: ts.ParameterDeclaration }[];
  /** EFFECTIVE constructor params: the own constructor's, or (constructor
   * omitted) the base's — `new Derived(...)` is typed by tsc against the
   * inherited signature, and the synthesized constructor forwards to it
   * (forwarding the completed ABI values; defaults apply in the base). */
  ctorParams: ParamShape[];
  base: ClassInfo | null;
  /** DIRECT subclasses, filled as derived classes collect — the frontend's
   * side of whole-program devirtualization (overrideBelow). */
  subclasses: ClassInfo[];
  /** Property names whose setter this class SYNTHESIZES as a throw: a
   * getter-only override shadows an inherited get/set pair in JS, so a
   * base-typed write reaches this class and throws TypeError (Node's
   * behavior, matched exactly — see collectClassShape). */
  throwingSetters: string[];
  /** STATIC fields with initializers — the honest static subset: each is
   * a module global (`%g.s.<C>.<name>`), assigned once in the declaring
   * file's %init at the class statement's source position (exactly when
   * JS evaluates static initializers, so an initializer reading earlier
   * module bindings sees their values), and read as `C.name` anywhere
   * (lowerStaticFieldRead). Writable (non-readonly) fields are MUTABLE
   * globals; writes lower only through the DECLARING class's own name
   * (`D.x = v` where x is inherited creates an OWN property on D in JS —
   * different storage — and writes through class VALUES would need the
   * same dynamic story: both are named fences). Accessors and
   * initializer-less fields keep the fence. */
  staticFields: { name: string; type: IrType; initializer: ts.Expression; globalId: string; readonly: boolean }[];
  /** STATIC methods — ordinary module functions named `%C.static:m` (the
   * accessor-colon trick: no user identifier can spell it, and statics
   * never join vtables, so IrClassDef doesn't know them). `C.m(args)` is
   * a direct call; `const f = C.m` a zero-capture closure; calls through
   * class VALUES devirtualize when no strict descendant redeclares the
   * member. `this`/`super` inside fence at lowering (JS binds `this` to
   * the RECEIVER class — dynamic). Absent on builtin classes. */
  staticMethods?: Map<string, { params: ParamShape[]; ret: IrType; member: ts.MethodDeclaration }>;
  /** `static { ... }` blocks, in declaration order. They are DECLARATION-TIME
   * CODE, not shape: JS runs each block once when the class statement
   * evaluates, whether or not anything ever references the class — so their
   * statements lower into the declaring file's %init at the class statement's
   * source position, interleaved with the static field initializers in member
   * order (lowerStaticFieldInits). `this` inside a block (the class
   * constructor value — no value form here) fences at collection. Absent on
   * builtin classes and classes without blocks. */
  staticBlocks?: ts.ClassStaticBlockDeclaration[];
  /** SYMBOL-KEYED fields (`this[kLimit] = v` where kLimit is a module-level
   * `const k = Symbol(...)`): the key's unique-symbol identity is a
   * compile-time constant, so each key resolves to an ORDINARY hidden slot
   * in the static layout — no runtime symbol table exists. The map goes
   * key-symbol → layout field name (`Symbol(limit)`, Node's inspect
   * spelling); inherited entries are seeded from the base like `fields`.
   * Absent on builtin classes and classes with no symbol-keyed fields. */
  symbolFields?: Map<ts.Symbol, string>;
  /** The subset of `symbolFields` declared by an `Object.defineProperty`
   * HIDDEN data descriptor (`enumerable: false`) rather than by a
   * constructor assignment — non-enumerable own symbol properties, which
   * Node's inspect omits and object spread does not copy. Layout-wise they
   * are ordinary slots; only their OBSERVABILITY differs, so every
   * enumeration path reads this set. Inherited entries seed from the base
   * like `symbolFields`. */
  hiddenSymbolFields?: Set<string>;
  /** True when the class carries the RUN-TIME property table — the single
   * `%props` field an `Object.defineProperty(<an instance>, <a
   * string-typed key>, desc)` site somewhere in the program needs
   * (definePropTableSiteOf's shape; zapo's `install.ts:114`). Set on
   * every class in the hierarchy that declares it and inherited by
   * subclasses with the field, because the table is per INSTANCE.
   *
   * Every surface that could answer a property question about an
   * instance has to read it once this is true: `in` (both the literal
   * and the run-time key), and util.inspect. The others — Object.keys,
   * for-in, spread, JSON.stringify, getOwnPropertyNames, delete,
   * hasOwnProperty — refuse over a class receiver today and keep
   * refusing, which is what keeps the slice exact rather than partial.
   * If one of them ever gains a lowering, this flag is what it has to
   * consult. */
  hasPropsTable?: boolean;
  /** GENERIC class FAMILY (`class Box<T>` itself): the synthetic,
   * never-constructed ancestor every instantiation extends. It owns what
   * JS's one runtime `Box` owns — the statics (one storage location for
   * every instantiation) and the `instanceof Box` interval — and declares
   * no fields, no instance methods, no constructor function. Construction
   * and instance types resolve to instantiations instead (`generic`
   * carries the instance table). */
  generic?: GenericClassInfo;
  /** GENERIC class INSTANTIATION (`Box%0` for `Box<number>`): the family,
   * the type-parameter bindings member lowering runs under (the
   * generic-fn typeParamResolver mechanism), the rendered type arguments
   * for diagnostics, and the demand ordinal (only the FIRST instantiation
   * counts statements toward coverage — re-instantiations re-visit the
   * same source lines). */
  genericInstance?: { family: ClassInfo; bindings: Map<ts.Symbol, IrType>; typeArgsText: string; ordinal: number };
  /** MIXIN instantiation (`%mx<start>.<name>` for `M(Base)` at one call
   * site): the call that minted it, the base-parameter type binding its
   * members lower under, the forwarding-constructor flag, and where its
   * static declaration-time code emits (lower-mixins.ts). */
  mixinInstance?: MixinInstanceInfo;
  /** CLASS decorators (`@dec class C`) — standard (TC39 stage-3 / TS 5+)
   * semantics, lowered statically as declaration-time CALLS in %init at
   * the class statement's position: decorator expressions evaluate in
   * source order, applications run in REVERSE order over the class object,
   * and static field initializers/blocks run AFTER the applications (the
   * verified Node order). Present exactly when the declaration carries
   * class-level decorators; `shapes` fills in the post-collection analysis
   * pass (a decorator's return type may name a subclass declared BELOW the
   * class, so analysis cannot run while shapes are still collecting). */
  classDecorators?: ClassDecorationInfo;
  /** The class's DEFINITION provably throws before anything else in it
   * evaluates: the first effectful item in TC39 evaluation order — class
   * decorators, then heritage, then member decorators and computed keys
   * interleaved — is a name nothing defines, and Node erases the
   * declaration, so the read is a ReferenceError. `via` says which item:
   * an AMBIENT DECORATOR name (`@dec` over `declare let dec: any`), or an
   * `extends` clause naming an ambient `declare class`. Both throw at the
   * class statement, so both take the same shell.
   *
   * The class registers as an empty SHELL: no members collect (nothing
   * after the throw ever runs — member fences would be fences on dead
   * code), the %init at the class statement is exactly the throw, and
   * every VALUE use (new, the class as a value, extends, a static read)
   * fences — the binding never initializes, so compiled code can never
   * legitimately reach one. */
  decorationThrows?: { name: string; via: "decoration" | "extends clause" };
}

/** A decorated class's decoration state (see ClassInfo.classDecorators). */
export interface ClassDecorationInfo {
  /** The class-level decorator nodes, source order. The HERITAGE clause
   * appears here in exactly one shape: the guaranteed-throw shell, whose
   * single entry pairs with an `ambientThrow` and is used only for its
   * source location (`extends <ambient class>` throws where the class
   * statement stands, and no decorator is involved). No analysis path
   * ever sees it — the shell publishes `shapes`, and analyzeClassDecoration
   * returns on any info that already has them. */
  nodes: (ts.Decorator | ts.ExpressionWithTypeArguments)[];
  /** Per-decorator analysis (parallel to `nodes`). `call`: the decorator
   * expression's completed function type — the type its VALUE lowers to
   * and the ABI the application call dispatches — and whether it can
   * REPLACE the class (return type is the class or a subclass, per the
   * classval flow rule) rather than returning void/undefined.
   * `ambientThrow`: the decorator names an ambient declaration NOTHING
   * defines (`declare let dec: any`, `declare function dec<T>(t: T): T`)
   * — Node erases it, so evaluating the decorator expression throws the
   * ReferenceError; the program compiles to exactly that crash. */
  shapes?: (
    | { kind: "call"; funcType: Extract<IrType, { kind: "func" }>; replaces: boolean }
    | { kind: "ambientThrow"; name: string }
  )[];
  /** Analysis fenced — diagnostics already reported; emission skips. */
  poisoned?: true;
  /** The MUTABLE classval module global holding the decoration RESULT,
   * present exactly when some decorator can replace the class. TC39 binds
   * the class NAME to the last non-undefined decorator return, so every
   * reference to the name routes through this value: bare reads load it,
   * `new C()` dispatches newValue through it, `C.x` takes the
   * through-a-VALUE static paths, and `instanceof C` reads its interval
   * (instanceOfValue). Absent when every decorator returns void/undefined
   * — the binding provably stays the original class object and every
   * direct path stays direct. */
  valueGlobalId?: string;
}

/** A generic class declaration's monomorphization state, hung off the
 * FAMILY ClassInfo (registered under the class's own qualified name and
 * bound to its symbol — `new`, `instanceof`, statics, and extends all
 * resolve to the family first and reroute to instantiations from there).
 * Instances key by comma-joined type-argument typeKeys; `info` is null
 * WHILE the instance's shape collects (self-referential layouts — `next:
 * Box<T> | null` — re-enter by key and take the name without recursing)
 * and stays null with `poisoned` set when collection fenced. */
export interface GenericClassInfo {
  decl: ts.ClassDeclaration;
  /** Unqualified source name, for diagnostics. */
  baseName: string;
  /** Declaration-order type parameter symbols. */
  typeParams: ts.Symbol[];
  family: ClassInfo;
  instances: Map<string, { name: string; info: ClassInfo | null; poisoned?: boolean }>;
}

/** The KEY symbol behind a LATE-BOUND (`__@name@id`) property: resolved
   * from the argument of the element-access assignment that declared it
   * (`this[kLimit] = v` — the declaration list holds the BinaryExpression
   * or the ElementAccessExpression itself). Null when no declaration has
   * that shape (well-known-symbol members like `[Symbol.iterator]`). */
  function lateBoundKeySymOf(L: Lowerer, p: ts.Symbol): ts.Symbol | null {
    for (const d of L.checker.declarationsOf(p)) {
      const access =
        ts.isBinaryExpression(d) && ts.isElementAccessExpression(d.left)
          ? d.left
          : ts.isElementAccessExpression(d)
            ? d
            : null;
      if (!access || !ts.isIdentifier(access.argumentExpression)) continue;
      const sym = L.resolveValueSymbol(access.argumentExpression);
      if (sym) return sym;
    }
    return null;
  }

/** An `Object.defineProperty` call that DECLARES a hidden symbol-keyed
   * slot on a program class, and everything the declaration needs.
   *
   * The admitted form is one shape and nothing near it:
   *
   *     Object.defineProperty(recv, K, {
   *       value: <expr>, enumerable: false, configurable: false, writable: false
   *     })
   *
   * where `K` is `uniqueSymbolKeyOf`-resolvable (a module-level `const k =
   * Symbol('desc')` — a compile-time identity) and `recv` is a bare
   * identifier whose type names a non-generic program class. This is the
   * "hidden per-instance field on someone else's class" idiom TypeScript
   * forces through `Object.defineProperty` because a symbol member cannot
   * be declared on a class from another module.
   *
   * Every clause is load-bearing:
   *
   *  - `writable: false` + `configurable: false` means the property is
   *    written at most ONCE and can never be deleted or redefined, so one
   *    static slot models its whole lifetime (a second define is a
   *    TypeError, emitted as a guard at the write).
   *  - `enumerable: false` keeps it out of spread, Object.assign and
   *    inspect — the paths a static layout would otherwise have to teach.
   *    An enumerable slot is a different, larger problem; it keeps SC2020.
   *  - A GETTER descriptor (`get`/`set`) is not a slot at all.
   *  - A bare-identifier receiver may be evaluated twice with no effect
   *    (defineProperty's result IS the receiver), which is what lets the
   *    call lower in expression position as well as statement position.
   *
   * The receiver→class resolution here is deliberately an OVER-approximation
   * (it navigates interface `extends` chains without mapType's retyping
   * conditions): a slot declared on a class nothing reads is dead layout,
   * while both the read and the write are gated at their own sites by
   * `symbolFieldInfo`, which uses the real mapType. Over-approximating can
   * only waste a field; it can never route a read to a slot the write
   * missed. */
  interface DefinePropSlotSite {
    readonly decl: ts.ClassLikeDeclaration;
    readonly key: { sym: ts.Symbol; fieldName: string };
    readonly value: ts.Expression;
  }

/** The hidden-data-descriptor half of the recognizer: exactly `value` plus
   * all three of `enumerable`/`configurable`/`writable` spelled `false`,
   * as plain property assignments. Anything else — a missing flag (JS
   * defaults it to false, but spelling it is what makes the intent
   * checkable), a computed or shorthand member, a spread, an accessor, a
   * non-literal flag — is not this shape. */
  function hiddenDataDescriptorOf(node: ts.Expression): ts.Expression | null {
    if (!ts.isObjectLiteralExpression(node)) return null;
    let value: ts.Expression | undefined;
    const flags = new Set<string>();
    for (const p of node.properties) {
      if (!ts.isPropertyAssignment(p)) return null;
      const nm = ts.isIdentifier(p.name) || ts.isStringLiteral(p.name) ? p.name.text : null;
      if (nm === null) return null;
      if (nm === "value") {
        if (value !== undefined) return null;
        value = p.initializer;
        continue;
      }
      if (nm !== "enumerable" && nm !== "configurable" && nm !== "writable") return null;
      if (p.initializer.kind !== ts.SyntaxKind.FalseKeyword) return null;
      flags.add(nm);
    }
    if (value === undefined || flags.size !== 3) return null;
    return value;
  }

/** The class DECLARATION a defineProperty receiver's type names: the
   * declared class itself, or the class an interface chain re-publishes
   * (`export interface WaClient extends WaClientImpl` — the shape a
   * package uses to give a class event-map-typed overloads it cannot
   * express). Generic classes are excluded: one declaration node stands
   * for every instantiation, and a per-instantiation slot type would need
   * the bindings this scan runs without. */
  function receiverClassDeclOf(L: Lowerer, recv: ts.Expression): ts.ClassLikeDeclaration | null {
    if (!ts.isIdentifier(recv)) return null;
    return receiverClassDeclOfAny(L, recv);
  }

  /** The same resolution without the bare-identifier requirement. The
   * SYMBOL-slot recognizer wants the identifier — its write is a field
   * store through one local — but the run-time property TABLE lowers any
   * receiver, because it binds one to a hidden local first. */
  function receiverClassDeclOfAny(L: Lowerer, recv: ts.Expression): ts.ClassLikeDeclaration | null {
    // The CHECKER's type, never L.typeOf: the scan runs before any lowering
    // (so the narrowing maps typeOf consults are empty) but the recognizer
    // is asked again at the write site with them live, and the two must
    // agree on what the declaration is.
    let sym: ts.Symbol | undefined = L.checker.getTypeAtLocation(recv).getSymbol();
    for (let hop = 0; sym !== undefined && hop < 8; hop++) {
      const decls = L.checker.declarationsOf(sym);
      const cls = decls.find((d) => ts.isClassDeclaration(d) || ts.isClassExpression(d)) as
        | ts.ClassLikeDeclaration
        | undefined;
      if (cls) {
        if (cls.getSourceFile().isDeclarationFile || !L.fileTag.has(cls.getSourceFile())) return null;
        return cls.typeParameters === undefined ? cls : null;
      }
      // An interface: follow a single agreed `extends <bare identifier>`.
      const ifaces = decls.filter((d) => ts.isInterfaceDeclaration(d));
      if (ifaces.length === 0) return null;
      let next: ts.Symbol | undefined;
      for (const d of ifaces) {
        const clauses = d.heritageClauses ?? [];
        if (clauses.length !== 1) return null;
        const clause = clauses[0]!;
        if (clause.token !== ts.SyntaxKind.ExtendsKeyword || clause.types.length !== 1) return null;
        const ref = clause.types[0]!;
        if (!ts.isIdentifier(ref.expression)) return null;
        const s = L.checker.getSymbolAtLocation(ref.expression);
        if (!s || (next !== undefined && next !== s)) return null;
        next = s;
      }
      sym = next;
    }
    return null;
  }

/** The layout name of the run-time property table. `%`-prefixed, so no
   * string key spells it, `in`'s member walk already skips it, and
   * util.inspect's field loop already omits it. */
  export const CLASS_PROPS_FIELD = IR_CLASS_PROPS_FIELD;

  /** A `Object.defineProperty(<an instance of a program class>, <a
   * STRING-typed key>, <an object literal descriptor>)` site — the row
   * the per-instance table exists for, and the one the hidden SYMBOL
   * slot above cannot serve: a symbol key resolves to a compile-time
   * constant and gets its own layout cell, while a string key,
   * especially a RUN-TIME string, names no cell at all.
   *
   * Three clauses, and each one is load-bearing:
   *
   *  - the KEY must be string-typed. A unique-symbol key is the other
   *    recognizer's, and it must stay so: the symbol form has a typed
   *    slot and a static read, both of which this table would lose.
   *  - the DESCRIPTOR must be an object LITERAL. It is lowered as a dyn
   *    object either way, but the getter check below needs to see the
   *    syntax.
   *  - a `get`/`set` half must be an ARROW function. The table stores
   *    the closure and calls it with NO receiver, because a compiled
   *    instance has no dyn spelling to bind as `this`; an arrow's `this`
   *    is lexical and already captured, so nothing is lost. A `function`
   *    expression or a bare identifier could read `this` and would get
   *    the wrong one — that keeps the fence.
   *
   * Answers the class DECLARATION (receiverClassDeclOf's interface hop
   * included — `export interface WaClient extends WaClientImpl` is
   * exactly zapo's shape), so the whole-program scan can put the field in
   * the layout before any site is lowered. */
  export function definePropTableSiteOf(L: Lowerer, call: ts.CallExpression): ts.ClassLikeDeclaration | null {
    if (call.questionDotToken) return null;
    const access = call.expression;
    if (!ts.isPropertyAccessExpression(access) || access.questionDotToken) return null;
    if (access.name.text !== "defineProperty") return null;
    if (call.arguments.length !== 3 || call.arguments.some(ts.isSpreadElement)) return null;
    if (!L.isStdlibGlobal(access.expression, "Object")) return null;
    if (definePropTableDescriptorDecline(L, call) !== null) return null;
    const d = receiverClassDeclOfAny(L, call.arguments[0]!);
    if (process.env["SCRIPTC_DEFPROP_WHY"]) process.stderr.write(`[defprop] cand recvDecl=${d ? (d.name?.text ?? "?") : "null"}\n`);
    return d;
  }

  /** Why this call is NOT the run-time-property-table shape, as a phrase
   * the SC2020 hint can finish a sentence with — or null when the KEY and
   * DESCRIPTOR halves are both admissible. The recognizer above is this
   * function plus the receiver resolution, so the hint and the lowering
   * can never disagree about which clause failed.
   *
   * These are the SYNTACTIC clauses only. The receiver's class and the
   * statement position are checked at the lowering (which has mapType and
   * the class table live) and are named there. */
  export function definePropTableDescriptorDecline(L: Lowerer, call: ts.CallExpression): string | null {
    // NOT a type test on the key. This runs from the middle of class
    // collection (the layout is interned before any site is lowered), so
    // it may not call mapType — and the checker's raw TypeFlags are the
    // BUNDLED checker's numbering, which is not `ts.TypeFlags`'s:
    // `string` reads back as 134217728 here, the value
    // `ts.TypeFlags.TemplateLiteral` names, so a flag test silently
    // rejected every site. What is needed is only "not the SYMBOL
    // recognizer's row", and that one has a syntactic answer.
    // Over-approximating costs one unused field on a class, exactly as it
    // does for the symbol slots; the LOWERING checks the real key type,
    // with mapType live.
    if (uniqueSymbolKeyOf(L, call.arguments[1]!) !== null) {
      return "the key is a unique SYMBOL, which is the hidden-slot recognizer's row and keeps its own typed cell";
    }
    let desc: ts.Expression = call.arguments[2]!;
    while (ts.isParenthesizedExpression(desc)) desc = desc.expression;
    if (!ts.isObjectLiteralExpression(desc)) {
      return "the descriptor is not an OBJECT LITERAL, so its get/set halves cannot be checked at all";
    }
    for (const p of desc.properties) {
      if (!ts.isPropertyAssignment(p)) {
        return "the descriptor has a shorthand, spread or method member rather than plain `name: value` assignments";
      }
      const nm = ts.isIdentifier(p.name) || ts.isStringLiteral(p.name) ? p.name.text : null;
      if (nm === null) return "the descriptor has a COMPUTED member name";
      if (nm !== "get" && nm !== "set" && nm !== "value" && nm !== "writable" &&
        nm !== "enumerable" && nm !== "configurable") {
        return `the descriptor carries '${nm}', which is not one of get/set/value/writable/enumerable/configurable`;
      }
      if (nm !== "get" && nm !== "set") continue;
      let half: ts.Expression = p.initializer;
      while (ts.isParenthesizedExpression(half)) half = half.expression;
      if (!ts.isArrowFunction(half)) {
        // The table calls the half with NO receiver: a compiled instance
        // has no dyn spelling to bind as `this`. An arrow's `this` is
        // lexical and already captured, so nothing is lost; anything else
        // could read `this` and would get the wrong one.
        return `the descriptor's '${nm}' is not an ARROW function, and the table calls it with no receiver — only an arrow's \`this\` is already captured`;
      }
    }
    return null;
  }

  /** Why an `Object.defineProperty` whose receiver IS a program class did
   * not take the run-time-property-table lowering — a phrase the SC2020
   * hint finishes its sentence with. It reads the same clauses the
   * lowering does, in the same order, so the two cannot disagree.
   *
   * Never "no key table": a class receiver HAS one now (for the classes
   * the pre-pass named), and telling a reader otherwise is the wrong-blame
   * mistake estado-accessor.md paid for from the other side. */
  export function definePropTableDecline(L: Lowerer, call: ts.CallExpression): string {
    const shape = definePropTableDescriptorDecline(L, call);
    if (shape !== null) return shape;
    if (call.parent === undefined || !ts.isExpressionStatement(call.parent)) {
      return "the call is used as a VALUE, and only STATEMENT position lowers — the call's " +
        "value is the receiver at the checker's laundered type for the call, which is not what " +
        "the binding holds";
    }
    const recvIr = L.mapTypeOf(L.typeOf(call.arguments[0]!));
    const info = recvIr?.kind === "object" ? L.classes.get(recvIr.className) : undefined;
    if (!info) return "the receiver's class is not one this program declares";
    if (info.hasPropsTable !== true) {
      return "the whole-program pre-pass declared no table on this class — the receiver's " +
        "written type does not resolve to the class declaration (a generic class cannot carry " +
        "one, because a single declaration node stands for every instantiation)";
    }
    if (info.subclasses.length > 0) {
      return `'${info.def.name}' has a subclass, so the closed member set the collision check ` +
        "reads is not exact: a base-typed binding can hold a derived instance, and answering " +
        "\"does this key name a declared member\" without the derived members is a silent wrong " +
        "answer";
    }
    for (let a: ClassInfo | null = info; a; a = a.base) {
      if (a.builtinEmitter) continue;
      if (a.def.runtime) {
        return `the chain reaches the runtime builtin '${a.def.name}', whose members the object ` +
          "model does not carry, so the collision check has no closed set to read";
      }
    }
    return "the key is not STRING-typed";
  }

  /** Every class declaration the program defines a run-time-keyed
   * property on. The whole-program shape and the reason it cannot be
   * decided at the site are scanDefinePropSymbolSlots's: a class layout
   * is interned from the TYPE long before the defining call is lowered,
   * and the call usually lives in a different module. */
  export function scanDefinePropStringTables(L: Lowerer): Set<ts.ClassLikeDeclaration> {
    const out = new Set<ts.ClassLikeDeclaration>();
    const visit = (n: ts.Node): void => {
      if (ts.isCallExpression(n)) {
        const decl = definePropTableSiteOf(L, n);
        if (decl) out.add(decl);
      }
      ts.forEachChild(n, visit);
    };
    for (const sf of L.fileTag.keys()) {
      if (sf.isDeclarationFile) continue;
      ts.forEachChild(sf, visit);
    }
    return out;
  }

  export function definePropSlotSiteOf(L: Lowerer, call: ts.CallExpression): DefinePropSlotSite | null {
    if (call.questionDotToken) return null;
    const access = call.expression;
    if (!ts.isPropertyAccessExpression(access) || access.questionDotToken) return null;
    if (access.name.text !== "defineProperty") return null;
    if (call.arguments.length !== 3 || call.arguments.some(ts.isSpreadElement)) return null;
    if (!L.isStdlibGlobal(access.expression, "Object")) return null;
    const key = uniqueSymbolKeyOf(L, call.arguments[1]!);
    if (!key) return null;
    const value = hiddenDataDescriptorOf(call.arguments[2]!);
    if (!value) return null;
    const decl = receiverClassDeclOf(L, call.arguments[0]!);
    if (!decl) return null;
    return { decl, key, value };
  }

/** Every hidden symbol slot the program declares, class declaration by
   * class declaration.
   *
   * A class layout is interned from the TYPE long before any
   * defineProperty site is lowered — and the declaring site usually lives
   * in a DIFFERENT module from the class — so the decision has to be made
   * once, over the whole program, exactly like `scanAccessorProducers`.
   * Computed on first ask rather than in the constructor: by then every
   * file is in fileTag, and shape interning has not begun.
   *
   * The scan itself touches only the checker (uniqueSymbolKeyOf and
   * declaration navigation) — never mapType — so asking for it from the
   * middle of class collection cannot re-enter class collection. */
  export function scanDefinePropSymbolSlots(L: Lowerer): Map<ts.ClassLikeDeclaration, Map<ts.Symbol, { fieldName: string; values: ts.Expression[] }>> {
    const out = new Map<ts.ClassLikeDeclaration, Map<ts.Symbol, { fieldName: string; values: ts.Expression[] }>>();
    const visit = (n: ts.Node): void => {
      if (ts.isCallExpression(n)) {
        const site = definePropSlotSiteOf(L, n);
        if (site) {
          let per = out.get(site.decl);
          if (!per) {
            per = new Map();
            out.set(site.decl, per);
          }
          const prev = per.get(site.key.sym);
          if (prev) prev.values.push(site.value);
          else per.set(site.key.sym, { fieldName: site.key.fieldName, values: [site.value] });
        }
      }
      ts.forEachChild(n, visit);
    };
    for (const sf of L.fileTag.keys()) {
      if (sf.isDeclarationFile) continue;
      ts.forEachChild(sf, visit);
    }
    return out;
  }

/** Symbol-slot RETURN refinement (5.9.3 ABI parity): tsgo synthesizes no
   * late-bound property for a JS class's `this[k] = v` declaration (the
   * finding-5 family), so an unannotated method whose returns read a
   * declared symbol-keyed slot infers `any` — the checked-dynamic
   * fallback would box a value whose static type the class layout already
   * knows (5.9.3 inferred it through the late-bound property; runtime
   * output was identical either way, but the method ABI carried a dyn
   * box). Recovered here from the layout itself, under a shape that
   * cannot mis-type: an unannotated, non-async, non-generator JS method
   * whose LAST top-level statement is a return (no fall-through
   * `undefined` completion), where EVERY return statement (nested
   * functions excluded — they return elsewhere) returns `this[k]` with a
   * statically-resolved key declared in symbolFields, and all the slots
   * agree on one IR type. Null when the shape doesn't hold — the value
   * stays checked-dynamic exactly as before. */
  function symbolSlotReturnType(
    L: Lowerer,
    fnLike: ts.MethodDeclaration,
    symbolFields: ReadonlyMap<ts.Symbol, string>,
    fields: ReadonlyMap<string, IrType>,
  ): IrType | null {
    if (symbolFields.size === 0) return null;
    if (fnLike.type !== undefined || !fnLike.body) return null;
    if (!isJsSourceFile(fnLike.getSourceFile())) return null;
    if (fnLike.asteriskToken !== undefined) return null;
    if (fnLike.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)) return null;
    const stmts = fnLike.body.statements;
    const last = stmts[stmts.length - 1];
    if (!last || !ts.isReturnStatement(last)) return null;
    const returns: ts.ReturnStatement[] = [];
    const visit = (n: ts.Node): void => {
      if (ts.isFunctionLike(n)) return;
      if (ts.isReturnStatement(n)) returns.push(n);
      n.forEachChild(visit);
    };
    fnLike.body.forEachChild(visit);
    let out: IrType | null = null;
    for (const r of returns) {
      let e = r.expression;
      while (e !== undefined && ts.isParenthesizedExpression(e)) e = e.expression;
      if (e === undefined || !ts.isElementAccessExpression(e)) return null;
      if (e.expression.kind !== ts.SyntaxKind.ThisKeyword) return null;
      const key = uniqueSymbolKeyOf(L, e.argumentExpression);
      const fieldName = key ? symbolFields.get(key.sym) : undefined;
      const t = fieldName !== undefined ? fields.get(fieldName) : undefined;
      if (t === undefined || t.kind === "dyn") return null;
      if (out !== null && !typeEquals(out, t)) return null;
      out = t;
    }
    return out;
  }

/** The builtin Error hierarchy (Error + TypeError/RangeError/SyntaxError)
   * as eagerly-registered ClassInfos: mapType names them the moment a lib
   * Error type appears, so the infos must exist before any lowering. They
   * are runtime-provided — no decl, no lowerable bodies; `new`/super()/
   * toString reach them through dedicated error.* libCall lowerings, and
   * user classes extend them like any base (the emitted subclass struct
   * embeds ScrError's prefix). */
  export function registerBuiltinErrorClasses(L: Lowerer): void {
    const loc = { file: "<builtin>", start: 0, end: 0 };
    for (const [irName, rec] of RUNTIME_ERROR_CLASSES) {
      const base = rec.base ? (L.classes.get(rec.base) ?? null) : null;
      const info: ClassInfo = {
        def: {
          name: irName,
          runtime: true,
          ...(rec.base ? { base: rec.base } : {}),
          // Layout only — `%code` is ScrError's third slot (NULL = absent;
          // fs/exec throw sites stamp it): subclass structs embed it in
          // their prefix, and teardown releases it NULL-guarded like any
          // string field. The '%' name keeps it out of user reach (a
          // subclass declaring its own `code` field lays out AFTER it,
          // never colliding), and it is NOT in the fields map below: the
          // READ has its own `string | undefined` lowering (error.code),
          // never a plain-string field access.
          fields: [
            { name: "name", type: STRING },
            { name: "message", type: STRING },
            { name: "%code", type: STRING },
          ],
          loc,
        },
        fields: new Map([
          ["name", STRING],
          ["message", STRING],
        ]),
        fieldOrder: [],
        // Only the root declares toString — subclasses (builtin and user)
        // reach it through the base-chain walk, so its declarer is always
        // %Error and calls lower to the one runtime implementation.
        methods: rec.base === null
          ? new Map([["toString", { params: [], ret: STRING }]])
          : new Map(),
        decl: null,
        builtinError: true,
        ctor: null,
        // Display shape of `new Error(message?)`. Construction and super()
        // never complete against this — errorMessageArg owns those (the
        // runtime ABI is one plain string; "" when omitted, like Node).
        ctorParams: [{ type: STRING, mode: "omittable" }],
        base,
        subclasses: [],
        throwingSetters: [],
        staticFields: [],
      };
      if (base) base.subclasses.push(info);
      L.classes.set(irName, info);
    }
  }

/** The runtime-provided node:events EventEmitter as an eagerly-registered
   * ClassInfo (the error-hierarchy story): mapType names `%EventEmitter`
   * the moment an emitter type appears, so the info must exist before any
   * lowering. No decl, no lowerable bodies — `new`/super() reach it
   * through emitter.* libCalls, the method surface lowers through
   * lower-emitter.ts, and user classes extend it like any base (the
   * emitted subclass struct embeds ScrEmitter's registry/name prefix —
   * carried by the BACKEND, not by IR fields, so the fields list stays
   * empty and subclass field layout starts right after the prefix). */
  export function registerBuiltinEmitterClass(L: Lowerer): void {
    const loc = { file: "<builtin>", start: 0, end: 0 };
    const info: ClassInfo = {
      def: { name: RUNTIME_EMITTER_CLASS, runtime: true, fields: [], loc },
      fields: new Map(),
      fieldOrder: [],
      methods: new Map(),
      decl: null,
      builtinEmitter: true,
      ctor: null,
      // `new EventEmitter()` — zero-argument (the options bag fences at
      // construction sites; the checker may admit it via @types/node).
      ctorParams: [],
      base: null,
      subclasses: [],
      throwingSetters: [],
      staticFields: [],
    };
    L.classes.set(RUNTIME_EMITTER_CLASS, info);
  }

/** The runtime-provided node:stream classes as eagerly-registered
   * ClassInfos (the emitter story): mapType names `%Readable` et al the
   * moment a stream type appears, so the infos must exist before any
   * lowering. Each roots at the emitter through its base chain, so the
   * EventEmitter method surface, upcasts, and instanceof intervals apply
   * unchanged; the stream method/property surface lowers through
   * lower-stream.ts. No decl, no lowerable bodies, empty field lists —
   * every instance is runtime-allocated (user `extends` is fenced). */
  export function registerBuiltinStreamClasses(L: Lowerer): void {
    const loc = { file: "<builtin>", start: 0, end: 0 };
    for (const [irName, rec] of RUNTIME_STREAM_CLASSES) {
      const base = L.classes.get(rec.base) ?? null;
      const info: ClassInfo = {
        def: { name: irName, runtime: true, base: rec.base, fields: [], loc },
        fields: new Map(),
        fieldOrder: [],
        methods: new Map(),
        decl: null,
        builtinStream: rec.sides,
        ctor: null,
        // `new Readable(opts?)` — the options bag is parsed structurally
        // by the stream spoke (lowerNew never completes against this).
        ctorParams: [],
        base,
        subclasses: [],
        throwingSetters: [],
        staticFields: [],
      };
      if (base) base.subclasses.push(info);
      L.classes.set(irName, info);
    }
  }

/** The stream ClassInfo a VALUE symbol refers to (`new Readable(...)`,
   * `x instanceof Writable`) — any import spelling resolves to the
   * ambient class. Provenance is runtimeStreamClassOf, the SAME test the
   * type mapping uses (this used to carry its own copy, and the copies
   * drifted). */
  export function builtinStreamInfoOf(L: Lowerer, symbol: ts.Symbol | null | undefined): ClassInfo | null {
    if (!symbol) return null;
    if (!L.isStdlibSymbol(symbol)) {
      // A const ALIAS of a namespace member (`const Writable =
      // stream.Writable` — the two-step spelling; the one-step
      // require('stream').Writable rides the same walk): follow the
      // member to the stdlib class symbol. The declaration itself is
      // alias plumbing (streamClassAliasDecl — both declaration walks
      // skip it).
      const decl = L.checker.valueDeclarationOf(symbol);
      if (
        decl && ts.isVariableDeclaration(decl) &&
        (ts.getCombinedNodeFlags(decl) & ts.NodeFlags.Const) !== 0 &&
        decl.initializer !== undefined &&
        ts.isPropertyAccessExpression(decl.initializer) &&
        !decl.initializer.questionDotToken &&
        L.builtinNamespaceModuleOf(decl.initializer.expression) === "stream"
      ) {
        const mSym = L.checker.getSymbolAtLocation(decl.initializer.name);
        const target = mSym && mSym.flags & ts.SymbolFlags.Alias ? L.checker.getAliasedSymbol(mSym) : mSym;
        if (target && target !== symbol) return builtinStreamInfoOf(L, target);
      }
      return null;
    }
    const irName = runtimeStreamClassOf(
      L.checker.declarationsOf(symbol),
      symbol.name,
      (sf) => L.isStdlibFile(sf),
    );
    return irName ? (L.classes.get(irName) ?? null) : null;
  }

/** Does the constructor READ `this.<name>` at a source position before
   * `declStart`, the assignment that declares the field? Lexical and
   * constructor-local by design: a read from a method the constructor
   * calls, or from a base constructor's virtual dispatch through
   * `super()`, is not decidable here and keeps today's behaviour. The LHS
   * of a plain `=` is a write, not a read; `this.x += 1` is both, and
   * counts. */
  function ctorReadsBeforeDeclaration(body: ts.Block, name: string, declStart: number): boolean {
    let found = false;
    const visit = (n: ts.Node): void => {
      if (found) return;
      if (
        ts.isPropertyAccessExpression(n) &&
        n.expression.kind === ts.SyntaxKind.ThisKeyword &&
        ts.isIdentifier(n.name) &&
        n.name.text === name &&
        n.getStart() < declStart
      ) {
        const parent = n.parent as ts.Node | undefined;
        const isWriteTarget =
          parent !== undefined &&
          ts.isBinaryExpression(parent) &&
          parent.left === n &&
          parent.operatorToken.kind === ts.SyntaxKind.EqualsToken;
        if (!isWriteTarget) {
          found = true;
          return;
        }
      }
      ts.forEachChild(n, visit);
    };
    ts.forEachChild(body, visit);
    return found;
  }

/** Can a CHECKED-DYNAMIC box stand in for this inference without
   * inventing an answer? The dyn tree's native shapes are the primitives,
   * plain objects and real arrays: keyed reads and writes on them do what
   * JS does. It has NO method table for built-in class instances — a Map
   * in a dyn box answers `m.set is not a function` (measured, on
   * `this.m = new Map()`), which is a wrong answer standing where a
   * refusal belonged. So the box stands in for `any`/`unknown`, the
   * primitives and units, arrays, and plain ANONYMOUS object shapes with
   * no call or construct signatures — RECURSIVELY, because a Map nested
   * inside a plain object is the same wrong answer one level down — and
   * for nothing else. A cyclic shape is admitted at the back-edge (the
   * arms that close the cycle were judged on the way in) and the depth cap
   * makes a pathological nesting a refusal, never a hang. */
  function dynBoxIsFaithful(L: Lowerer, t: ts.Type, seen = new Set<ts.Type>(), depth = 0): boolean {
    if (depth > 6) return false;
    const arms: readonly ts.Type[] = t.isUnionType() ? t.getTypes() : [t];
    return arms.every((a) => {
      if (seen.has(a)) return true;
      seen.add(a);
      if ((a.flags & DYN_FAITHFUL_PRIMITIVES) !== 0) return true;
      if ((a.flags & ts.TypeFlags.Object) === 0) return false;
      if (L.checker.isArrayType(a)) {
        const elem = L.checker.getTypeArguments(a as ts.TypeReference)[0];
        return elem === undefined || dynBoxIsFaithful(L, elem, seen, depth + 1);
      }
      const objectFlags = (a as ts.ObjectType).objectFlags;
      if ((objectFlags & (ts.ObjectFlags.Anonymous | ts.ObjectFlags.ObjectLiteral)) === 0) return false;
      if (L.checker.getCallSignatures(a).length > 0) return false;
      if (L.checker.getConstructSignatures(a).length > 0) return false;
      return L.checker
        .getPropertiesOfType(a)
        .every((m) => dynBoxIsFaithful(L, L.checker.getTypeOfSymbol(m), seen, depth + 1));
    });
  }

  /** IS THIS THE DEFERRED-CALLBACK FIELD? — a field whose whole inference is
   * "a callback, or not written yet": every arm is either a PURE
   * single-call-signature function type (dynFallbackType's own gate — no
   * properties, no construct signatures, no type parameters, no rest or
   * `arguments` params) or a unit meaning absent (undefined/null/never).
   * At least one arm must be a function, so this never widens a
   * plain-unit inference that has its own answer.
   *
   * `this.resolve = resolve` inside a `new Promise(...)` executor is the
   * shape, in both spellings the checker produces for it: bare
   * `(value: any) => void` when the write is lexically inside the
   * constructor, and `((value: any) => void) | undefined` when the write
   * sits in a method the constructor calls (ioredis's `initPromise`,
   * which is how `built/Command.js:303` actually reads). The two spell
   * one construct and had to answer alike; keying on the bare form alone
   * admitted the reduction and still refused the real package.
   *
   * The arms are asked ONE BY ONE and unions are never passed whole to
   * dynFallbackType, because that function answers a blanket `dyn` for
   * every union it does not recognize — a `Map<any, any> | undefined`
   * field included. Routing that to a dyn box is the regression this
   * file's history records twice (`m.set is not a function` where Node
   * answers a value), and asking per arm is what keeps this rule from
   * being that change wearing a narrower name. */
/** Is this write LEXICALLY inside a CALLBACK rather than in the
   * constructor's or a method's own body? Walks out of the assignment until
   * it meets either a function that could be the callback, or the member
   * that contains it.
   *
   * The distinction decides which remedy the fence below can honestly name,
   * and both arms were compiled and run before being written into a
   * message. A value produced INSIDE a callback is usually made out of the
   * callback's own parameters (`this.resolve = resolve`), so "move the
   * assignment to the top of the constructor" names something no reader can
   * do — the parameter does not exist there. Every other position really
   * can be moved, and moving it really does compile: a generator-valued
   * field assigned in a method refuses here and runs byte-exact once the
   * assignment sits at the constructor's top level. */
  function assignedInsideCallback(site: ts.Node): boolean {
    for (let n: ts.Node | undefined = site.parent; n !== undefined; n = n.parent) {
      if (ts.isArrowFunction(n) || ts.isFunctionExpression(n) || ts.isFunctionDeclaration(n)) return true;
      if (
        ts.isConstructorDeclaration(n) || ts.isMethodDeclaration(n) ||
        ts.isGetAccessorDeclaration(n) || ts.isSetAccessorDeclaration(n) ||
        ts.isClassDeclaration(n) || ts.isClassExpression(n) || ts.isSourceFile(n)
      ) {
        return false;
      }
    }
    return false;
  }

  function isDeferredCallbackField(L: Lowerer, site: ts.Node, t: ts.Type): boolean {
    const arms: readonly ts.Type[] = t.isUnionType() ? t.getTypes() : [t];
    let sawFn = false;
    for (const a of arms) {
      if ((a.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Null | ts.TypeFlags.Never)) !== 0) continue;
      if (dynFallbackType(L, site, a)?.kind !== "func") return false;
      sawFn = true;
    }
    return sawFn;
  }

/** The flag set dynBoxIsFaithful admits outright: everything whose whole
   * runtime representation already IS a dyn payload. */
  const DYN_FAITHFUL_PRIMITIVES =
    ts.TypeFlags.Any |
    ts.TypeFlags.Unknown |
    ts.TypeFlags.Undefined |
    ts.TypeFlags.Null |
    ts.TypeFlags.Never |
    ts.TypeFlags.StringLike |
    ts.TypeFlags.NumberLike |
    ts.TypeFlags.BooleanLike |
    ts.TypeFlags.BigIntLike;

/** The undefined-armed union of a JS class property's inferred type — the
   * honest slot for a field first assigned outside the constructor's top
   * level (undefined until the write runs, Node-exact). Null when the
   * inference is unmappable or an arm-less kind that cannot join a union
   * (genResultRecord's list).
   *
   * A CHECKED-DYNAMIC inference is NOT one of those: `dyn` already carries
   * undefined as a value, and both backends' undefined-field initializers
   * already store `scr_dyn_undefined()` into a dyn field (the
   * `class C { u?: unknown; n: number }` case they were written for), so a
   * dyn slot IS the undefined-armed representation — no union needed. The
   * old blanket exclusion is what fenced the commonest JS shape there is:
   * a field assigned from an UNTYPED parameter outside the constructor's
   * top level (`this._connectionCallback = callback` — pg's terminal
   * blocker), where the property's inferred type is implicit `any`. The
   * constructor's own top-level scan has declared such fields dyn all
   * along; the two scans now agree.
   *
   * What does NOT get this treatment: every OTHER unmappable inference.
   * Routing all of them through dynFallbackType was measured and REVERTED
   * — `if (f) this.m = new Map()` types the property `Map<any, any>`,
   * which maps to nothing, and the dyn slot then answered
   * "y.m.set is not a function" at run time: a loud refusal replaced by a
   * wrong answer, which is the one trade this project never makes. Only
   * `any` itself, whose whole representation IS the checked-dynamic box,
   * takes the fallback, plus the plain shapes dynBoxIsFaithful admits. */
  function undefArmedFieldType(L: Lowerer, p: ts.Symbol, site: ts.Node): IrType | null {
    const t = L.checker.getTypeOfSymbol(p);
    const mapped = L.mapTypeOf(t);
    // The checked-dynamic fallback, for the inferences a dyn box
    // represents FAITHFULLY (dynBoxIsFaithful). Implicit `any` — the
    // untyped-parameter shape — is the arm that fires on real packages.
    if (mapped === null && dynBoxIsFaithful(L, t)) return DYN;
    // THE DEFERRED-CALLBACK FIELD: a field whose inference is a PURE
    // single-call-signature function type — `this.resolve = resolve`
    // inside a `new Promise(...)` executor (ioredis's
    // `built/Command.js:303`, and every deferred/latch/settler shape
    // after it).
    //
    // This is the one shape whose fence had no followable remedy. The
    // message below says "assign it unconditionally at the top of the
    // constructor"; the value here IS the executor's own parameter, which
    // does not exist at the top of the constructor, so the line cannot be
    // moved. Measured, the nearest followable spellings each stop
    // somewhere else: a bare `this.resolve = undefined` placeholder makes
    // the slot a checked-dynamic one through the TOP-LEVEL scan and then
    // refuses the CALL, and only a JSDoc `@type` on the placeholder
    // reached a binary. A diagnostic whose advice cannot be followed is
    // worse than the refusal it replaces.
    //
    // The representation is the checked-dynamic box, not an
    // undefined-armed func union, and that is load-bearing: the box
    // ALREADY carries undefined as a value, so a read before the write
    // answers `undefined` exactly like Node (p02's `before: undefined`),
    // and `dynCall` — the same boundary an implicit-any JS callee uses —
    // validates the callee and throws Node's catchable
    // "<name> is not a function" when the write never ran. The armed-union
    // spelling was built first and refused every call site instead.
    //
    // dynBoxIsFaithful above deliberately answers false for call
    // signatures, and that stays right for OBJECT shapes that are also
    // callable (the chalk hybrid, which has no representation). A pure
    // function type is not one of those: `dynConvertible` boxes it as the
    // checked-dynamic tree's callable kind with identity preserved.
    // Anything isDeferredCallbackField does not admit — a Map, a Set, a
    // Date, an overloaded, generic, or rest-parameter signature, a union
    // carrying any arm that is neither a callback nor absent — falls
    // through unchanged to the fences below, so the method-table refusal
    // beneath this one keeps every site it had.
    if (mapped === null && isDeferredCallbackField(L, site, t)) return DYN;
    if (!mapped || mapped.kind === "void") return null;
    if (mapped.kind === "dyn") return mapped;
    const byKey = new Map<string, IrType>();
    const arms = mapped.kind === "union" ? (L.unions.get(mapped.unionId)?.arms ?? []) : [mapped];
    for (const a of arms) {
      if (a.kind === "map" || a.kind === "regex" || a.kind === "jsval" || a.kind === "generator") {
        return null;
      }
      byKey.set(typeKey(a), a);
    }
    byKey.set(typeKey(UNDEFINED_T), UNDEFINED_T);
    const sorted = [...byKey.values()].sort((a, b) => (typeKey(a) < typeKey(b) ? -1 : 1));
    return { kind: "union", unionId: L.unions.intern(sorted) };
  }

/** Builtins whose whole value IS a method table the checked-dynamic tree
   * does not carry. A dyn box holds JSON-shaped data plus functions,
   * promises and handles; it has no `set`, no `add`, no `getTime`, no
   * `test`. Boxing one of these answers `m.set is not a function` where
   * Node answers a value — measured, on `this.m = new Map()` at a
   * constructor's top level. */
  const DYN_LOSES_METHODS: ReadonlySet<string> = new Set([
    "Map", "ReadonlyMap", "Set", "ReadonlySet", "WeakMap", "WeakSet", "WeakRef",
    "Date", "RegExp",
  ]);

/** Would a checked-dynamic box LOSE this inference's method table?
   * The narrow, name-and-provenance-checked complement of the fallback:
   * only a reference to one of the stdlib's method-table builtins counts,
   * so plain object shapes — including ones whose members are functions,
   * which a dyn box does carry — keep the fallback they have always had.
   *
   * Deliberately NOT `dynBoxIsFaithful`, the method scan's whitelist.
   * That predicate excludes anonymous shapes with call signatures, and
   * routing the CONSTRUCTOR scan through it refused
   * `mysql2/lib/base/connection.js:83` — an LRU record whose members are
   * methods — which poisoned BaseConnection and took mysql2's whole
   * `extends` chain down with it. A driver that reaches a native binary
   * today must keep reaching one; the wrong answer being closed here is
   * the method table, and only the method table.
   *
   * A union is checked ARM BY ARM: one Map arm is enough, and it is the
   * same wrong answer whichever arm the value takes. */
  function dynBoxLosesMethodTable(L: Lowerer, t: ts.Type): boolean {
    const arms: readonly ts.Type[] = t.isUnionType() ? t.getTypes() : [t];
    return arms.some((a) => {
      const sym = a.getSymbol();
      if (sym === undefined || !DYN_LOSES_METHODS.has(sym.name)) return false;
      // A user's own `class Map` is not this: only the standard library's
      // declaration of the name counts, exactly as the container
      // diagnostics decide it.
      return L.checker
        .declarationsOf(sym)
        .some((d) =>
          (ts.isInterfaceDeclaration(d) || ts.isClassDeclaration(d)) &&
          L.isStdlibFile(d.getSourceFile()),
        );
    });
  }

/** The members a Map/Set binding may be used through and still be a
   * container this pass can type. Anything NOT here — including a bare
   * reference that hands the value to someone else — ends the inference,
   * because a value that escapes can be written through a name this scan
   * never sees. */
  const MAP_USE_MEMBERS: ReadonlySet<string> = new Set([
    "set", "get", "has", "delete", "clear", "size", "forEach", "keys", "values", "entries",
  ]);
  const SET_USE_MEMBERS: ReadonlySet<string> = new Set([
    "add", "has", "delete", "clear", "size", "forEach", "keys", "values", "entries",
  ]);
  /** The members whose FIRST argument is a key (Map) or an element (Set). */
  const KEYED_MEMBERS: ReadonlySet<string> = new Set(["set", "get", "has", "delete", "add"]);

/** JavaScript has no type-argument syntax, so `const m = new Map()` types
   * `Map<any, any>` however the program goes on to use it, and `any` is
   * not a supported map key — the container has no static home and the
   * value falls to the checked-dynamic escape hatch, which carries no
   * method table and answers V8's own `m.set is not a function` for a
   * method Node HAS.
   *
   * The PROGRAM says what the annotation would have said. This reads the
   * key and value types off the binding's OWN uses: a `const` local whose
   * every reference is a member operation on the container itself, with
   * one supported key type and one supported value type across every
   * `set`, is exactly the `Map<K, V>` a JSDoc `@type` would have written
   * — and that spelling already compiles (the contextual-type arm below
   * adopts it), so this pass reaches an existing representation rather
   * than inventing one.
   *
   * Every clause below is a REFUSAL to guess, and each has a wrong answer
   * behind it:
   *
   *  - `const` only. The adopt-the-initializer rule in lower-stmts.ts
   *    that carries this type onto the binding is `!isLet`; a `let` may
   *    be reassigned a different shape later, and the binding would keep
   *    a map type the second initializer never had.
   *  - the value must NOT ESCAPE. One bare reference — passed as an
   *    argument, returned, stored, compared — and some other name can
   *    write a key kind this scan never counted. Closure capture is fine
   *    and is the shape lru.min is written in: a nested function reading
   *    `keyMap.get(k)` is still a member operation on the container.
   *  - at least one `set`/`add`. With no write there is no evidence, and
   *    a program that only constructs the map is exactly what the escape
   *    hatch below exists to keep working.
   *  - one key type and one value type, both supported. Node's Map takes
   *    mixed kinds (`m.set(1, x); m.set("1", y)` is two entries); ScrMap
   *    fixes ONE key kind at construction, so a mixed-kind inference
   *    would answer `size` as 1 where Node says 2. Disagreement refuses
   *    and the value keeps the escape hatch it has today. */
  function inferContainerTypeFromUses(
    L: Lowerer,
    expr: ts.NewExpression,
    flavor: "map" | "set",
  ): IrType | null {
    const decl = expr.parent;
    if (
      !ts.isVariableDeclaration(decl) || decl.initializer !== expr ||
      !ts.isIdentifier(decl.name) || decl.type !== undefined
    ) return null;
    if (!ts.isVariableDeclarationList(decl.parent)) return null;
    if ((decl.parent.flags & ts.NodeFlags.Const) === 0) return null;
    if (!isJsSourceFile(expr.getSourceFile())) return null;
    const sym = L.checker.getSymbolAtLocation(decl.name);
    if (!sym) return null;

    const members = flavor === "map" ? MAP_USE_MEMBERS : SET_USE_MEMBERS;
    const writer = flavor === "map" ? "set" : "add";
    const keyArgs: ts.Expression[] = [];
    const valArgs: ts.Expression[] = [];
    let writes = 0;
    let escaped = false;

    const visit = (node: ts.Node): void => {
      if (escaped) return;
      if (ts.isIdentifier(node) && node !== decl.name &&
          L.checker.getSymbolAtLocation(node) === sym) {
        const p = node.parent;
        // `for (const [k, v] of m)` — iteration over the container is a
        // read of the container, not a handing-out of it.
        if (ts.isForOfStatement(p) && p.expression === node) return;
        if (ts.isTypeOfExpression(p)) return;
        if (!ts.isPropertyAccessExpression(p) || p.expression !== node) { escaped = true; return; }
        const name = p.name.text;
        if (!members.has(name)) { escaped = true; return; }
        const call = p.parent;
        const isCall = ts.isCallExpression(call) && call.expression === p;
        if (KEYED_MEMBERS.has(name)) {
          if (!isCall) { escaped = true; return; }
          const a0 = call.arguments[0];
          if (a0 === undefined) { escaped = true; return; }
          keyArgs.push(a0);
          if (name === writer) {
            writes++;
            if (flavor === "map") {
              const a1 = call.arguments[1];
              if (a1 === undefined) { escaped = true; return; }
              valArgs.push(a1);
            }
          }
        }
        return;
      }
      ts.forEachChild(node, visit);
    };
    for (const sf of L.moduleOrder) { visit(sf); if (escaped) return null; }
    if (escaped || writes === 0) return null;

    const oneOf = (nodes: readonly ts.Expression[]): IrType | null => {
      let acc: IrType | null = null;
      for (const a of nodes) {
        const t = L.mapTypeOf(L.checker.getBaseTypeOfLiteralType(L.checker.getTypeAtLocation(a)));
        if (t === null) return null;
        if (acc === null) acc = t;
        else if (!typeEquals(acc, t)) return null;
      }
      return acc;
    };
    const key = oneOf(keyArgs);
    if (key === null) return null;
    // STRICTER than isSupportedMapKey/isSupportedSetElem on purpose. Those
    // admit records and class instances, keyed by REFERENCE identity, and
    // they are right to: an annotated `Map<Conn, T>` is a type the program
    // ASKED for, and reference identity is what JS gives it.
    //
    // An INFERRED key is a guess, and this one is measurably wrong. A
    // record is a VALUE here — a width coercion copies it — so the address
    // that goes into the map is not the address a later `get` presents,
    // and `m.set(k1, "a"); m.get(k1)` answered `undefined` where Node
    // answers `a`. Measured on corpus m32, which the base LOUDLY refused
    // and the first draft of this inference turned into
    // `undefined undefined undefined` AT EXIT 0 — a silent wrong answer
    // where there had been a crash, which is the trade this project never
    // makes, in the direction it least tolerates.
    //
    // f64 and string are the two ScrMap key kinds whose SameValueZero IS
    // value equality, so an inferred container over them cannot disagree
    // with Node about what is in it. Everything else keeps the named
    // refusal at the use site (untypedContainerUseFence) and the JSDoc
    // remedy, which can still spell the reference-keyed map by hand.
    if (key.kind !== "f64" && key.kind !== "string") return null;
    if (flavor === "set") return isSupportedSetElem(key) ? setOf(key) : null;
    if (!isSupportedMapKey(key)) return null;
    const value = oneOf(valArgs);
    if (value === null || !isSupportedMapValue(value)) return null;
    return mapOf(key, value);
  }

/** Does the undefined arm of a COLLECTED field's slot mean ABSENT and
   * nothing else? Only then may an enumeration surface read the arm as
   * "the property does not exist yet" — see ClassInfo.absentTrackedFields
   * for why this is a proof and not a guess.
   *
   * Three clauses, and each one excludes a slot where a live `undefined`
   * could be a VALUE the source stored:
   *
   *  - the armed slot must be a UNION. A dyn slot carries undefined as a
   *    kind, and `this.cb = cb` with an undefined argument writes exactly
   *    the kind the initializer wrote.
   *  - the property's OWN inferred type must map. An unmapped inference
   *    reached the dyn fallback, which is the clause above.
   *  - and it must not already carry undefined. A JS class property's type
   *    is inferred FROM its assignments, so an undefined arm in the
   *    checker's own answer says the source assigns undefined somewhere;
   *    the arm can no longer tell absence from that write. */
  function undefArmIsAbsenceOnly(L: Lowerer, p: ts.Symbol, armed: IrType, site: ts.Node): boolean {
    // Clause 3 first, because it is the one clause every arm needs: a name
    // some assignment ANYWHERE can store undefined into can never tell
    // absence from that write.
    const written = undefWrittenPropNames(L);
    if (written.has("*") || written.has(p.name)) return false;
    // THE DEFERRED-CALLBACK SLOT, and the one place a checked-dynamic field
    // may join this set. The exclusion above it is right about the
    // population it was written for — in an implicit-`any` field
    // (`this._connectionCallback = callback`) `undefined` is a dyn KIND
    // that an explicit `obj.connect(undefined)` writes just as the
    // initializer does, and nothing distinguishes them. A field whose whole
    // inference is a FUNCTION TYPE is not that field: every value the
    // checker admits in the slot is callable, so a dyn `undefined` there
    // cannot be a value the source stored — and the name scan above still
    // takes the name away the moment any assignment in the program proves
    // otherwise. Measured both ways: the never-written slot stops printing
    // (Node omits the key), and a program that really does write
    // `a.cb = undefined` keeps printing it.
    if (armed.kind === "dyn") {
      return isDeferredCallbackField(L, site, L.checker.getTypeOfSymbol(p));
    }
    if (armed.kind !== "union") return false;
    if (L.armTag(armed.unionId, UNDEFINED_T) < 0) return false;
    const pre = L.mapTypeOf(L.checker.getTypeOfSymbol(p));
    if (pre === null || pre.kind === "dyn" || pre.kind === "void") return false;
    return true;
  }

/** Every property NAME the program can assign an undefined value to, over
   * any receiver — the conservative disqualifier behind
   * ClassInfo.absentTrackedFields.
   *
   * The checker's own property type cannot answer this. For a JS field
   * assigned in a conditional position tsc ARMS the inference itself
   * (`if (f) this.b = 2` types `b` as `number | undefined`), so an
   * undefined arm there says "the write may not have run", which is the
   * very thing being represented, not "a write stores undefined". The
   * assignments are what distinguish the two, and the disqualifying one
   * need not be inside the class: `c.b = undefined` from outside is a
   * write tsc allows through the armed slot, and it MATCHES Node today
   * (`C { a: 1, b: undefined }`). Skipping the entry for that instance
   * would trade one wrong answer for another.
   *
   * By NAME, over the whole program, and counting `any`/`unknown` as
   * possibly-undefined: a name-keyed over-approximation costs some class
   * an entry it could have skipped, which is exactly today's behaviour,
   * while a receiver-precise one that misses a write is a wrong answer.
   * Walked once per lowering pass and cached. */
  const undefWrittenCache = new WeakMap<Lowerer, ReadonlySet<string>>();
  function undefWrittenPropNames(L: Lowerer): ReadonlySet<string> {
    const hit = undefWrittenCache.get(L);
    if (hit) return hit;
    const names = new Set<string>();
    const rhsMayBeUndefined = (rhs: ts.Expression): boolean => {
      const rhsT = L.checker.getBaseTypeOfLiteralType(L.checker.getTypeAtLocation(rhs));
      const mapped = L.mapTypeOf(rhsT);
      // An unmapped right-hand side is unknown to this scan and counts as
      // possibly-undefined — with ONE exception, and it is not a relaxation
      // of the over-approximation but a correction to it: a FUNCTION VALUE
      // is never `undefined`, whatever its signature does. Without this the
      // assignment that DECLARES a callback field disqualified its own
      // name (an implicit-any signature does not map), so no
      // deferred-callback slot could ever be absence-tracked and inspect
      // kept printing a key Node omits. Only the pure single-signature
      // shape counts; every other unmapped RHS still disqualifies.
      if (mapped === null) return dynFallbackType(L, rhs, rhsT)?.kind !== "func";
      if (mapped.kind === "dyn" || mapped.kind === "undefinedT" || mapped.kind === "void") return true;
      return mapped.kind === "union" && L.armTag(mapped.unionId, UNDEFINED_T) >= 0;
    };
    const visit = (n: ts.Node): void => {
      if (ts.isBinaryExpression(n) && ts.isPropertyAccessExpression(n.left) && ts.isIdentifier(n.left.name)) {
        const op = n.operatorToken.kind;
        // Every ASSIGNMENT spelling, not just `=`: `c.b ??= u` and
        // `c.b ||= u` store their right operand too.
        const isAssign =
          op === ts.SyntaxKind.EqualsToken ||
          op === ts.SyntaxKind.QuestionQuestionEqualsToken ||
          op === ts.SyntaxKind.BarBarEqualsToken ||
          op === ts.SyntaxKind.AmpersandAmpersandEqualsToken;
        if (isAssign && rhsMayBeUndefined(n.right)) names.add(n.left.name.text);
      }
      // A COMPUTED key names no member statically, so any such write is a
      // write to every name (`c[k] = undefined`).
      if (
        ts.isBinaryExpression(n) && ts.isElementAccessExpression(n.left) &&
        n.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        !ts.isStringLiteralLike(n.left.argumentExpression) && rhsMayBeUndefined(n.right)
      ) {
        names.add("*");
      }
      if (
        ts.isBinaryExpression(n) && ts.isElementAccessExpression(n.left) &&
        n.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isStringLiteralLike(n.left.argumentExpression) && rhsMayBeUndefined(n.right)
      ) {
        names.add(n.left.argumentExpression.text);
      }
      ts.forEachChild(n, visit);
    };
    for (const sf of L.moduleOrder) visit(sf);
    // `delete c.b` makes the property genuinely absent again, which the
    // arm cannot represent either way; it already refuses over a class
    // receiver, so nothing is recorded for it.
    const result: ReadonlySet<string> = names.has("*") ? new Set(["*"]) : names;
    undefWrittenCache.set(L, result);
    return result;
  }

/** The emitter ClassInfo a VALUE symbol refers to (`new EventEmitter`,
   * `extends EventEmitter`, `x instanceof EventEmitter`) — any import
   * spelling (named/default/namespace member, CJS require) resolves to
   * the ambient class. Provenance-checked like the error classes: only a
   * stdlib-file declaration inside the "events" ambient module counts. */
  export function builtinEmitterInfoOf(L: Lowerer, symbol: ts.Symbol | null | undefined): ClassInfo | null {
    if (!symbol) return null;
    if (!L.isStdlibSymbol(symbol)) {
      // A const ALIAS of the emitter class member (`const EventEmitter =
      // require('node:events').EventEmitter` — commander's spelling; the
      // two-step `const EE = events.EventEmitter` rides the same walk):
      // follow the member off the module namespace. The declaration
      // itself is alias plumbing (builtinMemberRequireDecl — both
      // declaration walks skip it).
      const decl = L.checker.valueDeclarationOf(symbol);
      if (
        decl !== undefined && ts.isVariableDeclaration(decl) &&
        (ts.getCombinedNodeFlags(decl) & ts.NodeFlags.Const) !== 0 &&
        decl.initializer !== undefined &&
        ts.isPropertyAccessExpression(decl.initializer) &&
        !decl.initializer.questionDotToken &&
        decl.initializer.name.text === "EventEmitter" &&
        L.builtinNamespaceModuleOf(decl.initializer.expression) === "events"
      ) {
        return L.classes.get(RUNTIME_EMITTER_CLASS) ?? null;
      }
      return null;
    }
    if (symbol.name !== "EventEmitter") return null;
    const declared = L.checker.declarationsOf(symbol).some((d) => {
      if (!ts.isClassDeclaration(d) && !ts.isInterfaceDeclaration(d)) return false;
      let node: ts.Node | undefined = d.parent;
      while (node) {
        if (ts.isModuleDeclaration(node) && ts.isStringLiteral(node.name)) {
          return node.name.text === "events" || node.name.text === "node:events";
        }
        node = node.parent;
      }
      return false;
    });
    return declared ? (L.classes.get(RUNTIME_EMITTER_CLASS) ?? null) : null;
  }

/** The builtin error ClassInfo a VALUE symbol refers to (`new Error`,
   * `extends TypeError`, `x instanceof RangeError`), or null. Provenance-
   * checked: only the standard library's declarations count — a user's own
   * `class Error` resolves through classBySymbol instead. */
  export function builtinErrorInfoOf(L: Lowerer, symbol: ts.Symbol | null | undefined): ClassInfo | null {
    if (!symbol || !L.isStdlibSymbol(symbol)) return null;
    for (const [irName, rec] of RUNTIME_ERROR_CLASSES) {
      if (rec.lib === symbol.name) return L.classes.get(irName) ?? null;
    }
    return null;
  }

/** The instance-method surface the runtime EventEmitter owns — subclass
 * members with these names are fenced (collectClassShapeInner) and calls
 * to them on emitter-rooted receivers lower through lower-emitter.ts. */
export const EMITTER_API_MEMBERS: ReadonlySet<string> = new Set([
  "on", "addListener", "once", "prependListener", "prependOnceListener",
  "off", "removeListener", "removeAllListeners", "emit", "listenerCount",
  "listeners", "rawListeners", "eventNames", "setMaxListeners", "getMaxListeners",
]);

/** The decorators of a class-like or member node (they live in
   * `modifiers` since TS 4.8). */
  export function decoratorNodesOf(n: ts.Node): ts.Decorator[] {
    return (((n as { modifiers?: readonly ts.Node[] }).modifiers ?? []) as ts.Node[]).filter(
      (m): m is ts.Decorator => m.kind === ts.SyntaxKind.Decorator,
    );
  }

/** The AMBIENT name a decorator expression's evaluation throws on, or
   * null. Node erases ambient declarations (`declare let dec: any`,
   * `declare const instance: T`, `declare function dec<T>(t: T): T`), so
   * reading the name is a ReferenceError. Factory spellings ride along —
   * `@dec(...)` evaluates the CALLEE before any argument — and property
   * chains throw at their ROOT (`@instance.decorate` reads `instance`
   * first). */
  export function ambientDecoratorThrowNameOf(L: Lowerer, dExpr: ts.Expression): string | null {
    let e: ts.Expression = dExpr;
    while (ts.isParenthesizedExpression(e)) e = e.expression;
    const target = ts.isCallExpression(e) ? e.expression : e;
    const root = ambientUndefVarRootOf(L, target);
    if (root) return root.text;
    let callee: ts.Expression = target;
    while (ts.isParenthesizedExpression(callee)) callee = callee.expression;
    if (ts.isIdentifier(callee) && ambientUndefinedFnSymbolOf(L, callee) !== null) return callee.text;
    return null;
  }

/** The AMBIENT name an `extends` clause reads, or null: the heritage
   * expression is a bare identifier naming a top-level `declare class`
   * NOTHING defines. Node erases the declaration, so evaluating the
   * heritage clause — which happens when the CLASS STATEMENT evaluates,
   * before any member — throws `ReferenceError: <name> is not defined`.
   *
   * WHY IT EXISTS: the ambient class is still COLLECTED like a program
   * class (ambientUndefinedClassSymbolOf answers at the `new` site, not
   * at collection), so `L.classBySymbol.get(sym)` FOUND it here and the
   * derived class inherited a fabricated base. `declare class Base {...}`
   * followed by `class D extends Base {}` therefore compiled, ran every
   * statement after the class — static field initializers included, whose
   * side effects Node never performs — and constructed instances reading
   * their fields back out of `calloc`. A SILENT wrong answer, exit 0,
   * where Node exits 1 having printed nothing past the class statement.
   *
   * Deliberately narrow, matching the `new` arm's predicate exactly: only
   * a `declare class` whose parent is the SOURCE FILE, never a .d.ts,
   * never a stdlib symbol, never a class merged with an implementation.
   * The `declare const B: { new(): T }` and `declare function` spellings
   * of a base are NOT accepted here: they never resolved to a ClassInfo,
   * so they already answer with the loud
   * `extending classes not declared in the program` refusal — a refusal
   * standing where a correct answer is available is a separate row, not a
   * wrong answer, and widening it is not what this fix is for. */
  export function ambientHeritageThrowNameOf(L: Lowerer, hExpr: ts.Expression): string | null {
    let e: ts.Expression = hExpr;
    while (ts.isParenthesizedExpression(e)) e = e.expression;
    if (!ts.isIdentifier(e)) return null;
    return ambientUndefinedClassSymbolOf(L, e) !== null ? e.text : null;
  }

/** The guaranteed DEFINITION throw of a class, or null. Walks the class
   * definition's evaluation-order items — class decorators (source
   * order), the heritage expression, then per member in body order its
   * decorators and computed key (the verified TC39/tsc-downlevel order)
   * — and answers the first item that provably throws Node's
   * ReferenceError: an AMBIENT decorator name, or an `extends` clause
   * naming an ambient `declare class` nothing defines. Every item BEFORE
   * it must be provably effect-free and non-throwing: bare identifier
   * decorators over defined values (a pure read), an absent / `null` /
   * bare-identifier heritage, literal or bare-identifier computed keys.
   * Anything richer (factory calls over defined values, property-access
   * reads, computed-key calls) stops the proof — the named fences answer
   * instead.
   *
   * The heritage step answers BOTH ways for a reason: a bare-identifier
   * base over a defined value is effect-free and the walk continues past
   * it to the member decorators, exactly as before; a bare-identifier
   * base over an ambient-undefined class IS the throw. */
  export function guaranteedDefinitionThrow(L: Lowerer, decl: ts.ClassLikeDeclaration,): { name: string; node: ts.Decorator | ts.ExpressionWithTypeArguments } | null {
    const stripParens = (e: ts.Expression): ts.Expression => {
      let x = e;
      while (ts.isParenthesizedExpression(x)) x = x.expression;
      return x;
    };
    const decoratorVerdict = (d: ts.Decorator): { name: string; node: ts.Decorator } | "effectFree" | "opaque" => {
      const name = ambientDecoratorThrowNameOf(L, d.expression);
      if (name !== null) return { name, node: d };
      const e = stripParens(d.expression);
      // A bare identifier over a DEFINED value: a pure read.
      if (ts.isIdentifier(e)) return "effectFree";
      return "opaque";
    };
    for (const d of decoratorNodesOf(decl)) {
      const v = decoratorVerdict(d);
      if (v === "opaque") return null;
      if (v !== "effectFree") return v;
    }
    const heritage = decl.heritageClauses
      ?.find((c) => c.token === ts.SyntaxKind.ExtendsKeyword)
      ?.types[0];
    if (heritage) {
      const h = stripParens(heritage.expression);
      const ambientBase = ambientHeritageThrowNameOf(L, h);
      if (ambientBase !== null) return { name: ambientBase, node: heritage };
      if (h.kind !== ts.SyntaxKind.NullKeyword && !ts.isIdentifier(h)) return null;
    }
    for (const member of decl.members) {
      for (const d of decoratorNodesOf(member)) {
        const v = decoratorVerdict(d);
        if (v === "opaque") return null;
        if (v !== "effectFree") return v;
      }
      const name = (member as { name?: ts.PropertyName }).name;
      if (name && ts.isComputedPropertyName(name)) {
        const k = stripParens(name.expression);
        const literalKey =
          ts.isStringLiteralLike(k) || ts.isNumericLiteral(k) || ts.isIdentifier(k);
        if (!literalKey) return null;
      }
    }
    return null;
  }

export function collectClassShape(L: Lowerer, decl: ts.ClassDeclaration): void {
    const symbol = L.collectDeferring(
      () => declSymbolOf(L, decl),
      () => L.collectClassShapeInner(decl),
    );
    // Typed receivers and module retention know the class only by its
    // qualified IR name — index the deferral under it too.
    if (symbol) L.deferredClassByName.set(L.classNamer(decl), symbol);
    // A poisoned class containing a static BLOCK or a DECORATOR must report
    // EAGERLY: deferral's premise ("an unreached broken declaration costs
    // nothing") fails here — Node runs the block (and calls the decorator)
    // when the class statement evaluates, referenced or not, so silently
    // dropping the declaration would drop observable side effects (the
    // classStaticBlock13/28 miscompiles).
    const hasDeclTimeCode = (n: ts.Node): boolean =>
      ts.isClassStaticBlockDeclaration(n) ||
      ((n as { modifiers?: readonly ts.Node[] }).modifiers ?? []).some(
        (m) => m.kind === ts.SyntaxKind.Decorator,
      );
    if (symbol && (hasDeclTimeCode(decl) || decl.members.some(hasDeclTimeCode))) {
      const diags = L.deferredDiags.get(symbol);
      if (diags) {
        L.deferredDiags.delete(symbol);
        if (!L.alreadyFlushed.has(symbol)) {
          L.flushedSymbols.add(symbol);
          for (const d of diags) L.pushDiag(d);
        }
      }
    }
    // A poisoned BASE this class EXTENDS must report EAGERLY for the same
    // reason: the derived statement evaluates its heritage when module
    // init reaches it (these are top-level declarations), and the base's
    // fence is the COMPILER's, not Node's — Node defines the base fine and
    // runs on — so a deferred trap there is a manufactured divergence, not
    // the Node-parity deferral is licensed by (classFieldSuperAccessibleJs2:
    // the binary refused at `class D extends C` where Node prints five
    // lines). Leaf poisoned classes stay deferred — only the extends edge
    // reports. Resolution runs under the collect pass's guard (this is
    // collectProgram), so the lookup neither flushes nor fences.
    {
      const baseIdent = decl.heritageClauses
        ?.find((h) => h.token === ts.SyntaxKind.ExtendsKeyword)
        ?.types.map((t) => t.expression)
        .filter(ts.isIdentifier)[0];
      const baseSym = baseIdent ? L.resolveValueSymbol(baseIdent) : null;
      const baseDiags = baseSym ? L.deferredDiags.get(baseSym) : undefined;
      if (baseSym && baseDiags) {
        L.deferredDiags.delete(baseSym);
        if (!L.alreadyFlushed.has(baseSym)) {
          L.flushedSymbols.add(baseSym);
          for (const d of baseDiags) L.pushDiag(d);
        }
      }
    }
  }

export function collectClassShapeInner(L: Lowerer, decl: ts.ClassLikeDeclaration, jsNameOverride?: string,
    inst?: { family: ClassInfo; name: string; bindings: Map<ts.Symbol, IrType>; typeArgsText: string; ordinal: number },
    /** MIXIN instantiation mode (lower-mixins.ts): the class inside a
     * mixin function, collected per call site — `base` is the ARGUMENT
     * class (the heritage clause names the mixin's parameter and is
     * resolved here, never through the loop below), `name` the
     * position-derived instance name. */
    mixin?: { base: ClassInfo; name: string; call: ts.CallExpression; bindings: Map<ts.Symbol, IrType>; context: string; ordinal: number },): void {
    {
      // Anonymous class EXPRESSIONS are ordinary (their .name follows
      // NamedEvaluation — jsNameOverride carries it). The one legal
      // nameless class DECLARATION is `export default class {}` — its
      // symbol is the module's default export (declSymbolOf) and it
      // registers under classNamer's "%anon" spelling (unique per file).
      if (!decl.name && ts.isClassDeclaration(decl) && declSymbolOf(L, decl) === undefined) {
        L.unsupported("SC1090", decl, "anonymous classes");
      }
      // Decorators are declaration-time CALLS (they run when the class
      // statement evaluates and may replace the declaration outright).
      // CLASS decorators lower statically (collected here, analyzed
      // post-collection, emitted in %init at the class statement's
      // position — see ClassDecorationInfo). A decoration that PROVABLY
      // throws before anything else evaluates (an ambient decorator name,
      // the corpus's dominant shape — class-level or MEMBER-level) makes
      // the whole declaration a shell whose %init is exactly the throw.
      // Remaining MEMBER decorators stay named fences — a method/field
      // replacement would have to rebind vtable slots and initializer
      // chains at declaration time, and the standard context object
      // (addInitializer, access) has no static story yet. Parameter
      // decorators are not valid ES decorators — the checker rejects
      // them first.
      const classDecoratorNodes: ts.Decorator[] = [];
      {
        classDecoratorNodes.push(...decoratorNodesOf(decl));
        const decoratedMembers = decl.members.filter((m) => decoratorNodesOf(m).length > 0);
        if (classDecoratorNodes.length > 0 || decoratedMembers.length > 0) {
          // Node itself cannot execute decorator syntax in a JavaScript
          // source (V8 has not shipped the proposal; the type-stripping
          // loaders leave `@dec` in place) — there is no runtime behavior
          // to be exact against.
          if (isJsSourceFile(decl.getSourceFile())) {
            L.unsupported(
              "SC1090",
              (classDecoratorNodes[0] ?? decoratorNodesOf(decoratedMembers[0]!)[0])!,
              "decorators in JavaScript sources (V8 has not shipped decorators — Node cannot execute this file)",
            );
          }
        }
        {
          // The guaranteed-throw SHELL: declarations only (expressions
          // lower their throw at the expression — lowerClassExpression),
          // never instantiations/mixins (they share a family declaration).
          //
          // NOT gated on the class carrying decorators. It once was, when
          // an ambient DECORATOR was the only item that could throw here;
          // an `extends` clause naming an ambient `declare class` throws
          // at the same point in the same evaluation order, on a class
          // with no decorator anywhere in it.
          if (
            inst === undefined && mixin === undefined &&
            ts.isClassDeclaration(decl) && decl.typeParameters === undefined
          ) {
            const thrown = guaranteedDefinitionThrow(L, decl);
            if (thrown) {
              const className = L.classNamer(decl);
              const info: ClassInfo = {
                def: {
                  name: className,
                  jsName: jsNameOverride ?? decl.name?.text ?? "",
                  fields: [],
                  loc: locOf(decl),
                },
                fields: new Map(),
                fieldOrder: [],
                methods: new Map(),
                decl,
                ctor: null,
                ctorParams: [],
                base: null,
                subclasses: [],
                throwingSetters: [],
                staticFields: [],
                decorationThrows: {
                  name: thrown.name,
                  via: ts.isDecorator(thrown.node) ? "decoration" : "extends clause",
                },
                // The existing ambientThrow emission (lowerClassDecoration)
                // owns the %init: earlier expressions are all pure reads,
                // so the throw is the first observable effect.
                classDecorators: {
                  nodes: [thrown.node],
                  shapes: [{ kind: "ambientThrow", name: thrown.name }],
                },
              };
              L.classes.set(className, info);
              const classSymbol = decl.name
                ? L.checker.getSymbolAtLocation(decl.name)
                : declSymbolOf(L, decl);
              if (classSymbol) L.classBySymbol.set(classSymbol, info);
              return;
            }
          }
        }
        if (classDecoratorNodes.length > 0 || decoratedMembers.length > 0) {
          for (const member of decoratedMembers) {
            const dec = decoratorNodesOf(member)[0]!;
            const kind = ts.isMethodDeclaration(member)
              ? "method decorators"
              : ts.isGetAccessorDeclaration(member) || ts.isSetAccessorDeclaration(member)
                ? "accessor decorators"
                : ts.isPropertyDeclaration(member)
                  ? (member.modifiers?.some((m) => m.kind === ts.SyntaxKind.AccessorKeyword)
                      ? "auto-accessor decorators"
                      : "field decorators")
                  : "member decorators";
            L.unsupported(
              "SC1090",
              dec,
              `${kind} (the standard context object and member replacement have no static lowering — class decorators and provably-throwing ambient decorations compile)`,
            );
          }
        }
        if (classDecoratorNodes.length > 0) {
          // Each evaluation of a class EXPRESSION decorates a freshly
          // minted class; only once-evaluated declarations have a single
          // decoration event to lower.
          if (!ts.isClassDeclaration(decl)) {
            L.unsupported(
              "SC1090",
              classDecoratorNodes[0]!,
              "decorators on class expressions (each evaluation decorates a distinct class)",
            );
          }
          // A generic class declares ONCE in JS (one decoration event over
          // the one runtime Box) but compiles per instantiation here — the
          // family object is never constructed and the instantiations were
          // never individually decorated.
          if (decl.typeParameters !== undefined) {
            L.unsupported(
              "SC1090",
              classDecoratorNodes[0]!,
              "decorators on generic classes (JS decorates the one runtime class; the compiled family instantiates per type argument)",
            );
          }
        }
      }
      // An abstract class is a class nothing constructs directly — tsc
      // rejects `new` on it (through class values too), so no runtime
      // trap exists to lower. It collects like any class; only the flag
      // is recorded (abstract MEMBERS are per-member, below).
      const abstractClass = ts.getModifiers(decl)?.some((m) => m.kind === ts.SyntaxKind.AbstractKeyword) === true;
      // A GENERIC class declaration collects as its FAMILY (statics + the
      // instanceof interval; no instance members — those collect per
      // instantiation, `inst` set). Generic class EXPRESSIONS stay fenced:
      // each evaluation mints a distinct class in JS, and a distinct
      // FAMILY of classes has no once-evaluated story.
      const familyMode = decl.typeParameters !== undefined && inst === undefined;
      if (familyMode && !ts.isClassDeclaration(decl)) {
        L.unsupported("SC1090", decl, "generic class expressions");
      }
      const className = inst ? inst.name : mixin ? mixin.name : L.classNamer(decl); // program-wide qualified name

      // Single inheritance: `extends` of a class declared in the program.
      // tsc guarantees the base is declared before the derived class (its
      // use-before-declaration error), and collection runs in module order,
      // so the base's ClassInfo already exists here. An INSTANTIATION's
      // base is its family (whose base is the declared one) — the heritage
      // clause resolved when the family collected.
      let base: ClassInfo | null = inst ? inst.family : mixin ? mixin.base : null;
      // A family whose `extends` clause mentions its OWN type parameters
      // (`class D<T> extends Box<T>`) would need a different base per
      // instantiation — no single family interval can sit above all of
      // them. Named fence at the declaration.
      if (familyMode && decl.heritageClauses !== undefined) {
        const tpSyms = new Set<ts.Symbol>();
        for (const tp of decl.typeParameters!) {
          const s = L.checker.getSymbolAtLocation(tp.name);
          if (s) tpSyms.add(s);
        }
        for (const clause of decl.heritageClauses) {
          if (clause.token !== ts.SyntaxKind.ExtendsKeyword) continue;
          for (const t of clause.types) {
            let mentions = false;
            ts.walkPreorder(t, (n) => {
              const s = ts.isIdentifier(n) ? L.checker.getSymbolAtLocation(n) : undefined;
              if (s && tpSyms.has(s)) {
                mentions = true;
                return "stop";
              }
              return undefined;
            });
            if (mentions) {
              L.unsupported(
                "SC1090",
                t,
                "generic classes whose 'extends' clause mentions their own type parameters (each instantiation would need a different base)",
              );
            }
          }
        }
      }
      for (const clause of inst || mixin ? [] : (decl.heritageClauses ?? [])) {
        // `implements` is pure type-world: tsc checked the conformance and
        // the clause erases — nothing about the runtime class changes.
        // (Assigning an instance INTO an interface-typed slot is a separate
        // question, owned by the shape-coercion fences at those sites.)
        if (clause.token === ts.SyntaxKind.ImplementsKeyword) continue;
        const t = clause.types[0];
        // `extends events.EventEmitter` — the namespace-member spelling of
        // the ambient emitter base resolves like the named import.
        if (t && ts.isPropertyAccessExpression(t.expression) && ts.isIdentifier(t.expression.name)) {
          const memberSym = L.checker.getSymbolAtLocation(t.expression.name);
          const resolved =
            memberSym && memberSym.flags & ts.SymbolFlags.Alias
              ? L.checker.getAliasedSymbol(memberSym)
              : memberSym;
          const emitterBase = L.builtinEmitterInfoOf(resolved);
          const streamBaseNs = builtinStreamInfoOf(L, resolved);
          if (emitterBase || streamBaseNs) {
            if (t.typeArguments) L.unsupported("SC1090", t, "extending generic classes");
            base = (emitterBase ?? streamBaseNs)!;
            continue;
          }
          // `class Tower extends Shapes.Cube` — the namespace-qualified
          // base: the member resolves to the registered program class
          // (import= alias chains included), with the source-order guard
          // (the class statement evaluates at its init position; a base
          // block below it would still be uninitialized in Node).
          if (!t.expression.questionDotToken && nsMemberIdentOf(L, t.expression)) {
            if (t.typeArguments) L.unsupported("SC1090", t, "extending generic classes");
            if (memberSym) fenceEarlyNsMemberRef(L, t.expression, memberSym);
            const nsBase = resolved ? L.classBySymbol.get(resolved) : undefined;
            if (!nsBase) {
              L.unsupported(
                "SC1090",
                t,
                `extending the namespace member '${t.expression.name.text}' (no class lowering)`,
              );
            }
            base = nsBase;
            continue;
          }
          // `Common.O = class extends Common.I {}` — the base is a
          // PROPERTY-ASSIGNED class expression (the salsa expando form and
          // its CJS spellings `exports.I` / `module.exports.I`): the
          // member's single top-level assignment pins the class, so the
          // base resolves like a declaration. Source order guards the
          // same-file case — Node evaluates the extends clause at THIS
          // statement, and a base assigned below it is still undefined
          // here (TypeError at runtime; the fence is the honest answer).
          // Reassigned properties never reach this branch (the resolver
          // answers null for them) and keep the computed-expression fence:
          // the runtime base is whichever assignment ran last.
          if (!t.expression.questionDotToken) {
            const propBase = propertyAssignedClassInfoOf(L, memberSym);
            if (propBase) {
              if (t.typeArguments) L.unsupported("SC1090", t, "extending generic classes");
              const baseDecl = propBase.decl;
              if (
                baseDecl != null &&
                baseDecl.getSourceFile() === decl.getSourceFile() &&
                baseDecl.getStart() > decl.getStart()
              ) {
                L.unsupported(
                  "SC1090",
                  t,
                  `extending '${t.expression.getText()}' above the statement that assigns it (the property is still undefined when this class evaluates — Node throws here; assign the base first)`,
                );
              }
              base = propBase;
              continue;
            }
            // The REASSIGNED spelling of the same family gets its own
            // fence (the generic computed-expression one below would hide
            // what actually blocks it).
            const rebinds =
              memberSym !== undefined &&
              L.checker
                .declarationsOf(memberSym)
                .filter(
                  (d) =>
                    ts.isBinaryExpression(d) &&
                    d.operatorToken.kind === ts.SyntaxKind.EqualsToken,
                ).length > 1;
            if (rebinds) {
              L.unsupported(
                "SC1090",
                t,
                `extending the reassigned property '${t.expression.getText()}' (the runtime base is whichever assignment ran last — bind the class exactly once)`,
              );
            }
          }
        }
        // `class extends class {…} {…}` — a class-EXPRESSION base:
        // collect it recursively (JS evaluates the extends clause first,
        // so its statics queue ahead of the derived class's — the
        // recursion order delivers exactly that).
        if (t && ts.isClassExpression(t.expression)) {
          if (t.typeArguments) L.unsupported("SC1090", t, "extending generic classes");
          const baseExpr = L.lowerClassExpressionInfo(t.expression);
          base = baseExpr;
          continue;
        }
        // `class D extends Mixin(Base)` — a MIXIN call as the base: the
        // call's per-site instantiation (its heritage the argument class)
        // is the base — interval nesting, fields, and methods compose
        // through the monomorphized chain (lower-mixins.ts). A call whose
        // callee is NOT a mixin function keeps the computed-expression
        // fence below.
        if (t && ts.isCallExpression(t.expression) && !t.typeArguments) {
          const mixinBase = L.mixinCallClassInfoOf(t.expression);
          if (mixinBase) {
            base = mixinBase;
            continue;
          }
        }
        if (!t || !ts.isIdentifier(t.expression)) {
          L.unsupported("SC1090", clause, "extending computed expressions");
        }
        const symbol = L.resolveValueSymbol(t.expression);
        // `extends <ambient declare class>` on a class shape the throw
        // SHELL does not cover — a GENERIC family, a mixin instantiation,
        // a class EXPRESSION reached through lowerClassExpressionInfo.
        // The ambient class is still collected like a program class, so
        // `L.classBySymbol.get(symbol)` below would FIND it and this
        // derived class would inherit a fabricated base and run on past a
        // statement Node never gets through. Refuse loudly instead: the
        // shell answers exactly for the shape it covers, and everything
        // else says why rather than answering wrongly.
        if (ambientUndefinedClassSymbolOf(L, t.expression) !== null) {
          L.unsupported(
            "SC1090",
            t,
            `extending the ambient class '${t.expression.text}' that nothing defines (Node erases the declaration, so evaluating this 'extends' clause throws ReferenceError: ${t.expression.text} is not defined — a non-generic class declaration compiles to exactly that throw)`,
          );
        }
        // Extending a REBINDABLE decorated class (analysis already ran —
        // this collection is a class expression or a generic
        // instantiation demanded during lowering): the runtime base is
        // the decoration result, not the declaration. Declared
        // subclasses collected BEFORE analysis meet the same fence from
        // analyzeClassDecoration's subclasses check.
        {
          const directBase = symbol && L.classBySymbol.get(symbol);
          if (directBase && directBase.classDecorators?.valueGlobalId !== undefined) {
            L.unsupported(
              "SC1090",
              t,
              `extending the decorated class '${directBase.def.jsName ?? directBase.def.name}' (its decorators may replace it — the runtime base would be the decoration result)`,
            );
          }
          if (directBase) fenceDecorationThrows(L, directBase, t);
        }
        // `extends DOMException`: the runtime instance carries hidden
        // slots (the legacy code, the cause) BEYOND the ScrError prefix
        // the IR fields describe — a subclass layout would overlap them.
        if (L.builtinErrorInfoOf(symbol)?.def.name === "%DOMException") {
          L.unsupported(
            "SC1090",
            t,
            "extending DOMException (its runtime layout carries hidden slots a subclass would overlap — extend Error and set name/code yourself)",
          );
        }
        const named = (symbol && L.classBySymbol.get(symbol)) ?? L.builtinErrorInfoOf(symbol) ??
          L.builtinEmitterInfoOf(symbol) ?? builtinStreamInfoOf(L, symbol) ??
          // A const BINDING holding exactly one class (`const B = Animal`,
          // `const B = class {…}`): the base is that class — extends
          // through the alias is the declaration story (a general class
          // VALUE stays fenced: the runtime base would be dynamic).
          exactClassOfReceiver(L, t.expression) ??
          // A require BINDING of a class-expression whole export
          // (`const C = require('./x')` over `module.exports = class {…}`):
          // the alias resolves to the expression's own symbol — the same
          // declaration story, collected on demand.
          propertyAssignedClassInfoOf(L, symbol) ??
          // A const BINDING of a mixin call (`const Tagged = M(Base);
          // class D extends Tagged {}`): the binding pins that call's
          // instantiation — collected on demand (lower-mixins.ts).
          mixinResultBindingClassOf(L, symbol) ?? null;
        // `extends Box<number>` — a GENERIC program class as the base: the
        // base is the concrete INSTANTIATION, resolved through the heritage
        // type (mapType registers/reuses `Box%0`).
        if (named?.generic) {
          const instT = L.checker.getTypeAtLocation(t);
          const mappedBase = L.mapTypeOf(instT);
          const instBase = mappedBase?.kind === "object" ? L.classes.get(mappedBase.className) : undefined;
          if (!instBase || instBase.generic) {
            L.unsupported(
              "SC1090",
              t,
              `extending the generic class '${t.expression.text}' without a compiled concrete instantiation (the type arguments must map — see the instantiation's own diagnostic)`,
            );
          }
          base = instBase;
          continue;
        }
        if (t.typeArguments) L.unsupported("SC1090", t, "extending generic classes");
        base = named;
        if (!base) {
          L.unsupported(
            "SC1090",
            t,
            `extending classes not declared in the program ('${t.expression.text}')`,
          );
        }
      }

      const fields = new Map<string, IrType>(base ? base.fields : []);
      const symbolFields = new Map<ts.Symbol, string>(base?.symbolFields ?? []);
      const hiddenSymbolFields = new Set<string>(base?.hiddenSymbolFields ?? []);
      const fieldOrder: ClassInfo["fieldOrder"] = [];
      // Set when this class routes its own `code` declaration onto
      // ScrError's inherited code slot (the Error-rooted branch in the
      // member loop below): the layout prefix then names that slot
      // `code`, so ONE JS property answers through both the subclass's
      // field paths and the `%Error` view's error.code libCall.
      let routesErrorCode = false;
      const errorRootedBase = ((): boolean => {
        let r: ClassInfo | null = base;
        while (r && r.base) r = r.base;
        return r !== null && r.def.name === "%Error";
      })();
      const methods = new Map<string, { params: ParamShape[]; ret: IrType; abstract?: true; async?: true; gen?: { yieldT: IrType; nextT: IrType } }>();
      // Own accessor declarations ("get:x"/"set:x" → node), for the
      // partial-override analysis below (diagnostics need the node).
      const accessorNodes = new Map<string, ts.AccessorDeclaration>();
      /** Non-override methods whose collected return stayed dyn — the
       * symbol-slot refinement retries them after the constructor scan
       * declares this class's OWN symbol-keyed slots. */
      const dynRetMethods = new Map<string, ts.MethodDeclaration>();
      /** The class's own `emit` override in the forwarding shape (emitter-
       * rooted classes only) — recorded here, NEVER in `methods`, so emit
       * calls keep routing through the emitter spoke's dispatch. */
      let emitOverride: EmitOverrideRec | undefined;
      let ctor: ts.ConstructorDeclaration | null = null;
      /** Initializer-less fields whose type cannot hold undefined and whose
       * definite assignment tsc did NOT verify (a `!` assertion, or
       * strictPropertyInitialization off) — checked against the
       * constructor's top-level assignments after the member loop. */
      const unguardedFields: { node: ts.Node; name: string; why: string }[] = [];
      /** Parameter properties, in parameter order — spliced in FRONT of the
       * declared fields after the member loop (Node's layout, probed: the
       * transform hoists their definitions above every declared field). */
      const paramProps: NonNullable<ClassInfo["paramProps"]> = [];

      const staticFields: ClassInfo["staticFields"] = [];
      const staticMethods = new Map<string, { params: ParamShape[]; ret: IrType; member: ts.MethodDeclaration }>();
      const staticBlocks: ts.ClassStaticBlockDeclaration[] = [];
      // GENERIC methods (own type parameters), instance and static: only
      // the SYNTAX is checked here — parameter/return types mention the
      // type parameters and cannot map yet; bodies lower per call-site
      // instantiation (collectGenericSignature's rule, member form). The
      // `member.cls` backlink fills after the ClassInfo assembles below.
      const genericMethods = new Map<string, GenericFnInfo>();
      const genericStatics = new Map<string, GenericFnInfo>();
      // Accepts generic METHODS and instance FIELDS initialized with a
      // generic arrow/function expression (`time = async <T>(...) => {...}`
      // — the field form of a generic method: no closure slot can hold a
      // generic function, so the member collects aside like a method and
      // calls dispatch statically per instantiation; the arrow's lexical
      // `this` IS the instance, exactly the method's param 0). ASYNC
      // members collect too: a generic async instance is an async
      // IrFunction like any other (lowerGenericInstance), calls enter
      // through the instance's own spawn wrapper, and no vtable slot is
      // ever involved — generic members always dispatch statically.
      const collectGenericMember = (member: ts.MethodDeclaration | ts.PropertyDeclaration, isStatic: boolean): void => {
        const fnNode: ts.MethodDeclaration | ts.ArrowFunction | ts.FunctionExpression =
          ts.isPropertyDeclaration(member)
            ? (genericFieldFnNodeOf(member) as ts.ArrowFunction | ts.FunctionExpression)
            : member;
        if (!ts.isIdentifier(member.name) && !ts.isPrivateIdentifier(member.name)) {
          L.unsupported("SC1090", member, "computed generic method names");
        }
        if (fnNode.asteriskToken) L.unsupported("SC1071", member);
        const mName = (member.name as ts.Identifier | ts.PrivateIdentifier).text;
        const typeParams: ts.Symbol[] = [];
        for (const tp of fnNode.typeParameters!) {
          const sym = L.checker.getSymbolAtLocation(tp.name);
          if (!sym) L.unsupported("SC1090", member, "this method form");
          typeParams.push(sym);
        }
        for (const param of fnNode.parameters) {
          if (!ts.isIdentifier(param.name) && !ts.isObjectBindingPattern(param.name) && !ts.isArrayBindingPattern(param.name)) {
            L.unsupported("SC1031", param);
          }
        }
        (isStatic ? genericStatics : genericMethods).set(mName, {
          decl: fnNode,
          baseName: mName,
          qualifiedName: `%${className}.${isStatic ? "static:" : ""}${mName}`,
          typeParams,
          instances: new Map(),
        });
      };
      for (const member of decl.members) {
        if (ts.isClassStaticBlockDeclaration(member)) {
          // Statics live on the FAMILY (JS has one class, one static
          // storage, however many instantiations exist) — instantiations
          // skip them.
          if (inst) continue;
          // A static block is declaration-time CODE — Node runs it when the
          // class statement evaluates, referenced or not — so it collects
          // for %init lowering (lowerStaticFieldInits) instead of fencing.
          // `this` (and super) inside the block means the class constructor
          // value, which has no value form here: fenced at the reference,
          // with arrow functions transparent (they inherit the block's
          // `this`) and this-binding function forms opaque (their `this` is
          // their own).
          const checkThis = (n: ts.Node): void => {
            if (
              ts.isFunctionExpression(n) || ts.isFunctionDeclaration(n) ||
              ts.isMethodDeclaration(n) || ts.isConstructorDeclaration(n) ||
              ts.isGetAccessor(n) || ts.isSetAccessor(n) ||
              ts.isClassDeclaration(n) || ts.isClassExpression(n)
            ) {
              return;
            }
            if (n.kind === ts.SyntaxKind.ThisKeyword || n.kind === ts.SyntaxKind.SuperKeyword) {
              L.unsupported("SC1090", n, "'this' in class static blocks (it names the class — reference the class by name instead)");
            }
            n.forEachChild(checkThis);
          };
          member.body.forEachChild(checkThis);
          staticBlocks.push(member);
          continue;
        }
        const modifiers = ts.canHaveModifiers(member) ? ts.getModifiers(member) : undefined;
        if (modifiers?.some((m) => m.kind === ts.SyntaxKind.StaticKeyword)) {
          // Statics live on the FAMILY (one storage location for every
          // instantiation — JS's one class); instantiations skip them and
          // reach them through the base chain (findStaticOn).
          if (inst) continue;
          // The honest static subset: a field WITH an initializer is a
          // module global (mutable when not readonly) assigned once at
          // the class statement's position in module init and read as
          // `C.name` anywhere; a static METHOD is an ordinary module
          // function `%C.static:m`. No per-class runtime property table
          // exists, so the members that would need one — accessors, and
          // initializer-less fields (undefined until someone assigns
          // them) — keep the fence, each named at its use site.
          // #PRIVATE statics ride along under their spelled names
          // ('#count' → the module global %g.s.C.#count, '#make' → the
          // module function %C.static:#make): tsc confines every access
          // to the declaring class's body, and the resolution guard in
          // findStaticOn's callers keeps a SUBCLASS-named receiver
          // (`D.#s` — Node's brand TypeError) from resolving up the
          // chain. Class-VALUE receivers fence for privates (a classval
          // slot can hold a descendant at runtime, and only the declaring
          // class object carries the brand in JS).
          if (
            ts.isPropertyDeclaration(member) &&
            (ts.isIdentifier(member.name) || ts.isPrivateIdentifier(member.name)) &&
            member.initializer &&
            member.postfixToken?.kind !== ts.SyntaxKind.QuestionToken
          ) {
            const type = L.irTypeOf(member.name);
            if (type.kind === "void") L.badType(member.name, L.typeOf(member.name));
            if (type.kind === "dyn") {
              L.unsupported("SC1090", member.name, "'unknown'-typed static fields");
            }
            staticFields.push({
              name: member.name.text,
              type,
              initializer: member.initializer,
              globalId: `%g.s.${L.classNamer(decl)}.${member.name.text}`,
              readonly: modifiers.some((m) => m.kind === ts.SyntaxKind.ReadonlyKeyword),
            });
          }
          // Async statics collect like any static method: the module
          // function `%C.static:m` is an async IrFunction (fiber spawn
          // wrapper), no vtable in sight — statics never dispatch.
          if (
            ts.isMethodDeclaration(member) &&
            (ts.isIdentifier(member.name) || ts.isPrivateIdentifier(member.name)) &&
            member.body &&
            member.typeParameters === undefined &&
            member.asteriskToken === undefined
          ) {
            const { shapes, funcType: ft } = L.lambdaSignature(member);
            staticMethods.set(member.name.text, { params: shapes, ret: ft.ret, member });
          }
          // GENERIC static methods monomorphize like top-level generic
          // functions (`%C.static:m%n`), async ones included — a generic
          // async instance is an async module function entered through its
          // own spawn wrapper (the async-static precedent above, per
          // instantiation).
          if (
            ts.isMethodDeclaration(member) &&
            (ts.isIdentifier(member.name) || ts.isPrivateIdentifier(member.name)) &&
            member.body &&
            member.typeParameters !== undefined
          ) {
            collectGenericMember(member, true);
          }
          // Statics that don't qualify for the module-global/module-
          // function treatment (accessors, initializer-less fields,
          // async/generic methods) never live on instances, so they must
          // not poison the class either — constructions and instance
          // members stay compilable, and each USE of an unsupported
          // static fences at its own site.
          continue;
        }
        // INSTANCE members of a generic class collect per instantiation
        // (`inst` set, the type-parameter bindings threaded through every
        // mapType) — the family declares none.
        if (familyMode) continue;
        // 7's ClassElement base carries no `name`; read it structurally
        // (every named member kind stores a PropertyName there).
        const memberName = (member as { name?: ts.PropertyName }).name;
        // #PRIVATE members compile: their names ('#m') are unspellable by
        // any public identifier, so they ride the ordinary fields/methods
        // maps collision-free — with the base-chain walks doubling as
        // LEXICAL resolution because a subclass re-declaring an inherited
        // private NAME is fenced here (JS would give the two classes
        // DISTINCT private slots under one spelling; one name, one slot is
        // the static story — rename one). tsc guarantees every access site
        // sits inside the declaring class's body, and privates never
        // enter vtables (no redeclaration below ⇒ overrideBelow is false
        // ⇒ every call devirtualizes), which is exactly JS's semantics:
        // lexically bound, no dynamic dispatch, a subclass cannot
        // override.
        if (memberName && ts.isPrivateIdentifier(memberName)) {
          const pname = memberName.text;
          if (
            base !== null &&
            (base.fields.has(pname) ||
              L.findMethodOn(base, pname) !== null ||
              L.findMethodOn(base, `get:${pname}`) !== null ||
              L.findMethodOn(base, `set:${pname}`) !== null ||
              findGenericMethodOn(L, base, pname) !== null)
          ) {
            L.unsupported(
              "SC1090",
              memberName,
              `redeclaring the private name '${pname}' of a base class (JS gives each class its own distinct '${pname}' slot; these layouts have one slot per name — rename one)`,
            );
          }
        }
        // The EventEmitter API surface is runtime-provided: a subclass
        // member with one of its names would shadow behavior the runtime
        // dispatches internally (meta events, once removal), so the
        // override is fenced rather than silently split-brained — with ONE
        // exception: `emit` in the forwarding shape on a plain (non-
        // stream) emitter-rooted class monomorphizes per event name
        // (lower-emitter.ts's emit-overrides block). Stream-rooted classes
        // keep the fence for emit too: the runtime stream machinery emits
        // 'data'/'end'/... internally, which could never route through
        // the override.
        if (
          memberName && ts.isIdentifier(memberName) &&
          EMITTER_API_MEMBERS.has(memberName.text) &&
          (() => {
            for (let c = base; c; c = c.base) if (c.builtinEmitter) return true;
            return false;
          })()
        ) {
          const streamRooted = (() => {
            for (let c = base; c; c = c.base) if (c.builtinStream !== undefined) return true;
            return false;
          })();
          if (
            memberName.text === "emit" && !streamRooted && !inst && !mixin &&
            ts.isMethodDeclaration(member) &&
            !member.modifiers?.some((m) => m.kind === ts.SyntaxKind.StaticKeyword)
          ) {
            const reason = emitOverrideShapeReason(L, member);
            if (reason === null) {
              const eventSym = L.checker.getSymbolAtLocation(member.parameters[0]!.name);
              const restSym = L.checker.getSymbolAtLocation(member.parameters[1]!.name);
              if (eventSym && restSym) {
                emitOverride = { decl: member, eventSym, restSym };
                continue;
              }
            }
            // A pure super-delegation is erasable even when it is not the
            // SPECIALIZABLE forwarding shape: `emit(event: string |
            // symbol, ...args)` cannot be specialized per event (the
            // event parameter is not a string), but a body that is
            // nothing but `return super.emit(event, ...args)` does not
            // need to be — it observes nothing, so dropping it leaves the
            // runtime's own emit in place. Checked after the
            // specialization path so a conforming shape still takes it.
            if (erasableSuperDelegation(decl, member, "emit")) continue;
            L.unsupported(
              "SC1090",
              memberName,
              `overriding EventEmitter's 'emit' outside the forwarding shape (${reason ?? "its parameters do not resolve statically"}; the compiled form is \`emit(event: string, ...args: unknown[]): boolean\`)`,
            );
          }
          // A TYPE-ONLY override: the class re-declares an inherited
          // member purely to narrow its TypeScript signature, and the
          // body forwards verbatim to super. Nothing happens at runtime,
          // so the declaration is ERASED and the member goes on
          // dispatching into the runtime surface that owns it.
          //
          // Overload SIGNATURES (no body) are erased with it: they
          // declare nothing at runtime either, and whether they are
          // erasable is decided entirely by the implementation they
          // belong to — which is the declaration that would run.
          if (erasableSuperDelegation(decl, member, memberName.text)) continue;
          L.unsupported(
            "SC1090",
            memberName,
            `overriding the EventEmitter member '${memberName.text}' (the runtime owns the emitter surface)`,
          );
        }
        // The stream surface is likewise runtime-provided on stream-rooted
        // subclasses: API members (push/read/write/...) and the property
        // family (readableEnded/destroyed/...) dispatch into the runtime
        // state, so an override or shadowing field would split-brain.
        // Underscore methods are the SUPPORTED override form — but only
        // the ones the class's own base consumes (a `_read` on a
        // Transform, or `_writev`/`_construct` anywhere, would be consumed
        // by Node machinery that has no lowering here).
        if (memberName && ts.isIdentifier(memberName)) {
          const streamBase = (() => {
            for (let c = base; c; c = c.base) if (c.builtinStream) return c;
            return null;
          })();
          if (streamBase) {
            const name = memberName.text;
            if (STREAM_API_MEMBERS.has(name) || STREAM_PROP_MEMBERS.has(name)) {
              L.unsupported(
                "SC1090",
                memberName,
                `overriding the stream member '${name}' (the runtime owns the stream surface)`,
              );
            }
            if (name === "_writev" || name === "_construct") {
              L.unsupported(
                "SC1090",
                memberName,
                `declaring '${name}' on a stream subclass (${name === "_writev" ? "batched writes are" : "deferred construction is"} not lowered — writes deliver one chunk at a time)`,
              );
            }
            const accepted = streamCtorShape(streamBase.def.name).accepted;
            for (const [option, methodName] of UNDERSCORE_METHODS) {
              if (name === methodName && !accepted.includes(option)) {
                L.unsupported(
                  "SC1090",
                  memberName,
                  `declaring '${name}' on a ${streamBase.def.name.slice(1)} subclass (its constructor consumes ${accepted.map((a) => `'${UNDERSCORE_METHODS.get(a)}'`).join("/")})`,
                );
              }
            }
          }
        }
        if (ts.isPropertyDeclaration(member)) {
          // An ABSTRACT property declaration is erased at runtime — Node
          // defines NO field for it (verified: `abstract p: number` in the
          // base leaves the concrete subclass's own `p = 3` as the only
          // property, at the SUBCLASS's position in inspect order). So it
          // contributes nothing to the layout; the concrete subclass's
          // declaration is an ordinary OWN field (tsc guarantees every
          // instantiable subclass declares it and, under
          // strictPropertyInitialization, initializes it). Reads through
          // ABSTRACT-typed receivers have no slot to read and keep a
          // per-site fence.
          if (modifiers?.some((m) => m.kind === ts.SyntaxKind.AbstractKeyword)) continue;
          if (modifiers?.some((m) => m.kind === ts.SyntaxKind.AccessorKeyword)) {
            // `accessor x = 1` desugars (in JS) to a private slot plus a
            // get/set pair — declare the field and accessors explicitly.
            L.unsupported("SC1090", member, "auto-accessor fields ('accessor x')");
          }
          // #private fields ride the ordinary field machinery — the '#'
          // name is unspellable publicly, so the slot never collides, and
          // enumeration surfaces (inspect) exclude it like Node.
          if (!ts.isIdentifier(member.name) && !ts.isPrivateIdentifier(member.name)) {
            L.unsupported("SC1090", member, "computed field names");
          }
          // A field initialized with a GENERIC arrow/function expression
          // (`time = async <T>(label, fn) => {...}` — the Output.time
          // idiom): a generic MEMBER, not a field. No closure slot can
          // hold a generic function (the record-shape exclusion rule), so
          // the member collects like a generic method — no field slot,
          // static per-instantiation dispatch, `this` as param 0 (the
          // arrow's lexical `this` IS the instance). Reads of the field as
          // a VALUE and writes to it fence at their sites — there is no
          // slot — which enforces never-reassigned by construction.
          // Guarded on the member TYPE still carrying its type parameters:
          // an annotation that pins a concrete signature makes an ordinary
          // closure field, which the normal path below owns.
          if (
            genericFieldFnNodeOf(member) !== null &&
            isGenericCallableMemberType(L.typeOf(member.name), L.checker)
          ) {
            if (fields.has(member.name.text)) {
              L.unsupported("SC1090", member.name, "redeclaring inherited fields");
            }
            if (L.findMethodOn(base, member.name.text)) {
              L.unsupported("SC1090", member.name, "fields shadowing inherited methods");
            }
            if (findGenericMethodOn(L, base, member.name.text)) {
              L.unsupported(
                "SC1090",
                member.name,
                `redeclaring the inherited generic member '${member.name.text}' (generic members dispatch statically, so the base's call sites could never reach this redeclaration)`,
              );
            }
            collectGenericMember(member, false);
            continue;
          }
          // Non-generic fields shadowing an inherited GENERIC member split
          // the two dispatch worlds (static per-instantiation calls would
          // never see the field's value) — the method-vs-generic mixing
          // fence, field form.
          if (findGenericMethodOn(L, base, member.name.text)) {
            L.unsupported(
              "SC1090",
              member.name,
              `fields shadowing the inherited generic member '${member.name.text}' (generic members dispatch statically and would never reach this field's value)`,
            );
          }
          // OPTIONAL fields (`a?: string`) are the record-field precedent
          // applied to class shapes: the checker already types the slot
          // `string | undefined`, the allocation writes the interned
          // undefined arm (undefFieldInitLineC — Node defines the property
          // as undefined on construction, verified), and reads/writes ride
          // the ordinary undefined-armed union machinery.
          const type = L.irTypeOf(member.name);
          if (type.kind === "void") L.badType(member.name, L.typeOf(member.name));
          // A dyn (`unknown`-typed) class field stores a boxed dyn value,
          // exactly like a dyn local: the named slot holds a ScrDyn,
          // construction writes it, reads hand it back, reassignment and
          // destruction refcount it (verified byte-identical to Node,
          // refcounted values and reassignment included). Record fields and
          // array elements still reject dyn — those are anonymous positions
          // mapType cannot slot — so a dyn-field class projected to a record
          // still fences at the projection, as it should.
          // `code` on an ERROR-ROOTED class IS ScrError's inherited slot,
          // not a new field. The runtime lays Error out as [name, message,
          // code], and the `%Error` view answers `.code` by reading that
          // third slot through the error.code libCall. A subclass that
          // declared its own `code` used to get a SECOND slot laid out
          // after it, so the value answered through the subclass type and
          // `undefined` through every `Error`/ErrnoException view — Node
          // has ONE property and answers it either way (measured: `e.code`
          // and `(e as Error).code` both give the subclass's string).
          // Routing the declaration onto the inherited slot makes the two
          // views the same memory, which is the whole fix; the layout
          // rename at the def below is its other half.
          //
          // STRING only. The slot is a plain string, so a `code: number`
          // subclass keeps its own separate slot and its own (pre-existing,
          // unchanged) view divergence rather than taking a new fence —
          // turning a wrong answer into a refusal is not a fix, and
          // 1301-errors-subclass.ts is exactly that shape.
          //
          // Runs BEFORE the redeclare check because `%code` is deliberately
          // absent from the base's fields map: `fields.has("code")` is
          // false at the first routing class, and TRUE at any subclass of
          // one — which is why that case falls through to the ordinary
          // redeclare path (slot-exact, initializer required) unchanged.
          if (
            member.name.text === "code" &&
            errorRootedBase &&
            !fields.has("code") &&
            typeEquals(type, STRING)
          ) {
            routesErrorCode = true;
            fields.set("code", STRING);
            if (member.initializer) {
              fieldOrder.push({ name: "code", type, initializer: member.initializer, redeclared: true });
            } else {
              // No initializer: the inherited slot is already NULL, and
              // NULL is exactly what the `Error` view reports as absent —
              // Node's own answer for a bare redeclare — so construction
              // needs no write. A read before the constructor assigns it
              // would still hand NULL to a string slot, so it takes the
              // same definite-assignment guarantee every other field whose
              // type cannot hold undefined takes.
              const codeOpts = L.program.getCompilerOptions();
              const codeSpi = codeOpts.strictPropertyInitialization ?? codeOpts.strict ?? false;
              if (member.postfixToken?.kind === ts.SyntaxKind.ExclamationToken) {
                unguardedFields.push({
                  node: member.name,
                  name: "code",
                  why: "definite assignment assertions on fields not assigned at the constructor's top level ('code!' defers the first assignment past construction — the field would hold garbage, not undefined, until it runs; assign it in the constructor or include undefined in its type)",
                });
              } else if (!codeSpi) {
                unguardedFields.push({
                  node: member.name,
                  name: "code",
                  why: "initializer-less fields not assigned at the constructor's top level when strictPropertyInitialization is off (nothing guarantees 'code' is assigned before a read — enable the option, assign it unconditionally at the top of the constructor, or include undefined in its type)",
                });
              }
            }
            continue;
          }
          if (fields.has(member.name.text)) {
            // REDECLARING an inherited field: Node [[Define]]s the OWN
            // property again when THIS class's field initializers run
            // (after super()), so the base slot simply takes the new
            // value at that position — a slot-type-exact redeclare WITH
            // an initializer lowers as an assignment into the inherited
            // slot, no new slot, no layout change (the `class
            // ConfigError extends Error { name = "ConfigError" }`; the
            // builtin Error prefix included — reads, toString, and throw
            // reports all answer the overwritten name like Node). A BARE
            // redeclare writes undefined in Node (`class B extends A
            // { x; }` reads undefined!) and a type-changing redeclare has
            // no single slot type — both keep the fence.
            const baseType = fields.get(member.name.text)!;
            if (member.initializer && typeEquals(type, baseType)) {
              fieldOrder.push({ name: member.name.text, type, initializer: member.initializer, redeclared: true });
              continue;
            }
            L.unsupported(
              "SC1090",
              member.name,
              member.initializer
                ? "redeclaring inherited fields at a different type"
                : "redeclaring inherited fields without an initializer (Node resets the field to undefined)",
            );
          }
          if (L.findMethodOn(base, member.name.text)) {
            L.unsupported("SC1090", member.name, "fields shadowing inherited methods");
          }
          // Initializer-less fields whose type ADMITS undefined start as
          // JS's undefined (the allocation writes the interned undefined
          // arm — see the backend's undefFieldInitLineC), exactly Node's
          // fresh-instance read. A field whose type CANNOT hold undefined
          // has no honest pre-assignment value in these monomorphic
          // layouts — zeroed memory would read as garbage (0, NULL) where
          // Node reads undefined — so it needs a definite-assignment
          // guarantee. tsc's strictPropertyInitialization is that
          // guarantee; where the program waives it — a `x!: T` assertion,
          // or a project tsconfig with the option off (scriptc adopts the
          // project's strictness knobs) — the field goes on the deferred
          // list checked against the constructor after the member loop
          // (the constructor may be declared later in the class body).
          const admitsUndefined =
            (type.kind === "union" &&
              (L.unions.get(type.unionId)?.arms.some((a) => a.kind === "undefinedT") ?? false)) ||
            type.kind === "jsval";
          if (!member.initializer && !admitsUndefined) {
            const opts = L.program.getCompilerOptions();
            const spi = opts.strictPropertyInitialization ?? opts.strict ?? false;
            if (member.postfixToken?.kind === ts.SyntaxKind.ExclamationToken) {
              unguardedFields.push({
                node: member.name,
                name: member.name.text,
                why: `definite assignment assertions on fields not assigned at the constructor's top level ('${member.name.text}!' defers the first assignment past construction — the field would hold garbage, not undefined, until it runs; assign it in the constructor or include undefined in its type)`,
              });
            } else if (!spi) {
              unguardedFields.push({
                node: member.name,
                name: member.name.text,
                why: `initializer-less fields not assigned at the constructor's top level when strictPropertyInitialization is off (nothing guarantees '${member.name.text}' is assigned before a read — enable the option, assign it unconditionally at the top of the constructor, or include undefined in its type)`,
              });
            }
          }
          fields.set(member.name.text, type);
          fieldOrder.push({ name: member.name.text, type, initializer: member.initializer });
        } else if (ts.isConstructorDeclaration(member)) {
          // A body-less constructor is an OVERLOAD SIGNATURE: type-world,
          // lowers to nothing — tsc resolved each `new` against the
          // signatures, and construction flows through the implementation's
          // ABI (its parameter types are supersets by the
          // overload-compatibility rules).
          if (!member.body) continue;
          if (ctor) L.unsupported("SC1090", member, "constructor overloads");
          // PARAMETER PROPERTIES (`constructor(public x: number)`): pure
          // sugar — the parameter declares a field and assigns it from the
          // parameter's value. Visibility (public/private/protected) and
          // readonly/override are type-world; the field is an ordinary
          // property at runtime. The field's type is the parameter's BODY
          // type (paramShape's contract: the plain T of a defaulted
          // `public x = e`, the `T | undefined` union of `public x?: T`) —
          // exactly what the ctor's body local carries, so the synthesized
          // assignment is slot-exact. Layout/inspect position and
          // assignment order are Node's, probed exactly: the fields define
          // FIRST (before every declared field, as undefined), and the
          // assignments run after super() and the field initializers, in
          // parameter order (see paramPropInitStmts).
          for (const p of member.parameters) {
            const isParamProp = p.modifiers?.some(
              (m) =>
                m.kind === ts.SyntaxKind.PublicKeyword ||
                m.kind === ts.SyntaxKind.PrivateKeyword ||
                m.kind === ts.SyntaxKind.ProtectedKeyword ||
                m.kind === ts.SyntaxKind.ReadonlyKeyword ||
                m.kind === ts.SyntaxKind.OverrideKeyword,
            );
            if (!isParamProp) {
              // Non-keyword modifiers (parameter decorators) are rejected
              // by tsc under standard decorators; defensive.
              if (p.modifiers?.length) L.unsupported("SC1090", p, "this parameter form");
              continue;
            }
            // tsc rejects binding patterns (TS1187) and rest params
            // (TS1317) as parameter properties; defensive.
            if (!ts.isIdentifier(p.name) || p.dotDotDotToken) {
              L.unsupported("SC1090", p, "this parameter property form");
            }
            const name = (p.name as ts.Identifier).text;
            const shape = L.paramShape(p);
            const type = shape.bodyType ?? shape.type;
            if (type.kind === "void") L.badType(p.name, L.typeOf(p.name));
            // The class-field dyn rule verbatim: a dyn parameter property is
            // a boxed dyn slot, like a dyn declared field.
            // `override x` (and any same-named inherited member) would
            // redeclare a base slot — the declared-field rule verbatim.
            if (fields.has(name)) {
              L.unsupported("SC1090", p.name, "redeclaring inherited fields");
            }
            if (L.findMethodOn(base, name)) {
              L.unsupported("SC1090", p.name, "fields shadowing inherited methods");
            }
            paramProps.push({ name, type, param: p });
          }
          ctor = member;
        } else if (ts.isMethodDeclaration(member)) {
          const mName = classMemberNameOf(L, member.name);
          if (mName === null) L.unsupported("SC1090", member, "computed method names");
          // PUBLIC generator METHODS stay fenced (virtualCall dispatch
          // over gen-spawn wrappers has no story yet); module-level
          // function* and object-literal *methods compile — and #PRIVATE
          // generator methods (`*#walk()`) compile below: privates never
          // enter vtables (a subclass redeclaration is fenced, so
          // overrideBelow can never flip), every call is a direct call the
          // emitter routes through the gen-spawn wrapper with `this` as
          // param 0 — the async-method precedent, generator form.
          if (member.asteriskToken !== undefined && !ts.isPrivateIdentifier(member.name)) {
            L.unsupported(
              "SC1071",
              member,
              "generator methods (a #private generator method compiles — privates never dispatch dynamically; or declare a module-level function* and call it from the method)",
            );
          }
          // An async #private generator (`async *#m()`) is still an async
          // generator — the blanket SC1071 fence.
          if (
            member.asteriskToken !== undefined &&
            member.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)
          ) {
            L.unsupported("SC1071", member, "async generators (async function*)");
          }
          // An ABSTRACT method is a signature with no body — type-world,
          // except that it declares the vtable slot: calls through
          // base-typed receivers are ordinary virtual dispatch, and tsc
          // guarantees every instantiable subclass implements it (so a
          // dispatch can never land on the empty declaration). It enters
          // `methods` (marked abstract) for slot declaration and the
          // override-exactness rule; no module function ever exists.
          if (ts.getModifiers(member)?.some((m) => m.kind === ts.SyntaxKind.AbstractKeyword)) {
            // A GENERIC abstract method has no body to monomorphize —
            // per-call-site instantiation needs a nearest declarer WITH a
            // body, which an abstract declaration never has.
            if (member.typeParameters !== undefined) {
              L.unsupported(
                "SC1090",
                member,
                "abstract generic methods (generic methods monomorphize from the nearest declaration's body, and an abstract declaration has none)",
              );
            }
            const { shapes, ret } = abstractMemberSignature(L, member);
            if (fields.has(mName)) {
              L.unsupported("SC1090", member.name, "methods shadowing inherited fields");
            }
            if (findGenericMethodOn(L, base, mName)) {
              L.unsupported(
                "SC1090",
                member.name,
                `overriding the inherited generic method '${mName}' with a non-generic method (generic methods dispatch statically and would never reach this override)`,
              );
            }
            // Abstract re-declarations keep the overridden ABI exactly,
            // like any override (a concrete implementation below must
            // agree with BOTH, which exactness makes one constraint).
            const overridden = L.findMethodOn(base, mName);
            if (
              overridden &&
              (overridden.sig.params.length !== shapes.length ||
                !overridden.sig.params.every((p, i) => typeEquals(p.type, shapes[i]!.type)) ||
                !typeEquals(overridden.sig.ret, ret))
            ) {
              L.unsupported(
                "SC1090",
                member.name,
                "overriding a method with a different signature (parameter and return types must match the base declaration exactly)",
              );
            }
            methods.set(mName, { params: shapes, ret, abstract: true });
            continue;
          }
          // A body-less method is an OVERLOAD SIGNATURE (abstract methods
          // collected above): type-world, exactly the constructor story.
          if (!member.body) continue;
          // GENERIC methods (own type parameters): collected aside — never
          // in `methods` (no single ABI signature, no vtable slot); bodies
          // lower per call-site instantiation as `%C.m%n`. Mixing generic
          // and non-generic declarations of one name across the hierarchy
          // fences (the two dispatch worlds — static per-instantiation
          // calls vs vtable slots — cannot see each other's overrides).
          if (member.typeParameters !== undefined) {
            if (fields.has(mName)) {
              L.unsupported("SC1090", member.name, "methods shadowing inherited fields");
            }
            if (findGenericMethodOn(L, base, mName)) {
            // A generic method owns no vtable slot, so every call resolves
            // on the receiver's STATIC class and `genericOverrideBelow` is
            // the only thing that catches a call which could land on this
            // override. That query reads `subclasses`, which is complete
            // only for classes collected in collectProgram's declaration
            // window -- a class EXPRESSION, or a class declared inside a
            // function body, registers when its containing statement
            // lowers, and a call compiled before that point already chose
            // the base's body. Refuse rather than answer, by name: the
            // alternative is a program that prints the base's answer where
            // Node prints the override's, at exit 0.
            if (!L.collectingClassDecls) {
              L.unsupported(
                "SC1090",
                member.name,
                `overriding the inherited generic method '${mName}' from a class expression or a class declared inside a function (generic methods dispatch statically, and this class is collected too late for calls already compiled to see it -- declare the class at module top level)`,
              );
            }
            }
            if (L.findMethodOn(base, mName)) {
              L.unsupported(
                "SC1090",
                member.name,
                `overriding the inherited method '${mName}' with a generic method (generic methods dispatch statically, so the base's vtable slot could never reach this override)`,
              );
            }
            collectGenericMember(member, false);
            continue;
          }
          // Async METHODS in JS classes simply do not COLLECT — each call
          // fences at its own site (the JS deferral stance, the
          // async-static precedent above), so a class whose driven
          // surface is synchronous still compiles (commander: parse()
          // works, parseAsync() traps where called). TS async methods
          // collect below like any method: the body is an async
          // IrFunction (fiber spawn wrapper, `this` as param 0), calls
          // dispatch STATICALLY — override chains fence (the vtable slot
          // machinery has no fiber-spawn story), so every call site is a
          // direct call the emitter routes through the spawn wrapper.
          if (
            member.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) &&
            isJsSourceFile(decl.getSourceFile())
          ) {
            continue;
          }
          // IMPLICIT-ANY monomorphization (npm-static JS): a method whose
          // signature carries bindable untyped params collects like a
          // GENERIC method — into genericMethods, no vtable slot, one
          // instance per call-site type tuple (the untyped params ARE the
          // type parameters; see lower-calls' implicit section). DECLINES
          // (falls through to the normal all-dyn ABI) wherever the two
          // dispatch worlds could meet: an inherited VTABLE declaration of
          // the name (the override belongs on the slot), a shadowed field,
          // or a generic-class instantiation's member.
          //
          // An inherited GENERIC declaration is NOT such a meeting: neither
          // end owns a vtable slot, so both dispatch statically and the
          // whole family stays in one world. Overriding it collects here
          // too — `genericOverrideBelow` is what keeps that sound, fencing
          // by name at any call whose receiver's runtime class could be the
          // subclass without the static type proving it (see
          // lowerClassGenericMethodCall). This is the shape mysql2's
          // `PoolConnection.end(callback)` over `BaseConnection.end(callback)`
          // has, and every JS class hierarchy that overrides an untyped
          // method has it.
          if (
            implicitMonoFile(decl.getSourceFile()) &&
            ts.isIdentifier(member.name) &&
            inst === undefined && decl.typeParameters === undefined &&
            !fields.has(member.name.text) &&
            !L.findMethodOn(base, member.name.text)
          ) {
            const implicit = implicitAnyParamSymbolsOf(L, member);
            if (implicit && findGenericMethodOn(L, base, member.name.text)) {
            // A generic method owns no vtable slot, so every call resolves
            // on the receiver's STATIC class and `genericOverrideBelow` is
            // the only thing that catches a call which could land on this
            // override. That query reads `subclasses`, which is complete
            // only for classes collected in collectProgram's declaration
            // window -- a class EXPRESSION, or a class declared inside a
            // function body, registers when its containing statement
            // lowers, and a call compiled before that point already chose
            // the base's body. Refuse rather than answer, by name: the
            // alternative is a program that prints the base's answer where
            // Node prints the override's, at exit 0.
            if (!L.collectingClassDecls) {
              L.unsupported(
                "SC1090",
                member.name,
                `overriding the inherited generic method '${member.name.text}' from a class expression or a class declared inside a function (generic methods dispatch statically, and this class is collected too late for calls already compiled to see it -- declare the class at module top level)`,
              );
            }
            }
            if (implicit) {
              genericMethods.set(member.name.text, {
                decl: member,
                baseName: member.name.text,
                qualifiedName: `%${className}.${member.name.text}`,
                typeParams: [],
                instances: new Map(),
                implicitParams: implicit,
              });
              continue;
            }
          }
          const { shapes, funcType: ft } = L.lambdaSignature(member);
          if (fields.has(mName)) {
            L.unsupported("SC1090", member.name, "methods shadowing inherited fields");
          }
          if (findGenericMethodOn(L, base, mName)) {
            L.unsupported(
              "SC1090",
              member.name,
              `overriding the inherited generic method '${mName}' with a non-generic method (generic methods dispatch statically and would never reach this override)`,
            );
          }
          // Symbol-slot return refinement, INHERITED slots (own ctor-declared
          // slots refine in the post-scan pass below — the constructor hasn't
          // been scanned yet here, but base slots are already in
          // symbolFields/fields). Doing it before the exactness check keeps
          // a derived override of a refined base method agreeing.
          if (ft.ret.kind === "dyn") {
            const refined = symbolSlotReturnType(L, member, symbolFields, fields);
            if (refined) ft.ret = refined;
          }
          // Overrides keep the EXACT overridden ABI signature. tsc's method
          // bivariance would let a narrowed parameter type through, and a
          // vtable-dispatched call could then hand the override a base
          // instance it reads out-of-bounds fields from — exactness keeps
          // every slot sound (covariant returns can come later). Comparing
          // ABI types only (not modes) is deliberate: call sites complete
          // against the STATIC receiver's shape, so `m(x?: number)` and
          // `m(x: number | undefined)` interchange soundly in overrides.
          const overridden = L.findMethodOn(base, mName);
          if (overridden?.declarer.builtinError) {
            // Error.prototype.toString is a runtime implementation with no
            // vtable slot — calls to it are direct, so an override could
            // never be reached through a base-typed receiver.
            L.unsupported(
              "SC1090",
              member.name,
              `overriding the builtin Error method '${mName}'`,
            );
          }
          if (
            overridden &&
            (overridden.sig.params.length !== shapes.length ||
              !overridden.sig.params.every((p, i) => typeEquals(p.type, shapes[i]!.type)) ||
              !typeEquals(overridden.sig.ret, ft.ret))
          ) {
            L.unsupported(
              "SC1090",
              member.name,
              "overriding a method with a different signature (parameter and return types must match the base declaration exactly)",
            );
          }
          const asyncMember =
            member.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) === true;
          // Async methods dispatch STATICALLY (the body enters through its
          // fiber spawn wrapper; vtable slots hold raw implementations) —
          // an override chain touching an async method on either end would
          // put a spawn wrapper behind a virtual slot, so it fences.
          if (overridden && (asyncMember || overridden.sig.async === true)) {
            L.unsupported(
              "SC1090",
              member.name,
              `overriding ${overridden.sig.async === true ? "the async method" : "a method with an async method"} '${mName}' (async methods dispatch statically — the vtable slot machinery has no fiber-spawn story)`,
            );
          }
          // A #private GENERATOR method carries its channels on the sig:
          // the body lowers as a generator IrFunction (`this` as param 0),
          // and every call — direct by construction — enters through the
          // emitted gen-spawn wrapper, answering the suspended generator.
          if (member.asteriskToken !== undefined) {
            if (ft.ret.kind !== "generator") L.badType(member.name, L.typeOf(member.name));
            methods.set(mName, { params: shapes, ret: ft.ret, gen: { yieldT: ft.ret.yieldT, nextT: ft.ret.nextT } });
          } else {
            methods.set(mName, asyncMember ? { params: shapes, ret: ft.ret, async: true as const } : { params: shapes, ret: ft.ret });
          }
          // Overrides keep the inherited ABI exactly, so only non-override
          // methods may still refine once the ctor scan runs.
          if (ft.ret.kind === "dyn" && !overridden) {
            dynRetMethods.set(mName, member);
          }
        } else if (ts.isGetAccessor(member) || ts.isSetAccessor(member)) {
          // Accessors are methods with property syntax: `get x()` collects
          // as the method entry "get:x" (a name no user identifier can
          // spell, so it can never collide with a real method) and `set x`
          // as "set:x" — every downstream mechanism (override exactness,
          // whole-program devirtualization, vtable slots, may-throw) then
          // applies verbatim, with the get and set halves independent.
          const isGet = ts.isGetAccessor(member);
          // #private accessors collect as "get:#x"/"set:#x" — the same
          // reserved spelling, one more unspellable segment.
          if (!ts.isIdentifier(member.name) && !ts.isPrivateIdentifier(member.name)) {
            L.unsupported("SC1090", member, "computed accessor names");
          }
          // ABSTRACT accessors are the abstract-method story with property
          // syntax: body-less by definition, they enter `methods` (marked
          // abstract) as their "get:x"/"set:x" halves — slot declaration
          // and override exactness verbatim; no module function exists.
          const abstractAccessor =
            ts.getModifiers(member)?.some((m) => m.kind === ts.SyntaxKind.AbstractKeyword) === true;
          if (!member.body && !abstractAccessor) L.unsupported("SC1090", member, "bodyless accessors");
          const prop = member.name.text;
          const mName = `${isGet ? "get" : "set"}:${prop}`;
          if (fields.has(prop)) {
            // tsc rejects field/accessor mixing (TS2610/2611); defensive.
            L.unsupported("SC1090", member.name, "accessors sharing a name with a field");
          }
          let sig: { params: ParamShape[]; ret: IrType };
          if (isGet) {
            const ret = L.declaredReturnType(member, member.name);
            if (ret.kind === "void") L.badType(member.name, L.typeOf(member.name));
            sig = { params: [], ret };
          } else {
            // tsc rejects optional/default/rest setter params (TS1051-53).
            sig = { params: L.paramShapes(member.parameters), ret: VOID };
          }
          // One property, ONE type: tsc (5.1+) admits get/set pairs with
          // unrelated annotated types; a property slot here has a single
          // IR type, so the pair must agree exactly.
          const twin = methods.get(`${isGet ? "set" : "get"}:${prop}`);
          const twinType = twin ? (isGet ? twin.params[0]!.type : twin.ret) : null;
          const ownType = isGet ? sig.ret : sig.params[0]!.type;
          if (twinType && !typeEquals(twinType, ownType)) {
            L.unsupported(
              "SC1090",
              member.name,
              `getter/setter pairs with different types (the property '${prop}' must have one type)`,
            );
          }
          // Same exactness rule as methods — an accessor override keeps
          // the overridden accessor's type (getter return / setter param).
          const overridden = L.findMethodOn(base, mName);
          if (
            overridden &&
            (overridden.sig.params.length !== sig.params.length ||
              !overridden.sig.params.every((p, i) => typeEquals(p.type, sig.params[i]!.type)) ||
              !typeEquals(overridden.sig.ret, sig.ret))
          ) {
            L.unsupported(
              "SC1090",
              member.name,
              "overriding an accessor with a different type (the property type must match the base declaration exactly)",
            );
          }
          methods.set(mName, abstractAccessor ? { ...sig, abstract: true } : sig);
          // Abstract accessors stay OUT of accessorNodes: they are erased
          // at runtime (nothing shadows an inherited pair, nothing needs a
          // synthesized throwing setter) — the partial-override analysis
          // below reasons about accessors that EXIST on the instance.
          if (!abstractAccessor) accessorNodes.set(mName, member);
        } else if (ts.isIndexSignatureDeclaration(member)) {
          L.unsupported("SC1090", member, "index signatures");
        } else if (!ts.isSemicolonClassElement(member)) {
          L.unsupported("SC1090", member, `syntax '${ts.SyntaxKind[member.kind]}'`);
        }
      }

      // Parameter properties join the shape FIRST among own fields —
      // Node's transform hoists their definitions above every declared
      // field (probed: `constructor(public x, private w)` after a declared
      // `z` still prints `{ x, w, z }`), so layout/inspect order follows.
      // No definite-assignment analysis applies: the constructor assigns
      // them unconditionally (paramPropInitStmts).
      if (paramProps.length > 0) {
        // `code` routes onto ScrError's inherited slot from a PARAMETER
        // property too, by the same rule and into the same slot — the two
        // spellings of "an Error subclass carrying a code" must not
        // disagree about which memory holds it. Same shape as the declared
        // field: no own slot, and paramPropInitStmts' unconditional
        // assignment writes the prefix slot (which is also why this needs
        // no definite-assignment note — the constructor always assigns).
        const ppRoutesCode = (pp: { name: string; type: IrType }): boolean =>
          errorRootedBase && pp.name === "code" && !fields.has("code") && typeEquals(pp.type, STRING);
        for (const pp of paramProps) {
          if (ppRoutesCode(pp)) routesErrorCode = true;
        }
        const ppRouted = routesErrorCode ? paramProps.some((pp) => pp.name === "code") : false;
        for (const pp of paramProps) fields.set(pp.name, pp.type);
        fieldOrder.unshift(...paramProps.map((pp) =>
          ppRouted && pp.name === "code"
            ? { name: pp.name, type: pp.type, initializer: undefined, redeclared: true as const }
            : { name: pp.name, type: pp.type, initializer: undefined }));
      }

      // The deferred definite-assignment check: a field on the unguarded
      // list passes only with an unconditional `this.x = ...` at the
      // constructor's TOP LEVEL — the same standard the JS-class path
      // below applies to constructor-declared fields. Anything less
      // (conditional branches, assignment in a method, no constructor at
      // all) leaves a window where Node reads undefined and these layouts
      // would read zeroed memory, so it fences instead.
      const deferredInitFields = new Set<string>(base?.deferredInitFields ?? []);
      const collectedFields = new Set<string>(base?.collectedFields ?? []);
      const absentTrackedFields = new Set<string>(base?.absentTrackedFields ?? []);
      if (unguardedFields.length > 0) {
        const topAssigned = new Set<string>();
        for (const stmt of ctor?.body?.statements ?? []) {
          if (
            ts.isExpressionStatement(stmt) &&
            ts.isBinaryExpression(stmt.expression) &&
            stmt.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
            ts.isPropertyAccessExpression(stmt.expression.left) &&
            stmt.expression.left.expression.kind === ts.SyntaxKind.ThisKeyword
          ) {
            topAssigned.add(stmt.expression.left.name.text);
          }
        }
        for (const f of unguardedFields) {
          if (topAssigned.has(f.name)) continue;
          // DEFERRED INITIALIZATION (the Output.initialize idiom —
          // `stream!: T` assigned inside a method the constructor calls):
          // the slot becomes the undefined-armed union — allocation writes
          // the interned undefined (Node's pre-assignment value), writes
          // wrap, and reads CHECKED-extract the declared type, trapping a
          // genuinely-unassigned read with the catchable TypeError.
          // Only single-arm declared types take the deferral (the checked
          // extraction targets one arm); union-typed `!` fields keep the
          // fence.
          const declared = fields.get(f.name);
          const armable =
            declared !== undefined && !isUnitType(declared) &&
            declared.kind !== "union" && declared.kind !== "jsval" && declared.kind !== "dyn" &&
            declared.kind !== "map" && declared.kind !== "generator" && declared.kind !== "void" &&
            declared.kind !== "caught";
          const armed = armable ? L.withUndefinedArm(declared) : null;
          if (armed !== null && armed.kind === "union") {
            fields.set(f.name, armed);
            const fo = fieldOrder.find((x) => x.name === f.name);
            if (fo) fo.type = armed;
            deferredInitFields.add(f.name);
            continue;
          }
          L.unsupported("SC1090", f.node, f.why);
        }
      }

      // Partial overrides of an inherited accessor pair. JS gives the
      // derived class ONE own accessor property that SHADOWS the whole
      // inherited pair — the missing half does NOT resolve to the base's
      // (verified against Node):
      //   - getter-only override where the chain has a setter: a write
      //     through a base-typed reference (tsc-clean — the base has a
      //     setter) throws TypeError at runtime. Matched exactly: a
      //     synthesized throwing setter fills the derived class's slot.
      //   - setter-only override where the chain has a getter: a read
      //     through a base-typed reference yields undefined — a value
      //     these property types cannot represent. Rejected.
      const throwingSetters: string[] = [];
      for (const [mName, node] of accessorNodes) {
        const prop = mName.slice(4);
        if (mName.startsWith("get:") && !accessorNodes.has(`set:${prop}`)) {
          // An ABSTRACT inherited setter is erased at runtime — there is
          // no accessor pair to shadow, so no throwing setter to
          // synthesize (tsc makes an instantiable class implement it, and
          // that implementation shadows nothing either).
          const baseSet = L.findMethodOn(base, `set:${prop}`);
          if (baseSet && baseSet.sig.abstract !== true) {
            if (!typeEquals(baseSet.sig.params[0]!.type, methods.get(mName)!.ret)) {
              // Unreachable when the base pair agrees (induction through
              // the exactness rule); a base setter-only + new getter of a
              // different type would break the slot signature.
              L.unsupported("SC1090", node.name, "accessors whose getter and inherited setter types differ");
            }
            methods.set(`set:${prop}`, { params: [baseSet.sig.params[0]!], ret: VOID });
            throwingSetters.push(prop);
          }
        }
        if (mName.startsWith("set:") && !accessorNodes.has(`get:${prop}`)) {
          // The abstract-inherited-getter case is the same erasure story.
          const baseGet = L.findMethodOn(base, `get:${prop}`);
          if (baseGet && baseGet.sig.abstract !== true) {
            L.unsupported(
              "SC1090",
              node.name,
              `overriding only the setter of an inherited accessor pair (JS shadows the inherited getter — reads of '${prop}' would yield undefined; declare the getter too)`,
            );
          }
        }
      }

      // JavaScript classes declare fields by ASSIGNMENT: `this.x = v` in
      // the constructor IS the declaration (checkJs infers the property —
      // its type is the checker's, exactly like an annotated field). The
      // supported form is a definite assignment at the constructor's TOP
      // LEVEL, in source order — the layout is then as fixed as a TS field
      // list and the assignment itself doubles as the initializer (fields
      // are zero until the ctor body runs, same as TS's ctor-assigned
      // declared fields). Properties the checker infers from anywhere else
      // (conditional branches, methods) would be readable before any
      // assignment ran — the zeroed-memory trap a TS declaration order
      // forbids via strictPropertyInitialization — so they keep a named
      // fence instead of a silent undefined.
      if (isJsSourceFile(decl.getSourceFile())) {
        // Named classes (declarations and self-binding expressions) resolve
        // by name; the nameless default-export declaration by its module's
        // default-export symbol.
        const classSym = decl.name ? L.checker.getSymbolAtLocation(decl.name) : ts.isClassDeclaration(decl) ? declSymbolOf(L, decl) : undefined;
        const instType = classSym ? L.checker.getDeclaredTypeOfSymbol(classSym) : undefined;
        // LATE-BOUND properties (the checker's `__@name@id` spelling —
        // `this[kLimit] = v` where kLimit is a unique symbol const) by
        // their KEY symbol: the scan below needs the checker's property
        // type (tsc types computed declarations with unique-symbol keys
        // statically, exactly like named ones) but getSymbolAtLocation
        // answers null on element-access declaration sites, so the link
        // goes through the key.
        const lateBoundByKey = new Map<ts.Symbol, ts.Symbol>();
        for (const p of instType ? L.checker.getPropertiesOfType(instType) : []) {
          if (!p.name.startsWith("__@")) continue;
          const keySym = lateBoundKeySymOf(L, p);
          if (keySym) lateBoundByKey.set(keySym, p);
        }
        if (ctor?.body) {
          for (const stmt of ctor.body.statements) {
            const lhs =
              ts.isExpressionStatement(stmt) &&
              ts.isBinaryExpression(stmt.expression) &&
              stmt.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken
                ? stmt.expression.left
                : null;
            if (
              lhs && ts.isPropertyAccessExpression(lhs) &&
              lhs.expression.kind === ts.SyntaxKind.ThisKeyword
            ) {
              const assign = lhs;
              const name = assign.name.text;
              // Later assignments to an already-declared field (own or
              // inherited) are writes, not declarations.
              if (fields.has(name)) continue;
              if (methods.has(name) || L.findMethodOn(base, name)) {
                L.unsupported("SC1090", assign, "constructor-assigned fields shadowing methods");
              }
              const sym = L.checker.getSymbolAtLocation(assign);
              const t = sym ? L.checker.getTypeOfSymbol(sym) : undefined;
              // Implicit-any fields (assigned from UNTYPED ctor params —
              // countdown.js's `this.limit = limit`) take the JS checked-
              // dynamic fallback like every JS binding: the slot holds a dyn
              // box, reads validate per use, writes convert in (dynFrom).
              // TS-annotated `unknown` fields keep their fence (KEEP NARROW
              // applies where an annotation could say better).
              // ...but ONLY where a dyn box represents the inference
              // (dynBoxIsFaithful). The method scan below has admitted
              // exactly this set since it started collecting, and this
              // scan admitted EVERYTHING — so `this.m = new Map()` at the
              // constructor's top level took a dyn slot, which has no
              // method table, and answered `m.size` as `undefined` and
              // `m.set(...)` as "this.m.set is not a function" at run
              // time. Node says `0` and `1`.
              //
              // That was not just a wrong answer, it was the wrong answer
              // this fence's own REMEDY produced: `SC1090 fields assigned
              // outside the constructor's top level` refuses the same
              // `this.m = new Map()` in a method and tells the reader to
              // "assign it unconditionally at the top of the
              // constructor" — into the slot that silently misbehaves.
              // The two scans now agree in both directions, and the
              // refusal that lands here names the real blocker (Map keys
              // are limited to numbers and strings), which a JSDoc `@type`
              // on the field can answer.
              let type = t
                ? (L.mapTypeOf(t) ?? (dynBoxLosesMethodTable(L, t) ? null : dynFallbackType(L, assign, t)))
                : null;
              if (!type || type.kind === "void") L.badType(assign, t ?? L.typeOf(assign));
              // A JSDoc claim the BODY contradicts (`@type {Command}`
              // assigned `undefined` — the lazy-init idiom): the
              // representation follows the body — the field widens to the
              // undefined-armed union, so the declaring assignment and
              // every pre-init read carry Node's actual undefined.
              // Trust-but-verify: the claim never silently narrows the
              // runtime value.
              {
                const rhsT = L.typeOf(((stmt as ts.ExpressionStatement).expression as ts.BinaryExpression).right);
                const assignsUndef = (rhsT.flags & ts.TypeFlags.Undefined) !== 0;
                // A READ of the field EARLIER IN THIS CONSTRUCTOR than the
                // assignment that declares it. In Node the property does not
                // exist yet and the read answers `undefined`; a plain static
                // slot answers the calloc zero instead — measured, `0`
                // against Node's `undefined`, which is the zeroed-memory
                // trap this whole scan exists to avoid, firing inside the
                // supported form. The slot takes the undefined arm for the
                // same reason the JSDoc-contradiction case above does.
                const readsFirst =
                  ctor?.body !== undefined &&
                  ctorReadsBeforeDeclaration(ctor.body, name, assign.getStart());
                const admitsUndef =
                  type.kind === "dyn" ||
                  isUnitType(type) ||
                  (type.kind === "union" && L.armTag(type.unionId, UNDEFINED_T) >= 0);
                if ((assignsUndef || readsFirst) && !admitsUndef) {
                  const widened = L.withUndefinedArmOf(type);
                  if (widened !== null) type = widened;
                }
              }
              fields.set(name, type);
              fieldOrder.push({ name, type, initializer: undefined });
              continue;
            }
            // `this[kLimit] = v` at the constructor's top level with a
            // STATICALLY-RESOLVABLE unique-symbol key (uniqueSymbolKeyOf's
            // contract — the countdown.js idiom): the key is a compile-time
            // identity, so the member is an ordinary hidden field of the
            // static layout under Node's inspect spelling; no runtime
            // symbol table exists. Its type is the checker's late-bound
            // property type, through the same JS checked-dynamic fallback
            // as named fields. Keys that DON'T resolve fall through to the
            // late-bound fence below.
            if (
              lhs && ts.isElementAccessExpression(lhs) &&
              lhs.expression.kind === ts.SyntaxKind.ThisKeyword
            ) {
              const key = uniqueSymbolKeyOf(L, lhs.argumentExpression);
              if (!key) continue;
              // A key already declared (own or inherited) makes later
              // assignments writes, not declarations.
              if (symbolFields.has(key.sym)) continue;
              if (fields.has(key.fieldName)) {
                // Two DISTINCT Symbol(...) consts with one description in
                // one layout would need one printable name for two slots.
                L.unsupported(
                  "SC1090",
                  lhs,
                  `distinct symbol keys sharing the printable name '${key.fieldName}' in one class`,
                );
              }
              const propSym = lateBoundByKey.get(key.sym);
              // tsgo does not synthesize the late-bound `__@name@id`
              // property for a JS `this[k] = v` declaration (the finding-5
              // family: no expando/late-bound synthesis in its stricter
              // CJS-JS modeling), so when the key found no property the
              // field's type comes from the SAME inference source 5.9.3's
              // property type did — the declaring assignment's RHS, widened.
              const rhs =
                ts.isExpressionStatement(stmt) && ts.isBinaryExpression(stmt.expression)
                  ? stmt.expression.right
                  : undefined;
              const t = propSym
                ? L.checker.getTypeOfSymbol(propSym)
                : rhs
                  ? L.checker.getBaseTypeOfLiteralType(L.checker.getTypeAtLocation(rhs))
                  : undefined;
              const type = t ? (L.mapTypeOf(t) ?? dynFallbackType(L, lhs, t)) : null;
              if (!type || type.kind === "void") L.badType(lhs, t ?? L.typeOf(lhs));
              fields.set(key.fieldName, type);
              symbolFields.set(key.sym, key.fieldName);
              fieldOrder.push({ name: key.fieldName, type, initializer: undefined });
            }
          }
        }
        // Every OTHER inferred instance property — assigned only in
        // methods, only in conditional constructor positions, or via
        // computed keys — is undefined until its first write, which these
        // static layouts cannot represent. Named fence, at the first
        // assignment site.
        for (const p of instType ? L.checker.getPropertiesOfType(instType) : []) {
          if (fields.has(p.name) || methods.has(p.name)) continue;
          if (methods.has(`get:${p.name}`) || methods.has(`set:${p.name}`)) continue;
          if (base && (base.fields.has(p.name) || L.findMethodOn(base, p.name))) continue;
          const site = L.checker.declarationsOf(p).find(
            (d) =>
              ts.isPropertyAccessExpression(d) || ts.isBinaryExpression(d) ||
              ts.isElementAccessExpression(d),
          );
          if (!site) continue;
          // Late-bound properties: the ones the scan above collected are
          // real fields under their printable names — skip. The rest keep
          // a fence that names the supported form: keys that are runtime
          // identities (symbol parameters, Symbol.for consts, computed
          // descriptions) or assignments outside the constructor's top
          // level.
          if (p.name.startsWith("__@")) {
            const keySym = lateBoundKeySymOf(L, p);
            if (keySym && symbolFields.has(keySym)) continue;
            L.unsupported(
              "SC1090",
              site,
              "symbol-keyed class fields outside the supported form (a module-level `const k = Symbol('desc')` key, assigned unconditionally at the top of the constructor)",
            );
          }
          // JS classes: a property first assigned in a method or a
          // conditional constructor position holds `undefined` until the
          // write runs — exactly representable as the undefined-armed
          // union of the inferred property type, so the field COLLECTS
          // (pre-write reads answer undefined, like Node) instead of
          // poisoning the class (commander's `this.required` switch
          // assignment, `this.runningCommand` method assignment).
          // Unmappable inferences and arm-less kinds keep the fence.
          // TypeScript classes keep the loud fence too: an annotated
          // program can spell `T | undefined` itself.
          if (isJsSourceFile(decl.getSourceFile())) {
            const armed = undefArmedFieldType(L, p, site);
            if (armed !== null) {
              fields.set(p.name, armed);
              fieldOrder.push({ name: p.name, type: armed, initializer: undefined });
              collectedFields.add(p.name);
              if (undefArmIsAbsenceOnly(L, p, armed, site)) absentTrackedFields.add(p.name);
              continue;
            }
          }
          // The remedy this fence names — "assign it unconditionally at the
          // top of the constructor" — has to be a remedy that WORKS. For a
          // Map/Set/Date/RegExp field it is not one: the top-level scan
          // refuses the same inference there (dynBoxLosesMethodTable), so
          // the reader would move the line and meet a second refusal about
          // something else. Name the real blocker instead, and the
          // annotation that answers it.
          const propT = L.checker.getTypeOfSymbol(p);
          if (dynBoxLosesMethodTable(L, propT)) {
            L.unsupported(
              "SC1090",
              site,
              `fields holding a '${L.checker.typeToString(propT)}' the inference cannot compile (moving the assignment to the constructor's top level does NOT help — that slot would be checked-dynamic, which carries no method table for this builtin; annotate the element/key types with a JSDoc '@type' on the declaring assignment so the container itself compiles)`,
            );
          }
          // THE REMEDY HAS TO BE ONE THAT WORKS, and which one works
          // depends on WHERE the write is. Both arms below were compiled
          // and run against node v25.9.0 before being written here.
          //
          // Inside a CALLBACK there is no move to make: the value is the
          // callback's own parameter. The deferred-callback rule above now
          // COMPILES that shape outright; what still lands here is the
          // same position with an inference that rule declines — a rest
          // parameter, a signature carrying properties, a field the source
          // assigns two unrelated shapes. For those a JSDoc '@type' on a
          // top-level pre-initialisation is what reaches a binary
          // (measured: with it both shapes match node byte for byte;
          // without it the reader moves the line, lands in a
          // checked-dynamic slot, and meets a second fence about the CALL
          // instead — which is the afternoon this diagnostic used to cost).
          if (assignedInsideCallback(site)) {
            L.unsupported(
              "SC1090",
              site,
              `fields assigned inside a callback rather than at the constructor's top level ('this.${p.name}' is undefined until the callback runs, and when its value comes from the callback's own parameters the assignment cannot be moved out at all — give the field a static type instead: a JSDoc '@type' on a 'this.${p.name} = undefined' at the top of the constructor)`,
            );
          }
          L.unsupported(
            "SC1090",
            site,
            `fields assigned outside the constructor's top level ('this.${p.name}' would be undefined until the first assignment runs — assign it unconditionally at the top of the constructor)`,
          );
        }
      }

      // HIDDEN symbol slots declared by `Object.defineProperty` elsewhere
      // in the program (definePropSlotSiteOf's shape). Unlike the JS
      // constructor scan above this is NOT a JavaScript-only story: the
      // idiom exists precisely because TypeScript cannot declare a symbol
      // member on a class it does not own, so a TS program can only spell
      // it this way. The slot's type is the descriptor value's, WIDENED BY
      // AN UNDEFINED ARM, because the property does not exist until the
      // define runs and a read before then answers undefined — Node's
      // answer, and the same representation `undefArmedFieldType` gives the
      // JS assigned-in-a-method fields (undefFieldInitLineC initializes it
      // to the interned undefined instance, so a fresh instance reads
      // undefined, never a calloc NULL). Sites whose value types disagree,
      // or whose type cannot take the arm, declare NOTHING and keep every
      // fence: one slot cannot hold two representations.
      for (const [keySym, slot] of L.definePropSymbolSlots(decl) ?? []) {
        if (symbolFields.has(keySym)) continue;
        if (fields.has(slot.fieldName)) {
          // Two distinct Symbol(...) consts with one description would need
          // one printable name for two slots — the constructor scan's rule.
          L.unsupported(
            "SC1090",
            slot.values[0]!,
            `distinct symbol keys sharing the printable name '${slot.fieldName}' in one class`,
          );
        }
        let vt: IrType | null = null;
        let agree = true;
        for (const v of slot.values) {
          const m = L.mapTypeOf(L.checker.getBaseTypeOfLiteralType(L.checker.getTypeAtLocation(v)));
          if (!m || m.kind === "void" || (vt !== null && !typeEquals(vt, m))) {
            agree = false;
            break;
          }
          vt = m;
        }
        if (!agree || vt === null) continue;
        const armed = L.withUndefinedArmOf(vt);
        if (armed === null) continue;
        fields.set(slot.fieldName, armed);
        symbolFields.set(keySym, slot.fieldName);
        hiddenSymbolFields.add(slot.fieldName);
        fieldOrder.push({ name: slot.fieldName, type: armed, initializer: undefined });
        if (process.env["SCRIPTC_DEFPROP_WHY"]) {
          process.stderr.write(`[defprop] slot ${className}.${slot.fieldName} : ${L.fmt(armed)} (${slot.values.length} site(s))\n`);
        }
      }

      // The RUN-TIME property table — one dyn field, and only for the
      // classes some `Object.defineProperty(<an instance>, <a string
      // key>, desc)` site in the program names (definePropTableSiteOf).
      // It is deliberately NOT on every class: it is 8 bytes and a
      // traced edge per instance, and the whole point of a compiled
      // class is that the property set is the layout.
      //
      // Inherited through `fields` like every other field, so a subclass
      // of a table-carrying base has the table too — which is right,
      // because the receiver's STATIC type decides where the field is
      // declared and its RUNTIME type decides nothing.
      // receiverClassDeclOf already refuses a declaration file and any
      // source the program did not tag, so a runtime builtin can never
      // reach this set — the guard is that recognizer's, not a second one.
      const ownPropsTable = L.definePropStringTable(decl);
      const hasPropsTable = ownPropsTable || base?.hasPropsTable === true;
      if (ownPropsTable && !fields.has(CLASS_PROPS_FIELD)) {
        fields.set(CLASS_PROPS_FIELD, DYN);
        fieldOrder.push({ name: CLASS_PROPS_FIELD, type: DYN, initializer: undefined });
        if (process.env["SCRIPTC_DEFPROP_WHY"]) {
          process.stderr.write(`[defprop] table ${className}.${CLASS_PROPS_FIELD}\n`);
        }
      }

      // Second refinement chance, OWN symbol slots: the member loop ran
      // before the constructor scan declared this class's own symbol-keyed
      // fields, so methods returning those slots (1731's `extra()` —
      // `return this[kExtra]`) retry here with the layout complete.
      for (const [mName, node] of dynRetMethods) {
        const sig = methods.get(mName);
        if (!sig || sig.ret.kind !== "dyn") continue;
        const refined = symbolSlotReturnType(L, node, symbolFields, fields);
        if (refined) sig.ret = refined;
      }

      // The mixin FORWARDING constructor — `constructor(...args: any[]) {
      // super(...args); … }`: under monomorphization the base's signature
      // is known, so the instantiation's ABI IS the base's — synthetic
      // params forward to super unchanged (defaults apply in the base's
      // own prologue, exactly JS's raw-argument forwarding) and the rest
      // parameter never materializes. A rest constructor in a mixin that
      // is NOT the pure forwarding shape has no static story — named
      // fence, never a mis-typed array.
      const mixinForwarding = mixin !== undefined && ctor !== null && mixinForwardingCtor(L, ctor);
      if (mixin && ctor && !mixinForwarding && ctor.parameters.some((p) => p.dotDotDotToken)) {
        L.unsupported(
          "SC1090",
          ctor.parameters.find((p) => p.dotDotDotToken)!,
          "mixin constructors whose rest parameter does anything but forward (`super(...args)` as the first statement is the compiled shape)",
        );
      }
      // Constructor omitted on a derived class: it inherits the base's
      // (tsc types `new Derived(...)` against the inherited signature; the
      // synthesized constructor forwards the same params to super).
      const ctorParams: ParamShape[] = ctor && !mixinForwarding
        ? L.paramShapes(ctor.parameters)
        : (base?.ctorParams ?? []);

      const info: ClassInfo = {
        def: {
          name: className,
          // The JS-observable .name (the class object's name string and
          // what `C.name` folds to): the declared name, or NamedEvaluation's
          // answer for class expressions ("" when truly anonymous). An
          // INSTANTIATION prints its family's name — JS has one `Box`.
          jsName: jsNameOverride ?? decl.name?.text ?? "",
          ...(base ? { base: base.def.name } : {}),
          // Layout order: the base chain's fields as an IDENTICAL prefix,
          // then this class's own — what makes an upcast a reinterpret.
          // Redeclared INHERITED fields contribute no slot (their
          // initializers assign the prefix slot).
          fields: [
            // A class that routed its own `code` onto ScrError's inherited
            // slot names that slot `code` in ITS OWN layout: same index,
            // same type, same memory. Upcasts stay reinterprets (they are
            // positional, never by name), and the struct member the
            // subclass's field paths spell is now the very prefix slot the
            // `Error` view's error.code reads through `(ScrError *)`. This
            // is what keeps the whole change inside the frontend: no
            // backend, validator, IR or runtime layout knows about it.
            ...(base?.def.fields ?? []).map((f) => (routesErrorCode && f.name === "%code" ? { ...f, name: "code" } : f)),
            ...fieldOrder.filter((f) => f.redeclared !== true).map((f) => ({ name: f.name, type: f.type })),
          ],
          ...(methods.size > 0 ? { methods: [...methods.keys()] } : {}),
          ...(abstractClass ? { abstract: true as const } : {}),
          ...((): { abstractMethods?: string[] } => {
            const am = [...methods.entries()].filter(([, s]) => s.abstract === true).map(([n]) => n);
            return am.length > 0 ? { abstractMethods: am } : {};
          })(),
          ...(inst ? { genericOf: inst.family.def.name } : {}),
          loc: locOf(decl),
        },
        fields,
        fieldOrder,
        methods,
        decl,
        ...(emitOverride !== undefined ? { emitOverride } : {}),
        ctor,
        ctorParams,
        ...(paramProps.length > 0 ? { paramProps } : {}),
        base,
        subclasses: [],
        throwingSetters,
        staticFields,
        ...(staticMethods.size > 0 ? { staticMethods } : {}),
        ...(staticBlocks.length > 0 ? { staticBlocks } : {}),
        ...(symbolFields.size > 0 ? { symbolFields } : {}),
        ...(hiddenSymbolFields.size > 0 ? { hiddenSymbolFields } : {}),
        ...(hasPropsTable ? { hasPropsTable: true as const } : {}),
        ...(classDecoratorNodes.length > 0 ? { classDecorators: { nodes: classDecoratorNodes } } : {}),
        ...(deferredInitFields.size > 0 ? { deferredInitFields } : {}),
        ...(collectedFields.size > 0 ? { collectedFields } : {}),
        ...(absentTrackedFields.size > 0 ? { absentTrackedFields } : {}),
      };
      // GENERIC members get their declaring-class backlink now that the
      // info exists (instance lowering reads it for `this` typing and the
      // generic-class binding merge).
      if (genericMethods.size > 0) {
        for (const gm of genericMethods.values()) gm.member = { cls: info, kind: "method" };
        info.genericMethods = genericMethods;
      }
      if (genericStatics.size > 0) {
        for (const gs of genericStatics.values()) gs.member = { cls: info, kind: "static" };
        info.genericStatics = genericStatics;
      }
      if (inst) {
        info.genericInstance = {
          family: inst.family,
          bindings: inst.bindings,
          typeArgsText: inst.typeArgsText,
          ordinal: inst.ordinal,
        };
      }
      if (mixin) {
        info.mixinInstance = {
          call: mixin.call,
          bindings: mixin.bindings,
          context: mixin.context,
          ordinal: mixin.ordinal,
          ...(mixinForwarding ? { forwardingCtor: true } : {}),
        };
      }
      if (familyMode) {
        const typeParams: ts.Symbol[] = [];
        for (const tp of decl.typeParameters!) {
          const sym = L.checker.getSymbolAtLocation(tp.name);
          if (!sym) L.unsupported("SC1090", tp, "this type parameter form");
          typeParams.push(sym);
        }
        info.generic = {
          decl: decl as ts.ClassDeclaration,
          baseName: decl.name?.text ?? "%anon",
          typeParams,
          family: info,
          instances: new Map(),
        };
        L.genericClassByDecl.set(decl, info.generic);
      }
      if (base) base.subclasses.push(info);
      L.classes.set(className, info);
      // A NAMED class binds its name (declarations in their scope, class
      // expressions inside their own bodies — tsc resolves both to this
      // symbol); a nameless default-export declaration binds its module's
      // default-export symbol; anonymous expressions have nothing to bind.
      // Instantiations bind nothing — the FAMILY owns the symbol. A mixin
      // instantiation binds nothing either: the inner class's name would
      // alias EVERY instantiation (self-references by name inside mixin
      // classes fence at their use sites).
      const classSymbol = inst || mixin
        ? undefined
        : decl.name ? L.checker.getSymbolAtLocation(decl.name) : ts.isClassDeclaration(decl) ? declSymbolOf(L, decl) : undefined;
      if (classSymbol) L.classBySymbol.set(classSymbol, info);
      // Static-field storage registers with the module's globals only
      // once the whole shape collected (a poisoned class never leaves a
      // half-registered global behind).
      for (const f of staticFields) {
        L.globalsList.push({ id: f.globalId, name: `${info.def.jsName ?? className}.${f.name}`, type: f.type, mutable: !f.readonly });
      }
    }
  }

/** mapType's generic-class hook: the INSTANTIATION a concrete type
   * reference (`Box<number>`) names — registered on first demand. The
   * instance's NAME reserves its key before the shape collects, so
   * self-referential layouts (`next: Box<T> | null`) re-enter here and
   * take the name without recursing; a poisoned collection (a field type
   * with no lowering under these bindings — the diagnostic carries the
   * instantiation context) leaves the entry poisoned and the type
   * unmapped, the fenced-JS-class story. Null answers (unmappable type
   * arguments, the instance cap, an uncollected family) make the whole
   * reference unmappable — per-site diagnostics own the fence. */
  export function genericClassInstanceType(L: Lowerer, decl: ts.ClassLikeDeclaration, ref: ts.Type): IrType | null {
    const gci = L.genericClassByDecl.get(decl);
    if (!gci) {
      // The family never collected (a deferred/poisoned declaration): the
      // pre-generics answer — the class's own name, unregistered, so dead
      // storage prunes (typeNamesUnregisteredClass) and live references
      // flush the declaration's deferred diagnostics (moduleArtifacts /
      // the validator backstop). Exactly the fenced-class story.
      return { kind: "object", className: L.classNamer(decl) };
    }
    // A degenerate reference collapses to the FAMILY's object type instead
    // of going unmapped: `Box<any>` under a static build, wilder arguments
    // no instantiation can carry (`X<<T>() => T>`), and the instance cap.
    // The family is nominal Box-ness with only the INHERITED layout: no
    // value can be CONSTRUCTED at such a type (construction resolves
    // instantiations and fences), real instantiations may UPCAST into its
    // slots (the ancestor rule — `let b: Box<any> = new Box(1)`), interval
    // instanceof answers for the whole family, inherited concrete fields
    // read through the shared prefix, and every per-instantiation member
    // keeps a named per-site fence.
    const familyT: IrType = { kind: "object", className: gci.family.def.name };
    // The checker appends `this` (and outer type parameters) to
    // getTypeArguments — only the declaration's own count participates.
    const args = L.checker.getTypeArguments(ref as ts.TypeReference).slice(0, gci.typeParams.length);
    const mapped: IrType[] = [];
    if (args.length === gci.typeParams.length) {
      for (const a of args) {
        const m = L.mapTypeOf(a);
        if (!m || m.kind === "void") {
          // An UNBOUND type parameter argument (`Box<T>` outside any
          // instantiation) stays honestly unmapped — nothing concrete is
          // being named; everything else degrades to the family.
          return a.flags & ts.TypeFlags.TypeParameter ? null : familyT;
        }
        mapped.push(m);
      }
    } else {
      // No argument list — the `this` TYPE inside the generic class's own
      // body (`this.v = v` types the receiver as `this`, not a reference).
      // Inside an instantiation the CURRENT bindings are the arguments;
      // anywhere else the reference is honestly unmappable.
      for (const tp of gci.typeParams) {
        const b = L.typeParamBindings?.get(tp);
        if (!b) return null;
        mapped.push(b);
      }
    }
    const key = mapped.map(typeKey).join(",");
    const existing = gci.instances.get(key);
    if (existing) {
      return existing.poisoned ? null : { kind: "object", className: existing.name };
    }
    // The generic-fn cap, same rationale (polymorphic recursion through
    // class fields would mint instances forever). mapType has no
    // diagnostic channel — the family answer keeps the site compilable
    // where the OBJECT itself is never touched; touched members fence.
    if (gci.instances.size >= MAX_GENERIC_INSTANCES) return familyT;
    const ordinal = gci.instances.size;
    const name = `${gci.family.def.name}%${ordinal}`;
    const entry: { name: string; info: ClassInfo | null; poisoned?: boolean } = { name, info: null };
    gci.instances.set(key, entry);
    const bindings = new Map<ts.Symbol, IrType>();
    gci.typeParams.forEach((tp, i) => bindings.set(tp, mapped[i]!));
    const rendered = mapped.map((m) => L.fmt(m)).join(", ");
    const typeArgsText = `<${rendered.length > 80 ? rendered.slice(0, 77) + "..." : rendered}>`;
    const prevBindings = L.typeParamBindings;
    const prevContext = L.instantiationContext;
    L.typeParamBindings = bindings;
    L.instantiationContext = `instantiating class '${gci.baseName}' with ${typeArgsText}`;
    try {
      L.collectClassShapeInner(decl, undefined, { family: gci.family, name, bindings, typeArgsText, ordinal });
    } catch (e) {
      // Collection fenced under THESE bindings: the diagnostic (with the
      // instantiation context) is recorded; the type stays unmapped.
      if (!(e instanceof PoisonError)) throw e;
      entry.poisoned = true;
      return null;
    } finally {
      L.typeParamBindings = prevBindings;
      L.instantiationContext = prevContext;
    }
    const info = L.classes.get(name);
    if (!info) {
      entry.poisoned = true;
      return null;
    }
    entry.info = info;
    L.genericClassInstances.push(info);
    L.onLateClassCollected?.(info);
    return { kind: "object", className: name };
  }

/** Runs a member-lowering thunk under an INSTANTIATION's type-parameter
   * bindings (the generic-fn typeParamResolver mechanism) — the checker
   * keeps reporting the unsubstituted `T`s inside the shared body AST.
   * Coverage counts a generic class's statements once: only the FIRST
   * instantiation contributes (the lowerGenericInstance rule). A no-op
   * for ordinary classes. */
  export function withInstanceBindings<T>(L: Lowerer, info: ClassInfo, fn: () => T): T {
    const gi = info.genericInstance;
    if (!gi) {
      // MIXIN instantiations ride the same mechanism: T (the base
      // parameter's type parameter) resolves to the argument's classval,
      // fences carry the instantiation context, and only the first
      // instantiation of a mixin's class counts toward coverage.
      const mi = info.mixinInstance;
      if (!mi) return fn();
      const prevBindings = L.typeParamBindings;
      const prevContext = L.instantiationContext;
      const prevSuppress = L.suppressStats;
      const prevMixinCtx = L.mixinTypeContext;
      L.typeParamBindings = mi.bindings;
      L.instantiationContext = mi.context;
      L.suppressStats = prevSuppress || mi.ordinal > 0;
      L.mixinTypeContext = { classNode: info.decl!, className: info.def.name };
      try {
        return fn();
      } finally {
        L.typeParamBindings = prevBindings;
        L.instantiationContext = prevContext;
        L.suppressStats = prevSuppress;
        L.mixinTypeContext = prevMixinCtx;
      }
    }
    const prevBindings = L.typeParamBindings;
    const prevContext = L.instantiationContext;
    const prevSuppress = L.suppressStats;
    L.typeParamBindings = gi.bindings;
    L.instantiationContext = `instantiating class '${gi.family.generic?.baseName ?? info.def.jsName ?? ""}' with ${gi.typeArgsText}`;
    L.suppressStats = prevSuppress || gi.ordinal > 0;
    try {
      return fn();
    } finally {
      L.typeParamBindings = prevBindings;
      L.instantiationContext = prevContext;
      L.suppressStats = prevSuppress;
    }
  }

/** The `%init` statements for one class's static readonly fields AND
   * static blocks, interleaved in member order — emitted at the class
   * statement's source position (see lowerFileInit's merge), exactly when
   * JS evaluates static initializers and blocks. Field failures poison per
   * field, like fieldInitStmts; a block lowers as the block statement it
   * is, so its statements poison individually inside lowerStmts. */
  export function lowerStaticFieldInits(L: Lowerer, info: ClassInfo): IrStmt[] {
    // Mixin instantiations lower their initializers under the
    // instantiation's bindings/context (a no-op for everything else —
    // generic FAMILIES own their statics and carry no genericInstance).
    return withInstanceBindings(L, info, () => lowerStaticFieldInitsInner(L, info));
  }

  function lowerStaticFieldInitsInner(L: Lowerer, info: ClassInfo): IrStmt[] {
    // Decoration first: TC39 evaluates decorator expressions, creates the
    // class, applies the decorators, and only THEN runs static field
    // initializers and static blocks (verified against Node — the
    // decorated result is what `this`/the class name mean inside them).
    const out: IrStmt[] = [...lowerClassDecoration(L, info)];
    type Item =
      | { pos: number; kind: "field"; f: ClassInfo["staticFields"][number] }
      | { pos: number; kind: "block"; b: ts.ClassStaticBlockDeclaration };
    const items: Item[] = [
      ...info.staticFields.map((f): Item => ({ pos: f.initializer.getStart(), kind: "field", f })),
      ...(info.staticBlocks ?? []).map((b): Item => ({ pos: b.getStart(), kind: "block", b })),
    ].sort((a, b) => a.pos - b.pos);
    for (const item of items) {
      if (item.kind === "block") {
        // The block's body IS a Block statement: lowerStmts scopes its
        // let/const like any nested block and poisons per inner statement.
        out.push(...L.lowerStmts([item.b.body]));
        continue;
      }
      const f = item.f;
      L.stats.statementsTotal++;
      L.bumpFileStat(locOf(f.initializer).file, "total");
      try {
        // `this` in a static field initializer names the CLASS (like a
        // static block's), with arrows transparent and this-binding
        // function forms opaque — the static-block rule verbatim, named
        // here so the generic outside-a-method fence never fires first.
        const checkThis = (n: ts.Node): void => {
          if (
            ts.isFunctionExpression(n) || ts.isFunctionDeclaration(n) ||
            ts.isMethodDeclaration(n) || ts.isConstructorDeclaration(n) ||
            ts.isGetAccessor(n) || ts.isSetAccessor(n) ||
            ts.isClassDeclaration(n) || ts.isClassExpression(n)
          ) {
            return;
          }
          if (n.kind === ts.SyntaxKind.ThisKeyword || n.kind === ts.SyntaxKind.SuperKeyword) {
            L.unsupported("SC1090", n, "'this' in static field initializers (it names the class — reference the class by name instead)");
          }
          n.forEachChild(checkThis);
        };
        checkThis(f.initializer);
        const value = L.lowerExprExpecting(f.initializer, f.type);
        out.push({ kind: "assign", localId: f.globalId, value, loc: locOf(f.initializer) });
      } catch (e) {
        if (!(e instanceof PoisonError)) throw e;
        L.stats.statementsFailed++;
        L.bumpFileStat(locOf(f.initializer).file, "failed");
      }
    }
    return out;
  }

/** Post-collection analysis of a decorated class (all shapes registered —
   * a decorator's return type may name a subclass declared BELOW the
   * class). Classifies every class-level decorator by its checker type:
   * exactly one parameter, itself a classval the decorated class legally
   * flows into (the class, or a base sharing its completed constructor
   * ABI — the classval widening rule), returning void/undefined (an
   * effect-only decorator) or the class/a same-ABI subclass (a REPLACING
   * decorator, whose result rebinds the name). Everything else is a named
   * fence: the standard context parameter, structural sibling
   * replacements tsc admits but the nominal classval world cannot carry,
   * unions mixing the class with undefined. A replacing decorator
   * registers the mutable classval global the name rebinds through, and
   * fences the two shapes the value rebinding cannot keep exact —
   * subclasses of the decorated class (the compiled hierarchy is fixed at
   * build time; the runtime base would be the decoration result) and
   * namespace-nested declarations (qualified references resolve the class
   * directly, not through the rebound value). */
  export function analyzeClassDecoration(L: Lowerer, info: ClassInfo): void {
    const cd = info.classDecorators;
    if (!cd || cd.shapes !== undefined || cd.poisoned) return;
    const display = info.def.jsName ?? info.def.name;
    try {
      const shapes: NonNullable<ClassDecorationInfo["shapes"]> = [];
      for (const d of cd.nodes) {
        // An ambient declaration NOTHING defines (`declare let dec: any`,
        // `declare function dec<T>(t: T): T` — the conformance corpus's
        // dominant decorator shape): Node erases it, so the decorator
        // EXPRESSION itself throws ReferenceError when the class statement
        // evaluates. That is runnable semantics, not a fence — the
        // undefRead story (the ambient `declare const` stance verbatim).
        // Factory spellings ride along: `@dec("x")` evaluates the CALLEE
        // before any argument, so the ReferenceError is still the first
        // observable effect.
        const ambientCallee =
          ts.isCallExpression(d.expression) && ts.isIdentifier(d.expression.expression)
            ? d.expression.expression
            : ts.isIdentifier(d.expression)
              ? d.expression
              : null;
        if (ambientCallee !== null) {
          const sym = L.resolveValueSymbol(ambientCallee);
          const vdecl = sym && !L.isStdlibSymbol(sym) ? L.checker.declarationsOf(sym)[0] : undefined;
          const ambientVar =
            vdecl !== undefined &&
            ts.isVariableDeclaration(vdecl) &&
            vdecl.initializer === undefined &&
            (ts.getCombinedModifierFlags(vdecl) & ts.ModifierFlags.Ambient) !== 0 &&
            !vdecl.getSourceFile().isDeclarationFile;
          if (ambientVar || ambientUndefinedFnSymbolOf(L, ambientCallee) !== null) {
            shapes.push({ kind: "ambientThrow", name: ambientCallee.text });
            continue;
          }
        }
        const t = L.typeOf(d.expression);
        // Param-count first, off the checker signature: the context-taking
        // shape deserves its own name before mapType (whose failure on
        // ClassDecoratorContext would blur the story).
        const sigs = L.checker.getCallSignatures(t);
        if (sigs.length === 1 && sigs[0]!.getParameters().length > 1) {
          L.unsupported(
            "SC1090",
            d,
            "class decorators that take the standard 'context' parameter (its object — addInitializer, metadata — has no static lowering; single-parameter decorators compile)",
          );
        }
        const mapped = L.mapTypeOf(t);
        if (!mapped || mapped.kind !== "func" || mapped.rest === true || mapped.params.length > 1) {
          L.unsupported(
            "SC1090",
            d,
            "class decorators without one concrete (class) => class-or-void signature ('any'-typed and generic decorators have no compilable call ABI — declare the parameter as the class type)",
          );
        }
        // The parameter: a classval slot the decorated class's object can
        // legally inhabit — the class itself, or a BASE with the same
        // completed constructor ABI (the classval widening rule).
        if (mapped.params.length === 1) {
          const p = mapped.params[0]!;
          const paramOk =
            p.kind === "classval" &&
            (p.className === info.def.name ||
              (isSubclassOf(L, info.def.name, p.className) &&
                (() => {
                  const sup = L.classes.get(p.className);
                  return sup !== undefined && !sup.generic && ctorAbiEquals(L, info, sup);
                })()));
          if (!paramOk) {
            L.unsupported(
              "SC1090",
              d,
              `class decorators whose parameter is not the decorated class ('${display}' cannot flow into a '${L.fmt(p)}' slot — declare the parameter as 'typeof ${display}' or a base class sharing its constructor signature)`,
            );
          }
        }
        // The return: void/undefined keeps the original binding; the class
        // itself or a same-ABI SUBCLASS is a legal replacement (a classval
        // of the decorated class per the flow rule). tsc also admits
        // structurally-compatible siblings and bases — the nominal classval
        // world cannot carry those, so they fence by name.
        const ret = mapped.ret;
        const replaces = ret.kind === "classval";
        if (replaces) {
          const retOk =
            ret.className === info.def.name ||
            (isSubclassOf(L, ret.className, info.def.name) &&
              (() => {
                const sub = L.classes.get(ret.className);
                return sub !== undefined && !sub.generic && ctorAbiEquals(L, sub, info);
              })());
          if (!retOk) {
            L.unsupported(
              "SC1090",
              d,
              `class decorators returning '${L.fmt(ret)}' (a replacement must be '${display}' itself or a subclass sharing its constructor signature — tsc's structural check admits shapes the compiled nominal hierarchy cannot rebind)`,
            );
          }
        } else if (ret.kind !== "void") {
          L.unsupported(
            "SC1090",
            d,
            `class decorators returning '${L.fmt(ret)}' (supported returns: the decorated class type, a subclass with the same constructor signature, or void)`,
          );
        }
        shapes.push({ kind: "call", funcType: mapped, replaces });
      }
      if (shapes.some((s) => s.kind === "call" && s.replaces)) {
        // The name can rebind at runtime: every reference must route
        // through the decoration result. Two shapes cannot: a compiled
        // subclass (its base pointer, vtable prefix, and interval are
        // fixed at build time, but JS would extend the decoration result)
        // and namespace-nested declarations (the qualified-access paths
        // resolve the class directly, not through the rebound binding).
        if (info.subclasses.length > 0) {
          L.unsupported(
            "SC1090",
            cd.nodes[0]!,
            `class decorators that can replace a class with subclasses ('${info.subclasses[0]!.def.jsName ?? info.subclasses[0]!.def.name}' extends '${display}', but the runtime base would be the decoration result — return void, or decorate the leaf classes)`,
          );
        }
        if (info.decl && !ts.isSourceFile(info.decl.parent)) {
          L.unsupported(
            "SC1090",
            cd.nodes[0]!,
            "class decorators that can replace a namespace-nested class (qualified references resolve the declaration directly — return void, or declare the class at top level)",
          );
        }
        const globalId = `%g.dec.${info.def.name}`;
        L.globalsList.push({
          id: globalId,
          name: `${display}.decorated`,
          type: { kind: "classval", className: info.def.name },
          mutable: true,
        });
        cd.valueGlobalId = globalId;
      }
      cd.shapes = shapes;
    } catch (e) {
      if (!(e instanceof PoisonError)) throw e;
      cd.poisoned = true;
    }
  }

/** The decoration statements of a decorated class — the %init code that
   * runs at the class statement's position, BEFORE its static field
   * initializers and blocks (lowerStaticFieldInits composes them; the
   * lower-modules interleave places the whole bundle). Verified Node
   * order: decorator expressions evaluate in SOURCE order (factories run
   * here), then applications run in REVERSE member order over the class
   * object, each replacing decorator's non-undefined result feeding the
   * next application; the final value binds the class name (the mutable
   * classval global) when any decorator can replace. */
  export function lowerClassDecoration(L: Lowerer, info: ClassInfo): IrStmt[] {
    const cd = info.classDecorators;
    if (!cd || cd.poisoned || cd.shapes === undefined || info.decl === null) return [];
    const loc = locOf(info.decl);
    const stmts: IrStmt[] = [];
    try {
      // 1. Decorator expressions evaluate in source order, into hidden
      // locals — a later factory's side effects must not precede an
      // earlier one's, and every expression evaluates before any applies.
      // An ambient (never-defined) decorator name throws Node's
      // ReferenceError HERE: earlier expressions still evaluate, nothing
      // after — expression, application, or the class's own static
      // initializers — ever runs (the %init unwinds).
      const temps: { localId: string; funcType: Extract<IrType, { kind: "func" }>; replaces: boolean }[] = [];
      for (let i = 0; i < cd.nodes.length; i++) {
        const d = cd.nodes[i]!;
        const shape = cd.shapes[i]!;
        if (shape.kind === "ambientThrow") {
          stmts.push({ kind: "exprStmt", expr: nsUndefRead(L, shape.name, d, F64), loc: locOf(d) });
          return stmts;
        }
        const value = L.lowerExprExpecting(d.expression, shape.funcType);
        const local = L.declareHiddenLocal("dec", shape.funcType);
        stmts.push({ kind: "varDecl", localId: local.id, init: value, loc: locOf(d) });
        temps.push({ localId: local.id, funcType: shape.funcType, replaces: shape.replaces });
      }
      // 2. Applications, reverse order, over the accumulating class value.
      let current: IrExpr = classValueRef(L, info, info.decl);
      for (let i = temps.length - 1; i >= 0; i--) {
        const t = temps[i]!;
        const dLoc = locOf(cd.nodes[i]!);
        const callee: IrExpr = { kind: "varRef", localId: t.localId, type: t.funcType, loc: dLoc };
        const args: IrExpr[] = [];
        if (t.funcType.params.length === 1) {
          const p = t.funcType.params[0]!;
          const widened = L.coerceToExpected(current, p);
          L.requireExactShape(cd.nodes[i]!, widened.type, p);
          args.push(widened);
        }
        const call: IrExpr = { kind: "callValue", callee, args, type: t.funcType.ret, loc: dLoc };
        if (t.replaces) {
          const target: IrType = { kind: "classval", className: info.def.name };
          const widened = L.coerceToExpected(call, target);
          L.requireExactShape(cd.nodes[i]!, widened.type, target);
          const res = L.declareHiddenLocal("decres", target);
          stmts.push({ kind: "varDecl", localId: res.id, init: widened, loc: dLoc });
          current = { kind: "varRef", localId: res.id, type: target, loc: dLoc };
        } else {
          stmts.push({ kind: "exprStmt", expr: call, loc: dLoc });
        }
      }
      // 3. The binding: TC39 rebinds the class name to the final result.
      if (cd.valueGlobalId !== undefined) {
        stmts.push({ kind: "assign", localId: cd.valueGlobalId, value: current, loc });
      }
      return stmts;
    } catch (e) {
      if (!(e instanceof PoisonError)) throw e;
      L.stats.statementsFailed++;
      L.bumpFileStat(loc.file, "failed");
      return [];
    }
  }

/** The nearest declaration of static member `name` at or above `info` —
   * the compile-time prototype-chain walk (`D.x` reads C's global when C
   * declared x and nothing between redeclares it; a redeclaration shadows
   * with its OWN storage, exactly JS). */
  export function findStaticOn(L: Lowerer, info: ClassInfo | null, name: string):
    | { declarer: ClassInfo; field: ClassInfo["staticFields"][number]; method?: undefined }
    | { declarer: ClassInfo; method: { params: ParamShape[]; ret: IrType; member: ts.MethodDeclaration }; field?: undefined }
    | null {
    for (let c = info; c; c = c.base) {
      const field = c.staticFields.find((s) => s.name === name);
      if (field) return { declarer: c, field };
      const method = c.staticMethods?.get(name);
      if (method) return { declarer: c, method };
    }
    return null;
  }

/** True when some STRICT descendant of `info` redeclares static `name` —
   * the through-a-VALUE devirtualization test: a classval(info) slot can
   * hold any descendant, and a shadowing redeclaration means the runtime
   * class decides which storage answers. */
  export function staticShadowBelow(L: Lowerer, info: ClassInfo, name: string): boolean {
    return info.subclasses.some(
      (s) =>
        s.staticFields.some((f) => f.name === name) ||
        s.staticMethods?.has(name) === true ||
        s.genericStatics?.has(name) === true ||
        staticShadowBelow(L, s, name),
    );
  }

/** The nearest GENERIC static declaration of `name` at/above `info` —
   * findStaticOn's twin over the genericStatics tables. */
  export function findGenericStaticOn(L: Lowerer, info: ClassInfo | null,
    name: string,): { declarer: ClassInfo; info: GenericFnInfo } | null {
    for (let c = info; c; c = c.base) {
      const gs = c.genericStatics?.get(name);
      if (gs) return { declarer: c, info: gs };
    }
    return null;
  }

/** A static METHOD taken as a value: the zero-capture closure over its
   * module function — the declared-function-as-value rule verbatim
   * (interned by the backend, so `C.m === C.m` holds). */
  function staticMethodValue(L: Lowerer, declarer: ClassInfo, name: string,
    sig: { params: ParamShape[]; ret: IrType }, blame: ts.Expression, loc: SrcLoc): IrExpr {
    const fnName = `%${declarer.def.name}.static:${name}`;
    L.noteEdge(fnName);
    const funcType: IrType = {
      kind: "func",
      params: sig.params.filter((p) => p.mode !== "dynRest").map((p) => p.type),
      ret: sig.ret,
      ...(sig.params.some((p) => p.mode === "dynRest") ? { rest: true as const } : {}),
    };
    L.requireExactArityValue(blame, blame, sig.params, funcType);
    return { kind: "closure", fnName, captures: [], type: funcType, loc };
  }

/** The class itself taken as a VALUE (`const X = C`, an argument, an
   * array element, a class expression's result): the classRef over the
   * per-class immortal class object. The construct thunk needs a thunk-
   * shaped constructor, so classes whose construction is libCall-shaped —
   * the runtime-provided builtins and anything inheriting a builtin
   * constructor (Error/EventEmitter/stream chains complete their `new`
   * by special rules) — are named fences here. The constructor edge is
   * noted at every classRef: a value can always be constructed through. */
  export function classValueRef(L: Lowerer, info: ClassInfo, blame: ts.Node): IrExpr {
    const display = info.def.name.replace(/^%|^%m\d+\./, "");
    fenceDecorationThrows(L, info, blame);
    if (info.generic) {
      // `typeof Box` — the uninstantiated FAMILY as a value: no thunk, no
      // single constructor ABI. INSTANTIATIONS have class objects
      // (`const B = Box<number>`, `new (v: number) => Box<number>` slots).
      L.unsupported(
        "SC1090",
        blame,
        `generic classes as values ('typeof ${display}' keeps the type parameter — instantiation expressions ('${display}<number>') and concrete constructor-typed slots compile)`,
      );
    }
    if (info.builtinError || info.builtinEmitter || info.builtinStream !== undefined) {
      L.unsupported(
        "SC1090",
        blame,
        `builtin classes as values ('${display}' is runtime-provided — reference program-declared classes instead)`,
      );
    }
    if (
      L.inheritsBuiltinErrorCtor(info) ||
      inheritsBuiltinStreamCtor(L, info) ||
      (() => { for (let c = info.base; c; c = c.base) if (c.builtinError || c.builtinStream !== undefined) return true; return false; })()
    ) {
      L.unsupported(
        "SC1090",
        blame,
        `classes extending builtin bases as values ('${display}' inherits a runtime-provided constructor)`,
      );
    }
    L.noteEdge(`%${info.def.name}.constructor`);
    return {
      kind: "classRef",
      className: info.def.name,
      type: { kind: "classval", className: info.def.name },
      loc: locOf(blame),
    };
  }

/** Constructor-ABI equality — the classval widening rule: a classval(D)
   * value may flow into a classval(C) slot only when D's completed
   * constructor signature equals C's (same count, modes, and ABI types),
   * which is what keeps newValue completion against C's one signature
   * sound for every value legally in the slot. */
  export function ctorAbiEquals(L: Lowerer, sub: ClassInfo, sup: ClassInfo): boolean {
    const a = sub.ctorParams;
    const b = sup.ctorParams;
    return a.length === b.length && a.every((p, i) => p.mode === b[i]!.mode && typeEquals(p.type, b[i]!.type));
  }

/** `C.x` where C is a class declared in the program and x a static
   * member of its chain: field reads are the module global, static
   * methods become interned closures, and `.name` folds to the class's
   * compile-time name. Null for everything else — unresolved members
   * fall through to the ordinary chain so the static fence or the
   * generic member rejection names the site. */
  export function lowerStaticFieldRead(L: Lowerer, expr: ts.PropertyAccessExpression): IrExpr | null {
    if (L.chainBlocked(expr)) return null;
    if (!ts.isIdentifier(expr.expression)) return null;
    const symbol = L.resolveValueSymbol(expr.expression);
    const info =
      (symbol ? L.classBySymbol.get(symbol) : undefined) ??
      // A require binding over `module.exports = class {…}` (the alias
      // lands on the expression's own symbol): resolve/collect on demand,
      // or `C.name` below would fall through to paths that answer for
      // stdlib globals instead of this class.
      propertyAssignedClassInfoOf(L, symbol) ??
      undefined;
    if (!info) return null;
    // A decorated name that can REBIND (a replacing decorator): the
    // receiver is the decoration result, not the declaration — fall
    // through to the through-a-VALUE paths (lowerClassValueProperty),
    // whose devirtualization and .name rules answer for every legal
    // runtime value.
    if (info.classDecorators?.valueGlobalId !== undefined) return null;
    // The RECEIVER is an ambient `declare class` nothing defines. Node
    // erases the declaration, so `Amb.name` is a ReferenceError on `Amb`
    // — it never reaches the property. The `.name` fold at the bottom of
    // this function is a compile-time constant read off the collected
    // shape, so it answered `"Amb"` and the program ran on: measured
    // WRONG at exit 0 on both backends, where Node exits 1. Every other
    // member took the "static member has no lowering" refusal, which is
    // loud but names the wrong cause. Both answer with the throw now.
    if (ambientUndefinedClassSymbolOf(L, expr.expression) !== null) {
      return nsUndefRead(
        L,
        expr.expression.text,
        expr,
        ambientUndefReadType(L, expr) ?? F64,
      );
    }
    // A class whose DEFINITION provably throws collected as a member-less
    // shell, so every static read misses and would report "the static
    // member 's' … has no lowering" — a true sentence about a class that
    // does not exist, naming the wrong cause. The shell's own diagnostic
    // is the one that explains the program.
    fenceDecorationThrows(L, info, expr);
    const loc = locOf(expr);
    const found = findStaticOn(L, info, expr.name.text);
    // A #private static resolves only through the DECLARING class's own
    // name: in JS the brand lives on that one constructor object, so
    // `D.#s` (a subclass receiver) throws Node's TypeError instead of
    // reaching up the chain — fenced rather than silently resolved.
    if (found && expr.name.text.startsWith("#") && found.declarer !== info) {
      L.unsupported(
        "SC1090",
        expr,
        `reading the private static '${expr.name.text}' through the subclass '${info.def.name.replace(/^%|^%m\d+\./, "")}' (JS brands the declaring class object alone — Node throws a TypeError here; spell the declaring class's name)`,
      );
    }
    if (found?.field !== undefined) {
      return L.maybeNarrow(
        { kind: "varRef", localId: found.field.globalId, type: found.field.type, loc },
        expr,
      );
    }
    if (found) {
      return staticMethodValue(L, found.declarer, expr.name.text, found.method, expr, loc);
    }
    // A GENERIC static method as a VALUE: the pinned-value rule verbatim
    // (lowerGenericFnValue) — a slot spelling one concrete signature names
    // an instance, an unpinned reference fences by name.
    {
      const gfound = findGenericStaticOn(L, info, expr.name.text);
      if (gfound) return L.lowerGenericFnValue(expr, gfound.info);
    }
    // `C.name` — the JS-observable class name, a compile-time constant on
    // the direct spelling (tsc rejects user statics named `name`, so the
    // chain above can never shadow it in TypeScript sources).
    if (expr.name.text === "name" && info.def.jsName !== undefined) {
      return { kind: "strLit", value: info.def.jsName, type: STRING, loc };
    }
    return null;
  }

/** NamedEvaluation's answer for a class expression's `.name`: its own
   * declared name, else the binding name when the expression is the
   * direct initializer of a variable declaration / the RHS of a simple
   * assignment / an object-literal property value / a default parameter —
   * "" everywhere else (array elements, call arguments). Verified against
   * Node for each shape. */
  function namedEvaluationName(expr: ts.ClassExpression): string {
    if (expr.name) return expr.name.text;
    let p: ts.Node = expr.parent;
    while (ts.isParenthesizedExpression(p)) p = p.parent;
    if (ts.isVariableDeclaration(p) && ts.isIdentifier(p.name) && p.initializer !== undefined) return p.name.text;
    if (ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(p.left)) return p.left.text;
    if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name)) return p.name.text;
    if (ts.isParameter(p) && ts.isIdentifier(p.name)) return p.name.text;
    return "";
  }

/** A class EXPRESSION's ClassInfo: collection on first encounter (the
   * declaration path over the shared ClassLikeDeclaration machinery, with
   * NamedEvaluation supplying the runtime .name), idempotent per node —
   * probeLower's speculative visits and the heritage recursion reuse the
   * first collection. The honest v1 boundary is TOP-LEVEL evaluation
   * positions only: each evaluation of a class expression in JS mints a
   * DISTINCT class (fresh identity, fresh statics), and one immortal
   * class object is exact only for expressions that evaluate exactly
   * once. Statics-bearing expressions additionally restrict to positions
   * where "immediately before the enclosing statement" IS the evaluation
   * point (lowerFileInit drains pendingClassExprInits there). */
  export function lowerClassExpressionInfo(L: Lowerer, expr: ts.ClassExpression): ClassInfo {
    const cached = L.exprClassInfoByNode.get(expr);
    if (cached) return cached;
    // Reentrancy guard: heritage resolution can DEMAND another class
    // expression's collection (extends through property assignments —
    // propertyAssignedClassInfoOf), so a cyclic base chain would re-enter
    // its own collection here. The tsc gate rejects every such cycle it
    // can see (TS2506/TS2303 — direct, indirect, and cross-file require
    // cycles all probed); this fence is the backstop that turns anything
    // it misses into a diagnostic instead of a stack overflow.
    if (L.collectingExprClasses.has(expr)) {
      L.unsupported(
        "SC1090",
        expr,
        "class expressions whose extends chain re-enters their own collection (a cyclic base through property assignments)",
      );
    }
    if (L.instantiationContext) {
      L.unsupported(
        "SC1090",
        expr,
        "class expressions inside generic functions (each instantiation would need its own class)",
      );
    }
    for (let p: ts.Node = expr.parent; !ts.isSourceFile(p); p = p.parent) {
      if (ts.isFunctionLike(p) || ts.isClassStaticBlockDeclaration(p)) {
        L.unsupported(
          "SC1090",
          expr,
          "class expressions inside functions (each evaluation creates a DISTINCT class in JS — fresh identity, fresh statics; declare the class at top level)",
        );
      }
    }
    L.collectingExprClasses.add(expr);
    try {
      L.collectClassShapeInner(expr, namedEvaluationName(expr));
    } finally {
      L.collectingExprClasses.delete(expr);
    }
    const info = L.classes.get(L.classNamer(expr));
    if (!info) throw new PoisonError(); // collection poisoned and reported
    L.exprClassInfoByNode.set(expr, info);
    L.exprClasses.push(info);
    L.onExprClassCollected?.(info);
    // Static field initializers and static blocks run when the class
    // expression EVALUATES. The supported positions evaluate exactly once,
    // at the top-level statement containing the expression — the pending
    // buffer lands them immediately before that statement (lowerFileInit
    // drains it), which is JS's order for whole-initializer positions.
    // Anything subtler (multi-declarator statements, arguments evaluated
    // after other side effects) is a named fence, never a reordering.
    if (info.staticFields.length > 0 || (info.staticBlocks?.length ?? 0) > 0) {
      let holder: ts.Node = expr.parent;
      while (
        ts.isParenthesizedExpression(holder) || ts.isClassExpression(holder) ||
        ts.isHeritageClause(holder) || ts.isExpressionWithTypeArguments(holder)
      ) {
        holder = holder.parent;
      }
      const wholeInit =
        (ts.isVariableDeclaration(holder) &&
          holder.initializer !== undefined &&
          ts.isVariableDeclarationList(holder.parent) &&
          holder.parent.declarations.length === 1 &&
          ts.isVariableStatement(holder.parent.parent) &&
          ts.isSourceFile(holder.parent.parent.parent)) ||
        (ts.isBinaryExpression(holder) &&
          holder.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
          ts.isExpressionStatement(holder.parent) &&
          ts.isSourceFile(holder.parent.parent)) ||
        (ts.isExpressionStatement(holder) && ts.isSourceFile(holder.parent));
      if (!wholeInit) {
        L.unsupported(
          "SC1090",
          expr,
          "class expressions with static initializers or static blocks outside a whole-initializer position (their declaration-time code must run exactly where the expression evaluates — bind the class in its own top-level `const C = class …` statement)",
        );
      }
      L.pendingClassExprInits.push(...L.lowerStaticFieldInits(info));
    }
    return info;
  }

/** `class {…}` in expression position: a class definition bound to no
   * statement — once the static side is a value, the expression IS the
   * definition plus a classRef over it. A DECORATED class expression
   * whose decoration provably throws (the ambient-decorator shape) never
   * mints a class at all: evaluating the expression IS the
   * ReferenceError, so it lowers to exactly that read — every evaluation
   * throws identically, which is why the once-evaluated restriction and
   * the member fences don't apply. */
  export function lowerClassExpression(L: Lowerer, expr: ts.ClassExpression): IrExpr {
    // Deliberately still gated on DECORATORS. `class extends <ambient
    // declare class> {}` throws the same ReferenceError at the same
    // point, but answering it HERE types the whole expression by the
    // undefRead's F64 dummy, and the consumer of a class expression is
    // normally a binding that wants a classval: `const K = class extends
    // Ambient {}` then reports `'number' values where 'typeof cx67.' is
    // expected` — a refusal that names the dummy instead of the cause.
    // Measured, not assumed. The heritage guard in collectClassShapeInner
    // answers that shape with the cause instead. Making it a MATCH means
    // making the BINDING a trap binding (L.trapBindings), which is a
    // separate change to ambientUndefVarRootOf.
    if (
      decoratorNodesOf(expr).length > 0 ||
      expr.members.some((m) => decoratorNodesOf(m).length > 0)
    ) {
      if (!isJsSourceFile(expr.getSourceFile()) && expr.typeParameters === undefined) {
        const thrown = guaranteedDefinitionThrow(L, expr);
        if (thrown) {
          // The expression's static type never materializes — the read
          // throws — so the nominal IR type only has to satisfy the
          // consumer. F64 is the ambient-undefRead convention.
          return nsUndefRead(L, thrown.name, expr, F64);
        }
      }
    }
    return classValueRef(L, lowerClassExpressionInfo(L, expr), expr);
  }

/** The EXACT class a receiver expression is statically known to BE (not
   * merely be typed by): the class name itself, or a `const` binding
   * whose initializer is a class expression / class name. Such receivers
   * can never hold a subclass at runtime, so static WRITES through them
   * hit the declaring class's storage exactly (the shadowing hazards of
   * general class values don't arise). Null for everything else. */
  export function exactClassOfReceiver(L: Lowerer, expr: ts.Expression): ClassInfo | null {
    if (!ts.isIdentifier(expr)) return null;
    const symbol = L.resolveValueSymbol(expr);
    if (!symbol) return null;
    const direct = L.classBySymbol.get(symbol);
    // A rebindable decorated name is NOT exactly its class — the binding
    // may hold a replacing decorator's result (a subclass value), where a
    // static write would create an own property in JS. The general
    // class-value write fence answers instead.
    if (direct) return direct.classDecorators?.valueGlobalId !== undefined ? null : direct;
    const decl = L.checker.valueDeclarationOf(symbol);
    if (
      !decl || !ts.isVariableDeclaration(decl) || decl.initializer === undefined ||
      !ts.isVariableDeclarationList(decl.parent) ||
      (decl.parent.flags & ts.NodeFlags.Const) === 0
    ) {
      return null;
    }
    let init: ts.Expression = decl.initializer;
    while (ts.isParenthesizedExpression(init)) init = init.expression;
    if (ts.isClassExpression(init)) return L.exprClassInfoByNode.get(init) ?? null;
    if (ts.isIdentifier(init)) {
      const initSym = L.resolveValueSymbol(init);
      const aliased = initSym ? (L.classBySymbol.get(initSym) ?? null) : null;
      // `const X = C` over a rebindable decorated name: X holds the
      // decoration result — not exactly C (see the direct case above).
      return aliased?.classDecorators?.valueGlobalId !== undefined ? null : aliased;
    }
    return null;
  }

/** The class a PROPERTY-ASSIGNMENT binding pins — the salsa/CJS
   * declaration forms of a class expression: `Common.I = class {…}`
   * (expando members of a plain object), `exports.I = class {…}` /
   * `module.exports.I = class {…}` (CJS member exports), and
   * `module.exports = class {…}` (the whole-export replacement, whose
   * export symbol requirer bindings alias to). The symbol arrives in two
   * shapes — an ALIAS resolving to the class expression's own symbol
   * (valueDeclaration IS the ts.ClassExpression), or the expando property
   * symbol whose declarations are the assignment BinaryExpressions — and
   * both pin the class exactly when ONE top-level assignment declares it:
   * a reassigned property is a dynamic binding (the runtime class is
   * whichever assignment ran last), so it answers null and the caller's
   * fence names it. Collection is on demand and idempotent
   * (lowerClassExpressionInfo), so resolution order between files and
   * passes never matters. */
  /** A CONST whose initializer, with the type-level wrappers peeled, is a
   * reference to a class declared in the program: `export const C = Impl
   * as unknown as CCtor`, the shape a package uses to publish a class
   * while keeping its implementation unexported. The casts are erasure —
   * the value IS the class's static side — so `new C()` constructs the
   * class the reference names.
   *
   * Deliberately narrow: `const` only (a `let` could later name an
   * unrelated class), a single VALUE declaration, and an initializer that
   * peels to a bare identifier. A conditional or computed initializer
   * names no single class and keeps the fence.
   *
   * Type-only declarations MERGED under the same name do not count against
   * that single-declaration rule. The full published shape is
   *
   *     class Impl { … }                       // unexported
   *     export interface C extends Impl {}     // the instance type
   *     export const C = Impl as unknown as CCtor
   *
   * where the interface is what makes the pattern work at all (it names
   * the instance side while the const names the static side). An interface
   * or type alias contributes NO value, so it cannot make the binding name
   * a different class — only the value declarations can, and there must
   * still be exactly one of those. */
  export function castAliasedClassInfoOf(L: Lowerer, symbol: ts.Symbol | null | undefined): ClassInfo | null {
    if (!symbol) return null;
    const decls = L.checker
      .declarationsOf(symbol)
      .filter((d) => !ts.isInterfaceDeclaration(d) && !ts.isTypeAliasDeclaration(d));
    if (decls.length !== 1) return null;
    const decl = decls[0];
    if (decl === undefined || !ts.isVariableDeclaration(decl) || decl.initializer === undefined) return null;
    if ((ts.getCombinedNodeFlags(decl) & ts.NodeFlags.Const) === 0) return null;
    let init: ts.Expression = decl.initializer;
    while (
      ts.isParenthesizedExpression(init) ||
      ts.isAsExpression(init) ||
      ts.isSatisfiesExpression(init) ||
      ts.isTypeAssertion(init)
    ) {
      init = init.expression;
    }
    if (!ts.isIdentifier(init)) return null;
    const classSym = L.resolveValueSymbol(init);
    const info = (classSym ? L.classBySymbol.get(classSym) : undefined) ?? null;
    return annotationNamesAnotherClass(L, decl, info) ? null : info;
  }

  /** The class a `new` expression CONSTRUCTS, resolved through the callee
   * rather than the checker's result type: `new C()` where C is published
   * behind a construct-signature interface types the result as the
   * INTERFACE, so the mapped-type read (exactInstanceClassOf's classOfNew)
   * answers a record and loses the class. Mirrors lowerNew's own
   * resolution chain so both agree on which class a `new` names. */
  export function constructedClassInfoOf(L: Lowerer, expr: ts.Expression | undefined): ClassInfo | null {
    if (expr === undefined) return null;
    let e: ts.Expression = expr;
    // An UPCAST wrapper is peeled, and the class the binding adopts is
    // the CAST TARGET's, not the constructed one: `new D() as B` lowers
    // to B's pointer (the emitted C is a pointer cast through the upcast
    // bridge), so a slot typed D would need a DOWNCAST of its own
    // initializer and fences — measured, `SC1090: 'B1' values where 'D4'
    // is expected`. Typing the slot B is exact: the value IS a B, and
    // `m.toString()` reaches D's override through the virtual arm, which
    // is what the two-step spelling already did.
    //
    // An OBJECT target peels to the target; a RECORD target peels to the
    // CONSTRUCTED class. A cast to `unknown`/`any` leaves the static world
    // and still answers null, so that binding takes the representation the
    // cast actually produces.
    //
    // The record arm was measured, not reasoned. This function used to
    // break on a record target on the grounds that "a cast to a RECORD
    // materializes the shape (4142's price)". Its own sibling disproves
    // that: adoptedInstanceClassOf peels exactly this cast for the
    // IDENTIFIER spelling, and one build of the two spellings emits
    //     static sc_o_Own *sc_g_e_v4;   /* const b = new Own(); b as Rec */
    //     static sc_rs_r0 *sc_g_e_v3;   /* (new Own()) as Rec            */
    // — the record target does not force a materialization, it was simply
    // hiding the `new` from this syntactic test. The same program at BLOCK
    // scope already answered the class for both spellings (lowerVarDecl's
    // adoption arm reads the LOWERED initializer), so before this the one
    // declaration meant two different things at the two scopes — the
    // asymmetry the file-scope adoption arm in lower-modules.ts was added
    // to remove for `const v = live as unknown as { … }`, reaching the one
    // spelling it did not cover. Corpus 4262.
    //
    // Without this, `const m: Rec = new D() as B` folded
    // Object.prototype.toString where `const o: B = new D(); const m:
    // Rec = o` answered D's — two spellings of one thing, one of them
    // silently wrong, and no diagnostic either way. Corpus 4243.
    let castTarget: ClassInfo | null = null;
    for (;;) {
      if (ts.isParenthesizedExpression(e)) { e = e.expression; continue; }
      if (ts.isAsExpression(e) || ts.isTypeAssertion(e) || ts.isSatisfiesExpression(e)) {
        const t = L.mapTypeOf(L.typeOf(e));
        const info = t?.kind === "object" ? (L.classes.get(t.className) ?? null) : null;
        if (info === null) {
          // A RECORD target erases: there is no class to upcast to, so
          // castTarget stays null and the constructed class below is the
          // value's own type. Narrower than adoptedInstanceClassOf's
          // predicate by construction — dyn/jsval/unknown/any targets do
          // not map to `record` and still break here.
          if (t?.kind === "record") { e = e.expression; continue; }
          break;
        }
        castTarget ??= info; // the OUTERMOST target is the value's type
        e = e.expression;
        continue;
      }
      break;
    }
    if (!ts.isNewExpression(e) || !ts.isIdentifier(e.expression)) return null;
    if (castTarget !== null) return castTarget;
    const symbol = L.resolveValueSymbol(e.expression);
    return (
      (symbol ? L.classBySymbol.get(symbol) : undefined) ??
      propertyAssignedClassInfoOf(L, symbol) ??
      castAliasedClassInfoOf(L, symbol) ??
      null
    );
  }

  /** The class INSTANCE a file-scope CONST binding's initializer names
   * through ERASURE — the file-scope face of lowerVarDecl's adoption arm
   * (`!isLet && init.type.kind === "object"` over a record-mapping
   * declared type). collectGlobals runs BEFORE any body lowers, so it
   * cannot ask the lowering what the initializer produced; this mirrors
   * the two spellings whose lowered value provably IS the identifier's own
   * instance:
   *
   *   const v: Iface = live;                       // no cast at all
   *   const v = live as unknown as { … };          // an erasing cast chain
   *
   * A cast is peeled only where lowerAsExpression would ERASE it. Two
   * targets do not erase and are refused rather than predicted: a target
   * that maps to an OBJECT builds the checked-downcast or upcast bridge
   * (so the lowered value's class is the TARGET's, not this identifier's),
   * and `as any` under --dynamic is the island entrance (jsvalIn), whose
   * value is a handle. Everything past an identifier — a call, an element
   * read, a property read — is out: only a plain identifier's flow type is
   * the value the initializer yields with no lowering of its own. */
  /** True when a binding provably HOLDS its initializer for its whole life:
   * a `const`, or a `let`/`var` that nothing in its declaring file ever
   * writes. Both adoption arms rest on that and only on that — the reason
   * they refuse a reassignable binding is that a later assignment could
   * name an unrelated class, and bindingNeverReassigned is exactly the
   * proof that no later assignment exists. Its file walk is the whole story
   * for a module-scope binding (ESM import bindings are read-only, so no
   * other file can write one) and strictly conservative for a block-scoped
   * one, whose writers are a SUBSET of its declaring file.
   *
   * Merged `var` redeclarations are one symbol with several initializers —
   * writes the assignment scan never sees — and are refused, the same fence
   * bindingGenericFnInfoOf draws for the same reason. */
  export function bindingHoldsItsInitializer(L: Lowerer, decl: ts.VariableDeclaration): boolean {
    if ((ts.getCombinedNodeFlags(decl) & ts.NodeFlags.Const) !== 0) return true;
    if (!ts.isIdentifier(decl.name)) return false;
    const sym = L.checker.getSymbolAtLocation(decl.name);
    if (!sym) return false;
    if (L.checker.declarationsOf(sym).some((d) => d !== decl && ts.isVariableDeclaration(d) && d.initializer !== undefined)) {
      return false;
    }
    return bindingNeverReassigned(L, sym, decl);
  }

  export function adoptedInstanceClassOf(L: Lowerer, decl: ts.VariableDeclaration): string | null {
    if (decl.initializer === undefined) return null;
    if (!bindingHoldsItsInitializer(L, decl)) return null;
    let init: ts.Expression = decl.initializer;
    for (;;) {
      if (ts.isParenthesizedExpression(init) || ts.isSatisfiesExpression(init)) {
        init = init.expression;
        continue;
      }
      if (ts.isAsExpression(init) || ts.isTypeAssertion(init)) {
        const targetTs = L.checker.getTypeFromTypeNode(init.type);
        if (L.mapTypeOf(targetTs)?.kind === "object") return null;
        if ((targetTs.flags & ts.TypeFlags.Any) !== 0 && L.dynamic) return null;
        init = init.expression;
        continue;
      }
      break;
    }
    if (!ts.isIdentifier(init)) return null;
    const t = L.mapTypeOf(L.typeOf(init));
    return t !== null && t.kind === "object" ? t.className : null;
  }

  /** Does this declaration's own type ANNOTATION name a different class
   * than the one its initializer references? `const s: typeof Animal =
   * Spider` is a WIDENING class-value slot, not the erasure alias the
   * cast-alias rule models: tsc types every use of the binding against
   * the annotation (`new s(2)` answers Animal, `s.name` reads Animal's
   * static side), so pinning the initializer's class here makes the
   * lowering and the checker disagree about one expression — which the
   * IR validator can only report as SC9001, never as a diagnostic.
   *
   * Only an annotation that maps to a class value of its own can
   * disagree. The published-class shape the rule exists for (`export
   * const C = Impl as unknown as CCtor`) annotates a CONSTRUCT-SIGNATURE
   * interface, which maps to no classval at all, so it keeps the alias.
   * An UNANNOTATED binding keeps it too. */
  function annotationNamesAnotherClass(
    L: Lowerer,
    decl: ts.VariableDeclaration,
    info: ClassInfo | null,
  ): boolean {
    if (info === null || decl.type === undefined) return false;
    const declared = L.mapTypeOf(L.checker.getTypeFromTypeNode(decl.type));
    return declared?.kind === "classval" && declared.className !== info.def.name;
  }

  /** The class a CONST binding's initializer names directly, with the
   * type-level wrappers peeled — the declaration-site face of
   * castAliasedClassInfoOf, for callers that hold the declaration rather
   * than its symbol. */
  export function castAliasedClassRefOf(L: Lowerer, decl: ts.VariableDeclaration): ClassInfo | null {
    if (decl.initializer === undefined) return null;
    if ((ts.getCombinedNodeFlags(decl) & ts.NodeFlags.Const) === 0) return null;
    let init: ts.Expression = decl.initializer;
    while (
      ts.isParenthesizedExpression(init) ||
      ts.isAsExpression(init) ||
      ts.isSatisfiesExpression(init) ||
      ts.isTypeAssertion(init)
    ) {
      init = init.expression;
    }
    if (!ts.isIdentifier(init)) return null;
    const sym = L.resolveValueSymbol(init);
    const info = (sym ? L.classBySymbol.get(sym) : undefined) ?? null;
    return annotationNamesAnotherClass(L, decl, info) ? null : info;
  }

  export function propertyAssignedClassInfoOf(
    L: Lowerer,
    symbol: ts.Symbol | null | undefined,
  ): ClassInfo | null {
    if (!symbol) return null;
    const resolved =
      symbol.flags & ts.SymbolFlags.Alias ? L.checker.getAliasedSymbol(symbol) : symbol;
    const registered = L.classBySymbol.get(resolved);
    if (registered) return registered;
    const decls = L.checker.declarationsOf(resolved);
    // The class expression's OWN symbol (tsgo's answer through CJS export
    // aliases): the declaration is the expression itself. Its top-level
    // assignment statement must be the binding's ONLY producer. The
    // resolved symbol registers in classBySymbol so every downstream
    // path — static reads, the `.name` fold, instanceof — answers like a
    // declaration from then on.
    if (decls.length === 1 && decls[0] !== undefined && ts.isClassExpression(decls[0])) {
      const assign = enclosingTopLevelClassAssignment(decls[0]);
      if (!assign || countAssignmentsTo(assign) !== 1) return null;
      const info = L.lowerClassExpressionInfo(decls[0]);
      L.classBySymbol.set(resolved, info);
      return info;
    }
    // The expando property symbol: every top-level `X.N = …` assignment is
    // one of its declarations — exactly one, binding a class expression,
    // pins the class.
    const assigns = decls.filter(
      (d): d is ts.BinaryExpression =>
        ts.isBinaryExpression(d) && d.operatorToken.kind === ts.SyntaxKind.EqualsToken,
    );
    if (assigns.length !== 1 || assigns.length !== decls.length) return null;
    const a = assigns[0]!;
    if (!ts.isExpressionStatement(a.parent) || !ts.isSourceFile(a.parent.parent)) return null;
    let rhs: ts.Expression = a.right;
    while (ts.isParenthesizedExpression(rhs)) rhs = rhs.expression;
    if (!ts.isClassExpression(rhs)) return null;
    const info = L.lowerClassExpressionInfo(rhs);
    L.classBySymbol.set(resolved, info);
    return info;
  }

/** The top-level `… = <this class expression>` assignment a class
   * expression is the (paren-unwrapped) RHS of, or null. */
  function enclosingTopLevelClassAssignment(expr: ts.ClassExpression): ts.BinaryExpression | null {
    let value: ts.Expression = expr;
    while (ts.isParenthesizedExpression(value.parent)) value = value.parent;
    const p = value.parent;
    if (
      !ts.isBinaryExpression(p) || p.operatorToken.kind !== ts.SyntaxKind.EqualsToken ||
      p.right !== value || !ts.isExpressionStatement(p.parent) || !ts.isSourceFile(p.parent.parent)
    ) {
      return null;
    }
    return p;
  }

/** How many top-level statements of the file assign the same target as
   * `assign` (textual LHS match — `module.exports`, `exports.I`,
   * `Common.I`): a second assignment makes the binding dynamic, so
   * callers refuse to pin the first one's class. */
  function countAssignmentsTo(assign: ts.BinaryExpression): number {
    const sf = assign.getSourceFile();
    // `exports.I` and `module.exports.I` are the SAME binding in Node
    // (exports aliases module.exports until a table replaces it) — fold
    // the member spellings together before comparing.
    const canon = (lhs: ts.Expression): string => {
      const text = lhs.getText().replace(/\s+/g, "");
      return text.startsWith("module.exports.") ? text.slice("module.".length) : text;
    };
    const target = canon(assign.left);
    let n = 0;
    for (const stmt of sf.statements) {
      if (!ts.isExpressionStatement(stmt)) continue;
      const e = stmt.expression;
      if (
        ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        canon(e.left) === target
      ) {
        n++;
      }
    }
    return n;
  }

/** `C.m(args)` / `X.m(args)` — static method calls, on the class name
   * directly or through a class VALUE. Resolution walks the chain
   * (nearest declarer, the compile-time prototype chain); through a
   * VALUE the call devirtualizes exactly when no strict descendant
   * redeclares the member (values never leave the static class's
   * subtree). A func-typed static FIELD in call position reads the
   * global and calls through the value. Null when the receiver isn't a
   * class name/value or the member doesn't resolve (the fences name the
   * site downstream). */
  export function lowerStaticMethodCall(L: Lowerer, call: ts.CallExpression,
    access: ts.PropertyAccessExpression,): IrExpr | null {
    if (L.chainBlocked(access)) return null;
    // `module.exports.describe()` in a module whose whole export IS a
    // class expression: the receiver is exactly that class (the kept
    // export assignment pins it) — the direct-name rules apply.
    if (!ts.isIdentifier(access.expression)) {
      if (!isModuleExportsAccess(access.expression) || !isCjsJsFile(access.getSourceFile())) {
        return null;
      }
      const whole = cjsClassExprWholeExportOf(access.getSourceFile());
      if (!whole) return null;
      return staticCallOn(L, call, access, L.lowerClassExpressionInfo(whole.classExpr), false);
    }
    const symbol = L.resolveValueSymbol(access.expression);
    const direct =
      (symbol ? L.classBySymbol.get(symbol) : undefined) ??
      // A require binding over `module.exports = class {…}`: the alias
      // lands on the expression's own symbol — exact, like the name.
      propertyAssignedClassInfoOf(L, symbol) ??
      undefined;
    let info = direct ?? null;
    // A rebindable decorated name is a class VALUE receiver: the call
    // devirtualizes under the value rules (shadow fences below).
    let throughValue = direct?.classDecorators?.valueGlobalId !== undefined;
    if (!info) {
      const recvT = L.mapTypeOf(L.typeOf(access.expression));
      if (recvT?.kind !== "classval") return null;
      info = L.classes.get(recvT.className) ?? null;
      throughValue = true;
    }
    if (!info) return null;
    return staticCallOn(L, call, access, info, throughValue);
  }

/** True when a class-VALUE receiver can only hold `info`'s own class
   * object at runtime: the receiver provably IS the class
   * (exactClassOfReceiver — the name, or a const bound to the class
   * expression / class name), or `info` is a LEAF class, so no strict
   * descendant exists to flow into the slot (the static-write path's
   * rule — a rebindable decorated name rides this arm, since replacement
   * decorators fence any class with subclasses before minting the
   * rebindable global). Exactly then a #private static access through
   * the value always carries the declaring class's brand — Node's
   * TypeError cannot arise. */
  function classValueIsExactlyOwn(L: Lowerer, recv: ts.Expression, info: ClassInfo): boolean {
    return exactClassOfReceiver(L, recv) === info || info.subclasses.length === 0;
  }

  function staticCallOn(
    L: Lowerer,
    call: ts.CallExpression,
    access: ts.PropertyAccessExpression,
    info: ClassInfo,
    throughValue: boolean,
  ): IrExpr | null {
    const loc = locOf(call);
    // #private statics: through-a-VALUE receiver the call devirtualizes
    // exactly when the value can only BE the declaring class
    // (classValueIsExactlyOwn — a slot that could hold a descendant at
    // runtime fences, since only the declaring class object carries the
    // brand in JS), and the direct spelling resolves only on the
    // declaring class itself — `D.#s` is Node's TypeError.
    if (access.name.text.startsWith("#") && throughValue && !classValueIsExactlyOwn(L, access.expression, info)) {
      L.unsupported(
        "SC1090",
        call,
        `calling the private static '${access.name.text}' through a class value (JS brands the declaring class object alone — call it through the class's own name)`,
      );
    }
    const found = findStaticOn(L, info, access.name.text);
    if (found && access.name.text.startsWith("#") && found.declarer !== info) {
      L.unsupported(
        "SC1090",
        call,
        `calling the private static '${access.name.text}' through the subclass '${info.def.name.replace(/^%|^%m\d+\./, "")}' (JS brands the declaring class object alone — Node throws a TypeError here; spell the declaring class's name)`,
      );
    }
    if (!found) {
      // GENERIC static methods: monomorphized like top-level generic
      // functions, called directly as `%C.static:m%n` — with the same
      // through-a-VALUE shadowing fence as plain statics.
      const gfound = findGenericStaticOn(L, info, access.name.text);
      if (!gfound) return null;
      if (throughValue && staticShadowBelow(L, info, access.name.text)) {
        L.unsupported(
          "SC1090",
          call,
          `calling the static member '${access.name.text}' through a class value (a subclass of '${info.def.name.replace(/^%|^%m\d+\./, "")}' redeclares it, so the runtime class decides which declaration answers)`,
        );
      }
      const instance = genericCallInstance(L, call, gfound.info);
      const args = L.completeArgs(call.arguments, instance.params, loc, call);
      return { kind: "call", callee: instance.name, args, type: instance.returnType, loc };
    }
    if (throughValue && staticShadowBelow(L, info, access.name.text)) {
      L.unsupported(
        "SC1090",
        call,
        `calling the static member '${access.name.text}' through a class value (a subclass of '${info.def.name.replace(/^%|^%m\d+\./, "")}' redeclares it, so the runtime class decides which declaration answers)`,
      );
    }
    if (found.field !== undefined) {
      // A func-typed static field in call position: read the global,
      // call through the value (the ctor-assigned-callback pattern).
      if (found.field.type.kind !== "func") return null;
      const callee: IrExpr = { kind: "varRef", localId: found.field.globalId, type: found.field.type, loc };
      const params = found.field.type.params;
      const args = call.arguments.map((a, i) => L.lowerExprExpecting(a, params[i]));
      for (let i = args.length; i < params.length; i++) {
        const absent = omittedArgFor(L, params[i]!, loc);
        if (!absent) {
          L.unsupported("SC1090", call, "calls omitting a non-optional parameter of the callee's type");
        }
        args.push(absent);
      }
      return { kind: "callValue", callee, args, type: found.field.type.ret, loc };
    }
    const fnName = `%${found.declarer.def.name}.static:${access.name.text}`;
    L.noteEdge(fnName);
    const args = L.completeArgs(call.arguments, found.method.params, loc, call);
    return { kind: "call", callee: fnName, args, type: found.method.ret, loc };
  }

/** Static member access through a class VALUE (`X.m` where X is
   * classval-typed): devirtualized — the member resolves against the
   * static class's chain, exact when no strict descendant redeclares it
   * (values in the slot never leave the subtree). `X.name` is the one
   * genuinely dynamic member: the class.name libCall reads the runtime
   * class object's stored name. Null when the receiver isn't a class
   * value or the member doesn't resolve. */
  export function lowerClassValueProperty(L: Lowerer, expr: ts.PropertyAccessExpression): IrExpr | null {
    if (L.chainBlocked(expr)) return null;
    const recvT = L.mapTypeOf(L.typeOf(expr.expression));
    if (recvT?.kind !== "classval") return null;
    const loc = locOf(expr);
    const member = expr.name.text;
    // `X.name` reads the RUNTIME class object's stored name — the one
    // genuinely dynamic member. It CONSUMES the receiver (no evaluation
    // is discarded), so any receiver expression is fine here.
    if (member === "name") {
      const recv = L.lowerExpr(expr.expression);
      if (recv.type.kind !== "classval") return null;
      return { kind: "libCall", fn: "class.name", args: [recv], type: STRING, loc };
    }
    if (
      !ts.isIdentifier(expr.expression) &&
      // `module.exports.label` in a class-replaced CJS module: the
      // receiver is the exact exported class, and the read is
      // side-effect-free — as bindable as an identifier.
      !(isModuleExportsAccess(expr.expression) && isCjsJsFile(expr.getSourceFile()))
    ) {
      // Devirtualized reads DISCARD the receiver value, so only
      // side-effect-free receivers are claimed (the instanceOf fold
      // rule); computed ones meet the pointed fence with a bindable fix.
      L.unsupported(
        "SC1090",
        expr,
        "static member access through a computed class-value expression (bind the class value to a variable first)",
      );
    }
    // The direct class-name spelling resolved in lowerStaticFieldRead;
    // reaching here means the receiver is a classval-typed BINDING.
    const info = L.classes.get(recvT.className);
    if (!info) return null;
    const found = findStaticOn(L, info, member);
    if (!found) {
      L.unsupported(
        "SC1090",
        expr,
        `the static member '${member}' of class '${info.def.name.replace(/^%|^%m\d+\./, "")}' (static accessors and initializer-less static fields have no lowering, and Function members like .call/.bind/.prototype have no value form)`,
      );
    }
    // #private statics read through a class VALUE exactly when the value
    // can only BE the declaring class (classValueIsExactlyOwn — a const
    // bound to the class expression / class name, or a leaf class): a
    // slot that could hold a descendant at runtime fences, since JS
    // brands the declaring class object alone (Node's TypeError on any
    // other receiver). The direct class-name spelling resolved in
    // lowerStaticFieldRead, so a private reaching here is a
    // classval-typed binding.
    if (member.startsWith("#")) {
      if (!classValueIsExactlyOwn(L, expr.expression, info)) {
        L.unsupported(
          "SC1090",
          expr,
          `reading the private static '${member}' through a class value (JS brands the declaring class object alone — spell the declaring class's name)`,
        );
      }
      if (found.declarer !== info) {
        L.unsupported(
          "SC1090",
          expr,
          `reading the private static '${member}' through the subclass '${info.def.name.replace(/^%|^%m\d+\./, "")}' (JS brands the declaring class object alone — Node throws a TypeError here; spell the declaring class's name)`,
        );
      }
    }
    if (staticShadowBelow(L, info, member)) {
      L.unsupported(
        "SC1090",
        expr,
        `reading the static member '${member}' through a class value (a subclass of '${info.def.name.replace(/^%|^%m\d+\./, "")}' redeclares it, so the runtime class decides which declaration answers)`,
      );
    }
    if (found.field !== undefined) {
      return L.maybeNarrow(
        { kind: "varRef", localId: found.field.globalId, type: found.field.type, loc },
        expr,
      );
    }
    return staticMethodValue(L, found.declarer, member, found.method, expr, loc);
  }

/** An abstract method's signature — lambdaSignature minus the body check
   * (an abstract declaration IS exactly a signature; tsc rejects the
   * async/generator/generic-with-body combinations before this runs, and
   * the generic case fences at the caller). */
  function abstractMemberSignature(L: Lowerer, member: ts.MethodDeclaration): { shapes: ParamShape[]; ret: IrType } {
    for (const param of member.parameters) {
      if (!ts.isIdentifier(param.name)) L.unsupported("SC1031", param);
    }
    return { shapes: L.paramShapes(member.parameters), ret: L.declaredReturnType(member, member.name) };
  }

/** The nearest declaration of `name` at or above `info` — the method a
   * receiver of that static class runs when nothing below overrides it. */
  export function findMethodOn(L: Lowerer, info: ClassInfo | null,
    name: string,): { declarer: ClassInfo; sig: { params: ParamShape[]; ret: IrType; abstract?: true; async?: true; gen?: { yieldT: IrType; nextT: IrType } } } | null {
    for (let c = info; c; c = c.base) {
      const sig = c.methods.get(name);
      if (sig) return { declarer: c, sig };
    }
    return null;
  }

/** True when `sub` is a STRICT descendant of `sup` in the class graph. */
  export function isSubclassOf(L: Lowerer, sub: string, sup: string): boolean {
    for (let c = L.classes.get(sub)?.base ?? null; c; c = c.base) {
      if (c.def.name === sup) return true;
    }
    return false;
  }

/** In an extends-hierarchy (as base or derived): the class carries a
   * vtable and participates in dynamic instanceof; standalone classes keep
   * their exact pre-inheritance layout and behavior. */
  export function inHierarchy(L: Lowerer, info: ClassInfo): boolean {
    // The runtime emitter class is ALWAYS a hierarchy member: ScrEmitter
    // carries its vtable word whether or not the program subclasses it
    // (the runtime allocates bare instances with scr_emitter_vt).
    return info.base !== null || info.subclasses.length > 0 || info.builtinEmitter === true;
  }

/** True when some STRICT descendant of `info` declares `name` with a BODY
   * — the whole-program devirtualization test: a call through this static
   * class can reach a distinct implementation, so it must dispatch
   * dynamically. Abstract re-declarations don't count (they carry no
   * implementation; the concrete ones below them do, via the recursion). */
  export function overrideBelow(L: Lowerer, info: ClassInfo, name: string): boolean {
    return info.subclasses.some((s) => {
      const m = s.methods.get(name);
      return (m !== undefined && m.abstract !== true) || L.overrideBelow(s, name);
    });
  }

/** The nearest GENERIC-method declaration of `name` at/above `info` —
   * findMethodOn's twin over the genericMethods tables. */
  export function findGenericMethodOn(L: Lowerer, info: ClassInfo | null,
    name: string,): { declarer: ClassInfo; info: GenericFnInfo } | null {
    for (let c = info; c; c = c.base) {
      const gm = c.genericMethods?.get(name);
      if (gm) return { declarer: c, info: gm };
    }
    return null;
  }

/** True when some STRICT descendant of `info` re-declares the generic
   * method `name` — overrideBelow's twin: generic methods have no vtable
   * slot, so a call that could reach an override compiles only when the
   * receiver's runtime class is statically exact. */
  export function genericOverrideBelow(L: Lowerer, info: ClassInfo, name: string): boolean {
    return info.subclasses.some(
      (s) => s.genericMethods?.has(name) === true || genericOverrideBelow(L, s, name),
    );
  }

/** The receiver's EXACT runtime class, when the expression proves it: a
   * `new C(...)` expression directly, or a const binding initialized with
   * one (the binding can never be reassigned to a subclass instance).
   * The class is read off the mapped INITIALIZER type — a `const b: Base =
   * new D()` receiver is exactly D, not its annotation. Distinct from
   * exactClassOfReceiver, which answers for CLASS-VALUE receivers. */
  export function exactInstanceClassOf(L: Lowerer, expr: ts.Expression): ClassInfo | null {
    let e: ts.Expression = expr;
    while (ts.isParenthesizedExpression(e)) e = e.expression;
    const classOfNew = (n: ts.Expression): ClassInfo | null => {
      if (!ts.isNewExpression(n)) return null;
      const t = L.mapTypeOf(L.typeOf(n));
      // A construct signature that returns an INTERFACE types the result
      // as that interface, so the mapped read answers a record: resolve
      // through the callee, exactly as lowerNew does.
      return t?.kind === "object"
        ? (L.classes.get(t.className) ?? null)
        : constructedClassInfoOf(L, n);
    };
    const direct = classOfNew(e);
    if (direct) return direct;
    if (!ts.isIdentifier(e)) return null;
    const symbol = L.resolveValueSymbol(e);
    const decl = symbol ? L.checker.valueDeclarationOf(symbol) : undefined;
    if (
      !decl || !ts.isVariableDeclaration(decl) || decl.initializer === undefined ||
      !ts.isVariableDeclarationList(decl.parent) ||
      (decl.parent.flags & ts.NodeFlags.Const) === 0
    ) {
      return null;
    }
    let init: ts.Expression = decl.initializer;
    while (ts.isParenthesizedExpression(init)) init = init.expression;
    return classOfNew(init);
  }

/** `const r: Repo = new MemRepo()` where EVERY member of the annotation's
   * checker type is a generic-callable method (`interface Repo { get<T>(id:
   * string): T }`): the record shape maps EMPTY — generic members are
   * excluded (no closure slot can hold a generic function) — so the
   * copy-reshape width coercion would DROP the exact class the method
   * calls monomorphize against, and in JS the binding IS the instance (no
   * copy exists). The binding keeps the initializer's class
   * representation instead: generic-method calls resolve like class-typed
   * receivers (exactInstanceClassOf reads the same const+new discipline),
   * and uses that want the empty record width-coerce at the use site.
   * Const + direct `new` only — a reassignable binding or a produced
   * value keeps today's record story and its fences. */
  export function genericIfaceBindingKeepsClass(L: Lowerer, decl: ts.VariableDeclaration,
    declaredType: IrType,): boolean {
    if (declaredType.kind !== "record") return false;
    if (!ts.isIdentifier(decl.name) || decl.initializer === undefined || decl.type === undefined) return false;
    if ((ts.getCombinedNodeFlags(decl) & ts.NodeFlags.Const) === 0) return false;
    let init: ts.Expression = decl.initializer;
    while (ts.isParenthesizedExpression(init)) init = init.expression;
    if (!ts.isNewExpression(init)) return false;
    const shape = L.shapes.get(declaredType.shapeId);
    if (!shape || shape.fields.length > 0 || shape.indexValue !== undefined || shape.tuple === true) return false;
    const annT = L.typeOf(decl.name);
    const props = L.checker.getPropertiesOfType(annT);
    if (props.length === 0) return false;
    return props.every((p) => isGenericCallableMemberType(L.checker.getTypeOfSymbol(p), L.checker));
  }

/** `recv.m<T>(args)` — a GENERIC method call, dispatched STATICALLY: the
   * checker's resolved signature (type arguments substituted, inferred or
   * explicit) keys one instantiation of the nearest declarer's body, and
   * the call is a direct `call` of `%C.m%n` over the (up/down)cast
   * receiver. No per-instantiation vtable slots exist, so a receiver whose
   * runtime class could OVERRIDE the method (genericOverrideBelow) must be
   * statically exact (exactInstanceClassOf) — the override set then
   * resolves at compile time — or fences by name. */
  export function lowerClassGenericMethodCall(L: Lowerer, call: ts.CallExpression,
    access: ts.PropertyAccessExpression,
    recvInfo: ClassInfo,
    found: { declarer: ClassInfo; info: GenericFnInfo },
    recvIr?: IrExpr,): IrExpr {
    const name = access.name.text;
    let { declarer, info } = found;
    if (genericOverrideBelow(L, recvInfo, name)) {
      const exact = exactInstanceClassOf(L, access.expression);
      const refound = exact ? findGenericMethodOn(L, exact, name) : null;
      if (!refound) {
        L.unsupported(
          "SC1090",
          call,
          `calling the generic method '${name}' through a receiver whose runtime class may override it (a subclass of '${recvInfo.def.name.replace(/^%|^%m\d+\./, "")}' redeclares it and generic methods dispatch statically — bind the receiver to a const initialized with its 'new' expression)`,
        );
      }
      ({ declarer, info } = refound);
    }
    // Implicit-any methods instantiate over the call's ARGUMENT types
    // (there is no resolved generic signature — the untyped params are the
    // type parameters); everything else about the dispatch — static
    // resolution, the exactness rule above — is the generic story.
    const instance = info.implicitParams
      ? implicitCallInstance(L, call, info)
      : genericCallInstance(L, call, info);
    const receiver = recvIr ?? L.lowerExpr(access.expression);
    const loc = locOf(call);
    // The declarer sits at/above the receiver's static class on the plain
    // path; the EXACT path can land below it (a base-typed const provably
    // holding the subclass) — that direction is the checker-grade downcast
    // (the exactness proof is static, stronger than an instanceof guard).
    const thisArg =
      receiver.type.kind === "object" && isSubclassOf(L, declarer.def.name, receiver.type.className)
        ? { kind: "downcast" as const, value: receiver, type: { kind: "object" as const, className: declarer.def.name }, loc }
        : upcastTo(L, receiver, declarer.def.name);
    const args = L.completeArgs(call.arguments, instance.params, loc, call);
    return { kind: "call", callee: instance.name, args: [thisArg, ...args], type: instance.returnType, loc };
  }

/** Wraps a derived-class expression in an upcast when the target base
   * class differs (a no-op reinterpret at runtime; keeps IR types exact). */
  export function upcastTo(L: Lowerer, expr: IrExpr, className: string): IrExpr {
    if (expr.type.kind === "object" && expr.type.className !== className) {
      return { kind: "upcast", value: expr, type: { kind: "object", className }, loc: expr.loc };
    }
    return expr;
  }

/** Constructor and methods become module functions `%C.name` whose first
   * param is `this`. Field initializers run in declaration order at the top
   * of a base class's constructor; a derived class's run right after its
   * super() call returns (tsc/JS initialization order). Reachability gates
   * each member independently: an unreached method body never lowers and
   * never emits (pinned by the corpus), while every override a reachable
   * virtualCall can dispatch to was marked by the discovery pass. */
  /** True when a MIXIN class's constructor is the pure forwarding shape:
   * exactly one rest parameter, `super(...args)` as the first statement,
   * and no other reference to the parameter — the one rest-constructor
   * form with an exact static story under monomorphization (the
   * instantiation adopts the base's ABI; see collectClassShapeInner). */
  function mixinForwardingCtor(L: Lowerer, ctor: ts.ConstructorDeclaration): boolean {
    if (ctor.parameters.length !== 1 || !ctor.body) return false;
    const p = ctor.parameters[0]!;
    if (!p.dotDotDotToken || !ts.isIdentifier(p.name)) return false;
    const paramName = p.name;
    const paramSym = L.checker.getSymbolAtLocation(paramName);
    if (!paramSym) return false;
    const first = ctor.body.statements[0];
    if (!first || !ts.isExpressionStatement(first) || !ts.isCallExpression(first.expression)) return false;
    const call = first.expression;
    if (call.expression.kind !== ts.SyntaxKind.SuperKeyword) return false;
    if (call.arguments.length !== 1) return false;
    const a = call.arguments[0]!;
    if (!ts.isSpreadElement(a) || !ts.isIdentifier(a.expression)) return false;
    const spreadIdent = a.expression;
    if (L.checker.getSymbolAtLocation(spreadIdent) !== paramSym) return false;
    let extraRef = false;
    ts.walkPreorder(ctor.body, (n) => {
      if (n === spreadIdent) return undefined;
      if (ts.isIdentifier(n) && n.text === paramName.text && L.checker.getSymbolAtLocation(n) === paramSym) {
        extraRef = true;
        return "stop";
      }
      return undefined;
    });
    return !extraRef;
  }

export function lowerClassMembers(L: Lowerer, info: ClassInfo): IrFunction[] {
    const out: IrFunction[] = [];
    const className = info.def.name;
    // Generic-class INSTANTIATIONS (and mixin instantiations) are
    // demand-driven like generic-fn instances, not reachability units:
    // they are never registered as units, so wantBody's name-keyed gate
    // cannot apply — every member of a demanded instantiation lowers.
    const always = info.genericInstance !== undefined || info.mixinInstance !== undefined;
    // A FAMILY has no constructor function at all (nothing constructs it;
    // construction resolves to instantiations) and declares no instance
    // members — only its statics lower below.
    // A poison OUTSIDE the per-statement catches (a fenced parameter
    // default — declareParams lowers it before any statement-level catch
    // exists): the diagnostic is recorded — the member skips like a
    // signature-blocked function (lowerStaticMethod's rule) instead of
    // crashing the whole lowering.
    if (!info.generic && (always || L.wantBody(`%${className}.constructor`))) {
      try {
        out.push(L.lowerClassCtor(info));
      } catch (e) {
        if (!(e instanceof PoisonError)) throw e;
      }
    }
    for (const { mName, member } of L.classMethodMembers(info)) {
      if (!always && !L.wantBody(`%${className}.${mName}`)) continue;
      try {
        const fn = L.lowerClassMethodMember(info, member);
        if (fn) out.push(fn);
      } catch (e) {
        if (!(e instanceof PoisonError)) throw e;
      }
    }
    for (const name of info.staticMethods?.keys() ?? []) {
      if (!L.wantBody(`%${className}.static:${name}`)) continue;
      const fn = lowerStaticMethod(L, info, name);
      if (fn) out.push(fn);
    }
    for (const prop of info.throwingSetters) {
      if (always || L.wantBody(`%${className}.set:${prop}`)) out.push(L.throwingSetterFn(info, prop));
    }
    return out;
  }

/** The constructor function `%C.constructor`. Synthesized when absent: a
   * base class runs just its field initializers; a derived class inherits
   * the base's signature — forward every param to super(), then run own
   * field initializers. */
  export function lowerClassCtor(L: Lowerer, info: ClassInfo): IrFunction {
    return withInstanceBindings(L, info, () => lowerClassCtorInner(L, info));
  }

  function lowerClassCtorInner(L: Lowerer, info: ClassInfo): IrFunction {
    const className = info.def.name;
    const thisType: IrType = { kind: "object", className };
    const prevClass = L.currentClass;
    L.currentClass = info;
    L.fnStack.push(newFnCtx(false, null, null, VOID));
    try {
      const thisLocal = L.declareThis(thisType);
      const params: IrParam[] = [{ localId: thisLocal.id, name: "this", type: thisType }];
      const body: IrStmt[] = [];
      // The construction-relevant base: generic families are transparent
      // (an instantiation of a base-less generic class IS a base class —
      // its source has no super()).
      const ctorBase = superBaseOf(info);
      if (info.ctor && info.mixinInstance?.forwardingCtor) {
        // The mixin FORWARDING constructor: the declared rest parameter
        // never materializes — the ABI is the base's (synthetic params,
        // the synthesized-ctor rule), `super(...args)` forwards them
        // unchanged, and the remaining statements lower normally.
        const loc = locOf(info.ctor);
        const forward: IrExpr[] = info.ctorParams.map((shape, i) => {
          const local: IrLocal = { id: `arg${i}.0`, name: `arg${i}`, type: shape.type, mutable: false };
          L.ctx.locals.push(local);
          params.push({ localId: local.id, name: local.name, type: shape.type });
          return { kind: "varRef", localId: local.id, type: shape.type, loc };
        });
        body.push(...L.lowerDerivedCtorBody(info, thisLocal, forward));
      } else if (info.ctor) {
        // The default-param prologue runs FIRST — before field initializers
        // and (in a derived class) before super(): JS evaluates parameter
        // defaults on entry, ahead of everything the body does.
        const declared = L.declareParams(info.ctor.parameters, info.ctorParams);
        params.push(...declared.params);
        body.push(...declared.prologue);
        if (!ctorBase) {
          // Node's base-class order: field initializers run at the start
          // of construction, the parameter-property assignments open the
          // constructor body (probed — a field initializer reading a
          // parameter property sees undefined).
          body.push(...L.fieldInitStmts(info, thisLocal));
          body.push(...paramPropInitStmts(L, info, thisLocal));
          if (info.ctor.body) body.push(...L.lowerStmts(info.ctor.body.statements));
        } else if (info.ctor.body) {
          body.push(...L.lowerDerivedCtorBody(info, thisLocal));
        }
      } else {
        if (ctorBase) {
          // Synthetic forwarding params (the inherited ABI signature).
          // Nothing references them by symbol — only the super call below,
          // which forwards the already-completed values UNCHANGED (defaults
          // apply in the base constructor's own prologue, never twice).
          const loc = locOf(info.decl!);
          const superArgs: IrExpr[] = info.ctorParams.map((shape, i) => {
            const local: IrLocal = { id: `arg${i}.0`, name: `arg${i}`, type: shape.type, mutable: false };
            L.ctx.locals.push(local);
            params.push({ localId: local.id, name: local.name, type: shape.type });
            return { kind: "varRef", localId: local.id, type: shape.type, loc };
          });
          try {
            body.push(L.superCallStmt(info, thisLocal, superArgs, loc));
          } catch (e) {
            // A synthesized super() can fence (a stream base whose
            // underscore methods have no lowering): the diagnostic was
            // pushed; the half-initialized ctor stays out of the body.
            if (!(e instanceof PoisonError)) throw e;
          }
        }
        body.push(...L.fieldInitStmts(info, thisLocal));
      }
      return {
        name: `%${className}.constructor`,
        params,
        returnType: VOID,
        locals: L.ctx.locals,
        body,
        loc: locOf(info.ctor ?? info.decl!),
      };
    } finally {
      L.fnStack.pop();
      L.currentClass = prevClass;
    }
  }

/** The well-known Symbol keys that get a RESERVED method slot instead of
   * the computed-name fence. The slot name ("sym:iterator") is unspellable
   * as a user identifier, the accessor "get:x" convention.
   *
   * `iterator` is DISPATCHED: for-of, spreads and array destructuring
   * desugar to it (classIteratorOf). `dispose` and `asyncDispose` are
   * DECLARED ONLY -- the explicit-resource-management proposal calls them
   * from `using`/`await using` blocks, which this compiler does not lower,
   * and an explicit `x[Symbol.dispose]()` keeps the symbol-keyed access
   * fence. So a class carrying one compiles and the method is simply never
   * reached, which is what a program that never writes `using` does in Node
   * too. Real packages hang their whole class on this: mysql2's
   * Connection, Pool and PromiseConnection each declare one, and before
   * this the declaration alone refused the file. */
  const WELL_KNOWN_SYMBOL_SLOTS = new Set(["iterator", "dispose", "asyncDispose"]);

/** The lowered method-map name of a class member: identifier text, a
   * COMPUTED name that folds to one compile-time string
   * (foldedStringKeyOf — the object-literal computed-key machinery
   * applied to method positions; tsc late-bound the member under exactly
   * that name), or the reserved slot "sym:iterator" for
   * `[Symbol.iterator]` (a name no user identifier can spell — the
   * accessor "get:x" convention; for-of, spreads, and array destructuring
   * dispatch to it through the iterator protocol). Null for genuinely
   * runtime-keyed names — the computed-member fences stay. */
  export function classMemberNameOf(L: Lowerer, name: ts.PropertyName): string | null {
    if (ts.isIdentifier(name)) return name.text;
    // #private methods key by their spelled name ('#m') — '#' is
    // unspellable in public identifiers, the accessor-colon precedent.
    if (ts.isPrivateIdentifier(name)) return name.text;
    if (!ts.isComputedPropertyName(name)) return null;
    let e = name.expression;
    while (ts.isParenthesizedExpression(e)) e = e.expression;
    if (ts.isPropertyAccessExpression(e)) {
      const wellKnown = L.stdlibGlobalMember(e, "Symbol");
      if (wellKnown !== null && WELL_KNOWN_SYMBOL_SLOTS.has(wellKnown)) return `sym:${wellKnown}`;
    }
    return L.foldedStringKeyOf(name.expression);
  }

/** A class type's ITERATOR PROTOCOL shape, statically resolved: the
   * receiver declares (or inherits) `[Symbol.iterator]()` (the
   * "sym:iterator" method slot) returning a class whose zero-parameter
   * `next()` returns a record with a `value` field and an optional
   * boolean `done` field (`{ value, done: false }` — the self-iterator
   * idiom returns `this`, so the iterator class is usually the receiver
   * itself). A MISSING done field never terminates — exactly JS, where
   * `undefined` is falsy forever (Node loops forever too; corpus
   * iterators of that shape are deliberately infinite). Iterator classes
   * declaring `return`/`throw` members stay out — the desugars below
   * never call IteratorClose, and silently skipping a declared return()
   * would drop user cleanup. Null when the shape doesn't hold — callers
   * keep their fences. */
  export interface ClassIteratorInfo {
    /** The `[Symbol.iterator]()` call's receiver class + its declarer. */
    className: string;
    /** The iterator object's type (the method's return). */
    iterT: IrType & { kind: "object" };
    /** next()'s result record type. */
    resultT: IrType & { kind: "record" };
    valueT: IrType;
    /** False: no done field — the protocol never terminates. */
    hasDone: boolean;
  }
  export function classIteratorOf(L: Lowerer, t: IrType): ClassIteratorInfo | null {
    if (t.kind !== "object") return null;
    const info = L.classes.get(t.className);
    if (!info) return null;
    const iter = findMethodOn(L, info, "sym:iterator");
    if (!iter || iter.sig.params.length !== 0 || iter.sig.abstract === true) return null;
    const iterT = iter.sig.ret;
    if (iterT.kind !== "object") return null;
    const itInfo = L.classes.get(iterT.className);
    if (!itInfo) return null;
    // IteratorClose honesty: a declared return()/throw() would be called
    // by JS on abrupt completion; these desugars never close.
    if (findMethodOn(L, itInfo, "return") || findMethodOn(L, itInfo, "throw")) return null;
    const next = findMethodOn(L, itInfo, "next");
    if (!next || next.sig.params.length !== 0 || next.sig.abstract === true) return null;
    const resultT = next.sig.ret;
    if (resultT.kind !== "record") return null;
    const shape = L.shapes.get(resultT.shapeId);
    const value = shape?.fields.find((f) => f.name === "value");
    if (!shape || !value) return null;
    const done = shape.fields.find((f) => f.name === "done");
    if (done && done.type.kind !== "bool") return null;
    return { className: t.className, iterT, resultT, valueT: value.type, hasDone: done !== undefined };
  }

/** The `it.next()` step of a class iterator as an ordinary (possibly
   * virtual) method call. */
  export function classIteratorNextCall(L: Lowerer, cit: ClassIteratorInfo, itRef: IrExpr, loc: SrcLoc): IrExpr {
    return accessorCall(L, cit.iterT.className, "next", itRef, [], cit.resultT, loc);
  }

/** `recv[Symbol.iterator]()` as an ordinary method call. */
  export function classIteratorOpenCall(L: Lowerer, cit: ClassIteratorInfo, recv: IrExpr, loc: SrcLoc): IrExpr {
    return accessorCall(L, cit.className, "sym:iterator", recv, [], cit.iterT, loc);
  }

/** `[...new C]` / `f(...new C)` over a CLASS ITERABLE: the eager drain —
   * an interned `%iter.drain.<n>(recv)` lifted function running the
   * whole protocol into a fresh element array (a doneless iterator loops
   * forever, exactly Node's spread of an infinite iterator). `elemT`
   * (default: the iterator's own value type) is the DESTINATION element —
   * a spread into a union-element literal (`[...numbers, ...symbols]` as
   * `(number | symbol)[]`) pushes each value wrapped into its arm. Null
   * when the value isn't a recognized class iterable or the element
   * doesn't coerce — spread fences stay. */
  export function classIteratorDrainCall(L: Lowerer, src: IrExpr, loc: SrcLoc, elemT?: IrType): IrExpr | null {
    const cit = classIteratorOf(L, src.type);
    if (!cit) return null;
    const outElem = elemT ?? cit.valueT;
    // Probe the element coercion purely: identical types, or an arm of a
    // union destination (the wrap coerceToExpected applies below).
    if (!typeEquals(outElem, cit.valueT)) {
      if (outElem.kind !== "union" || L.armTag(outElem.unionId, cit.valueT) < 0) return null;
    }
    const outT = arrayOf(outElem);
    const key = `${cit.className}:${typeKey(outElem)}`;
    let name = L.iterDrainHelpers.get(key);
    if (!name) {
      name = `%iter.drain.${L.iterDrainHelpers.size}`;
      L.iterDrainHelpers.set(key, name);
      const recvT: IrType = { kind: "object", className: cit.className };
      const recvRef: IrExpr = { kind: "varRef", localId: "r.0", type: recvT, loc };
      const itRef: IrExpr = { kind: "varRef", localId: "it.0", type: cit.iterT, loc };
      const outRef: IrExpr = { kind: "varRef", localId: "out.0", type: outT, loc };
      const resRef: IrExpr = { kind: "varRef", localId: "res.0", type: cit.resultT, loc };
      const valueRead: IrExpr = { kind: "recordGet", obj: resRef, shapeId: cit.resultT.shapeId, field: "value", type: cit.valueT, loc };
      const loop: IrStmt[] = [
        { kind: "varDecl", localId: "res.0", init: classIteratorNextCall(L, cit, itRef, loc), loc },
        ...(cit.hasDone
          ? [
              {
                kind: "if",
                cond: { kind: "recordGet", obj: resRef, shapeId: cit.resultT.shapeId, field: "done", type: BOOL, loc },
                then: [{ kind: "return", value: outRef, loc }],
                else_: null,
                loc,
              } satisfies IrStmt,
            ]
          : []),
        {
          kind: "exprStmt",
          expr: {
            kind: "arrIntrinsic",
            method: "push",
            receiver: outRef,
            args: [L.coerceToExpected(valueRead, outElem)],
            type: F64,
            loc,
          },
          loc,
        },
      ];
      L.liftedFns.push({
        name,
        params: [{ localId: "r.0", name: "r", type: recvT }],
        returnType: outT,
        locals: [
          { id: "r.0", name: "r", type: recvT, mutable: false },
          { id: "it.0", name: "it", type: cit.iterT, mutable: false },
          { id: "out.0", name: "out", type: outT, mutable: false },
          { id: "res.0", name: "res", type: cit.resultT, mutable: true },
        ],
        body: [
          { kind: "varDecl", localId: "out.0", init: { kind: "arrayLit", elems: [], type: outT, loc }, loc },
          { kind: "varDecl", localId: "it.0", init: classIteratorOpenCall(L, cit, recvRef, loc), loc },
          {
            kind: "while",
            cond: { kind: "boolLit", value: true, type: BOOL, loc },
            body: loop,
            loc,
          },
          // Doneless iterators never leave the loop; satisfies the
          // all-paths-return rule (the retag-helper convention).
          {
            kind: "throw",
            value: { kind: "strLit", value: "scriptc: internal error: iterator drain fell through", type: STRING, loc },
            loc,
          },
        ],
        loc,
      });
    }
    return { kind: "call", callee: name, args: [src], type: outT, loc };
  }

/** The tail of a class iterable's protocol from an already-open ITERATOR
   * object (`var [a, ...rest] = new C` — the rest element drains whatever
   * next() still yields): the drain loop keyed by the iterator class. */
  export function classIteratorRestDrainCall(L: Lowerer, cit: ClassIteratorInfo, itVal: IrExpr, loc: SrcLoc): IrExpr {
    const outT = arrayOf(cit.valueT);
    const key = `it:${cit.iterT.className}`;
    let name = L.iterDrainHelpers.get(key);
    if (!name) {
      name = `%iter.drain.${L.iterDrainHelpers.size}`;
      L.iterDrainHelpers.set(key, name);
      const itRef: IrExpr = { kind: "varRef", localId: "it.0", type: cit.iterT, loc };
      const outRef: IrExpr = { kind: "varRef", localId: "out.0", type: outT, loc };
      const resRef: IrExpr = { kind: "varRef", localId: "res.0", type: cit.resultT, loc };
      const loop: IrStmt[] = [
        { kind: "varDecl", localId: "res.0", init: classIteratorNextCall(L, cit, itRef, loc), loc },
        ...(cit.hasDone
          ? [
              {
                kind: "if",
                cond: { kind: "recordGet", obj: resRef, shapeId: cit.resultT.shapeId, field: "done", type: BOOL, loc },
                then: [{ kind: "return", value: outRef, loc }],
                else_: null,
                loc,
              } satisfies IrStmt,
            ]
          : []),
        {
          kind: "exprStmt",
          expr: {
            kind: "arrIntrinsic",
            method: "push",
            receiver: outRef,
            args: [{ kind: "recordGet", obj: resRef, shapeId: cit.resultT.shapeId, field: "value", type: cit.valueT, loc }],
            type: F64,
            loc,
          },
          loc,
        },
      ];
      L.liftedFns.push({
        name,
        params: [{ localId: "it.0", name: "it", type: cit.iterT }],
        returnType: outT,
        locals: [
          { id: "it.0", name: "it", type: cit.iterT, mutable: false },
          { id: "out.0", name: "out", type: outT, mutable: false },
          { id: "res.0", name: "res", type: cit.resultT, mutable: true },
        ],
        body: [
          { kind: "varDecl", localId: "out.0", init: { kind: "arrayLit", elems: [], type: outT, loc }, loc },
          { kind: "while", cond: { kind: "boolLit", value: true, type: BOOL, loc }, body: loop, loc },
          {
            kind: "throw",
            value: { kind: "strLit", value: "scriptc: internal error: iterator drain fell through", type: STRING, loc },
            loc,
          },
        ],
        loc,
      });
    }
    return { kind: "call", callee: name, args: [itVal], type: outT, loc };
  }

/** One method or accessor body as its module function `%C.name`
   * (accessors are methods with property syntax: "get:x"/"set:x" entries —
   * see collectClassShape). */
  export function lowerClassMethodMember(L: Lowerer, info: ClassInfo,
    fnLike: ts.MethodDeclaration | ts.AccessorDeclaration,): IrFunction | null {
    return withInstanceBindings(L, info, () => lowerClassMethodMemberInner(L, info, fnLike));
  }

  function lowerClassMethodMemberInner(L: Lowerer, info: ClassInfo,
    fnLike: ts.MethodDeclaration | ts.AccessorDeclaration,): IrFunction | null {
    const className = info.def.name;
    const thisType: IrType = { kind: "object", className };
    const memberName = ts.isMethodDeclaration(fnLike) ? classMemberNameOf(L, fnLike.name) : ts.isIdentifier(fnLike.name) || ts.isPrivateIdentifier(fnLike.name) ? fnLike.name.text : null;
    if (memberName === null) return null;
    const mName = ts.isMethodDeclaration(fnLike)
      ? memberName
      : `${ts.isGetAccessor(fnLike) ? "get" : "set"}:${memberName}`;
    const sig = info.methods.get(mName);
    if (!sig || !fnLike.body) return null;
    const prevClass = L.currentClass;
    L.currentClass = info;
    // ASYNC methods: the module function is an async IrFunction — its
    // body returns the promise's INNER type (a `return v` fulfills with
    // v) and every call enters through the emitted fiber spawn wrapper
    // (callTargetC routes by fn.async; `this` rides as param 0 in the
    // spawn's argument pack). Dispatch is static by construction — the
    // override fence at collection keeps async methods out of vtables.
    const isAsync = sig.async === true && sig.ret.kind === "promise";
    // #PRIVATE GENERATOR methods: the module function is a generator
    // IrFunction — the body returns the TReturn channel, yields ride
    // ctx.generator, and every call (direct by construction — privates
    // never virtualize) enters through the emitted gen-spawn wrapper with
    // `this` in the argument pack, answering the suspended generator.
    const genCh = sig.gen !== undefined && sig.ret.kind === "generator" ? sig.gen : null;
    const bodyReturn = isAsync && sig.ret.kind === "promise"
      ? sig.ret.inner
      : genCh !== null
        ? L.genBodyReturnType(sig.ret)
        : sig.ret;
    const fnCtx = newFnCtx(false, null, null, bodyReturn);
    fnCtx.isAsync = isAsync;
    if (genCh !== null) fnCtx.generator = genCh;
    L.fnStack.push(fnCtx);
    try {
      const thisLocal = L.declareThis(thisType);
      const params: IrParam[] = [{ localId: thisLocal.id, name: "this", type: thisType }];
      // `this` is declared first, so method parameter DEFAULTS may use it
      // (JS allows this in method defaults; it is param 0 here).
      const declared = L.declareParams(fnLike.parameters, sig.params);
      params.push(...declared.params);
      const body = [...declared.prologue, ...L.lowerStmts(fnLike.body.statements)];
      const fn: IrFunction = {
        name: `%${className}.${mName}`,
        params,
        returnType: bodyReturn,
        locals: L.ctx.locals,
        body,
        loc: locOf(fnLike),
      };
      if (isAsync) fn.async = true;
      if (genCh !== null) fn.generator = genCh;
      return fn;
    } finally {
      L.fnStack.pop();
      L.currentClass = prevClass;
    }
  }

/** One static method body as its module function `%C.static:m` — an
   * ordinary function with NO `this` param. `this` and `super` inside
   * name the RECEIVER class in JS (dynamic — `F.who()` sees F even when
   * who() is declared on E), which has no static story here: both are
   * named fences, with arrow functions transparent (they inherit the
   * method's `this`) and this-binding function forms opaque — the static-
   * block rule verbatim. */
  export function lowerStaticMethod(L: Lowerer, info: ClassInfo, name: string): IrFunction | null {
    const entry = info.staticMethods?.get(name);
    if (!entry?.member.body) return null;
    const checkThis = (n: ts.Node): void => {
      if (
        ts.isFunctionExpression(n) || ts.isFunctionDeclaration(n) ||
        ts.isMethodDeclaration(n) || ts.isConstructorDeclaration(n) ||
        ts.isGetAccessor(n) || ts.isSetAccessor(n) ||
        ts.isClassDeclaration(n) || ts.isClassExpression(n)
      ) {
        return;
      }
      if (n.kind === ts.SyntaxKind.ThisKeyword || n.kind === ts.SyntaxKind.SuperKeyword) {
        L.unsupported(
          "SC1090",
          n,
          `'${n.kind === ts.SyntaxKind.ThisKeyword ? "this" : "super"}' in static methods (it names the RECEIVER class — a dynamic value; reference the class by name instead)`,
        );
      }
      n.forEachChild(checkThis);
    };
    // Async statics: an async IrFunction like any module function — the
    // body returns the promise's INNER type, calls enter through the
    // fiber spawn wrapper (callTargetC routes by fn.async).
    const isAsync =
      entry.member.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) === true &&
      entry.ret.kind === "promise";
    const bodyReturn = isAsync && entry.ret.kind === "promise" ? entry.ret.inner : entry.ret;
    const fnCtx = newFnCtx(false, null, null, bodyReturn);
    fnCtx.isAsync = isAsync;
    L.fnStack.push(fnCtx);
    try {
      entry.member.body.forEachChild(checkThis);
      const declared = L.declareParams(entry.member.parameters, entry.params);
      const body = [...declared.prologue, ...L.lowerStmts(entry.member.body.statements)];
      const fn: IrFunction = {
        name: `%${info.def.name}.static:${name}`,
        params: declared.params,
        returnType: bodyReturn,
        locals: L.ctx.locals,
        body,
        loc: locOf(entry.member),
      };
      if (isAsync) fn.async = true;
      return fn;
    } catch (e) {
      // A poison OUTSIDE the per-statement catches (the this/super fence,
      // a fenced parameter default): the diagnostic is recorded — the
      // method skips like a signature-blocked function (lowerFunction's
      // rule) instead of killing the whole analysis.
      if (!(e instanceof PoisonError)) throw e;
      return null;
    } finally {
      L.fnStack.pop();
    }
  }

/** A synthesized throwing setter: a getter-only override shadows the
   * inherited pair (JS), so a base-typed write dispatches HERE and must
   * throw exactly like Node's TypeError — a real instance (a typed catch's
   * `e instanceof TypeError` matches), catchable, exit 1 uncaught (message
   * text is compiler-worded; stdout and exit code are the contract). */
  export function throwingSetterFn(L: Lowerer, info: ClassInfo, prop: string): IrFunction {
    const className = info.def.name;
    const thisType: IrType = { kind: "object", className };
    const sig = info.methods.get(`set:${prop}`)!;
    const loc = locOf(info.decl!);
    const locals: IrLocal[] = [
      { id: "this.0", name: "this", type: thisType, mutable: false },
      { id: "v.0", name: "v", type: sig.params[0]!.type, mutable: false },
    ];
    return {
      name: `%${className}.set:${prop}`,
      params: locals.map((l) => ({ localId: l.id, name: l.name, type: l.type })),
      returnType: VOID,
      locals,
      body: [
        {
          kind: "throw",
          value: {
            kind: "libCall",
            fn: "error.new",
            args: [
              {
                kind: "strLit",
                value: `Cannot set property ${prop} which has only a getter`,
                type: STRING,
                loc,
              },
            ],
            type: { kind: "object", className: "%TypeError" },
            loc,
          },
          loc,
        },
      ],
      loc,
    };
  }

/** The base a constructor chain actually CALLS into: generic FAMILIES are
   * never constructed (no `%<family>.constructor` exists), so an
   * instantiation's construction-relevant base is the family's own base —
   * null when the generic class extends nothing, exactly the source's
   * story (tsc forbids super() there). Ordinary classes answer their base
   * unchanged. */
  export function superBaseOf(info: ClassInfo): ClassInfo | null {
    const b = info.base;
    return b?.generic ? b.base : b;
  }

/** The class's OWN field initializers as fieldSet statements (declaration
   * order) — a base constructor's prologue, a derived constructor's
   * super()-return continuation. */
  export function fieldInitStmts(L: Lowerer, info: ClassInfo, thisLocal: IrLocal): IrStmt[] {
    const out: IrStmt[] = [];
    const thisType: IrType = { kind: "object", className: info.def.name };
    for (const f of info.fieldOrder) {
      if (!f.initializer) continue;
      L.stats.statementsTotal++;
      L.bumpFileStat(locOf(f.initializer).file, "total");
      try {
        const value = L.lowerExprExpecting(f.initializer, f.type);
        out.push({
          kind: "fieldSet",
          obj: { kind: "varRef", localId: thisLocal.id, type: thisType, loc: locOf(f.initializer) },
          className: info.def.name,
          field: f.name,
          value,
          loc: locOf(f.initializer),
        });
      } catch (e) {
        if (!(e instanceof PoisonError)) throw e;
        L.stats.statementsFailed++;
        L.bumpFileStat(locOf(f.initializer).file, "failed");
      }
    }
    return out;
  }

/** PARAMETER-PROPERTY assignments (`this.x = x`, synthesized): run AFTER
   * the field initializers — Node's transform defines the fields at the
   * top of the class body (undefined until assigned) and injects the
   * assignments at the start of the constructor body, i.e. after super()
   * and after the (native) field initializers ran (probed: a field
   * initializer reading `this.x` sees undefined; the body sees the value).
   * Each assignment reads the parameter's BODY local (defaults already
   * applied by the declareParams prologue), whose type the collection made
   * the field's type — slot-exact by construction. */
  export function paramPropInitStmts(L: Lowerer, info: ClassInfo, thisLocal: IrLocal): IrStmt[] {
    const out: IrStmt[] = [];
    const thisType: IrType = { kind: "object", className: info.def.name };
    for (const pp of info.paramProps ?? []) {
      const loc = locOf(pp.param);
      const local = ts.isIdentifier(pp.param.name) ? L.resolveLocal(pp.param.name) : null;
      if (!local || !typeEquals(local.type, pp.type)) {
        // Defensive: collection derived the field type from the same
        // paramShape the ctor's declareParams bound — they cannot diverge.
        L.unsupported("SC1090", pp.param, "this parameter property form");
      }
      out.push({
        kind: "fieldSet",
        obj: { kind: "varRef", localId: thisLocal.id, type: thisType, loc },
        className: info.def.name,
        field: pp.name,
        value: { kind: "varRef", localId: local!.id, type: local!.type, loc },
        loc,
      });
    }
    return out;
  }

/** A derived constructor's body: statements lower as usual EXCEPT the
   * top-level `super(...)` statement, which becomes a direct call to the
   * base constructor over the same `this`, immediately followed by this
   * class's field initializers (JS runs them when super returns). tsc
   * guarantees a super call exists and runs before any this-use; the
   * supported form is a top-level expression statement — anywhere else
   * (conditionals, expression positions) is rejected, not misordered. */
  export function lowerDerivedCtorBody(L: Lowerer, info: ClassInfo, thisLocal: IrLocal,
    /** Mixin forwarding-constructor mode: `super(...args)` forwards these
     * pre-declared synthetic params directly (the spread never lowers —
     * the base's ABI is this constructor's ABI). */
    forward?: IrExpr[],): IrStmt[] {
    const out: IrStmt[] = [];
    let superSeen = false;
    for (const stmt of info.ctor!.body!.statements) {
      const superCall =
        ts.isExpressionStatement(stmt) &&
        ts.isCallExpression(stmt.expression) &&
        stmt.expression.expression.kind === ts.SyntaxKind.SuperKeyword
          ? stmt.expression
          : null;
      if (!superCall) {
        out.push(...L.lowerStmts([stmt]));
        continue;
      }
      if (!L.suppressStats) {
        L.stats.statementsTotal++;
        L.bumpFileStat(locOf(stmt).file, "total");
      }
      try {
        if (superSeen) L.unsupported("SC1090", stmt, "multiple super() calls");
        superSeen = true;
        const base = superBaseOf(info)!;
        if (base.builtinEmitter && superCall.arguments.length > 0) {
          // @types/node admits super({ captureRejections }) — no lowering.
          L.unsupported("SC1090", superCall, "EventEmitter constructor options ('captureRejections')");
        }
        if (base.builtinStream) {
          // super(options?) into a runtime stream base: the stream spoke
          // parses the options and binds overridden underscore methods.
          out.push(...lowerStreamSuperCall(L, info, base, superCall.arguments, thisLocal, locOf(stmt), stmt));
          out.push(...L.fieldInitStmts(info, thisLocal));
          out.push(...paramPropInitStmts(L, info, thisLocal));
          continue;
        }
        const args = forward !== undefined
          ? forward
          : base.builtinError
            ? [L.errorMessageArg(superCall.arguments, locOf(stmt), stmt)]
            : base.builtinEmitter
              ? []
              : L.completeArgs(superCall.arguments, base.ctorParams, locOf(stmt), stmt);
        out.push(L.superCallStmt(info, thisLocal, args, locOf(stmt)));
        // super() returns → field initializers → parameter-property
        // assignments (Node's order, probed) → the rest of the body.
        out.push(...L.fieldInitStmts(info, thisLocal));
        out.push(...paramPropInitStmts(L, info, thisLocal));
      } catch (e) {
        if (!(e instanceof PoisonError)) throw e;
        if (!L.suppressStats) {
          L.stats.statementsFailed++;
          L.bumpFileStat(locOf(stmt).file, "failed");
        }
      }
    }
    if (!superSeen) {
      // tsc guarantees the call exists somewhere; if it wasn't a top-level
      // statement the per-site rejection above already fired — this is the
      // constructor-level backstop so a half-initialized ctor never emits.
      L.pushDiag(
        unsupportedDiag(
          "SC1090",
          locOf(info.ctor!),
          "super() calls anywhere but as a top-level constructor statement",
        ),
      );
    }
    return out;
  }

/** `super(args)` → direct call of the base constructor with the SAME
   * `this` (upcast; retained by the varRef read — the callee owns and
   * releases its param per the universal convention). */
  export function superCallStmt(L: Lowerer, info: ClassInfo,
    thisLocal: IrLocal,
    args: IrExpr[],
    loc: SrcLoc,): IrStmt {
    const base = superBaseOf(info)!;
    const thisRef: IrExpr = {
      kind: "varRef",
      localId: thisLocal.id,
      type: { kind: "object", className: info.def.name },
      loc,
    };
    if (base.builtinError) {
      // super(message) into the runtime-provided Error constructor: stamps
      // name/message on the (already-allocated) object. Receiver + message
      // are BORROWED by the libCall — no ownership transfer, unlike the
      // call form below.
      return {
        kind: "exprStmt",
        expr: {
          kind: "libCall",
          fn: "error.ctor",
          args: [L.upcastTo(thisRef, base.def.name), ...args],
          type: VOID,
          loc,
        },
        loc,
      };
    }
    if (base.builtinEmitter) {
      // super() into the runtime-provided EventEmitter: the emitted
      // allocation already initialized the prefix (registry NULL, display
      // name stamped), so the call is a placeholder site. Receiver
      // borrowed, like error.ctor.
      return {
        kind: "exprStmt",
        expr: {
          kind: "libCall",
          fn: "emitter.ctor",
          args: [L.upcastTo(thisRef, base.def.name)],
          type: VOID,
          loc,
        },
        loc,
      };
    }
    if (base.builtinStream) {
      // The SYNTHESIZED constructor of a ctor-less stream subclass:
      // super() with default options (underscore methods still bind; a
      // construction passing options requires a declared constructor —
      // lowerNew fences that). Zero options ⇒ exactly one init stmt.
      return lowerStreamSuperCall(L, info, base, [], thisLocal, loc, info.decl ?? info.ctor!)[0]!;
    }
    L.noteEdge(`%${base.def.name}.constructor`);
    return {
      kind: "exprStmt",
      expr: {
        kind: "call",
        callee: `%${base.def.name}.constructor`,
        args: [L.upcastTo(thisRef, base.def.name), ...args],
        type: VOID,
        loc,
      },
      loc,
    };
  }

/** `super.method(args)`: the base chain's implementation, called
   * DIRECTLY over this method's own `this` (upcast to the declarer) —
   * super dispatch is static in JS too, never through the dynamic class. */
  export function lowerSuperMethodCall(L: Lowerer, call: ts.CallExpression,
    access: ts.PropertyAccessExpression,): IrExpr {
    const cls = L.currentClass;
    if (!cls?.base) {
      // tsc rejects super outside derived-class bodies first; defensive.
      L.unsupported("SC1090", access, "'super' outside a derived class");
    }
    // An emit-override SPECIALIZATION body's forward — `super.emit(event,
    // ...args)` — carries no literal event name; the specialization's own
    // context answers it (matched before any lookup: neither identifier
    // resolves through the ordinary lowering).
    const forward = emitSpecSuperForward(L, call, access);
    if (forward) return forward;
    const found = L.findMethodOn(cls.base, access.name.text);
    if (!found) {
      // `super.m(...)` of a GENERIC method: super dispatch is static in JS
      // too, so the base chain's declaration answers unconditionally — the
      // ordinary instantiation route over this method's own `this`.
      const gfound = findGenericMethodOn(L, cls.base, access.name.text);
      if (gfound) {
        const thisL = L.resolveThis();
        if (!thisL) L.unsupported("SC1080", access);
        // An IMPLICIT-any method instantiates over the call's ARGUMENT
        // types — there is no resolved generic signature to read type
        // arguments off. The same split lowerClassGenericMethodCall makes.
        const instance = gfound.info.implicitParams
          ? implicitCallInstance(L, call, gfound.info)
          : genericCallInstance(L, call, gfound.info);
        const loc = locOf(call);
        const thisRef: IrExpr = { kind: "varRef", localId: thisL.id, type: thisL.type, loc };
        const args = L.completeArgs(call.arguments, instance.params, loc, call);
        return {
          kind: "call",
          callee: instance.name,
          args: [L.upcastTo(thisRef, gfound.declarer.def.name), ...args],
          type: instance.returnType,
          loc,
        };
      }
      // The runtime-provided emitter surface through `super` —
      // `super.emit('x', v)`, `super.on(...)`: Node's prototype-chain rule
      // is STATIC dispatch above the lexical class, which the emitter
      // spoke lowers with this method's own `this` as the receiver (an
      // emit override at-or-below `cls` never answers; the nearest one
      // strictly above does).
      if (EMITTER_API_MEMBERS.has(access.name.text) && emitterRooted(L, cls.base)) {
        const viaEmitter = lowerEmitterSuperCall(L, call, access, cls);
        if (viaEmitter) return viaEmitter;
      }
      L.unsupported("SC1090", access, `'super.${access.name.text}' (no base class declares it)`);
    }
    // tsc rejects super-access of abstract members (TS2513); defensive —
    // no function exists behind an abstract declaration.
    if (found.sig.abstract === true) {
      L.unsupported("SC1090", access, `'super.${access.name.text}' of an abstract method`);
    }
    const thisLocal = L.resolveThis();
    if (!thisLocal) L.unsupported("SC1080", access);
    L.noteEdge(`%${found.declarer.def.name}.${access.name.text}`);
    const loc = locOf(call);
    const thisRef: IrExpr = { kind: "varRef", localId: thisLocal.id, type: thisLocal.type, loc };
    const args = L.completeArgs(call.arguments, found.sig.params, loc, call);
    return {
      kind: "call",
      callee: `%${found.declarer.def.name}.${access.name.text}`,
      args: [L.upcastTo(thisRef, found.declarer.def.name), ...args],
      type: found.sig.ret,
      loc,
    };
  }

/** The `this` reference for super accessor reads/writes, with the shared
   * validity checks (derived-class body, resolvable this). */
  export function superThisRef(L: Lowerer, access: ts.PropertyAccessExpression): { thisRef: IrExpr; base: ClassInfo } {
    const cls = L.currentClass;
    if (!cls?.base) {
      L.unsupported("SC1090", access, "'super' outside a derived class");
    }
    const thisLocal = L.resolveThis();
    if (!thisLocal) L.unsupported("SC1080", access);
    const loc = locOf(access);
    return {
      thisRef: { kind: "varRef", localId: thisLocal.id, type: thisLocal.type, loc },
      base: cls.base,
    };
  }

/** `super.x` read: a DIRECT call of the base chain's getter over this
   * method's own `this` (upcast to the declarer) — like super.method(),
   * never through the vtable. */
  export function lowerSuperAccessorRead(L: Lowerer, access: ts.PropertyAccessExpression): IrExpr {
    const { thisRef, base } = L.superThisRef(access);
    const name = access.name.text;
    const found = L.findMethodOn(base, `get:${name}`);
    if (!found) {
      L.unsupported(
        "SC1090",
        access,
        L.findMethodOn(base, name)
          ? `bound method references through 'super' (call 'super.${name}(...)' directly)`
          : `'super.${name}' (only base-class methods and getter properties are readable through 'super')`,
      );
    }
    // tsc rejects super-access of abstract members (TS2513); defensive.
    if (found.sig.abstract === true) {
      L.unsupported("SC1090", access, `'super.${name}' of an abstract accessor`);
    }
    L.noteEdge(`%${found.declarer.def.name}.get:${name}`);
    return {
      kind: "call",
      callee: `%${found.declarer.def.name}.get:${name}`,
      args: [L.upcastTo(thisRef, found.declarer.def.name)],
      type: found.sig.ret,
      loc: locOf(access),
    };
  }

/** `super.x = v`: a DIRECT call of the base chain's setter (same
   * static-dispatch rule as every super member access). */
  export function lowerSuperAccessorWrite(L: Lowerer, access: ts.PropertyAccessExpression,
    rhs: ts.Expression,
    loc: SrcLoc,): IrStmt {
    const { thisRef, base } = L.superThisRef(access);
    const name = access.name.text;
    const found = L.findMethodOn(base, `set:${name}`);
    if (!found) {
      L.unsupported(
        "SC1090",
        access,
        `assignment to 'super.${name}' (no base class declares a setter for it)`,
      );
    }
    // tsc rejects super-access of abstract members (TS2513); defensive.
    if (found.sig.abstract === true) {
      L.unsupported("SC1090", access, `assignment to 'super.${name}' of an abstract accessor`);
    }
    L.noteEdge(`%${found.declarer.def.name}.set:${name}`);
    const value = L.lowerExprExpecting(rhs, found.sig.params[0]!.type);
    return {
      kind: "exprStmt",
      expr: {
        kind: "call",
        callee: `%${found.declarer.def.name}.set:${name}`,
        args: [L.upcastTo(thisRef, found.declarer.def.name), value],
        type: VOID,
        loc,
      },
      loc,
    };
  }

/** True when `info`'s EFFECTIVE constructor — its own, or the one
   * inherited through ctor-less bases — is a builtin error class's. Such
   * classes construct with the error message rule, and their synthesized
   * constructors forward one plain string to error.ctor. */
  export function inheritsBuiltinErrorCtor(L: Lowerer, info: ClassInfo): boolean {
    for (let c: ClassInfo | null = info; c; c = c.base) {
      if (c.builtinError) return true;
      if (c.ctor) return false;
    }
    return false;
  }

/** The EventEmitter twin: a ctor-less chain into the emitter base
   * inherits `new C()` — zero arguments (the options bag fences). */
  export function inheritsBuiltinEmitterCtor(L: Lowerer, info: ClassInfo): boolean {
    for (let c: ClassInfo | null = info; c; c = c.base) {
      if (c.builtinStream) return false; // the stream story owns the chain
      if (c.builtinEmitter) return true;
      if (c.ctor) return false;
    }
    return false;
  }

/** The stream twin: a ctor-less chain into a runtime stream base
   * inherits `new C()` — zero arguments (the synthesized constructor runs
   * super() with default options; passing options through an inherited
   * constructor would need the literal at the new-site to plumb, so it
   * asks for a declared constructor instead). */
  export function inheritsBuiltinStreamCtor(L: Lowerer, info: ClassInfo): boolean {
    for (let c: ClassInfo | null = info; c; c = c.base) {
      if (c.builtinStream) return true;
      if (c.ctor) return false;
    }
    return false;
  }

/** `new C(args)` for a class declared in the program (imports resolve
   * through aliases, so cross-module classes construct too). */
  /** The single message argument of a builtin Error construction or
   * super() call: "" when omitted or explicitly undefined (Node's message
   * property default), the string otherwise. The lib signature's second
   * parameter (options/cause) has no lowering. */
  export function errorMessageArg(L: Lowerer, args: readonly ts.Expression[], loc: SrcLoc, blame: ts.Node): IrExpr {
    if (args.length > 1) {
      L.unsupported("SC1090", args[1] ?? blame, "Error constructor options ('cause')");
    }
    if (args.length === 0) return { kind: "strLit", value: "", type: STRING, loc };
    const value = L.lowerExpr(args[0]!);
    if (value.type.kind === "string") return value;
    if (value.kind === "unitLit" && value.unit === "undefined") {
      return { kind: "strLit", value: "", type: STRING, loc };
    }
    L.unsupported(
      "SC1090",
      args[0]!,
      `Error messages of type '${L.fmt(value.type)}' (the message must be a string)`,
    );
  }

/** `new C(...)` of a registered PROGRAM class — the shared tail of the
 * identifier and namespace-qualified construction forms. */
/** `new Box(1)` / `new Box<string>("s")` — construction of a GENERIC
 * class resolves to the INSTANTIATION the expression's checker type names
 * (inference and explicit type arguments both land there; defaults apply).
 * The identity function for ordinary classes. */
function genericNewTarget(L: Lowerer, expr: ts.NewExpression, info: ClassInfo): ClassInfo {
  if (!info.generic) return info;
  const t = L.typeOf(expr);
  const mapped = L.mapTypeOf(t);
  const instInfo = mapped?.kind === "object" ? L.classes.get(mapped.className) : undefined;
  // Unmappable type arguments (or a poisoned instantiation): the site
  // reports the type it cannot compile — the instantiation's own
  // diagnostic (context-tagged) already told the deeper story.
  if (!instInfo || instInfo.generic) L.badType(expr, t);
  return instInfo;
}

/** A class whose DEFINITION provably throws — its decoration, or an
 * `extends` clause naming an ambient class nothing defines — has no
 * reachable VALUE form: the binding never initializes (the %init
 * ReferenceError unwinds first), so `new`, the class as a value, and
 * `extends` all fence — reaching one in compiled code would require
 * executing past the throw.
 *
 * This is a refusal standing on PROVABLY DEAD code, and that is
 * deliberate: the alternative is lowering those uses to the same
 * undefRead trap shape (trapBindings' stance for `declare const` chains),
 * which is sound but would change what shipped for the decorator case.
 * The distance it costs is measurable and stated: a program that
 * constructs the class after declaring it stops being a WRONG answer and
 * becomes a build refusal, not a MATCH. */
export function fenceDecorationThrows(L: Lowerer, info: ClassInfo, blame: ts.Node): void {
  if (info.decorationThrows === undefined) return;
  L.unsupported(
    "SC1090",
    blame,
    `using the class '${info.def.jsName || info.def.name}' whose ${info.decorationThrows.via} provably throws ('${info.decorationThrows.name}' is an ambient name nothing defines — the class statement crashes before the binding exists, so nothing below it ever runs)`,
  );
}

function lowerProgramClassNew(L: Lowerer, expr: ts.NewExpression, info0: ClassInfo, loc: SrcLoc): IrExpr {
  const info = genericNewTarget(L, expr, info0);
  fenceDecorationThrows(L, info, expr);
  L.noteEdge(`%${info.def.name}.constructor`);
  // A ctor-less chain into an EventEmitter base inherits `new C()` —
  // zero arguments (the options bag fences, like the super() form).
  // Stream subclasses come first: their chain roots at the emitter
  // too, but the message should name the stream story.
  if (inheritsBuiltinStreamCtor(L, info) && (expr.arguments ?? []).length > 0) {
    L.noLowering(
      `new ${info.def.name.replace(/^%/, "")} with arguments through an inherited stream constructor`,
      expr.arguments![0]!,
      "declare a constructor that passes an inline options object to super(...)",
    );
  }
  if (L.inheritsBuiltinEmitterCtor(info) && (expr.arguments ?? []).length > 0) {
    L.unsupported("SC1090", expr.arguments![0]!, "EventEmitter constructor options ('captureRejections')");
  }
  // A ctor-less chain into a builtin error base inherits `new
  // C(message?)` — completed by the error rule (one plain string),
  // not the general ABI completion.
  const args = L.inheritsBuiltinErrorCtor(info)
    ? [L.errorMessageArg(expr.arguments ?? [], loc, expr)]
    : L.completeArgs(expr.arguments ?? [], info.ctorParams, loc, expr);
  return {
    kind: "new",
    className: info.def.name,
    args,
    type: { kind: "object", className: info.def.name },
    loc,
  };
}

/** An expression whose SPELLING cannot have an effect — a name, `this`, a
 * keyword or numeric/string literal, or a dotted path over those. Used to
 * decide whether a dropped operand still has to be evaluated. */
function effectFreeSpelling(e: ts.Expression): boolean {
  let n: ts.Expression = e;
  while (ts.isParenthesizedExpression(n)) n = n.expression;
  if (ts.isPropertyAccessExpression(n) && !n.questionDotToken) return effectFreeSpelling(n.expression);
  return (
    ts.isIdentifier(n) ||
    ts.isStringLiteral(n) ||
    ts.isNumericLiteral(n) ||
    n.kind === ts.SyntaxKind.ThisKeyword ||
    n.kind === ts.SyntaxKind.NullKeyword ||
    n.kind === ts.SyntaxKind.TrueKeyword ||
    n.kind === ts.SyntaxKind.FalseKeyword
  );
}

/** A construct-position expression that names a BOUND function, resolved
 * to what JS's [[Construct]] actually runs: the innermost bind TARGET, the
 * bound arguments it prepends, and the bound receivers it IGNORES (kept so
 * their effects still happen where the bind expression sat).
 *
 * Two spellings resolve. The DIRECT one — `new (f.bind(o, a))(b)` — owns
 * its bind expression, so the receiver has not been evaluated yet and
 * comes back in `thisArgs`. The INDIRECT one — `var B = f.bind(o); new
 * B(x)` — reaches through a never-reassigned binding whose declaration
 * already ran the bind, so nothing re-evaluates; it is admitted only with
 * NO bound arguments, because those were evaluated at the declaration and
 * re-lowering them here would run their effects a second time, in the
 * wrong order. Rebinding chains fold (the first bind's target wins,
 * arguments concatenate outward), exactly as JS composes them. */
function boundFnOriginOf(
  L: Lowerer,
  node: ts.Expression,
): { target: ts.Expression; boundArgs: readonly ts.Expression[]; thisArgs: readonly ts.Expression[] } | null {
  let e: ts.Expression = node;
  while (ts.isParenthesizedExpression(e)) e = e.expression;
  if (
    ts.isCallExpression(e) &&
    ts.isPropertyAccessExpression(e.expression) &&
    e.expression.name.text === "bind" &&
    !e.expression.questionDotToken &&
    e.arguments.length >= 1 &&
    !e.arguments.some((a) => ts.isSpreadElement(a)) &&
    L.checker.getCallSignatures(L.typeOf(e.expression.expression)).length > 0
  ) {
    const inner = boundFnOriginOf(L, e.expression.expression);
    return {
      target: inner ? inner.target : e.expression.expression,
      boundArgs: [...(inner?.boundArgs ?? []), ...e.arguments.slice(1)],
      thisArgs: [...(inner?.thisArgs ?? []), e.arguments[0]!],
    };
  }
  if (ts.isIdentifier(e)) {
    const sym = L.resolveValueSymbol(e) ?? undefined;
    const decls = sym ? L.checker.declarationsOf(sym) : [];
    const decl = decls.length === 1 ? decls[0]! : undefined;
    if (
      decl !== undefined &&
      ts.isVariableDeclaration(decl) &&
      decl.initializer !== undefined &&
      sym !== undefined &&
      bindingNeverReassigned(L, sym, decl)
    ) {
      const inner = boundFnOriginOf(L, decl.initializer);
      // Only the argument-free bind: the declaration already evaluated
      // everything this form would otherwise re-run.
      if (inner && inner.boundArgs.length === 0) {
        return { target: inner.target, boundArgs: [], thisArgs: [] };
      }
    }
  }
  return null;
}

/** A `new Promise<T>(executor)` whose executor RESOLVES WITH A PROMISE:
 * re-bind its resolve parameter to the SETTLE-OR-VALUE union `Promise<T> | T`
 * (paramIrOverrides) and answer that union, or null to leave the executor
 * exactly as it lowers today.
 *
 * WHY the parameter and not the argument. The lib's
 * `resolve: (value: T | PromiseLike<T>) => void` maps to `T` — the
 * PromiseLike arm has no home of its own, so the union collapses — and the
 * promise possibility is gone before the call is lowered. Nothing at the
 * call site can put it back: the resolve closure is the only thing that
 * holds the promise being settled, so adoption has to live in the closure's
 * own type. The settle-or-value union is the one shape a runtime tag can
 * tell apart (types.ts, settleOrValueArms), and `await` already consumes it.
 *
 * WHY only executors that need it. Re-binding every resolve would put a
 * union wrap in front of every `resolve(value)` in every program. The scan
 * below asks whether some call of the resolve parameter passes a value whose
 * IR type actually carries a promise; nothing else is touched, so a program
 * that resolves with plain values emits the same bytes it did before.
 *
 * The scan is deliberately narrow: an INLINE arrow/function executor whose
 * first parameter is a plain unannotated identifier. A resolve that escapes
 * as a value (`arr.push(resolve)`) or an executor written as a named
 * function VALUE keeps today's behaviour — including today's fences. */
function executorResolveAdoptionUnion(
  L: Lowerer,
  execNode: ts.Expression,
  inner: IrType,
): (IrType & { kind: "union" }) | null {
  // Promise<void> resolve takes no argument, and a promise PAYLOAD that is
  // itself a promise has no tag that separates the two.
  if (inner.kind === "void" || inner.kind === "promise") return null;
  let fn: ts.Expression = execNode;
  while (ts.isParenthesizedExpression(fn)) fn = fn.expression;
  if (!ts.isArrowFunction(fn) && !ts.isFunctionExpression(fn)) return null;
  const p0 = fn.parameters[0];
  if (
    p0 === undefined ||
    !ts.isIdentifier(p0.name) ||
    p0.type !== undefined ||
    p0.questionToken !== undefined ||
    p0.dotDotDotToken !== undefined ||
    p0.initializer !== undefined
  ) {
    return null;
  }
  const resolveSym = L.checker.getSymbolAtLocation(p0.name);
  if (resolveSym === undefined) return null;
  const promiseArm: IrType = { kind: "promise", inner };
  const payloadArms =
    inner.kind === "union" ? (L.unions.get(inner.unionId)?.arms ?? []) : [inner];
  if (payloadArms.length === 0) return null;
  if (payloadArms.some((a) => a.kind === "promise")) return null;
  // Does any call of the resolve parameter pass a value that CARRIES a
  // promise? The question is asked of the CHECKER type, never of the mapped
  // one. mapType INTERNS — record shapes and unions are minted on first
  // sight and emitted in creation order — so mapping an argument here, ahead
  // of the ordinary lowering, renumbers shapes in every program that merely
  // CONSTRUCTS a promise. (Measured twice: `u1186` -> `u1188` from a
  // speculative union intern, then `r2301` -> `r2302` from a speculative
  // mapType. zapo's whole emitted C moved, semantically unchanged both
  // times.) A Promise/PromiseLike reference, alone or as a union arm, is the
  // only thing this needs to know, and the checker answers it for free.
  const isPromiseRef = (t: ts.Type): boolean => {
    if (!t.isTypeReference()) return false;
    const n = t.getTarget().getSymbol()?.name;
    return n === "Promise" || n === "PromiseLike";
  };
  const carriesPromise = (t: ts.Type): boolean =>
    isPromiseRef(t) || (t.isUnionType() && t.getTypes().some(isPromiseRef));
  let wanted = false;
  const walk = (n: ts.Node): void => {
    if (wanted) return;
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.arguments.length === 1) {
      if (
        L.checker.getSymbolAtLocation(n.expression) === resolveSym &&
        carriesPromise(L.typeOf(n.arguments[0]!))
      ) {
        wanted = true;
      }
    }
    ts.forEachChild(n, walk);
  };
  walk(fn.body);
  // INTERNING IS THE LAST STEP, on purpose. UnionRegistry.intern MINTS an id
  // for an arm list it has not seen, and union ids are emitted in creation
  // order — interning speculatively, before the scan has said the union is
  // wanted, renumbers every union declared after it in every program that
  // merely CONSTRUCTS a promise. (Measured: zapo's emitted C moved by
  // nothing but `u1186` -> `u1188`.) Deciding first keeps the promise this
  // block makes — a program that does not resolve with a promise emits the
  // same bytes it did before.
  if (!wanted) return null;
  // Sorted before interning: mapType sorts and UnionRegistry keys on the arm
  // list AS GIVEN, so an unsorted intern would mint a SECOND id for a union
  // that already exists and typeEquals (which compares ids) would then
  // reject it everywhere.
  const arms = [promiseArm, ...payloadArms].sort((a, b) => (typeKey(a) < typeKey(b) ? -1 : 1));
  const sov: IrType & { kind: "union" } = { kind: "union", unionId: L.unions.intern(arms) };
  // The parameter IS the resolve closure, so the override is its SIGNATURE
  // with the widened value type — `(Promise<T> | T) => void`.
  L.paramIrOverrides.set(p0, { kind: "func", params: [sov], ret: VOID });
  return sov;
}

export function lowerNew(L: Lowerer, expr: ts.NewExpression): IrExpr {
    const loc = locOf(expr);
    /* better-sqlite3's `new Database(path, options?)` — the ONE npm
     * package the static lane serves itself. AHEAD of the npm fence
     * below, which is what it exists to answer: with
     * @types/better-sqlite3 installed the callee IS a package-declared
     * value, and the generic requires-dynamic diagnostic would win. */
    if (!L.dynamic) {
      const sqlite = lowerSqliteNew(L, expr);
      if (sqlite !== null) return sqlite;
    }
    // `new X(...)` where X is a package-declared class, in a static build:
    // the per-package requires-dynamic diagnostic (the constructor runs in
    // the embedded engine). Under --dynamic, X is jsval-typed and lowers
    // to the construct op below.
    if (!L.dynamic) {
      const pkg = ts.isIdentifier(expr.expression)
        ? L.npmPackageOfSymbol(L.resolveValueSymbol(expr.expression) ?? undefined)
        : null;
      if (pkg) {
        L.pushDiag(requiresDynamicPackageDiag(pkg, loc));
        throw new PoisonError();
      }
    }
    // Island construction: a jsval-typed callee (a package-declared class,
    // or any 'any'-typed constructor value) runs JS_CallConstructor —
    // `new Command()` is the npm entry point. Arguments marshal in; the
    // instance stays an island handle.
    if (L.isIslandExpr(expr.expression)) {
      const callee = L.lowerExpr(expr.expression);
      const args = (expr.arguments ?? []).map((a) => L.jsvalIn(L.lowerExpr(a), a));
      return { kind: "jsOp", op: "construct", args: [callee, ...args], type: JSVAL, loc };
    }
    // `new Missing(...)` where `Missing` is a top-level ambient
    // `declare class` NOTHING defines. Node erases the declaration, so
    // the CALLEE reference throws ReferenceError before a single
    // argument evaluates — undefRead reproduces that exactly, and the
    // `declare const Missing: { new (...): ... }` spelling of the same
    // declaration has always lowered this way. Without this arm the
    // class collected like a program class and construction answered a
    // calloc'd instance (every field 0 / "" / false, the constructor
    // arguments dropped as surplus) — a silent wrong answer where Node
    // throws. Placed after the npm and island arms so a package-declared
    // class keeps its own diagnostic.
    if (ts.isIdentifier(expr.expression) && ambientUndefinedClassSymbolOf(L, expr.expression) !== null) {
      const t = ambientUndefReadType(L, expr) ?? F64;
      return nsUndefRead(L, expr.expression.text, expr, t);
    }
    // `new events.EventEmitter()` — the namespace-member (and CJS
    // `require('events').EventEmitter`) construction form: the property's
    // symbol resolves to the same ambient class as the named import.
    if (ts.isPropertyAccessExpression(expr.expression) && ts.isIdentifier(expr.expression.name)) {
      const memberSym = L.checker.getSymbolAtLocation(expr.expression.name);
      const resolved =
        memberSym && memberSym.flags & ts.SymbolFlags.Alias
          ? L.checker.getAliasedSymbol(memberSym)
          : memberSym;
      const emitterInfo = L.builtinEmitterInfoOf(resolved);
      if (emitterInfo) {
        if ((expr.arguments ?? []).length > 0) {
          L.unsupported("SC1090", expr.arguments![0]!, "EventEmitter constructor options ('captureRejections')");
        }
        return {
          kind: "libCall",
          fn: "emitter.new",
          args: [],
          type: { kind: "object", className: RUNTIME_EMITTER_CLASS },
          loc,
        };
      }
      // `new stream.Readable({...})` — the namespace-member (and CJS
      // `require('stream').Readable`) construction form.
      const streamInfoNs = builtinStreamInfoOf(L, resolved);
      if (streamInfoNs) return lowerStreamNew(L, expr, streamInfoNs);
      // `new N.C(...)` / `new a.Point(...)` — construction through a
      // USER namespace qualifier (import= alias chains included): the
      // member resolves to the registered program class, guarded by the
      // namespace source-order fences (lower-namespaces.ts).
      if (!expr.expression.questionDotToken && nsMemberIdentOf(L, expr.expression)) {
        if (memberSym) fenceEarlyNsMemberRef(L, expr.expression, memberSym);
        // resolveValueSymbol (not the bare alias chase): the reference
        // must flush deferred collection diagnostics like any other.
        const classSym = L.resolveValueSymbol(expr.expression.name);
        const info = classSym ? L.classBySymbol.get(classSym) : undefined;
        // Qualified spellings of a rebindable decorated class (an import=
        // alias chain landing on it) cannot construct the declaration
        // directly — the decoration result decides. The bare-name path
        // routes through the class VALUE; the qualified one fences.
        if (info?.classDecorators?.valueGlobalId !== undefined) {
          L.unsupported(
            "SC1090",
            expr,
            "constructing a decorated class through a qualified name (a replacing decorator rebinds the class name — construct through the bare name)",
          );
        }
        if (info) return lowerProgramClassNew(L, expr, info, loc);
        L.unsupported(
          "SC1090",
          expr,
          `constructing '${expr.expression.name.text}' (a namespace member with no class lowering)`,
        );
      }
      // `new B.C()` where B is an AMBIENT namespace (fundule merges
      // included): Node evaluates the callee first and throws
      // ReferenceError before any argument runs — undefRead reproduces it
      // exactly.
      if (!expr.expression.questionDotToken) {
        const ambientRoot = ambientNsRootOf(L, expr.expression.expression);
        if (ambientRoot !== null) {
          const t = ambientUndefReadType(L, expr);
          if (t) return nsUndefRead(L, ambientRoot.text, expr, t);
        }
      }
      // Construction through a CJS export member tsgo types `any`
      // (expando members — `new module.exports.Sub()` / `new
      // exports.Sub()` in-file, `new C.Sub()` through the require
      // binding): the member IS its pre-registered export global —
      // construction dispatches through the class VALUE, the classval
      // path's newValue with the global as the callee. Resolution is the
      // member-export symbol's; the class collects on demand (a body
      // lowering ahead of the assignment statement).
      if (
        !expr.expression.questionDotToken &&
        ((isCjsJsFile(expr.getSourceFile()) &&
          (isModuleExportsAccess(expr.expression.expression) ||
            (ts.isIdentifier(expr.expression.expression) &&
              expr.expression.expression.text === "exports" &&
              !L.peekLocal(expr.expression.expression) &&
              !L.globalOf(expr.expression.expression)))) ||
          L.cjsLocalModuleBindingOf(expr.expression.expression))
      ) {
        // Candidate symbols for the export global: the member symbol as
        // spelled, its alias-chased resolution (resolveValueSymbol carries
        // the dep-module fallback tsgo needs at member-use sites), and the
        // in-file module-export symbol.
        const candidates = [
          memberSym,
          resolved,
          L.resolveValueSymbol(expr.expression.name) ?? undefined,
          L.cjsModuleExportSymbol(expr.getSourceFile(), expr.expression.name.text),
        ];
        const exportSym = candidates.find((s) => s !== undefined);
        const g = candidates
          .map((s) => (s ? L.globalsBySymbol.get(s) : undefined))
          .find((x) => x !== undefined);
        if (g && g.type.kind === "classval") {
          const info =
            L.classes.get(g.type.className) ??
            propertyAssignedClassInfoOf(L, exportSym) ??
            L.classes.get(g.type.className);
          if (info && !info.generic) {
            L.noteEdge(`%${info.def.name}.constructor`);
            const below = (c: ClassInfo): void => {
              for (const s of c.subclasses) {
                L.noteEdge(`%${s.def.name}.constructor`);
                below(s);
              }
            };
            below(info);
            const callee: IrExpr = { kind: "varRef", localId: g.id, type: g.type, loc };
            const args = L.completeArgs(expr.arguments ?? [], info.ctorParams, loc, expr);
            return {
              kind: "newValue",
              callee,
              args,
              type: { kind: "object", className: info.def.name },
              loc,
            };
          }
        }
      }
    }
    // `new http.Server([options][, handler])` — the constructor spelling
    // of http.createServer (Node's Server class IS the factory's
    // product); routed to lower-server ahead of the stdlib-ctor fences.
    {
      const httpServer = lowerHttpServerNew(L, expr);
      if (httpServer) return httpServer;
    }
    // `new http.Agent(opts?)` / `new https.Agent(opts?)` — the Agent
    // handle (lower-server): getName/destroy/counters through the dyn
    // handle ops, requests thread it via the agent option.
    {
      const agent = lowerHttpAgentNew(L, expr);
      if (agent) return agent;
    }
    if (ts.isIdentifier(expr.expression)) {
      // `import C = N.C; new C()` — the alias's own source-order guards
      // (a no-op for every non-import= binding).
      fenceEarlyAliasUse(L, expr.expression, expr);
      const symbol = L.resolveValueSymbol(expr.expression);
      // `new Error(msg?)` (and TypeError/RangeError/SyntaxError): the
      // runtime-provided classes construct through one libCall — the result
      // TYPE names which builtin, and the message completes to "" exactly
      // like Node's message property default.
      const errInfo = L.builtinErrorInfoOf(symbol);
      // `new DOMException(message?, nameOrOptions?)`: both arguments cross
      // as dyn values (absent → the dyn undefined), and the runtime owns
      // WebIDL's resolution — ToString of the message ("" for undefined),
      // name from a string / an options object's `name` member (with the
      // `cause` own-property record) / "Error" for absent, and the legacy
      // numeric code from the name table.
      if (errInfo && errInfo.def.name === "%DOMException") {
        const args = expr.arguments ?? [];
        if (args.length > 2) {
          L.noLowering(`new DOMException with ${args.length} arguments`, expr);
        }
        const toDynArg = (a: ts.Expression | undefined): IrExpr => {
          if (!a) return dynUndefinedExpr(loc);
          const v = L.lowerExpr(a);
          if (v.type.kind === "dyn") return v;
          if (v.kind === "unitLit" || (v.type.kind !== "jsval" && L.dynConvertible(v.type))) {
            return { kind: "dynFrom", value: v, type: DYN, loc };
          }
          L.noLowering(
            `new DOMException with a '${L.fmt(v.type)}' argument`,
            a,
            "message strings and string/options-object names lower (Node ToStrings other values — convert explicitly)",
          );
        };
        const msgArg = toDynArg(args[0]);
        const nameArg = toDynArg(args[1]);
        return {
          kind: "libCall",
          fn: "error.newDom",
          args: [msgArg, nameArg],
          type: { kind: "object", className: "%DOMException" },
          loc,
        };
      }
      if (errInfo) {
        const msg = L.errorMessageArg(expr.arguments ?? [], loc, expr);
        return {
          kind: "libCall",
          fn: "error.new",
          args: [msg],
          type: { kind: "object", className: errInfo.def.name },
          loc,
        };
      }
      // `new EventEmitter()`: the runtime-provided emitter constructs
      // through one libCall. Zero arguments — the options bag
      // (@types/node's captureRejections) has no lowering.
      const emitterInfo = L.builtinEmitterInfoOf(symbol);
      if (emitterInfo) {
        if ((expr.arguments ?? []).length > 0) {
          L.unsupported("SC1090", expr.arguments![0]!, "EventEmitter constructor options ('captureRejections')");
        }
        return {
          kind: "libCall",
          fn: "emitter.new",
          args: [],
          type: { kind: "object", className: RUNTIME_EMITTER_CLASS },
          loc,
        };
      }
      // `new Readable({...})` and the other stream classes: the options
      // object parses structurally in the stream spoke.
      const streamInfo = builtinStreamInfoOf(L, symbol);
      if (streamInfo) return lowerStreamNew(L, expr, streamInfo);
      // `new URL(input)`: the WHATWG URL class (stdlib/@types provenance —
      // a user's own `class URL` resolves through classBySymbol below).
      // One string argument; invalid input throws a catchable TypeError
      // ("Invalid URL"), like Node. The lib's base-argument form
      // typechecks and is fenced here.
      // `new RegExp(pattern, flags?)`: runtime construction over the same
      // libregexp engine the literals ride. The pattern compiles EAGERLY,
      // so bad input throws Node's catchable SyntaxError at construction.
      // String arguments only (Node also accepts a RegExp to copy — that
      // form keeps the fence).
      if (symbol && symbol.name === "RegExp" && L.isStdlibSymbol(symbol)) {
        const args = expr.arguments ?? [];
        if (args.length > 2) {
          L.noLowering(`new RegExp with ${args.length} arguments`, expr);
        }
        const strArg = (a: ts.Expression | undefined, what: string): IrExpr => {
          if (!a) return { kind: "strLit", value: "", type: STRING, loc };
          const v = L.lowerExpr(a);
          if (v.type.kind !== "string") {
            L.noLowering(
              `new RegExp with a '${L.fmt(v.type)}' ${what}`,
              a,
              "string arguments are the lowered form (a RegExp copy or ToString coercion has no lowering)",
            );
          }
          return v;
        };
        const pattern = strArg(args[0], "pattern");
        const flags = strArg(args[1], "flags argument");
        return { kind: "libCall", fn: "regex.new", args: [pattern, flags], type: { kind: "regex" }, loc };
      }
      // new AbortController() — the controller mints its one signal
      // (lower-abort.ts). Ahead of the stdlib-constructor chokepoint
      // below, which is where this used to report SC2020.
      if (symbol && symbol.name === "AbortController" && L.isStdlibSymbol(symbol)) {
        return lowerAbortControllerNew(L, expr, loc);
      }
      if (symbol && symbol.name === "URL" && L.isStdlibSymbol(symbol)) {
        const args = expr.arguments ?? [];
        if (args.length !== 1 && args.length !== 2) {
          L.noLowering(
            `new URL with ${args.length} argument${args.length === 1 ? "" : "s"}`,
            expr,
            "one absolute-URL string, or an input plus a base, are the supported forms",
            symbol,
          );
        }
        const input = L.lowerExprExpecting(args[0]!, STRING);
        if (args.length === 1) {
          return { kind: "libCall", fn: "url.new", args: [input], type: URL_T, loc };
        }
        // new URL(input, base) -- WHATWG relative resolution, in the
        // runtime, against a PARSED base (scr_url_new_rel). A string base
        // is that same call with the base parsed first, which is also
        // Node's order: an unparsable base throws "Invalid URL" before the
        // input is looked at.
        //
        // A base whose type is neither exactly URL nor exactly string --
        // `string | URL`, or one that admits undefined -- keeps fencing:
        // there is one runtime entry point and it takes one parsed base,
        // so a union base would need a runtime dispatch this lowering does
        // not build. Naming the type is what tells the reader which arm to
        // narrow.
        const baseNode = args[1]!;
        const baseTy = L.mapTypeOf(L.typeOf(baseNode));
        if (baseTy?.kind !== "url" && baseTy?.kind !== "string") {
          L.noLowering(
            `new URL with a '${L.checker.typeToString(L.typeOf(baseNode))}' base`,
            baseNode,
            "a URL value or one absolute-URL string is the lowered base -- narrow a 'string | URL' or optional base first",
            symbol,
          );
        }
        const base: IrExpr =
          baseTy.kind === "url"
            ? L.lowerExprExpecting(baseNode, URL_T)
            : {
                kind: "libCall",
                fn: "url.new",
                args: [L.lowerExprExpecting(baseNode, STRING)],
                type: URL_T,
                loc,
              };
        return { kind: "libCall", fn: "url.newRel", args: [input, base], type: URL_T, loc };
      }
      // `new URLSearchParams(init?)`: the WHATWG list (stdlib provenance —
      // see lowerSearchParamsNew for the lowered init shapes).
      if (symbol && symbol.name === "URLSearchParams" && L.isStdlibSymbol(symbol)) {
        return lowerSearchParamsNew(L, expr, loc);
      }
      // `new Date(...)` NOT consumed by the composed toISOString lowering
      // (lowerDateCall claims that form before the receiver lowers): Date
      // values have no representation — point at what does compile.
      if (symbol && symbol.name === "Date" && L.isStdlibSymbol(symbol)) {
        L.noLowering(
          "new Date",
          expr,
          "Date values have no representation — Date.now() and the composed new Date(ms?).toISOString() form compile",
          symbol,
        );
      }
      // `new StringDecoder(encoding?)` (node:string_decoder): the decoder
      // is a two-field record — the CANONICAL encoding name (aliases fold
      // at compile time, exactly what `.encoding` answers in Node) and
      // the packed-f64 pending state starting at 0 (nothing buffered).
      // The encoding must be a literal (Node's alias set); omitted means
      // utf8, Node's default.
      if (symbol && symbol.name === "StringDecoder" && L.isStdlibSymbol(symbol)) {
        const args = expr.arguments ?? [];
        if (args.length > 1) {
          L.noLowering("new StringDecoder with 2 arguments", expr, undefined, symbol);
        }
        const encName = args.length === 1 ? bufEncoding(L, "new StringDecoder", args[0]!) : "utf8";
        const decT = L.mapTypeOf(L.typeOf(expr));
        if (decT?.kind !== "record") L.badType(expr, L.typeOf(expr));
        return {
          kind: "recordLit",
          fields: [
            { name: "encoding", value: { kind: "strLit", value: encName, type: STRING, loc } },
            { name: "%pending", value: { kind: "numLit", value: 0, type: F64, loc } },
          ],
          type: decT,
          loc,
        };
      }
      // Both text codecs are STATELESS once their constructor is fenced to
      // the default utf-8 form: an instance IS its constant `encoding`
      // (types.ts maps the types to string) and lowerBytesNew builds it.
      // Storing one at module scope and calling encode/decode off it later
      // is the shape real code uses.
      // `new Uint8Array(...)` / `new Uint32Array(...)` / `new
      // Float32Array(...)`: the typed-array constructors with a runtime
      // representation (stdlib provenance — see lowerBytesNew for the
      // lowered argument shapes; a user's own class with one of the names
      // resolves through classBySymbol below).
      const bytesNew = L.lowerBytesNew(expr, symbol);
      if (bytesNew) return bytesNew;
      const info =
        (symbol ? L.classBySymbol.get(symbol) : undefined) ??
        // `const C = require('./x'); new C()` over `module.exports =
        // class {…}`: the binding aliases the expression's own symbol —
        // the declaration story, collected on demand.
        propertyAssignedClassInfoOf(L, symbol) ??
        // `const C = Impl as unknown as CCtor; new C()` — the published-
        // class-behind-an-interface shape (see castAliasedClassInfoOf).
        castAliasedClassInfoOf(L, symbol) ??
        undefined;
      // A rebindable decorated name constructs through its VALUE (the
      // classval-typed path below — newValue through the decoration
      // result's construct thunk), never the declaration directly.
      if (info && info.classDecorators?.valueGlobalId === undefined) {
        return lowerProgramClassNew(L, expr, info, loc);
      }
      // `new Map<K, V>()`: the lib Map constructor. The SEEDED forms: an
      // entries ARRAY LITERAL of PAIR LITERALS at the construction site
      // (`new Map([[k, v], ...])`) — each pair's key/value lower as
      // ordinary K/V-typed expressions and the backend set()s them in
      // order, so the tuple array never exists as a value — and a
      // `[K, V][]`-typed tuple-array VALUE (lowerMapSeedArrayNew: a
      // construct-and-set loop, pairs in array order, duplicates
      // overwrite). Other seeds — another Map, general iterables — keep
      // the fence: never silently an empty map. Unsupported key/value
      // types get their half named specifically instead of the component
      // fence (SC2009, which names Map slots at value positions elsewhere).
      // `new Array<T>()` and the ELEMENTS forms (`new Array('hi', 'bye')`,
      // any argument list that is not one lone number) ARE array literals
      // — the spec's ArrayCreate + element writes. The one-NUMBER form
      // allocates a HOLE array (reads answer undefined where the element
      // type says T) — no honest lowering exists unless the element type
      // admits undefined, so it fences by name.
      // `new Object()` — the spec's OrdinaryObjectCreate, exactly what the
      // `{}` literal builds (fresh reference identity, no own properties) —
      // lowers as the empty record. The ARGUMENT form is Object(x): it
      // returns its argument for objects and BOXES primitives — the wrapper
      // story with no lowering — so it keeps the constructor fence.
      if (
        symbol?.name === "Object" &&
        L.isStdlibSymbol(symbol) &&
        (expr.arguments ?? []).length === 0
      ) {
        return {
          kind: "recordLit",
          fields: [],
          type: { kind: "record", shapeId: L.shapes.intern([]) },
          loc,
        };
      }
      if (symbol?.name === "Array" && L.isStdlibSymbol(symbol)) {
        const args = expr.arguments ?? [];
        if (args.some(ts.isSpreadElement)) {
          L.noLowering("new Array with spread arguments", expr, "write the array literal: [...xs]");
        }
        // Where does this construction LIVE? A static array type — the
        // expression's own or the contextual annotation — takes the static
        // lowerings below. `new Array(...)` in a JavaScript source types
        // `any[]`, which has no static home; an `unknown[]` slot maps to
        // the checked-dynamic tree wholesale (mapType's dyn-element array
        // rule). Both build a dyn ARRAY here, exactly as the array LITERAL
        // already does at those same two slots (lower-exprs' JS
        // declaration fallback) — length/index/method uses then ride the
        // keyed-dyn paths that already carry them.
        const staticArr = ((): (IrType & { kind: "array" }) | null => {
          let t = L.mapTypeOf(L.typeOf(expr));
          if (t?.kind !== "array") {
            const ctx = L.checker.getContextualType(expr);
            const ctxMapped = ctx ? L.mapTypeOf(ctx) : null;
            if (ctxMapped?.kind === "array") t = ctxMapped;
          }
          return t?.kind === "array" ? t : null;
        })();
        if (
          staticArr === null &&
          (isJsSourceFile(expr.getSourceFile()) || L.mapTypeOf(L.typeOf(expr))?.kind === "dyn")
        ) {
          if (args.length === 1) {
            // The one-argument form is JS's fork: a NUMBER is a length
            // (holes), anything else is the array's single element
            // (`new Array('3')` is `['3']`). A statically numeric argument
            // decides it here; an implicit-any one does NOT, and guessing
            // either way would be a silent wrong answer at every call with
            // the other kind — so the runtime asks the value (dynArrNew's
            // dyn arm), which is what JS does.
            const argT = L.mapTypeOf(L.typeOf(args[0]!));
            const arg =
              argT?.kind === "f64"
                ? L.lowerExprExpecting(args[0]!, F64)
                : L.coerceToExpected(L.lowerExpr(args[0]!), DYN);
            if (arg.type.kind !== "f64" && arg.type.kind !== "dyn") {
              L.unsupported(
                "SC1101",
                args[0]!,
                `'${L.fmt(arg.type)}' as the argument of a dynamic (any[]) Array constructor`,
              );
            }
            return { kind: "dynArrNew", arg, type: DYN, loc };
          }
          // No arguments (the empty array) or the ELEMENTS form: every
          // argument is an element, so this IS the dyn array literal.
          const elems = args.map((a): IrExpr => {
            const v = L.coerceToExpected(L.lowerExpr(a), DYN);
            if (v.type.kind !== "dyn") {
              L.unsupported("SC1101", a, `holding '${L.fmt(v.type)}' values in a dynamic (any[]) array`);
            }
            return v;
          });
          return { kind: "dynArrLit", elems, type: DYN, loc };
        }
        if (args.length === 1 && L.mapTypeOf(L.typeOf(args[0]!))?.kind === "f64") {
          // `new Array(n)` allocates HOLES and is written to be filled by
          // index before anything reads it -- the same shape mapper-less
          // `Array.from({ length: n })` already lowers to (arrayNewLen).
          // Reuse it, and with it the ratified stance: a union element
          // with an undefined arm holds the interned undefined (JS-exact),
          // every other refcounted element holds an absent slot that TRAPS
          // if read before assignment (SEMANTICS.md 46) rather than
          // answering a value Node never would.
          const n = L.lowerExprExpecting(args[0]!, F64);
          // No static array type, but the checker DID spell an array — it
          // just spelled `any[]`, because `new Array(n)` is not one of the
          // initializers TS's evolving-array analysis follows. The
          // counting-loop proof below already knows every write this array
          // will ever receive; when they all name one type, that is the
          // element type (newArrayFillElemType). The declaration then
          // adopts the initializer's type through lowerVarDecl's existing
          // checkerAnyArray rule, so the writes and the uses see the same
          // array the value is.
          const inferred =
            staticArr === null && !isJsSourceFile(expr.getSourceFile()) && L.checkerAnyArray(expr)
              ? newArrayFillElemType(L, expr)
              : null;
          if (staticArr === null && inferred === null) L.badType(expr, L.typeOf(expr));
          const arrT = staticArr ?? inferred!;
          const elem = arrT.elem;
          // `new Array(n).fill(v)` is a COMPOSED form: the whole-range
          // fill writes every slot before anything can read one, so a
          // union WITHOUT an undefined arm (`(T | null)[]`, the shape this
          // idiom is written for) needs no readable absent value. Only the
          // range-less fill qualifies — a start/end narrows the write and
          // would leave slots unwritten. Scalars stay fenced regardless:
          // arrayNewLen itself is only defined over refcounted elements.
          const filledWhole =
            isRefCounted(elem) &&
            ts.isPropertyAccessExpression(expr.parent) &&
            expr.parent.name.text === "fill" &&
            ts.isCallExpression(expr.parent.parent) &&
            expr.parent.parent.expression === expr.parent &&
            expr.parent.parent.arguments.length === 1;
          // The prefix-fill proof is asked LAST on purpose: it is the only
          // disjunct whose instrument is meant to read "sites that would have
          // fenced without me", so it must not run for an element kind that
          // already carries an absent value.
          const absent =
            filledWhole || fullFillLoopFollows(expr) ||
            (elem.kind === "union" ? L.wrappedUndefined(elem, loc) !== null : isRefCounted(elem)) ||
            prefixFillTruncateFollows(expr);
          if (!absent) {
            // Scalars have no absent value that isn't a LIE on read (0
            // where Node says undefined) -- the Array.from fence's wording.
            L.noLowering(
              `new Array(count) with '${L.fmt(elem)}' elements`,
              expr,
              "scalar slots would read 0/false/\"\" where Node reads undefined — " +
                "build and push, or use the elements form: new Array(a, b)",
            );
          }
          return { kind: "arrayNewLen", length: n, type: arrT, loc };
        }
        // JS's `new Array()` types any[]; the contextual type carries the
        // annotation when one exists (the new Map() stance) — staticArr
        // consulted both, and the checked-dynamic build above already
        // answered the two slots that have no static home.
        if (staticArr === null) L.badType(expr, L.typeOf(expr));
        const t = staticArr;
        const elems = args.map((a) => L.lowerExprExpecting(a, t.elem));
        return { kind: "arrayLit", elems, type: t, loc };
      }
      // `new WeakMap()` / `new WeakSet()` in JAVASCRIPT sources: no weak
      // container exists in the value model, but harness code constructs
      // one unconditionally and touches it only on paths tests don't
      // reach — the value lowers as an opaque dyn object (identity only;
      // every reached METHOD use meets its own per-site fence → runtime
      // fence). TypeScript keeps the compile fence.
      //
      // This sits ABOVE the `Map || WeakMap` branch deliberately, and it
      // used to sit below it. Down there its WeakMap arm was unreachable:
      // the Map branch claims the symbol and never falls out of itself —
      // every path returns or calls unsupported/badType/noLowering, all of
      // which are typed `never` — and `new WeakMap()` types as
      // WeakMap<WeakKey, any>, so the Map branch's own all-`any` JS escape
      // misses on `targs[0] = WeakKey` and the walk ends at
      // `SC1090: Map keys of type 'WeakKey'`. Only WeakSet, which that
      // branch does not name, ever reached this code. Hoisting is the
      // smaller edit than teaching the Map branch a fourth condition, and
      // it leaves both fences exactly where they were: TypeScript sources
      // and any argument list still fall through to the Map branch.
      if (
        (symbol?.name === "WeakMap" || symbol?.name === "WeakSet") &&
        L.isStdlibSymbol(symbol) &&
        isJsSourceFile(expr.getSourceFile()) &&
        (expr.arguments?.length ?? 0) === 0
      ) {
        return { kind: "dynObjLit", type: DYN, loc };
      }
      if ((symbol?.name === "Map" || symbol?.name === "WeakMap") && L.isStdlibSymbol(symbol)) {
        const seedArg = (expr.arguments?.length ?? 0) === 1 ? expr.arguments![0]! : null;
        const isPairLit = (el: ts.Expression): el is ts.ArrayLiteralExpression =>
          ts.isArrayLiteralExpression(el) && el.elements.length === 2 &&
          !el.elements.some(ts.isSpreadElement);
        const entriesLit =
          seedArg && ts.isArrayLiteralExpression(seedArg) && seedArg.elements.every(isPairLit)
            ? seedArg.elements.filter(isPairLit)
            : null;
        let tsType = L.typeOf(expr);
        let mapped = L.mapTypeOf(tsType);
        // JavaScript's `new Map()` has no type-argument syntax: the no-arg
        // constructor overload pins Map<any, any> whatever the JSDoc says
        // (`@type` on the declaration types the VARIABLE, not this
        // expression). The CONTEXTUAL type carries the annotation — adopt
        // it when it is a supported map. TS type arguments keep winning:
        // their expression type already maps.
        if (mapped?.kind !== "map") {
          const ctx = L.checker.getContextualType(expr);
          const ctxMapped = ctx ? L.mapTypeOf(ctx) : null;
          if (ctx && ctxMapped?.kind === "map") {
            tsType = ctx;
            mapped = ctxMapped;
          }
        }
        // ...and with no annotation and no contextual type, the binding's
        // own USES carry the key and value types a JSDoc `@type` would
        // have spelled (inferContainerTypeFromUses). Only `new Map()`:
        // the WeakMap symbol shares this branch and has no static
        // container to infer INTO.
        if (mapped?.kind !== "map" && symbol?.name === "Map" && seedArg === null) {
          const inferred = inferContainerTypeFromUses(L, expr, "map");
          if (inferred !== null) {
            // SCRIPTC_MAPBOX_WHY=1 counts BOTH halves: an inferred site is
            // one the escape hatch below no longer has to swallow, and the
            // two counts together are the reach of this pass over a real
            // package.
            if (process.env["SCRIPTC_MAPBOX_WHY"] !== undefined) {
              process.stderr.write(
                `[mapbox] inferred ${L.fmt(inferred)} at ${loc.file}:${loc.start}\n`,
              );
            }
            mapped = inferred;
          }
        }
        if (seedArg && !entriesLit && mapped?.kind === "map") {
          const seeded = lowerMapSeedArrayNew(L, seedArg, mapped);
          if (seeded) return seeded;
          // `new Map(other)` — the COPY constructor, over a map value of
          // exactly this key/value type (ReadonlyMap sources included).
          const cloned = lowerMapCloneNew(L, seedArg, mapped);
          if (cloned) return cloned;
        }
        if ((expr.arguments?.length ?? 0) > 0 && !entriesLit) {
          L.noLowering(
            "new Map(entries)",
            expr,
            "supported seeds: an array literal of [key, value] pair literals, or a " +
              "[K, V][]-typed tuple-array value — construct the Map empty and set() " +
              "each entry otherwise",
          );
        }
        if (mapped?.kind === "map") {
          if (!entriesLit) return { kind: "mapNew", type: mapped, loc };
          const seed = entriesLit.map((pair) => ({
            key: L.lowerExprExpecting(pair.elements[0]!, mapped.key),
            value: L.lowerExprExpecting(pair.elements[1]!, mapped.value),
          }));
          return { kind: "mapNew", seed, type: mapped, loc };
        }
        const targs = L.checker.getTypeArguments(tsType as ts.TypeReference);
        // JAVASCRIPT `new Map()` whose arguments never resolved past
        // Map<any, any> (no annotation, no contextual type, no seed): the
        // WeakMap stance below — the VALUE lowers as an opaque dyn object
        // (identity and truthiness are real). The formatter's config-cache
        // shape: module init constructs the caches unconditionally; the
        // format path never touches them. TypeScript keeps the compile
        // fence.
        //
        // THIS COMMENT USED TO SAY "and every reached METHOD use meets its
        // own per-site fence at runtime", AND THAT IS NOT WHAT HAPPENS.
        // The value is a plain SCR_DYN_OBJ with no member table entry for
        // `set`, so `m.set("a", 1)` answers V8's own
        // `TypeError: m.set is not a function` — the mis-answer for a
        // method Node HAS, which is exactly what `scr_dyn_bytes_proto_name`
        // exists to prevent one kind over ("these fence loudly instead of
        // mis-answering Node's is-not-a-function for a method Node HAS")
        // and what the SCR_DYN_MAP read arm calls "the OBJINST arm's silent
        // wrong answer, one kind over". Node answers `1 1` for
        // `const m = new Map(); m.set("a",1); console.log(m.get("a"), m.size)`;
        // both backends exit 1 on that line. estado-ctorattr.md §4.2 (p34)
        // recorded the symptom without diagnosing it; estado-pinned.md
        // diagnoses it here and prices the close.
        //
        // WHY IT IS NOT CLOSED HERE. Boxing the value as a real
        // SCR_DYN_MAP needs an ScrMap whose keys are dynamic values
        // compared by SameValueZero across kinds, and ScrMapKeyKind is
        // {F64, STR, REF} — REF is pointer identity, which answers `false`
        // for two equal numbers. Fencing the METHOD USE at compile time is
        // the other candidate and is WORSE: this escape hatch exists for a
        // program that constructs the map and never touches it, and a
        // compile fence on a branch never taken would turn a working
        // program into a refusal (MATCH -> TRAP).
        if (
          isJsSourceFile(expr.getSourceFile()) &&
          (expr.arguments?.length ?? 0) === 0 &&
          targs.length > 0 &&
          targs.every((t) => (t.flags & ts.TypeFlags.Any) !== 0)
        ) {
          // SCRIPTC_MAPBOX_WHY=1: count the escape hatch.  Every one of these
          // is a value on which `.set`/`.get`/`.size` answers V8's own
          // "is not a function" -- a wrong answer for a method Node HAS -- and
          // no instrument in this project could say how many a program has.
          if (process.env["SCRIPTC_MAPBOX_WHY"] !== undefined) {
            process.stderr.write(`[mapbox] ${L.checker.typeToString(tsType)} at ${loc.file}:${loc.start}\n`);
          }
          return { kind: "dynObjLit", type: DYN, loc };
        }
        // A WeakMap that does NOT ride the identity-keyed Map (types.ts's
        // stance: only a CLASS INSTANCE key does) owes the weak-collection
        // fence, not Map's key report. The Map branch claims the WeakMap
        // symbol, so `new WeakMap()` (WeakKey, any) and
        // `new WeakMap<object, V>()` used to walk into the key message
        // below — which names a type the program never wrote and hands out
        // advice a WeakMap cannot take ("use a string or number key" is
        // impossible for a container whose keys must be objects). The
        // stdlib constructor chokepoint already carries the honest hint;
        // route there instead.
        if (symbol?.name === "WeakMap") {
          const weakKeyIr = targs[0] ? L.mapTypeOf(targs[0]) : null;
          if (!targs[0] || !weakKeyIr || !isSupportedMapKey(weakKeyIr)) {
            L.noLowering("new WeakMap", expr, WEAK_COLLECTION_HINTS.WeakMap, symbol);
          }
        }
        const keyIr = targs[0] ? L.mapTypeOf(targs[0]) : null;
        if (targs[0] && (!keyIr || !isSupportedMapKey(keyIr))) {
          L.unsupported(
            "SC1090",
            expr,
            `Map keys of type '${L.checker.typeToString(targs[0])}' ` +
              `(Map keys must be a string, a number, or a CLASS INSTANCE - those `+
                `key by reference identity. A record/interface type cannot: a width `+
                `coercion copies it, and a copy would miss its own entry)`,
          );
        }
        if (targs[1]) {
          L.unsupported(
            "SC1090",
            expr,
            `Map values of type '${L.checker.typeToString(targs[1])}' ` +
              `(Map values must be number, string, boolean, records, class instances, ` +
              `arrays, promises, or unions of those — not functions, Maps, 'unknown', or 'any')`,
          );
        }
        L.badType(expr, tsType);
      }
      // `new Set<T>()`: Map's sibling. The SEEDED form lowers for any
      // T[]-typed argument — literal or variable, T already a legal
      // element type — as construct + bulk add (duplicates collapse,
      // insertion order preserved, exactly JS). Non-array seeds (another
      // Set, general iterables) keep the fence. Unsupported element types
      // are named specifically.
      if (symbol?.name === "Set" && L.isStdlibSymbol(symbol)) {
        const tsType = L.typeOf(expr);
        let mapped = L.mapTypeOf(tsType);
        // `const s = new Set()` in JAVASCRIPT: no type-argument syntax, so
        // the element type never resolves past `any` and the container has
        // no static home. The binding's own uses carry it — Map's story,
        // one type slot narrower (inferContainerTypeFromUses).
        if (mapped === null && (expr.arguments?.length ?? 0) === 0) {
          const inferred = inferContainerTypeFromUses(L, expr, "set");
          if (inferred !== null) {
            if (process.env["SCRIPTC_MAPBOX_WHY"] !== undefined) {
              process.stderr.write(
                `[mapbox] inferred ${L.fmt(inferred)} at ${locOf(expr).file}:${locOf(expr).start}\n`,
              );
            }
            mapped = inferred;
          }
        }
        if (mapped?.kind === "set" && (expr.arguments?.length ?? 0) === 1) {
          const argNode = expr.arguments![0]!;
          // An array LITERAL seed builds element-wise (its contextual type
          // is the lib constructor's `readonly T[] | Iterable<T> | null`
          // union — unmappable, so the generic literal path can't type it);
          // an array-typed VALUE seed lowers as itself.
          if (ts.isArrayLiteralExpression(argNode) && !argNode.elements.some(ts.isSpreadElement)) {
            const elems = argNode.elements.map((el) => L.lowerExprExpecting(el, mapped.elem));
            const seed: IrExpr = { kind: "arrayLit", elems, type: arrayOf(mapped.elem), loc };
            return { kind: "setNew", seed, type: mapped, loc };
          }
          // A seed literal carrying SPREADS (`new Set([...other, extra])` —
          // the union-of-sets idiom): the ordinary array-literal lowering
          // already composes them, draining a spread Set through toArray
          // exactly as `[...set]` does. Expect the seed's array type so a
          // literal that lowers to anything else falls through to the
          // named fence instead of reaching the validator mistyped.
          if (ts.isArrayLiteralExpression(argNode)) {
            const seed = L.lowerExprExpecting(argNode, arrayOf(mapped.elem));
            if (typeEquals(seed.type, arrayOf(mapped.elem))) {
              return { kind: "setNew", seed, type: mapped, loc };
            }
          }
          // A readonly TUPLE seed — `Object.freeze([...] as const)`, the
          // shape a frozen constant table always has: `as const` makes a
          // tuple, not an array, so the array arm below never matches it.
          // Its length is known, so a lifted helper reads each position
          // off the record ONCE (the receiver is a parameter, so the
          // source evaluates a single time) and pushes into a fresh
          // array, which then seeds the Set exactly like an array value.
          if (!ts.isSpreadElement(argNode)) {
            const tupIr = L.mapTypeOf(L.typeOf(argNode));
            const tupShape = tupIr?.kind === "record" ? L.shapes.get(tupIr.shapeId) : null;
            if (
              tupIr?.kind === "record" && tupShape?.tuple === true &&
              tupShape.fields.length > 0 &&
              tupShape.fields.every((f) => typeEquals(f.type, mapped.elem))
            ) {
              const lowered = L.lowerExpr(argNode);
              // A uniform `as const` tuple often LOWERS as an array already
              // (the const-lookup-table binding gives a computed read its
              // slot), even though its CHECKER type is a tuple record. When
              // the VALUE is that array, it seeds the Set directly — the
              // tuple→array helper (which reads fields off a RECORD) is only
              // for a value that really lowered a record, and calling it on
              // an array is the shape the validator rejects.
              if (lowered.type.kind === "array" && typeEquals(lowered.type.elem, mapped.elem)) {
                return { kind: "setNew", seed: lowered, type: mapped, loc };
              }
              if (lowered.type.kind === "record") {
                const key = `tupleToArr:${typeKey(tupIr)}:${typeKey(mapped.elem)}`;
                let helper = L.mapHofHelpers.get(key);
                if (!helper) {
                  helper = `%tuple.toArray.${L.mapHofHelpers.size}`;
                  L.mapHofHelpers.set(key, helper);
                  L.liftedFns.push(buildTupleToArrayFn(L, helper, tupIr, tupShape.fields.length, mapped.elem, loc));
                }
                const seed: IrExpr = {
                  kind: "call",
                  callee: helper,
                  args: [lowered],
                  type: arrayOf(mapped.elem),
                  loc,
                };
                return { kind: "setNew", seed, type: mapped, loc };
              }
            }
          }
          if (!ts.isSpreadElement(argNode)) {
            const argIr = L.mapTypeOf(L.typeOf(argNode));
            if (argIr?.kind === "array" && typeEquals(argIr.elem, mapped.elem)) {
              let seed = L.lowerExpr(argNode);
              // A T[]-DECLARED seed whose value is an island handle (a
              // package's exported array — the binding never held a
              // static array): the VALIDATED exit copies the engine
              // array out (strict elements, the catchable TypeError on a
              // lying handle), and the bulk add proceeds on the copy —
              // construction reads the seed once, so the aliasing
              // divergence has nothing to observe.
              if (seed.type.kind === "jsval" && L.boundaryExitSafe(arrayOf(mapped.elem))) {
                seed = { kind: "jsExit", value: seed, type: arrayOf(mapped.elem), loc: seed.loc };
              }
              if (typeEquals(seed.type, arrayOf(mapped.elem))) {
                return { kind: "setNew", seed, type: mapped, loc };
              }
              // Any other lowered kind falls through to the named fence
              // below — never a mistyped seed into the validator.
            }
          }
        }
        // JavaScript's identity-Set idiom: `new Set([setTimeout, atob,
        // ...])` — the element TYPE (a union of stdlib signatures) has no
        // mapping, but the element VALUES all lower to identity tokens
        // (interned strings — see the JS token stance in lower-exprs), so
        // the honest construction is a Set of those scalars.
        if (
          !mapped &&
          isJsSourceFile(expr.getSourceFile()) &&
          (expr.arguments?.length ?? 0) === 1 &&
          ts.isArrayLiteralExpression(expr.arguments![0]!) &&
          !(expr.arguments![0] as ts.ArrayLiteralExpression).elements.some(ts.isSpreadElement)
        ) {
          const lit = expr.arguments![0] as ts.ArrayLiteralExpression;
          const elems = lit.elements.map((el) => L.lowerExpr(el));
          const first = elems[0];
          if (
            first !== undefined &&
            (first.type.kind === "string" || first.type.kind === "f64") &&
            elems.every((e) => e.type.kind === first.type.kind)
          ) {
            const setT: IrType = { kind: "set", elem: first.type };
            const seed: IrExpr = { kind: "arrayLit", elems, type: arrayOf(first.type), loc };
            return { kind: "setNew", seed, type: setT, loc };
          }
        }
        if ((expr.arguments?.length ?? 0) > 0) {
          L.noLowering(
            "new Set(values)",
            expr,
            "construct the Set empty and add() each value — only an array of " +
              "already-legal elements (string or number) seeds a Set",
          );
        }
        if (mapped?.kind === "set") return { kind: "setNew", type: mapped, loc };
        const targs = L.checker.getTypeArguments(tsType as ts.TypeReference);
        if (targs[0]) {
          L.unsupported(
            "SC1090",
            expr,
            `Set elements of type '${L.checker.typeToString(targs[0])}' ` +
              `(Set elements must be string or number — Map's key kinds — or a server handle, which stores under reference identity)`,
          );
        }
        L.badType(expr, tsType);
      }
      // `new AsyncLocalStorage()` (node:async_hooks): a fresh store id —
      // an f64 handle (types.ts), the Channel story. Construction options
      // ({ defaultValue, name }) have no lowering yet.
      if (symbol?.name === "AsyncLocalStorage" && L.isStdlibSymbol(symbol)) {
        if ((expr.arguments?.length ?? 0) > 0) {
          L.noLowering(
            "new AsyncLocalStorage(options)",
            expr,
            "the zero-argument constructor is the supported form (defaultValue/name options have no lowering yet)",
          );
        }
        return { kind: "libCall", fn: "als.new", args: [], type: F64, loc };
      }
      // `new Promise<T>((resolve) => ...)`: the ambient Promise constructor.
      if (symbol?.name === "Promise" && L.isStdlibSymbol(symbol)) {
        const type = L.irTypeOf(expr);
        if (type.kind !== "promise") L.badType(expr, L.typeOf(expr));
        const args = expr.arguments ?? [];
        if (args.length !== 1) {
          L.unsupported("SC1090", expr, "Promise construction without an executor");
        }
        // `new Promise(setImmediate)` (the Node-suite early-exit shape):
        // the executor IS the stdlib setImmediate, so resolve rides the
        // immediate queue — a dedicated runtime constructor arms an
        // immediate that fulfills with the undefined dyn value.
        {
          const a0 = args[0]!;
          if (ts.isIdentifier(a0) && a0.text === "setImmediate") {
            const sym = L.checker.getSymbolAtLocation(a0);
            const decls = sym ? L.checker.declarationsOf(sym) : [];
            if (decls.length > 0 && decls.every((d) => L.isStdlibFile(d.getSourceFile()))) {
              // The settled value is the undefined dyn value — the result
              // is promise<dyn> whatever T the checker inferred for the
              // unusual executor (Promise<unknown> in the suite's shape).
              return {
                kind: "libCall",
                fn: "timers.immediatePromise",
                args: [],
                type: { kind: "promise", inner: DYN },
                loc,
              };
            }
          }
        }
        // An executor that RESOLVES WITH A PROMISE. The lib signature spells
        // resolve `(value: T | PromiseLike<T>) => void`; mapType collapses
        // that union to `T`, so the promise possibility is erased from the
        // parameter and the argument coercion then reaches for the checked
        // single-arm extraction — an UNCODED TypeError at run time for a
        // settle-or-value union, and an SC1090 for a plain promise. Both are
        // gaps against the ambient override's own written contract.
        //
        // The parameter is re-bound to the SETTLE-OR-VALUE union instead, the
        // one shape whose arms a runtime tag can tell apart, and the
        // emitters adopt off that tag (emit-exprs.ts's newPromise). Only
        // executors that actually pass a promise-carrying value are
        // re-bound, so every program that resolves with a plain value keeps
        // its emitted code to the byte.
        executorResolveAdoptionUnion(L, args[0]!, type.inner);
        // Executors bind resolve alone or (resolve, reject): reject is a
        // real closure rejecting the promise with an Error reason (the
        // ambient override pins `reason: Error` — rejection payloads share
        // the thrown-value representation, and the OBJ kind keeps
        // catch-side instanceof and the uncaught printer working). First
        // settle wins, exactly JS: reject-after-resolve and double-reject
        // are no-ops, and an executor throw after any settle is swallowed.
        const executor = L.lowerExpr(args[0]!);
        if (executor.type.kind !== "func") L.badType(args[0]!, L.typeOf(args[0]!));
        if (executor.type.params.length > 1) {
          const rj = executor.type.params[1]!;
          if (
            executor.type.params.length > 2 ||
            rj.kind !== "func" ||
            rj.ret.kind !== "void" ||
            rj.params.length !== 1 ||
            rj.params[0]!.kind !== "object" ||
            rj.params[0]!.className !== "%Error"
          ) {
            // A non-contextually-typed executor VALUE whose second param
            // isn't the pinned (reason: Error) => void shape.
            L.unsupported(
              "SC1090",
              args[0]!,
              "Promise executors whose reject parameter is not '(reason: Error) => void'",
            );
          }
        }
        return { kind: "newPromise", executor, type, loc };
      }
      // The lib fence's CONSTRUCTOR chokepoint: `new` of any other
      // stdlib-declared constructor (Date, WeakMap, Proxy,
      // ArrayBuffer, RegExp, ... — and @types/node's URL, AbortController,
      // TextEncoder, ...) typechecks and reports SC2020 here. The named
      // families carry pointed hints: each states WHY no honest static
      // lowering exists (or what to use instead).
      if (L.isStdlibSymbol(symbol ?? undefined)) {
        // The deprecated `new Buffer(string, encoding?)` ctor's string arm
        // with a NON-STRING first argument and a string second: Node
        // throws ERR_INVALID_ARG_TYPE synchronously (and DEP0005 never
        // fires on this throwing path, so the compiled silence matches).
        // Every other new Buffer form keeps the fence below — the
        // constructing forms would owe the deprecation warning.
        if (
          expr.expression.text === "Buffer" &&
          expr.arguments?.length === 2 &&
          !expr.arguments.some(ts.isSpreadElement) &&
          L.mapTypeOf(L.typeOf(expr.arguments[0]!))?.kind !== "string" &&
          L.mapTypeOf(L.typeOf(expr.arguments[1]!))?.kind === "string"
        ) {
          const first = L.lowerExpr(expr.arguments[0]!);
          if (first.kind === "unitLit" || first.type.kind === "dyn" || L.dynConvertible(first.type)) {
            const got: IrExpr =
              first.type.kind === "dyn" ? first : { kind: "dynFrom", value: first, type: DYN, loc };
            // The encoding argument still evaluates in Node before the
            // throw only via the ctor body's later reads — it does NOT
            // observe it before throwing, so dropping it is exact for
            // effect-free operands; effectful ones keep the fence.
            const enc = L.lowerExpr(expr.arguments[1]!);
            if (enc.kind === "strLit" || pureReemittable(enc)) {
              return { kind: "libCall", fn: "buffer.newStringFail", args: [got], type: bytesOf("u8"), loc };
            }
          }
        }
        const ctorHints: Record<string, string | undefined> = {
          RegExp: "use a regex literal (/pattern/flags) — constructed regexes have no lowering",
          String: "boxed wrapper objects have no lowering — use the string primitive (the box is only distinguishable via typeof/identity, which nothing here can honor)",
          Number: "boxed wrapper objects have no lowering — use the number primitive",
          Boolean: "boxed wrapper objects have no lowering — use the boolean primitive",
          WeakMap: WEAK_COLLECTION_HINTS.WeakMap,
          WeakSet: WEAK_COLLECTION_HINTS.WeakSet,
          WeakRef: "deref()-after-collect exposes GC timing — genuinely dynamic; hold a strong reference instead",
          FinalizationRegistry: "finalization callbacks expose GC timing — genuinely dynamic; release resources explicitly instead",
          SharedArrayBuffer: "no shared-memory threads exist in a compiled program — Uint8Array is the byte storage",
          ArrayBuffer: "no free-standing ArrayBuffer value exists — typed arrays own their storage: allocate the view directly (new Uint8Array(n)), or erase a fresh buffer into one (new Uint8Array(new ArrayBuffer(n)), new DataView(new ArrayBuffer(n), ...))",
          Proxy: "property-access metaprogramming has no static lowering (every property read must resolve at compile time)",
          Function: "runtime code generation cannot be compiled ahead of time (the eval stance) — write the function",
        };
        L.noLowering(
          `new ${expr.expression.text}`,
          expr,
          ctorHints[expr.expression.text],
          symbol,
        );
      }
    }
    // `new crypto.X509Certificate(data)` — the Dirent-style data record:
    // the certificate's lowered members (fingerprint — the SHA-1 of the
    // DER, uppercase colon-separated — plus the validFrom/validTo
    // validity window in Node's ASN1_TIME_print shape) compute AT
    // CONSTRUCTION, when Node parses too, so unparseable input throws
    // Node's exact PEM error here (ERR_OSSL_PEM_NO_START_LINE) and the
    // handle never exists. Both import forms (`crypto.X509Certificate`
    // through the namespace, named `X509Certificate`); Buffer input only
    // — the readFileSync idiom. mapType interns the matching record, so
    // locals and the composed member reads all flow. The data argument
    // feeds THREE field computations, so construction goes through an
    // interned helper whose parameter evaluates it exactly once.
    {
      const callee = expr.expression;
      const isX509 =
        (ts.isPropertyAccessExpression(callee) &&
          callee.name.text === "X509Certificate" &&
          L.builtinNamespaceModuleOf(callee.expression) === "crypto") ||
        (ts.isIdentifier(callee) &&
          (() => {
            const bi = L.builtinImportOf(callee);
            return bi?.module === "crypto" && bi.member === "X509Certificate";
          })());
      if (isX509) {
        const args = expr.arguments ?? ([] as unknown as ts.NodeArray<ts.Expression>);
        if (args.length !== 1) {
          L.noLowering(
            "X509Certificate with this argument shape",
            expr,
            "the supported form is new X509Certificate(readFileSync(path))",
          );
        }
        const data = L.lowerExpr(args[0]!);
        const isBytes = data.type.kind === "bytes" && data.type.elem === "u8";
        if (!isBytes && data.type.kind !== "string") {
          L.noLowering(
            `X509Certificate over '${L.fmt(data.type)}' data`,
            args[0]!,
            "pass the certificate Buffer or PEM string (an fs.readFileSync result)",
          );
        }
        const t = L.mapTypeOf(L.typeOf(expr));
        if (t?.kind !== "record") L.badType(expr, L.typeOf(expr));
        const key = `x509.record:${isBytes ? "bytes" : "str"}`;
        let helper = L.widthHelpers.get(key);
        if (!helper) {
          helper = `%x509.record.${L.widthHelpers.size}`;
          L.widthHelpers.set(key, helper);
          const dataT = data.type;
          const dRef: IrExpr = { kind: "varRef", localId: "d.0", type: dataT, loc };
          const field = (
            name: string,
            fn: "crypto.x509Fingerprint" | "crypto.x509FingerprintStr" |
                "crypto.x509ValidFrom" | "crypto.x509ValidFromStr" |
                "crypto.x509ValidTo" | "crypto.x509ValidToStr",
          ): { name: string; value: IrExpr } => ({
            name,
            value: { kind: "libCall", fn, args: [dRef], type: STRING, loc },
          });
          L.liftedFns.push({
            name: helper,
            params: [{ localId: "d.0", name: "d", type: dataT }],
            returnType: t,
            locals: [{ id: "d.0", name: "d", type: dataT, mutable: false }],
            body: [
              {
                kind: "return",
                value: {
                  kind: "recordLit",
                  fields: [
                    field("fingerprint", isBytes ? "crypto.x509Fingerprint" : "crypto.x509FingerprintStr"),
                    field("validFrom", isBytes ? "crypto.x509ValidFrom" : "crypto.x509ValidFromStr"),
                    field("validTo", isBytes ? "crypto.x509ValidTo" : "crypto.x509ValidToStr"),
                  ],
                  type: t,
                  loc,
                },
                loc,
              },
            ],
            loc,
          });
        }
        return { kind: "call", callee: helper, args: [data], type: t, loc };
      }
    }
    // `new X(...)` through a class VALUE (a classval-typed binding, array
    // element, map read, param): the newValue dispatch through the class
    // object's construct thunk. Arguments complete against the STATIC
    // class's one constructor signature — exact for every value legally
    // in the slot (the classval widening rule pins the ABI). tsc typed
    // the site against the slot's construct signature; a UNION-typed
    // callee (unannotated heterogeneous registries) keeps a pointed
    // fence — annotate the slot with the common constructor type.
    {
      const calleeT = L.mapTypeOf(L.typeOf(expr.expression));
      if (calleeT?.kind === "classval") {
        let info = L.classes.get(calleeT.className);
        if (!info && ts.isPropertyAccessExpression(expr.expression) && ts.isIdentifier(expr.expression.name)) {
          // A property-assigned class expression not collected yet (this
          // body lowers ahead of the assignment statement — hoisted
          // functions): collect it on demand and retry, keeping the
          // dynamic newValue dispatch below (the runtime field value
          // decides, exactly Node under reassignment-through-aliases).
          propertyAssignedClassInfoOf(L, L.checker.getSymbolAtLocation(expr.expression.name));
          info = L.classes.get(calleeT.className);
        }
        if (!info) {
          // The TYPE world names a class the lowering never registered —
          // a fenced class expression, an abstract/deferred declaration:
          // flush its own diagnostics (they tell the real story) and
          // poison this construction site, never an ICE.
          L.flushDeferredClass(calleeT.className);
          L.unsupported(
            "SC1090",
            expr,
            "constructing through a class value whose class has no lowering (the class declaration itself was rejected — see its own diagnostic)",
          );
        }
        // A classval of a generic FAMILY (`new () => Box<any>` slots): no
        // single constructor ABI exists to complete against. No producer
        // can fill such a slot (family values and widenings both fence),
        // so the construction site is the honest place to name it.
        if (info.generic) {
          L.unsupported(
            "SC1090",
            expr,
            "constructing through a class value of an uninstantiated generic type (annotate the slot with a concrete instantiation — e.g. 'new (v: number) => Box<number>')",
          );
        }
        const callee = L.lowerExpr(expr.expression);
        if (callee.type.kind !== "classval") L.badType(expr.expression, L.typeOf(expr.expression));
        L.noteEdge(`%${info.def.name}.constructor`);
        // Every constructor a value in this slot can dispatch to is a
        // descendant's — mark them reachable like a virtual edge.
        const below = (c: ClassInfo): void => {
          for (const s of c.subclasses) {
            L.noteEdge(`%${s.def.name}.constructor`);
            below(s);
          }
        };
        below(info);
        const args = L.completeArgs(expr.arguments ?? [], info.ctorParams, loc, expr);
        return {
          kind: "newValue",
          callee,
          args,
          type: { kind: "object", className: info.def.name },
          loc,
        };
      }
      if (calleeT?.kind === "union") {
        const def = L.unions.get(calleeT.unionId);
        if (def?.arms.some((a) => a.kind === "classval")) {
          L.unsupported(
            "SC1090",
            expr,
            "constructing through a union of class values (annotate the slot with the common constructor type — e.g. `new () => Base` — or narrow first)",
          );
        }
      }
      // `new v(...)` through a CONSTRUCT-SIGNATURE func value (`new (…)
      // => Iface` slots — types.ts maps them to func types; the
      // classval-to-thunk coercion mints the values): the thunk call IS
      // the construction. Only the mapped shape takes this arm — exactly
      // one construct signature and no call signature on the callee's
      // checker type — so a plain function value in a JS `new` keeps the
      // fence below ([[Construct]] on an ordinary closure is a different
      // semantics the thunk does not model).
      if (calleeT?.kind === "func") {
        const calleeTs = L.typeOf(expr.expression);
        if (
          L.checker.getConstructSignatures(calleeTs).length === 1 &&
          L.checker.getCallSignatures(calleeTs).length === 0
        ) {
          const callee = L.lowerExpr(expr.expression);
          if (callee.type.kind === "func" && callee.type.rest !== true) {
            const params = callee.type.params;
            if ((expr.arguments ?? []).length > params.length) {
              L.unsupported("SC1090", expr, "constructing with more arguments than the slot's construct signature declares");
            }
            const args = (expr.arguments ?? []).map((a, i) => L.lowerExprExpecting(a, params[i]));
            for (let i = args.length; i < params.length; i++) {
              const absent = omittedArgFor(L, params[i]!, loc);
              if (!absent) {
                L.unsupported("SC1090", expr, "constructing while omitting a non-optional parameter of the slot's construct signature");
              }
              args.push(absent);
            }
            return { kind: "callValue", callee, args, type: callee.type.ret, loc };
          }
        }
      }
    }
    // `new Klass(a)` where `Klass` is a plain FUNCTION value in a
    // JavaScript file — JS's pre-class constructor, and the other half of
    // `Klass.prototype.m = fn`. The callee boxes through the same
    // per-use dyn box the own-property route uses (one ScrClosure, one
    // property table, one `prototype` object however many times it is
    // boxed), the arguments box into one dyn array, and the runtime runs
    // JS's [[Construct]]: a fresh OBJ linked to `Klass.prototype`, bound
    // as the ambient receiver so the body's `this.x = a` writes land on
    // it (`this` in a plain JS function already reads scr_dyn_this_get).
    //
    // Placed HERE, immediately before the generic construction fence and
    // after every typed arm above (declared classes, classval unions,
    // construct-signature func slots), so it can only turn a refusal into
    // a lowering — never change a program that compiles today.
    //
    // JavaScript only, mirroring `fnOwnPropBox`: in TypeScript the
    // checker has a declared type at the construction and answering DYN
    // there would cascade through every downstream consumer. The SPREAD
    // form (`new F(...xs)`) keeps the fence — the argument pack would
    // need the flattening walk `dynCall`'s spread arm has, and no
    // measured site spells it.
    if (
      isJsSourceFile(expr.getSourceFile()) &&
      !(expr.arguments ?? []).some((a) => ts.isSpreadElement(a))
    ) {
      // Two spellings reach the same runtime value. A receiver that
      // probes to DYN already IS the box (a module binding holding an
      // expando function — `const A = makeWriter()` where the factory
      // also wrote `W.create = …` — lowers dyn, not func); a func-typed
      // one goes through the shared per-use box so it lands on the same
      // ScrClosure the own-property route uses. A dyn value that turns
      // out not to be callable throws Node's "<name> is not a
      // constructor" at the construction, which is Node's answer.
      // `new (f.bind(o, a))(b)` — a BOUND function in construct position.
      // JS's [[Construct]] on a bound function forwards to the TARGET's
      // [[Construct]] with the bound arguments prepended and the bound
      // THIS IGNORED (a constructor's receiver is the fresh instance, not
      // whatever bind captured), so the honest lowering is the target's
      // construction — which is also the only one that links the instance
      // to the target's `prototype`. The bound receiver still evaluates,
      // for its effects, exactly where the bind expression sat.
      const bound = boundFnOriginOf(L, expr.expression);
      const calleeNode = bound ? bound.target : expr.expression;
      const probed = probeLower(L, calleeNode);
      const boxed =
        probed !== null && probed.type.kind === "dyn"
          ? probed
          : fnOwnPropBox(L, calleeNode, loc);
      if (boxed) {
        const args: IrExpr[] = [...(bound?.boundArgs ?? []), ...(expr.arguments ?? [])].map((a) =>
          L.lowerExprExpecting(a, DYN),
        );
        if (args.every((a) => a.type.kind === "dyn")) {
          const pack: IrExpr = { kind: "dynArrLit", elems: args, type: DYN, loc };
          const what: IrExpr = {
            kind: "strLit",
            value: expr.expression.getText(),
            type: STRING,
            loc,
          };
          fnOwnCounters.construct++;
          fnOwnWhy("construct", expr, expr.expression.getText());
          const made: IrExpr = {
            kind: "libCall",
            fn: "dyn.construct",
            args: [boxed, pack, what],
            type: DYN,
            loc,
          };
          // The bound receiver(s) the construction ignores still ran in
          // Node (the bind expression evaluated them) — keep the effects.
          // A receiver SPELLED without effects (`null`, `this`, a name, a
          // literal) has none to keep, and re-lowering one in statement
          // position is not even well-formed (a bare `null` is a unitLit
          // with no union to wrap it).
          const effectful = (bound?.thisArgs ?? []).filter((t) => !effectFreeSpelling(t));
          if (effectful.length === 0) return made;
          return {
            kind: "seqExpr",
            stmts: effectful.map((t) => ({
              kind: "exprStmt" as const,
              expr: L.lowerExpr(t),
              loc,
            })),
            result: made,
            type: DYN,
            loc,
          };
        }
      }
    }
    // Declared-but-unlowered stdlib classes (fallback surface: the
    // http/https Agent): the fence points at the lowered shapes instead
    // of the generic construction rejection.
    {
      const STDLIB_CTOR_HINTS: Record<string, string | undefined> = {
        Agent:
          "constructing an http Agent through an indirect class binding (spell the construction on the module binding — new http.Agent(...)/new https.Agent(...) or the named Agent import — which lowers to the Agent handle)",
      };
      const ctorName = ts.isIdentifier(expr.expression)
        ? expr.expression
        : ts.isPropertyAccessExpression(expr.expression) && ts.isIdentifier(expr.expression.name)
          ? expr.expression.name
          : null;
      if (ctorName !== null) {
        const raw = L.checker.getSymbolAtLocation(ctorName);
        const sym = raw && raw.flags & ts.SymbolFlags.Alias ? L.checker.getAliasedSymbol(raw) : raw;
        const hint = sym && L.isStdlibSymbol(sym) ? own(STDLIB_CTOR_HINTS, sym.name) : undefined;
        if (hint !== undefined) {
          L.unsupported("SC1090", expr, hint);
        }
      }
    }
    L.unsupported("SC1090", expr, "constructing values other than classes declared in the program");
  }

/** `(t: <tuple record>) => elem[]` — each tuple position read off the
   * parameter (so the SOURCE evaluates once at the call) and pushed into
   * a fresh array, in position order. Interned per (tuple, element) pair
   * like the map drain helpers. */
  function buildTupleToArrayFn(L: Lowerer, name: string,
    tupleT: IrType & { kind: "record" },
    arity: number,
    elemT: IrType,
    loc: SrcLoc,): IrFunction {
    const outT = arrayOf(elemT);
    const ref = (localId: string, type: IrType): IrExpr => ({ kind: "varRef", localId, type, loc });
    const body: IrStmt[] = [
      { kind: "varDecl", localId: "out.0", init: { kind: "arrayLit", elems: [], type: outT, loc }, loc },
    ];
    for (let i = 0; i < arity; i++) {
      const read: IrExpr = {
        kind: "recordGet",
        obj: ref("t.0", tupleT),
        shapeId: tupleT.shapeId,
        field: String(i),
        type: elemT,
        loc,
      };
      body.push({
        kind: "exprStmt",
        expr: { kind: "arrIntrinsic", method: "push", receiver: ref("out.0", outT), args: [read], type: F64, loc },
        loc,
      });
    }
    body.push({ kind: "return", value: ref("out.0", outT), loc });
    void L;
    return {
      name,
      params: [{ localId: "t.0", name: "t", type: tupleT }],
      returnType: outT,
      locals: [
        { id: "t.0", name: "t", type: tupleT, mutable: true },
        { id: "out.0", name: "out", type: outT, mutable: false },
      ],
      body,
      loc,
    };
  }

/** A getter/setter invocation over an accessor target's receiver — the
   * same whole-program devirtualization as method calls: a virtualCall
   * when some strict subclass of the receiver's static class overrides
   * this HALF of the accessor (get and set devirtualize independently),
   * a direct call of the nearest declaration otherwise. */
  export function accessorCall(L: Lowerer, className: string,
    member: string,
    obj: IrExpr,
    extraArgs: IrExpr[],
    ret: IrType,
    loc: SrcLoc,): IrExpr {
    const info = L.classes.get(className);
    if (!info) throw new Error(`lowerer bug: accessor call on unknown class ${className}`);
    const found = L.findMethodOn(info, member);
    if (!found) throw new Error(`lowerer bug: no ${member} on ${className}`);
    // The abstract direct-call fence, accessor form (see
    // lowerObjectMethodCall): an abstract accessor with no concrete
    // override below has no implementation for a direct call to target.
    if (found.sig.abstract === true && !L.overrideBelow(info, member)) {
      L.pushDiag(
        unsupportedDiag(
          "SC1090",
          loc,
          `${member.startsWith("get:") ? "reads" : "writes"} of the abstract accessor '${member.slice(4)}' with no concrete implementation below the receiver's static class`,
        ),
      );
      throw new PoisonError();
    }
    if (L.overrideBelow(info, member)) L.noteVirtualEdge(info, member);
    else L.noteEdge(`%${found.declarer.def.name}.${member}`);
    if (L.overrideBelow(info, member)) {
      return {
        kind: "virtualCall",
        className: info.def.name,
        method: member,
        args: [L.upcastTo(obj, info.def.name), ...extraArgs],
        type: ret,
        loc,
      };
    }
    return {
      kind: "call",
      callee: `%${found.declarer.def.name}.${member}`,
      args: [L.upcastTo(obj, found.declarer.def.name), ...extraArgs],
      type: ret,
      loc,
    };
  }

/** The generic function-like INITIALIZER behind a class FIELD —
 * `time = async <T>(...) => {...}` or `= function g<T>(...) {...}`
 * (parens stripped): bindingGenericFnNodeOf's shape rule, member form.
 * Null when the field isn't that shape. */
/** True when `new Array<T>(n)` initializes a binding whose very next
 * statement is a counting loop that writes EVERY index — the spelling the
 * `.fill(v)` exception already admits, written as a loop:
 *
 *   const t = new Array<number>(256)
 *   for (let i = 0; i < 256; i += 1) { ...; t[i] = c }
 *
 * Then no slot is readable before it is written, which is the whole reason
 * scalars are otherwise refused (their absent value would read 0 where Node
 * reads undefined). Everything the proof needs is checked, and anything
 * outside it declines:
 *
 *   - the loop runs 0..n-1 by ones, over the SAME length expression (compared
 *     by source text, so `addresses.length` matches `addresses.length` and
 *     nothing else);
 *   - EVERY path that finishes an iteration assigns `a[i]` before it does
 *     (fillWalk below). A branch that writes the slot and then `continue`s
 *     has finished its iteration honestly; a branch that reaches a
 *     `continue` without writing has left a readable hole, and declines;
 *   - the body mentions `a` nowhere but the left-hand side of those writes,
 *     and no right-hand side reads it back;
 *   - the body has no break/return, which could leave the TAIL unwritten
 *     with the array still reachable, and no LABELLED continue, which can
 *     abandon an outer loop the same way. */
/** `a[i] = <rhs>` as a whole statement, for the array named `aName` at the
 * loop variable named `iName`. `=` only: a compound assignment READS the slot
 * first, which is the very thing the proof exists to prevent. */
function isFillWrite(s: ts.Statement, aName: string, iName: string): s is ts.ExpressionStatement {
  return (
    ts.isExpressionStatement(s) && ts.isBinaryExpression(s.expression) &&
    s.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    ts.isElementAccessExpression(s.expression.left) &&
    ts.isIdentifier(s.expression.left.expression) &&
    s.expression.left.expression.text === aName &&
    ts.isIdentifier(s.expression.left.argumentExpression) &&
    s.expression.left.argumentExpression.text === iName
  );
}

/** The definite-assignment walk behind the counting-loop proof.
 *
 * `written` is "the slot `a[i]` has been assigned on every path that reached
 * here"; `flowsOut` is false when NO path reaches the end of this statement
 * list (they all left through `continue`, each having written first). Null is
 * a decline, and every shape the walk does not understand declines.
 *
 * The shape this exists for is the guarded fill, which the one-top-level-write
 * rule could not see:
 *
 *   for (let i = 0; i < ids.length; i += 1) {
 *     const hit = cache.get(ids[i])
 *     if (!hit) { out[i] = null; continue }
 *     if (hit.expiresAt <= now) { cache.delete(ids[i]); out[i] = null; continue }
 *     out[i] = { secret: hit.secret, jid: hit.jid }
 *   }
 *
 * Three writes on three paths, and the union of the paths is still every
 * index. What must NOT pass is a `continue` that skips the write, or a
 * `break`/`return` that leaves the tail of the array unwritten while the
 * array is still reachable -- both leave a hole a later read can observe, and
 * for a SCALAR element a hole reads 0 where Node reads undefined. */
function fillWalk(
  stmts: readonly ts.Statement[],
  aName: string,
  iName: string,
  written = false,
  writes?: ts.Expression[],
): { written: boolean; flowsOut: boolean } | null {
  let w = written;
  for (const s of stmts) {
    if (ts.isBlock(s)) {
      const r = fillWalk(s.statements, aName, iName, w, writes);
      if (r === null) return null;
      if (!r.flowsOut) return { written: true, flowsOut: false };
      w = r.written;
      continue;
    }
    if (isFillWrite(s, aName, iName)) {
      // The right-hand side must not read the array back.
      if (mentionsIdentifier((s.expression as ts.BinaryExpression).right, aName)) return null;
      writes?.push((s.expression as ts.BinaryExpression).right);
      w = true;
      continue;
    }
    if (ts.isContinueStatement(s)) {
      // The slot has to be written BEFORE the iteration is abandoned, and a
      // labelled continue may abandon an outer loop entirely.
      if (!w || s.label !== undefined) return null;
      return { written: true, flowsOut: false };
    }
    if (ts.isIfStatement(s)) {
      if (mentionsIdentifier(s.expression, aName)) return null;
      const t = fillWalk([s.thenStatement], aName, iName, w, writes);
      if (t === null) return null;
      const e =
        s.elseStatement === undefined
          ? { written: w, flowsOut: true }
          : fillWalk([s.elseStatement], aName, iName, w, writes);
      if (e === null) return null;
      if (!t.flowsOut && !e.flowsOut) return { written: true, flowsOut: false };
      if (!t.flowsOut) { w = e.written; continue; }
      if (!e.flowsOut) { w = t.written; continue; }
      w = t.written && e.written;
      continue;
    }
    // Anything else keeps the rule the proof has always had: it may not touch
    // the array, and it may not cut the loop short. `throw` is admitted
    // exactly as it was before this walk existed -- it unwinds the frame
    // rather than continuing to read the array.
    if (mentionsIdentifier(s, aName)) return null;
    if (hasLoopJump(s)) return null;
  }
  return { written: w, flowsOut: true };
}

function fullFillLoopFollows(expr: ts.NewExpression): boolean {
  const ok = fullFillLoopWrites(expr) !== null;
  if (ok) noteFillLoopProof(expr);
  return ok;
}

/** The counting-loop proof itself, handing back the RIGHT-HAND SIDES of the
 * writes it admitted. `fullFillLoopFollows` is this, asked as a yes/no.
 *
 * The RHS list is what newArrayFillElemType reads to give an UNANNOTATED
 * `new Array(n)` an element type. Nothing else changed about the proof: the
 * same shapes pass, the same shapes decline, and the counter still ticks
 * once per admitted site, so SCRIPTC_FILLLOOP_WHY reads exactly as before. */
function fullFillLoopWrites(expr: ts.NewExpression): ts.Expression[] | null {
  const lenArg = expr.arguments?.[0];
  if (!lenArg) return null;
  const decl = expr.parent;
  if (!ts.isVariableDeclaration(decl) || !ts.isIdentifier(decl.name)) return null;
  const list = decl.parent;
  if (!ts.isVariableDeclarationList(list) || list.declarations.length !== 1) return null;
  const stmt = list.parent;
  if (!ts.isVariableStatement(stmt)) return null;
  const owner = stmt.parent as ts.Node & { statements?: readonly ts.Statement[] };
  const stmts = owner.statements;
  if (!stmts) return null;
  const at = stmts.indexOf(stmt);
  const loop = at >= 0 ? stmts[at + 1] : undefined;
  if (!loop || !ts.isForStatement(loop)) return null;

  // for (let i = 0; i < <same length>; i += 1 | i++)
  const init = loop.initializer;
  if (!init || !ts.isVariableDeclarationList(init) || init.declarations.length !== 1) return null;
  const iDecl = init.declarations[0]!;
  if (!ts.isIdentifier(iDecl.name) || !iDecl.initializer) return null;
  if (iDecl.initializer.kind !== ts.SyntaxKind.NumericLiteral || iDecl.initializer.getText() !== "0") return null;
  const iName = iDecl.name.text;
  const cond = loop.condition;
  if (!cond || !ts.isBinaryExpression(cond) ||
      cond.operatorToken.kind !== ts.SyntaxKind.LessThanToken ||
      !ts.isIdentifier(cond.left) || cond.left.text !== iName ||
      cond.right.getText() !== lenArg.getText()) {
    return null;
  }
  const inc = loop.incrementor;
  if (!inc) return null;
  const byOne =
    (ts.isPostfixUnaryExpression(inc) && inc.operator === ts.SyntaxKind.PlusPlusToken &&
      ts.isIdentifier(inc.operand) && inc.operand.text === iName) ||
    (ts.isBinaryExpression(inc) && inc.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken &&
      ts.isIdentifier(inc.left) && inc.left.text === iName && inc.right.getText() === "1");
  if (!byOne) return null;

  // The body: every path that finishes an iteration writes `a[i]` first.
  const body = loop.statement;
  const bodyStmts: readonly ts.Statement[] = ts.isBlock(body) ? body.statements : [body];
  const aName = decl.name.text;
  const writes: ts.Expression[] = [];
  const walked = fillWalk(bodyStmts, aName, iName, false, writes);
  if (walked === null) return null;
  if (walked.flowsOut && !walked.written) return null;
  return writes;
}

/** The counter tick, kept OUT of fullFillLoopWrites on purpose: an
 * unannotated `new Array(n)` asks the proof TWICE — once through
 * newArrayFillElemType for the element type, once through
 * fullFillLoopFollows for the absent-slot gate — and a counter inside the
 * proof would report one site as two. fullFillLoopFollows runs exactly once
 * per site that reaches the gate, on both the annotated and the inferred
 * path, so the tick belongs here and the SCRIPTC_FILLLOOP_WHY probe keeps
 * the meaning its own comment gives it: how many SITES the proof admitted. */
function noteFillLoopProof(expr: ts.NewExpression): void {
  fullFillLoopProofs++;
  if (process.env["SCRIPTC_FILLLOOP_WHY"] !== undefined) {
    const decl = expr.parent;
    const aName = ts.isVariableDeclaration(decl) && ts.isIdentifier(decl.name) ? decl.name.text : "?";
    console.error(
      `[fillloopwhy] #${fullFillLoopProofs} ${expr.getSourceFile().fileName}:` +
        `${expr.getSourceFile().getLineAndCharacterOfPosition(expr.getStart()).line + 1} ${aName}`,
    );
  }
}

/** The element type of an UNANNOTATED `new Array(n)` that the counting-loop
 * proof admits, read off the writes the proof already collected.
 *
 *   const distributions = new Array(participants.length)
 *   for (let index = 0; index < participants.length; index += 1) {
 *     distributions[index] = { groupId, sender: participants[index], … }
 *   }
 *
 * is zapo's `signal/group/SenderKeyManager.ts:185`, and tsc types it
 * `any[]`: `new Array(n)` is not one of the initializers TS's evolving-array
 * analysis follows, so no element type exists to map and the site reported
 * three diagnostics in one host function — SC2011 on the `any[]`
 * declaration, SC1090 on the element write beneath it, and SC2004 on the
 * use of the blocked binding.
 *
 * The proof this reuses is strictly stronger than an inference would need:
 * it already establishes that the very next statement is a counting loop
 * over the SAME length expression, that every path finishing an iteration
 * writes `a[i]` first, and that nothing else in the body touches `a`. So
 * the writes ARE the array's contents, exhaustively, and their common type
 * is the element type — not a guess about it.
 *
 * Nothing is widened or invented. Every write must map, and they must all
 * map to the SAME IR type (typeEquals): two writes of different shapes name
 * no single element type, and inventing a union for them would build a
 * representation the source never asked for. That is a decline, and the
 * existing `any[]` diagnostic stands.
 *
 * The absent-slot question is NOT re-answered here — the caller's own
 * `absent` gate runs after this and keeps the ratified stance (SEMANTICS.md
 * 46). This decides only WHICH element type, never whether holes are
 * readable. */
function newArrayFillElemType(L: Lowerer, expr: ts.NewExpression): (IrType & { kind: "array" }) | null {
  const writes = fullFillLoopWrites(expr);
  if (writes === null || writes.length === 0) return null;
  let elem: IrType | null = null;
  for (const w of writes) {
    const t = L.mapTypeOf(L.typeOf(w));
    if (t === null) return null;
    if (elem === null) elem = t;
    else if (!typeEquals(elem, t)) return null;
  }
  return elem === null ? null : (arrayOf(elem) as IrType & { kind: "array" });
}

/** SCRIPTC_FILLLOOP_WHY probe: how many `new Array(n)` sites the
 * counting-loop proof admitted. Read in the SAME run as the trap count —
 * "nothing changed" and "the branch never ran" are otherwise the same
 * observation. */
let fullFillLoopProofs = 0;

/* ── the RESERVE / PREFIX-FILL / TRUNCATE idiom ───────────────────────────
 *
 * The counting-loop proof above answers "every slot is written". This one
 * answers the OTHER way a program keeps a scalar hole from ever being read:
 * it reserves an upper bound, fills a PREFIX under its own counter, and then
 * throws the unwritten tail away with `a.length = counter`.
 *
 *   const prepareTargetIndices = new Array<number>(missingIndices.length)
 *   const preparePromises      = new Array<Promise<...>>(missingIndices.length)
 *   let prepareCount = 0
 *   const missingBundleTargets: { jid: string; reason: string }[] = []
 *   for (let index = 0; index < missingIndices.length; index += 1) {
 *     ...
 *     if (!batchResult?.bundle) { missingBundleTargets.push(...); continue }
 *     ...
 *     prepareTargetIndices[prepareCount] = targetIndex
 *     preparePromises[prepareCount]      = ...
 *     prepareCount += 1
 *   }
 *   if (prepareCount === 0) { return collectResolvedTargets() }
 *   prepareTargetIndices.length = prepareCount
 *
 * That is zapo's `src/signal/session/resolver.ts` verbatim, and the reason it
 * needs its own proof is that the counting-loop proof cannot see it: the
 * writes are indexed by the COUNTER and not by the loop variable, and the
 * body's `continue` is the whole point rather than a reason to decline.
 *
 * The two sites it unblocks are a PAIR and are proven together on purpose --
 * `new Array<number>(N)` at the reserve and `a.length = c` at the truncation
 * are the same fact stated twice, and admitting either alone would leave a
 * readable scalar hole. Both entry points below run THIS function, and both
 * require it to name the very node they are lowering.
 *
 * The invariant, and where each clause of the proof buys it:
 *
 *   I.  Every slot in [0, c) has been written.
 *       `c` starts at 0 (C2) and its ONLY mutation is the `c += 1` that is
 *       the LAST statement of the loop body (C5, C6), reached only by falling
 *       out of the bottom of the body, which is only possible after the
 *       straight-line run of `a[c] = ...` writes that precedes it (C7). So
 *       the slot the counter is about to leave behind was written on that
 *       same pass. A `continue` above the first write abandons the iteration
 *       WITHOUT advancing c, which preserves I rather than breaking it.
 *
 *   II. c <= N, so the write index is always in range and the truncation is
 *       always a SHRINK.
 *       The loop is the counting form over the SAME length expression (C4),
 *       its variable is never reassigned in the body (C8), and the root of
 *       that length expression is never mutated between the reserve and the
 *       truncation (C3) -- so the trip count is exactly N and c advances at
 *       most once per trip. At the write in trip k, c <= k <= N-1.
 *
 *   III. No hole is READ before the truncation.
 *       `a` is mentioned nowhere between the reserve and the loop, nowhere in
 *       the loop but as the receiver of those writes, and nowhere between the
 *       loop and the truncation (C1, C7, C9). `a` is a `const` declared AT
 *       the reserve, so nothing earlier can hold it, and it is not exported,
 *       so nothing outside the module body can read it through the window.
 *       After the truncation the array has length c and, by I, no hole at all.
 *
 * II's "the trip count is exactly N" needs one clause the straight-line scans
 * cannot supply, and C10 is it: a function created elsewhere in the enclosing
 * body and invoked from inside the loop -- a callback, anything across an
 * `await` -- is invisible to a statement scan, and one that pushed to the
 * bound's array would make the loop outrun the reserved length and turn the
 * truncation into a GROW. So no function in the enclosing body may mention
 * the bound's root at all.
 *
 * Anything at all outside that shape DECLINES and keeps both fences. A
 * decline costs a diagnostic that was already there; a wrong admit costs a
 * scalar 0 read where Node reads undefined, which is the wrong-answer shape
 * this whole gate exists to prevent. */

/** `<ident>[<ident>] = rhs` as a top-level statement: the prefix write. */
function prefixWriteOf(s: ts.Statement, idxName: string): ts.BinaryExpression | null {
  if (!ts.isExpressionStatement(s)) return null;
  const e = s.expression;
  if (!ts.isBinaryExpression(e) || e.operatorToken.kind !== ts.SyntaxKind.EqualsToken) return null;
  if (!ts.isElementAccessExpression(e.left) || e.left.questionDotToken) return null;
  if (!ts.isIdentifier(e.left.expression)) return null;
  if (!ts.isIdentifier(e.left.argumentExpression) || e.left.argumentExpression.text !== idxName) return null;
  return e;
}

/** `c += 1;` / `c++;` as a statement -- the counter tick, and the name it
 * ticks. Prefix `++c` and `c = c + 1` are equally sound and equally declined:
 * the narrower the spelling the smaller the surface, and a decline is free. */
function counterTickName(s: ts.Statement): string | null {
  if (!ts.isExpressionStatement(s)) return null;
  const e = s.expression;
  if (ts.isPostfixUnaryExpression(e) && e.operator === ts.SyntaxKind.PlusPlusToken && ts.isIdentifier(e.operand)) {
    return e.operand.text;
  }
  if (
    ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken &&
    ts.isIdentifier(e.left) && e.right.getText() === "1"
  ) {
    return e.left.text;
  }
  return null;
}

/** `let <name> = 0;` as a single-declaration statement. */
function isLetZeroDecl(s: ts.Statement, name: string): boolean {
  if (!ts.isVariableStatement(s)) return false;
  const list = s.declarationList;
  if (list.declarations.length !== 1) return false;
  if ((list.flags & ts.NodeFlags.Let) === 0) return false;
  const d = list.declarations[0]!;
  return (
    ts.isIdentifier(d.name) && d.name.text === name &&
    d.initializer !== undefined && d.initializer.kind === ts.SyntaxKind.NumericLiteral &&
    d.initializer.getText() === "0"
  );
}

/** Every REFERENCE to `name` under `node` -- the same "a property NAME binds
 * nothing" rule mentionsIdentifier uses, but handing back the nodes so the
 * caller can say which positions it will accept. */
function referencesTo(node: ts.Node, name: string): ts.Identifier[] {
  const out: ts.Identifier[] = [];
  const walk = (n: ts.Node): void => {
    if (ts.isPropertyAccessExpression(n)) {
      walk(n.expression);
      return;
    }
    if (ts.isIdentifier(n)) {
      if (n.text === name) out.push(n);
      return;
    }
    ts.forEachChild(n, walk);
  };
  walk(node);
  return out;
}

/** Is this reference the target of a write -- an assignment's left-hand side,
 * or the operand of `++`/`--`? Element and property paths rooted at it count:
 * `a[i] = v` and `a.f = v` both mutate what `a` names. */
function isWriteTarget(id: ts.Identifier): boolean {
  let n: ts.Node = id;
  let p = n.parent;
  while (
    p !== undefined &&
    ((ts.isPropertyAccessExpression(p) && p.expression === n) ||
      (ts.isElementAccessExpression(p) && p.expression === n))
  ) {
    n = p;
    p = n.parent;
  }
  if (p === undefined) return false;
  if (ts.isBinaryExpression(p) && p.left === n) {
    const k = p.operatorToken.kind;
    return k === ts.SyntaxKind.EqualsToken || COMPOUND_ASSIGN_KINDS.has(k);
  }
  return (
    (ts.isPostfixUnaryExpression(p) || ts.isPrefixUnaryExpression(p)) &&
    (p.operator === ts.SyntaxKind.PlusPlusToken || p.operator === ts.SyntaxKind.MinusMinusToken)
  );
}

const COMPOUND_ASSIGN_KINDS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.PlusEqualsToken, ts.SyntaxKind.MinusEqualsToken, ts.SyntaxKind.AsteriskEqualsToken,
  ts.SyntaxKind.SlashEqualsToken, ts.SyntaxKind.PercentEqualsToken, ts.SyntaxKind.AsteriskAsteriskEqualsToken,
  ts.SyntaxKind.LessThanLessThanEqualsToken, ts.SyntaxKind.GreaterThanGreaterThanEqualsToken,
  ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken, ts.SyntaxKind.AmpersandEqualsToken,
  ts.SyntaxKind.BarEqualsToken, ts.SyntaxKind.CaretEqualsToken, ts.SyntaxKind.AmpersandAmpersandEqualsToken,
  ts.SyntaxKind.BarBarEqualsToken, ts.SyntaxKind.QuestionQuestionEqualsToken,
]);

/** Any assignment to `name` (or through it) under `node`. */
function assignsIdentifier(node: ts.Node, name: string): boolean {
  return referencesTo(node, name).some(isWriteTarget);
}

/** Could `name`'s VALUE change under `node`? Written to, incremented, handed
 * to a method of its own (`xs.push(...)`), or simply used as a bare value --
 * the last one because a reference that escapes can be mutated out of sight.
 * A pure read through a member or an index (`xs.length`, `xs[i]`) is not a
 * mutation, and those are the two spellings the bound is read through. */
function mayMutateIdentifier(node: ts.Node, name: string): boolean {
  if (name === "") return false;
  for (const id of referencesTo(node, name)) {
    if (isWriteTarget(id)) return true;
    const p = id.parent;
    if (p !== undefined && ts.isPropertyAccessExpression(p) && p.expression === id) {
      const gp = p.parent;
      if (gp !== undefined && ts.isCallExpression(gp) && gp.expression === p) return true; // xs.push(...)
      continue; // xs.length
    }
    if (p !== undefined && ts.isElementAccessExpression(p) && p.expression === id) continue; // xs[i]
    return true; // the bare reference escapes
  }
  return false;
}

/** Does any FUNCTION inside `root` mention `name`?
 *
 * The statement scans in the proof below are straight-line: they see what the
 * code between the reserve and the truncation does, and nothing else. A
 * function created somewhere else in the same enclosing body and invoked from
 * inside the loop -- a callback, or anything reached across an `await` --
 * would not appear in them at all, and if it pushed to the array the bound is
 * read from, the trip count would exceed the reserved length and the
 * truncation would GROW. Asking that no function so much as mentions the
 * bound's root is more than that argument needs and is free: zapo's
 * `missingIndices` is pushed only by a plain `for` at the same level, and is
 * captured by nothing. */
function mentionedInsideAnyFunction(root: ts.Node, name: string): boolean {
  let found = false;
  const walk = (n: ts.Node): void => {
    if (found) return;
    if (ts.isFunctionLike(n)) {
      if (mentionsIdentifier(n, name)) found = true;
      return;
    }
    ts.forEachChild(n, walk);
  };
  ts.forEachChild(root, walk);
  return found;
}

/** The nearest function body (or the source file) that encloses `n`. */
function enclosingBodyOf(n: ts.Node): ts.Node {
  let p: ts.Node | undefined = n.parent;
  while (p !== undefined && !ts.isFunctionLike(p) && !ts.isSourceFile(p)) p = p.parent;
  return p ?? n.getSourceFile();
}

/** The identifier whose value the bound depends on: `n` for `n`, `xs` for
 * `xs.length`, and "" for a numeric literal (nothing to protect). Anything
 * else has no root this proof can watch, and declines. */
function boundRootOf(lenArg: ts.Expression): string | null {
  if (lenArg.kind === ts.SyntaxKind.NumericLiteral) return "";
  if (ts.isIdentifier(lenArg)) return lenArg.text;
  if (
    ts.isPropertyAccessExpression(lenArg) && !lenArg.questionDotToken &&
    lenArg.name.text === "length" && ts.isIdentifier(lenArg.expression)
  ) {
    return lenArg.expression.text;
  }
  return null;
}

/** The proof. Answers the `a.length = c` STATEMENT that truncates the array
 * `expr` reserves, or null. Naming the statement is what lets the two entry
 * points agree: the `.length` site asks "is the statement I am lowering the
 * one this proof named", so neither site can be admitted by a proof about a
 * different statement. */
function prefixFillTruncationOf(expr: ts.NewExpression): ts.ExpressionStatement | null {
  const lenArg = expr.arguments?.[0];
  if (!lenArg || (expr.arguments?.length ?? 0) !== 1) return null;

  // C1: `const a = new Array(N);` alone in its statement, in a statement list.
  const decl = expr.parent;
  if (!ts.isVariableDeclaration(decl) || !ts.isIdentifier(decl.name)) return null;
  if (decl.initializer !== expr) return null;
  const list = decl.parent;
  if (!ts.isVariableDeclarationList(list) || list.declarations.length !== 1) return null;
  if ((list.flags & ts.NodeFlags.Const) === 0) return null;
  const stmt = list.parent;
  if (!ts.isVariableStatement(stmt)) return null;
  // An EXPORTED binding is readable from outside this module body, and a
  // circular import can read it while the body is still running -- which is
  // exactly the window between the reserve and the truncation.
  if (stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) return null;
  const owner = stmt.parent as ts.Node & { statements?: readonly ts.Statement[] };
  const stmts = owner.statements;
  if (!stmts) return null;
  const at = stmts.indexOf(stmt);
  if (at < 0) return null;
  const aName = decl.name.text;

  // C3 (first half): the bound must have a root this proof can watch, and no
  // function anywhere in the enclosing body may touch it (C10).
  const nRoot = boundRootOf(lenArg);
  if (nRoot === null || nRoot === aName) return null;
  if (nRoot !== "" && mentionedInsideAnyFunction(enclosingBodyOf(stmt), nRoot)) return null;

  // C1 (second half): the first `for` after the reserve is the fill loop, and
  // nothing before it touches the array or the bound.
  let loopIdx = -1;
  for (let k = at + 1; k < stmts.length; k++) {
    const s = stmts[k]!;
    if (ts.isForStatement(s)) { loopIdx = k; break; }
    if (mentionsIdentifier(s, aName)) return null;
    if (mayMutateIdentifier(s, nRoot)) return null;
  }
  if (loopIdx < 0) return null;
  const loop = stmts[loopIdx] as ts.ForStatement;

  // C4: `for (let i = 0; i < <the SAME length expression>; i += 1 | i++)`.
  const init = loop.initializer;
  if (!init || !ts.isVariableDeclarationList(init) || init.declarations.length !== 1) return null;
  const iDecl = init.declarations[0]!;
  if (!ts.isIdentifier(iDecl.name) || !iDecl.initializer) return null;
  if (iDecl.initializer.kind !== ts.SyntaxKind.NumericLiteral || iDecl.initializer.getText() !== "0") return null;
  const iName = iDecl.name.text;
  const cond = loop.condition;
  if (
    !cond || !ts.isBinaryExpression(cond) ||
    cond.operatorToken.kind !== ts.SyntaxKind.LessThanToken ||
    !ts.isIdentifier(cond.left) || cond.left.text !== iName ||
    cond.right.getText() !== lenArg.getText()
  ) {
    return null;
  }
  const inc = loop.incrementor;
  if (!inc) return null;
  const byOne =
    (ts.isPostfixUnaryExpression(inc) && inc.operator === ts.SyntaxKind.PlusPlusToken &&
      ts.isIdentifier(inc.operand) && inc.operand.text === iName) ||
    (ts.isBinaryExpression(inc) && inc.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken &&
      ts.isIdentifier(inc.left) && inc.left.text === iName && inc.right.getText() === "1");
  if (!byOne) return null;

  // C5: the body is a block whose LAST statement is the counter tick.
  const body = loop.statement;
  if (!ts.isBlock(body)) return null;
  const bodyStmts = body.statements;
  if (bodyStmts.length < 2) return null;
  const tick = bodyStmts[bodyStmts.length - 1]!;
  const cName = counterTickName(tick);
  if (cName === null || cName === aName || cName === iName || cName === nRoot) return null;

  // C2: `let c = 0` between the reserve and the loop, unassigned after it.
  let cDeclIdx = -1;
  for (let k = at + 1; k < loopIdx; k++) {
    if (isLetZeroDecl(stmts[k]!, cName)) { cDeclIdx = k; break; }
  }
  if (cDeclIdx < 0) return null;
  for (let k = cDeclIdx + 1; k < loopIdx; k++) if (assignsIdentifier(stmts[k]!, cName)) return null;

  // C7: the array is mentioned in the body only as `a[c] = rhs`, those writes
  // are top-level statements, and from the first of them to the tick the flow
  // is straight-line -- no jump can leave the counter behind un-ticked.
  const aRefs = referencesTo(body, aName);
  if (aRefs.length === 0) return null;
  let firstWriteAt = -1;
  let ownWrites = 0;
  for (let k = 0; k < bodyStmts.length - 1; k++) {
    const w = prefixWriteOf(bodyStmts[k]!, cName);
    if (w === null) continue;
    if (!ts.isIdentifier((w.left as ts.ElementAccessExpression).expression)) continue;
    if (((w.left as ts.ElementAccessExpression).expression as ts.Identifier).text !== aName) continue;
    if (mentionsIdentifier(w.right, aName) || mentionsIdentifier(w.right, cName)) return null;
    ownWrites++;
    if (firstWriteAt < 0) firstWriteAt = k;
  }
  if (ownWrites === 0 || ownWrites !== aRefs.length) return null;
  for (let k = firstWriteAt; k < bodyStmts.length - 1; k++) {
    const s = bodyStmts[k]!;
    if (prefixWriteOf(s, cName) !== null) continue; // a[c]= / other[c]= , both fine
    if (mentionsIdentifier(s, aName) || assignsIdentifier(s, cName) || hasLoopJump(s)) return null;
  }
  // C6: the tick is the counter's only mutation anywhere in the body.
  for (let k = 0; k < bodyStmts.length - 1; k++) if (assignsIdentifier(bodyStmts[k]!, cName)) return null;
  // C8 + C3 (second half): the trip count is what the header says it is.
  if (assignsIdentifier(body, iName)) return null;
  if (mayMutateIdentifier(body, nRoot)) return null;

  // C9: the first thing after the loop that touches the array is the
  // truncation, and nothing before it moves the counter.
  for (let k = loopIdx + 1; k < stmts.length; k++) {
    const s = stmts[k]!;
    if (!mentionsIdentifier(s, aName)) {
      if (assignsIdentifier(s, cName)) return null;
      continue;
    }
    if (!ts.isExpressionStatement(s)) return null;
    const e = s.expression;
    if (
      ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(e.left) && !e.left.questionDotToken &&
      e.left.name.text === "length" && ts.isIdentifier(e.left.expression) &&
      e.left.expression.text === aName &&
      ts.isIdentifier(e.right) && e.right.text === cName
    ) {
      return s;
    }
    return null;
  }
  return null;
}

/** SCRIPTC_PREFIXFILL_WHY probe: which RESERVE sites the prefix-fill proof
 * admitted, and how many.
 *
 * Deduplicated by NODE, and that is not tidiness -- MEASURED: the lowerer
 * asks each site twice (a probe pass and the real one), so a bare counter
 * reported one idiom as two and the first run of this instrument printed 4
 * lines for 2 arrays. An instrument whose number has to be halved before it
 * can be read is an instrument that will be misread. */
let prefixFillProofs = 0;
const prefixFillSeen = new WeakSet<ts.NewExpression>();
function prefixFillTruncateFollows(expr: ts.NewExpression): boolean {
  const t = prefixFillTruncationOf(expr);
  if (t === null) return false;
  if (prefixFillSeen.has(expr)) return true;
  prefixFillSeen.add(expr);
  prefixFillProofs++;
  if (process.env["SCRIPTC_PREFIXFILL_WHY"] !== undefined) {
    const sf = expr.getSourceFile();
    const decl = expr.parent;
    const aName = ts.isVariableDeclaration(decl) && ts.isIdentifier(decl.name) ? decl.name.text : "?";
    console.error(
      `[prefixfillwhy] #${prefixFillProofs} ${sf.fileName}:` +
        `${sf.getLineAndCharacterOfPosition(expr.getStart()).line + 1} ${aName} ` +
        `truncated at :${sf.getLineAndCharacterOfPosition(t.getStart()).line + 1}`,
    );
  }
  return true;
}

/** The truncation half, for lower-stmts: is `stmt` the `a.length = c` a
 * prefix-fill proof named?
 *
 * The array's declaration is found LEXICALLY, by scanning back through the
 * very statement list the proof requires it to share -- so no checker query,
 * and no chance of resolving to an outer binding a nearer `const` shadows. */
export function isProvenPrefixTruncation(stmt: ts.Statement, arrName: string): boolean {
  const owner = stmt.parent as ts.Node & { statements?: readonly ts.Statement[] };
  const stmts = owner.statements;
  if (!stmts) return false;
  const at = stmts.indexOf(stmt);
  if (at < 0) return false;
  for (let k = at - 1; k >= 0; k--) {
    const s = stmts[k]!;
    if (!ts.isVariableStatement(s)) continue;
    const list = s.declarationList;
    if (list.declarations.length !== 1) continue;
    const d = list.declarations[0]!;
    if (!ts.isIdentifier(d.name) || d.name.text !== arrName) continue;
    const initExpr = d.initializer;
    if (initExpr === undefined || !ts.isNewExpression(initExpr)) return false;
    if (!ts.isIdentifier(initExpr.expression) || initExpr.expression.text !== "Array") return false;
    return prefixFillTruncationOf(initExpr) === stmt;
  }
  return false;
}

/** Any reference to `name` anywhere under `node`.
 *
 * A REFERENCE, not any identifier that happens to spell the name: the NAME
 * half of a property access binds nothing, so `this.keys.get(...)` does not
 * mention a local called `keys`. That distinction is what the counting-loop
 * proof above needs — it asks "does the body read the array back", and a
 * same-named FIELD is a different storage location entirely. The receiver
 * half still walks (`keys.get(...)` IS a mention), and an ELEMENT access
 * `obj[keys]` is untouched: its argument is a real reference. */
function mentionsIdentifier(node: ts.Node, name: string): boolean {
  let found = false;
  const walk = (n: ts.Node): void => {
    if (found) return;
    if (ts.isPropertyAccessExpression(n)) {
      walk(n.expression);
      return;
    }
    if (ts.isIdentifier(n) && n.text === name) {
      found = true;
      return;
    }
    ts.forEachChild(n, walk);
  };
  walk(node);
  return found;
}

/** A break/continue/return that could leave the counting loop's tail
 * unwritten. Nested functions are their own control flow and do not count;
 * a nested LOOP's own break does not escape it, but distinguishing that
 * costs more than declining. */
function hasLoopJump(node: ts.Node): boolean {
  let found = false;
  const walk = (n: ts.Node): void => {
    if (found) return;
    if (ts.isFunctionLike(n)) return;
    if (ts.isBreakStatement(n) || ts.isContinueStatement(n) || ts.isReturnStatement(n)) {
      found = true;
      return;
    }
    ts.forEachChild(n, walk);
  };
  walk(node);
  return found;
}

export function genericFieldFnNodeOf(member: ts.PropertyDeclaration): ts.FunctionExpression | ts.ArrowFunction | null {
  if (member.initializer === undefined) return null;
  let init: ts.Expression = member.initializer;
  while (ts.isParenthesizedExpression(init)) init = init.expression;
  if (
    (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) &&
    init.typeParameters !== undefined && init.body !== undefined
  ) {
    return init;
  }
  return null;
}
