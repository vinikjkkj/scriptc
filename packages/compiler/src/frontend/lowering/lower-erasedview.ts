/* THE ERASED VIEW OF A GENERIC CLASS: `IdleExpiryIndex<string, unknown>` over `IdleExpiryIndex<string, SenderKeyRecord>` and
 * `IdleExpiryIndex<string, SenderKeyDistributionRecord>`.
 *
 * zapo-js's sender-key cache declares `indexFor(entries): IdleExpiryIndex<string, unknown>` and returns one of two DIFFERENT
 * instantiations through it, then calls `touch(key)` / `delete(key)`, which never mention the value type. `unknown` maps to dyn,
 * so `Foo<string, unknown>` is its own monomorph (its `data` is a `Map<string, dyn>`) and neither instantiation is a subclass of
 * it: the flow was refused.
 *
 * A VIEW is a fieldless, abstract class between the family and the instantiations that share its non-erased arguments. It declares
 * one abstract slot per public instance method whose signature does not mention an erased type parameter, and each such
 * instantiation extends it (its own `touch` fills the slot through the ordinary override machinery, the exactness rule included).
 * The declared type `Foo<string, unknown>` then maps to the view, an upcast of either instantiation into it is a pointer
 * reinterpret (the view adds no field, so every instantiation's layout is exactly the one it had under the family), and a call on
 * it is an ordinary virtual call. A member the view does not carry (one that mentions the erased parameter, a field) keeps the
 * named per-site refusal.
 *
 * WHEN A VIEW EXISTS. Never speculatively: a program that compiles without a view compiles byte for byte the same. The discovery pass
 * notes the need when a value of one instantiation reaches a slot of another instantiation of the same family whose arguments
 * differ only where the slot says `unknown` (requireExactShape, the refusal the flow used to end in); discovery then runs again, from
 * a fresh lowerer, with the view registered, until the set stops growing, so the emit pass decides every instantiation's base from
 * the final set. The registry is keyed by the TS type IDENTITY of the non-erased arguments (class names are demand ordinals and are
 * not stable between passes; the checker interns types), cleared at the start of every lowering.
 *
 * `new Foo<string, unknown>(x)` and `extends Foo<string, unknown>` keep their meaning: they construct / extend the `<string, dyn>`
 * monomorph (which itself extends the view), never the abstract view. */
import * as ts from "../ts7/adapter.js";
import type { Lowerer } from "./lowerer.js";
import { PoisonError } from "./lowerer.js";
import type { ClassInfo, GenericClassInfo, MethodSig } from "./lower-classes.js";
import { findGenericMethodOn } from "./lower-classes.js";
import { isJsSourceFile, locOf } from "../program.js";
import type { IrType } from "../../ir/nodes.js";

interface ViewRec {
  key: string;
  declName: string;
  /** erased[i]: type argument i is `unknown` in the slot's type. */
  erased: boolean[];
  /** The slot's type arguments (the erased positions are `unknown`). */
  args: ts.Type[];
}

const VIEWS = new Map<string, ViewRec>();
let noted = false;
let bypassDepth = 0;
const typeIds = new WeakMap<ts.Type, number>();
let nextTypeId = 1;

function typeId(t: ts.Type): number {
  let id = typeIds.get(t);
  if (id === undefined) {
    id = nextTypeId++;
    typeIds.set(t, id);
  }
  return id;
}

/** Per compilation: the discovery pass fills the registry, every later pass reads it. */
export function clearErasedViews(): void {
  VIEWS.clear();
  noted = false;
}

/** Did discovery register a view that earlier passes of this compilation did not know? Discovery reruns while the set grows. */
export function erasedViewsNoted(): boolean {
  return noted;
}

export function erasedViewsSignature(): string {
  return [...VIEWS.keys()].sort().join("\n");
}

const isErasedArg = (a: ts.Type): boolean => (a.flags & ts.TypeFlags.Unknown) !== 0;

function recKey(declName: string, erased: readonly boolean[], args: readonly ts.Type[]): string {
  return `${declName}|${erased.map((e, i) => (e ? "*" : String(typeId(args[i]!)))).join(",")}`;
}

/** A value of one instantiation reached a slot of another instantiation of the same family: when the slot's type is the family
 * with `unknown` where the source has a type and the remaining arguments are the same types, register the view that makes the
 * flow an upcast. Called where the flow ends in its refusal; the refusal itself stands (discovery's diagnostics are discarded, the
 * rerun with the view registered lowers the flow, and an emit pass that still reaches the refusal reports it). */
export function noteErasedViewFlow(L: Lowerer, actual: IrType, expected: IrType): void {
  if (actual.kind !== "object") return;
  // A nullable or optional slot (`Foo<string, unknown> | null`): the arm that is an object type is the slot the value upcasts into.
  if (expected.kind === "union") {
    const arms = L.unions.get(expected.unionId)?.arms;
    if (arms !== undefined) for (const arm of arms) if (arm.kind === "object") noteErasedViewFlowInto(L, actual, arm);
    return;
  }
  noteErasedViewFlowInto(L, actual, expected);
}

function noteErasedViewFlowInto(L: Lowerer, actual: IrType & { kind: "object" }, expected: IrType): void {
  if (expected.kind !== "object") return;
  // The source may be a SUBCLASS of an instantiation (`class Plain extends Ring<string, string>`): its nearest generic ancestor is
  // the instantiation the flow is about (the upcast to the view then goes through it).
  let src: ClassInfo | null | undefined = L.classes.get(actual.className);
  while (src !== null && src !== undefined && src.genericInstance === undefined) src = src.base;
  const ai = src?.genericInstance;
  const ei = L.classes.get(expected.className)?.genericInstance;
  if (ai === undefined || ei === undefined || ai.family !== ei.family || ai.tsRef === undefined || ei.tsRef === undefined) return;
  const fam = ei.family;
  if (fam.generic === undefined || fam.genericSplitBase === true) return;
  const n = fam.generic.typeParams.length;
  const eArgs = L.checker.getTypeArguments(ei.tsRef as ts.TypeReference).slice(0, n);
  const aArgs = L.checker.getTypeArguments(ai.tsRef as ts.TypeReference).slice(0, n);
  if (eArgs.length !== n || aArgs.length !== n) return;
  const erased = eArgs.map(isErasedArg);
  if (!erased.some((e) => e)) return;
  for (let i = 0; i < n; i++) {
    if (erased[i]) continue;
    if (aArgs[i] !== eArgs[i]) return;
  }
  const key = recKey(fam.def.name, erased, eArgs);
  if (VIEWS.has(key)) return;
  VIEWS.set(key, { key, declName: fam.def.name, erased, args: eArgs });
  noted = true;
}

/** `Foo<A, unknown>` resolved while views are registered: the view when this exact slot type has one, else null. */
export function erasedViewOfRef(L: Lowerer, gci: GenericClassInfo, args: readonly ts.Type[]): ClassInfo | null {
  if (VIEWS.size === 0 || bypassDepth > 0 || gci.family.genericSplitBase === true) return null;
  if (args.length !== gci.typeParams.length) return null;
  const erased = args.map(isErasedArg);
  if (!erased.some((e) => e)) return null;
  const rec = VIEWS.get(recKey(gci.family.def.name, erased, args));
  return rec === undefined ? null : ensureView(L, gci, rec);
}

/** The view a NEW instantiation with these arguments extends: the one registered view whose non-erased arguments it shares.
 * None, or more than one (a single inheritance chain cannot honour two), is null: the instantiation sits under the family as it
 * always did and a flow into either view keeps its refusal. */
export function viewBaseOfInstance(L: Lowerer, gci: GenericClassInfo, args: readonly ts.Type[]): ClassInfo | null {
  if (VIEWS.size === 0 || gci.family.genericSplitBase === true || args.length !== gci.typeParams.length) return null;
  const name = gci.family.def.name;
  let found: ViewRec | null = null;
  for (const rec of VIEWS.values()) {
    if (rec.declName !== name) continue;
    let ok = true;
    for (let i = 0; i < args.length; i++) {
      if (rec.erased[i]) continue;
      if (rec.args[i] !== args[i]) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    if (found !== null) return null;
    found = rec;
  }
  return found === null ? null : ensureView(L, gci, found);
}

/** Runs `fn` with erased-view mapping off: `new Foo<string, unknown>()` and `extends Foo<string, unknown>` mean the monomorph. */
export function withoutErasedViews<T>(fn: () => T): T {
  bypassDepth++;
  try {
    return fn();
  } finally {
    bypassDepth--;
  }
}

/** Does `t` mention one of the erased type parameters, or anything the walk cannot read (the safe answer is yes: the method then
 * carries no slot and a call on the view keeps its refusal)? `this` types mention (they are the instantiation itself). */
function mentionsErased(L: Lowerer, t: ts.Type, erasedSyms: ReadonlySet<ts.Symbol>, depth: number): boolean {
  if (depth > 6) return true;
  const f = t.flags;
  if ((f & ts.TypeFlags.TypeParameter) !== 0) {
    const sym = t.getSymbol();
    return sym === undefined || (sym.flags & ts.SymbolFlags.TypeParameter) === 0 || erasedSyms.has(sym);
  }
  if ((f & ts.TypeFlags.Union) !== 0) return ts.constituentTypes(t).some((c) => mentionsErased(L, c, erasedSyms, depth + 1));
  if ((f & ts.TypeFlags.Intersection) !== 0) return true;
  if ((f & ts.TypeFlags.Object) !== 0) {
    const of = (t as ts.ObjectType).objectFlags;
    if ((of & ts.ObjectFlags.Reference) !== 0) {
      let args: readonly ts.Type[];
      try {
        args = L.checker.getTypeArguments(t as ts.TypeReference);
      } catch {
        return true;
      }
      return args.some((a) => mentionsErased(L, a, erasedSyms, depth + 1));
    }
    if ((of & (ts.ObjectFlags.Anonymous | ts.ObjectFlags.Mapped | ts.ObjectFlags.ObjectLiteral)) !== 0) return true;
    return false;
  }
  // Conditional, indexed access, substitution and the rest: unreadable.
  const plain =
    ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.String | ts.TypeFlags.Number | ts.TypeFlags.Boolean |
    ts.TypeFlags.Enum | ts.TypeFlags.BigInt | ts.TypeFlags.StringLiteral | ts.TypeFlags.NumberLiteral |
    ts.TypeFlags.BooleanLiteral | ts.TypeFlags.EnumLiteral | ts.TypeFlags.BigIntLiteral | ts.TypeFlags.ESSymbol |
    ts.TypeFlags.UniqueESSymbol | ts.TypeFlags.Void | ts.TypeFlags.Undefined | ts.TypeFlags.Null | ts.TypeFlags.Never |
    ts.TypeFlags.NonPrimitive;
  return (f & plain) === 0;
}

function viewMethodCandidate(L: Lowerer, fam: ClassInfo, member: ts.ClassElement, erasedSyms: ReadonlySet<ts.Symbol>): member is ts.MethodDeclaration {
  if (!ts.isMethodDeclaration(member) || member.body === undefined || !ts.isIdentifier(member.name)) return false;
  if (member.typeParameters !== undefined || member.asteriskToken !== undefined || isJsSourceFile(member.getSourceFile())) return false;
  const mods = ts.getModifiers(member) ?? [];
  for (const m of mods) {
    if (
      m.kind === ts.SyntaxKind.StaticKeyword || m.kind === ts.SyntaxKind.PrivateKeyword || m.kind === ts.SyntaxKind.AbstractKeyword ||
      m.kind === ts.SyntaxKind.AsyncKeyword || m.kind === ts.SyntaxKind.DeclareKeyword
    ) {
      return false;
    }
  }
  if (member.modifiers?.some((m) => m.kind === ts.SyntaxKind.Decorator) === true) return false;
  const name = member.name.text;
  if (name === "constructor" || fam.fields.has(name) || L.findMethodOn(fam, name) !== null || findGenericMethodOn(L, fam, name) !== null) return false;
  for (const p of member.parameters) {
    if (p.dotDotDotToken !== undefined || !ts.isIdentifier(p.name)) return false;
    if (mentionsErased(L, L.checker.getTypeAtLocation(p), erasedSyms, 0)) return false;
  }
  const sig = L.checker.getSignatureFromDeclaration(member);
  if (sig === undefined) return false;
  return !mentionsErased(L, L.checker.getReturnTypeOfSignature(sig), erasedSyms, 0);
}

function ensureView(L: Lowerer, gci: GenericClassInfo, rec: ViewRec): ClassInfo {
  const have = gci.views?.get(rec.key);
  if (have !== undefined) return have;
  const fam = gci.family;
  const views = (gci.views ??= new Map());
  const name = `${fam.def.name}%v${views.size}`;
  const methods = new Map<string, MethodSig>();
  const info: ClassInfo = {
    ...fam,
    def: {
      ...fam.def,
      name,
      base: fam.def.name,
      genericOf: fam.def.name,
      abstract: true,
    },
    fields: new Map(fam.fields),
    fieldOrder: [],
    methods,
    base: fam,
    subclasses: [],
    throwingSetters: [],
    staticFields: [],
    generic: { decl: gci.decl, baseName: gci.baseName, typeParams: gci.typeParams, family: fam, instances: new Map(), view: true },
  };
  delete info.staticMethods;
  delete info.staticAccessors;
  delete info.staticBlocks;
  delete info.uncollectedStatics;
  delete info.genericMethods;
  delete info.genericStatics;
  delete info.classDecorators;
  delete info.genericInstance;
  delete info.genericSplitBase;
  delete info.def.methods;
  delete info.def.memberLengths;
  delete info.def.abstractMethods;
  views.set(rec.key, info);
  L.classes.set(name, info);
  fam.subclasses.push(info);

  // The slots: bind the NON-erased parameters (the signatures map under them), leave the erased ones unbound (no kept signature
  // mentions them), and collect quietly: a member that does not map simply carries no slot.
  const erasedSyms = new Set<ts.Symbol>();
  const bindings = new Map<ts.Symbol, IrType>();
  gci.typeParams.forEach((tp, i) => {
    if (rec.erased[i]) erasedSyms.add(tp);
    else {
      const m = L.mapTypeOf(rec.args[i]!);
      if (m !== null) bindings.set(tp, m);
      else erasedSyms.add(tp);
    }
  });
  const prevBindings = L.typeParamBindings;
  const prevContext = L.instantiationContext;
  const prevSink = L.diagSink;
  L.typeParamBindings = bindings;
  L.instantiationContext = `building the erased view of class '${gci.baseName}'`;
  L.diagSink = [];
  try {
    for (const member of gci.decl.members) {
      if (!viewMethodCandidate(L, fam, member, erasedSyms)) continue;
      const mName = (member.name as ts.Identifier).text;
      try {
        const sig = L.lambdaSignature(member);
        if (sig.argumentsBound === true) continue;
        methods.set(mName, { params: sig.shapes, ret: sig.funcType.ret, abstract: true });
      } catch (e) {
        if (!(e instanceof PoisonError)) throw e;
      }
    }
  } finally {
    L.typeParamBindings = prevBindings;
    L.instantiationContext = prevContext;
    L.diagSink = prevSink;
  }
  if (methods.size > 0) {
    info.def.methods = [...methods.keys()];
    info.def.abstractMethods = [...methods.keys()];
  }
  info.def.loc = locOf(gci.decl);
  return info;
}

/** The named refusal for a member read or called on a value typed at an erased view: null when the receiver is not one. */
export function erasedViewMemberRefusal(L: Lowerer, recvType: IrType | null, member: string, recvText: string): string | null {
  if (recvType === null || recvType.kind !== "object") return null;
  const info = L.classes.get(recvType.className);
  if (info?.generic?.view !== true) return null;
  const carried = [...info.methods.keys()].join(", ");
  return `'${member}' on '${recvText}', a value reached through its erased view (the view carries only the methods whose signatures do not mention the erased type parameters of '${info.generic.baseName}': ` +
    `${carried === "" ? "none here" : carried}; '${member}' is a field or a method that reads or writes the erased type, so call it on the concrete instantiation)`;
}
