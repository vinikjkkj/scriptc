/* Per-evaluation classes: a class EXPRESSION inside a function.
 *
 * JS mints a distinct class at every evaluation: fresh identity, its own
 * captured environment, `instanceof` that tells two evaluations apart. The
 * compiler lowers the class BODY once (one IR class `%E`, one struct layout,
 * its methods and constructor as ordinary module functions) and represents each
 * EVALUATION as an object of a synthetic class `%E.%static` whose fields hold
 * the bindings the body captured:
 *
 *   - the class VALUE (`typeof E`) is that object (type `object:%E.%static`);
 *     identity `===` is the ordinary object-pointer compare, and a value of an
 *     evaluated class never mixes with the immortal `classval` representation of
 *     a top-level class;
 *   - `new V(args)` is `new %E(args..., V)`: the constructor takes the
 *     evaluation as a hidden trailing parameter and stores it in the hidden
 *     instance field `%cls` BEFORE anything else runs (a base constructor may
 *     call an override that reads a captured binding);
 *   - a captured binding read inside the body reads `this.%cls.%capN.<name>`;
 *   - `x instanceof V` is the class test against `%E` plus `x.%cls === V`;
 *   - `V.name` is the class's constant NamedEvaluation name.
 *
 * Lifetime (no GC): the evaluation object and the instances are ordinary
 * refcounted heap objects. An instance holds its evaluation (strong), the
 * evaluation holds whatever the body captured. A cycle through a captured
 * value is a cycle among ordinary objects and the existing cycle collector
 * (cycle-capable classes are decided by the type graph) owns it.
 *
 * Covered shapes: no type parameters, decorators, static members, static
 * blocks or computed names (eval-class-syntax.ts); captures are local
 * bindings that are never written after their initializer. Everything else
 * keeps a NAMED fence. */
import * as ts from "../ts7/adapter.js";
import type { Lowerer } from "./lowerer.js";
import { BOOL, EVAL_STATIC_CLASSES, IrExpr, IrStmt, IrType, STRING, VOID, typeEquals } from "../../ir/nodes.js";
import { bindingNeverReassigned } from "./lower-calls.js";
import { locOf } from "../program.js";
import { evalClassSyntaxOk, evalStaticClassName } from "../eval-class-syntax.js";
import { mixinFnShapeOf } from "./lower-mixins.js";
import type { ClassInfo } from "./lower-classes.js";

/** The marker `captures` entry on an evaluated class: its hidden `%cls`
 * field, filled from the constructor's trailing parameter. Never a real
 * symbol. */
export const EVAL_ENV_SYM = { name: "%evalEnv" } as unknown as ts.Symbol;

/** A class node that is the body of a MIXIN function (lower-mixins.ts keeps
 * those): the mixin machinery owns them, never the evaluated-class one. */
function isMixinClassNode(L: Lowerer, decl: ts.ClassLikeDeclaration): boolean {
  for (let p: ts.Node = decl.parent; !ts.isSourceFile(p); p = p.parent) {
    if (ts.isFunctionLike(p)) {
      if (
        (ts.isFunctionDeclaration(p) || ts.isArrowFunction(p) || ts.isFunctionExpression(p)) &&
        mixinFnShapeOf(L, p)?.classNode === decl
      ) {
        return true;
      }
    }
  }
  return false;
}

/** The type mapper's hook: this class expression is a per-evaluation class. */
export function isEvalClassNode(L: Lowerer, decl: ts.ClassLikeDeclaration): boolean {
  return evalClassSyntaxOk(decl) && !isMixinClassNode(L, decl);
}

export interface EvalClassInfo {
  /** The static-side (per-evaluation) class. */
  staticName: string;
  /** Captured bindings: the symbol, the field on the static side holding its
   * value, and the IR type. */
  caps: { sym: ts.Symbol; field: string; type: IrType }[];
  /** The generic-instantiation context the class collected under; a second
   * instantiation of the enclosing function with different bindings could
   * need a different layout and keeps a fence. */
  context: string;
}

const LOCAL_SCOPE_KINDS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.Block, ts.SyntaxKind.CaseBlock, ts.SyntaxKind.CatchClause,
  ts.SyntaxKind.ForStatement, ts.SyntaxKind.ForInStatement, ts.SyntaxKind.ForOfStatement,
]);

/** The local bindings a class expression's body (and heritage) reads, in order
 * of first appearance, every unsupported shape a named fence. */
function evalClassCaptures(L: Lowerer, expr: ts.ClassExpression): ts.Symbol[] {
  const out: ts.Symbol[] = [];
  const selfSym = expr.name ? L.checker.getSymbolAtLocation(expr.name) : undefined;
  ts.walkPreorder(expr, (n) => {
    if (!ts.isIdentifier(n)) return undefined;
    // Property names and member names are not references.
    const par = n.parent;
    if (
      (ts.isPropertyAccessExpression(par) && par.name === n) ||
      (ts.isQualifiedName(par) && par.right === n) ||
      ((ts.isPropertyAssignment(par) || ts.isPropertyDeclaration(par) || ts.isMethodDeclaration(par) ||
        ts.isGetAccessorDeclaration(par) || ts.isSetAccessorDeclaration(par) || ts.isPropertySignature(par)) && par.name === n) ||
      (ts.isBindingElement(par) && par.propertyName === n)
    ) {
      return undefined;
    }
    const s = L.checker.getSymbolAtLocation(n);
    if (s === undefined || s === selfSym || out.includes(s)) return undefined;
    const decls = L.checker.declarationsOf(s);
    if (decls.length === 0) return undefined;
    for (const d of decls) {
      if (d.getSourceFile() !== expr.getSourceFile()) continue;
      if (d.pos >= expr.pos && d.end <= expr.end) continue; // declared inside the class
      if (ts.isInterfaceDeclaration(d) || ts.isTypeAliasDeclaration(d) || ts.isTypeParameterDeclaration(d)) continue;
      const isBinding =
        ts.isVariableDeclaration(d) || ts.isParameter(d) || ts.isFunctionDeclaration(d) ||
        ts.isClassDeclaration(d) || ts.isBindingElement(d) || ts.isEnumDeclaration(d);
      if (!isBinding) continue; // a property/method symbol: not a binding
      let local = false;
      for (let p: ts.Node | undefined = d.parent; p !== undefined && !ts.isSourceFile(p); p = p.parent) {
        if (ts.isFunctionLike(p) || LOCAL_SCOPE_KINDS.has(p.kind)) { local = true; break; }
        if (ts.isModuleBlock(p)) break;
      }
      if (!local) continue; // module-level binding: reached as a global
      const plain =
        (ts.isVariableDeclaration(d) && ts.isIdentifier(d.name)) ||
        (ts.isParameter(d) && ts.isIdentifier(d.name) && !d.dotDotDotToken) ||
        ts.isFunctionDeclaration(d);
      if (!plain) {
        L.unsupported(
          "SC1090",
          n,
          `class expressions inside functions that capture '${s.name}' (a destructured, rest, class or enum binding — only plain variables, parameters and functions are carried by the per-evaluation class)`,
        );
      }
      if (!ts.isFunctionDeclaration(d)) {
        if (d.pos <= expr.pos && d.end >= expr.end) {
          L.unsupported("SC1090", n, `class expressions inside functions that read '${s.name}' while it is being initialized`);
        }
        if (d.end > expr.pos) {
          L.unsupported(
            "SC1090",
            n,
            `class expressions inside functions that capture '${s.name}' before its declaration (the evaluation copies the binding when the class is created)`,
          );
        }
      }
      if (!bindingNeverReassigned(L, s, d)) {
        L.unsupported(
          "SC1090",
          n,
          `class expressions inside functions that capture '${s.name}', a binding written after its initializer (the per-evaluation class copies each captured binding)`,
        );
      }
      out.push(s);
      break;
    }
    return undefined;
  });
  return out;
}

/** Collects a class expression that sits inside a function, ON DEMAND: from
 * its evaluation site or from the first type mapping that names it (a use site
 * can lower before the enclosing function's body does). Captured bindings are
 * typed by the checker like a lifted local class's, so no frame is needed;
 * the evaluation site coerces the live value into that field type.
 * Idempotent per node. The static-side class registers alongside. */
export function ensureEvalClass(L: Lowerer, expr: ts.ClassExpression): ClassInfo {
  const cached = L.exprClassInfoByNode.get(expr);
  if (cached) return cached;
  const capSyms = evalClassCaptures(L, expr);
  const loc = locOf(expr);
  const className = L.classNamer(expr);
  const staticName = evalStaticClassName(className);
  const caps: EvalClassInfo["caps"] = [];
  capSyms.forEach((s, i) => {
    const csT = L.checker.getTypeOfSymbolAtLocation(s, expr);
    const mapped = L.mapTypeOf(csT) ?? dynFallbackType(L, expr, csT);
    if (!mapped || mapped.kind === "void") L.badType(expr, csT);
    caps.push({ sym: s, field: `%cap${i}.${s.name}`, type: mapped });
  });
  const plan: EvalClassInfo = { staticName, caps, context: L.instantiationContext ?? "" };
  L.evalClassPlans.set(expr, plan);
  L.collectClassShapeInner(expr, namedEvaluationNameOf(expr));
  const info = L.classes.get(className);
  if (!info) throw new PoisonError(); // collection poisoned and reported
  info.evalClass = plan;
  // The static side: an ordinary standalone class. Its fields are the
  // captured bindings (hidden, set by the constructor's trailing parameters)
  // then the class's static fields in declaration order; its methods are the
  // static methods, lowered as instance methods whose `this` is the
  // evaluation. Constructing it IS evaluating the class: captures are stored,
  // then the static initializers run in order with `this` = the new class.
  if (
    (info.uncollectedStatics?.size ?? 0) > 0 || (info.staticAccessors?.size ?? 0) > 0 ||
    (info.genericStatics?.size ?? 0) > 0 || (info.staticBlocks?.length ?? 0) > 0
  ) {
    L.unsupported("SC1090", expr, "class expressions inside functions with static accessors, private statics or static blocks");
  }
  const fields = new Map<string, IrType>();
  for (const c of caps) fields.set(c.field, c.type);
  const defFields = caps.map((c) => ({ name: c.field, type: c.type }));
  const fieldOrder: ClassInfo["fieldOrder"] = caps.map((c) => ({ name: c.field, type: c.type, initializer: undefined }));
  for (const sf of info.staticFields) {
    if (fields.has(sf.name)) L.unsupported("SC1090", sf.decl, `a static member '${sf.name}' that shadows a captured binding's slot`);
    fields.set(sf.name, sf.type);
    defFields.push({ name: sf.name, type: sf.type });
    fieldOrder.push({ name: sf.name, type: sf.type, initializer: sf.initializer });
  }
  const methods = new Map<string, import("./lower-classes.js").MethodSig>();
  for (const [name, sm] of info.staticMethods ?? []) {
    if (fields.has(name)) L.unsupported("SC1090", sm.member, `a static method '${name}' that shares its name with a static field`);
    methods.set(name, { params: sm.params, ret: sm.ret });
  }
  const staticInfo: ClassInfo = {
    def: {
      name: staticName,
      jsName: info.def.jsName ?? "",
      fields: defFields,
      ...(methods.size > 0 ? { methods: [...methods.keys()] } : {}),
      loc,
    },
    fields,
    fieldOrder,
    methods,
    decl: expr,
    ctor: null,
    ctorParams: [],
    base: null,
    subclasses: [],
    throwingSetters: [],
    staticFields: [],
    captures: caps.map((c) => ({ sym: c.sym, field: c.field, type: c.type })),
    evalStaticOf: info,
  };
  // The instance class keeps no static storage: its statics live on the
  // evaluation, so no module global or `%C.static:m` function exists for them.
  info.staticFields = [];
  delete info.staticMethods;
  L.classes.set(staticName, staticInfo);
  EVAL_STATIC_CLASSES.add(staticName);
  L.exprClassInfoByNode.set(expr, info);
  L.exprClasses.push(info);
  L.onExprClassCollected?.(info);
  L.exprClasses.push(staticInfo);
  L.onExprClassCollected?.(staticInfo);
  return info;
}

/** The type mapper's on-demand hook: collect, swallowing a poison (its
 * diagnostic is recorded; the type then names an unregistered class, the
 * fenced-class story). */
export function evalClassNodeHook(L: Lowerer, decl: ts.ClassLikeDeclaration): boolean {
  if (!isEvalClassNode(L, decl)) return false;
  const expr = decl as ts.ClassExpression;
  if (L.exprClassInfoByNode.has(expr) || L.evalClassPlans.has(expr)) return true;
  // While the program's declared classes are still being collected, a base
  // class (an import from another module) may not be registered yet: the type
  // names the class, and the collection happens at the first mapping after
  // the window (or at the evaluation site).
  if (L.collectingClassDecls) return true;
  try {
    ensureEvalClass(L, expr);
  } catch (e) {
    if (!(e instanceof PoisonError)) throw e;
  }
  return true;
}

import { PoisonError, dynFallbackType } from "./lowerer.js";
import { namedEvaluationNameOf } from "./lower-classes.js";

/** The expression `class …` evaluates to: a fresh static-side object holding
 * the captured bindings' CURRENT values. */
export function lowerEvalClassExpr(L: Lowerer, expr: ts.ClassExpression, info: ClassInfo): IrExpr {
  const plan = info.evalClass!;
  const loc = locOf(expr);
  const objT: IrType = { kind: "object", className: plan.staticName };
  // The constructor stores the captured values, then runs the static field
  // initializers in order.
  const args = plan.caps.map((c) => {
    const raw = L.capturedBindingRead(c.sym, expr);
    return typeEquals(raw.type, c.type) ? raw : L.coerceInto(expr, raw, c.type);
  });
  L.noteEdge(`%${plan.staticName}.constructor`);
  return { kind: "new", className: plan.staticName, args, type: objT, loc };
}

/** True for an object type naming a per-evaluation static side. */
export function evalStaticInfoOf(L: Lowerer, t: IrType): ClassInfo | null {
  if (t.kind !== "object") return null;
  const info = L.classes.get(t.className);
  return info?.evalStaticOf !== undefined ? info : null;
}

/** `new V(args)` where V is an evaluation object: construct the instance class
 * with the evaluation as the hidden trailing argument. */
export function lowerEvalClassNew(L: Lowerer, expr: ts.NewExpression, staticInfo: ClassInfo): IrExpr {
  const inst = staticInfo.evalStaticOf!;
  const loc = locOf(expr);
  let callee = L.lowerExpr(expr.expression);
  const stmts: IrStmt[] = [];
  if (callee.kind !== "varRef") {
    // Evaluated before the arguments, like JS.
    const tmp = L.declareHiddenLocal("%newtarget", callee.type);
    stmts.push({ kind: "varDecl", localId: tmp.id, init: callee, loc });
    callee = { kind: "varRef", localId: tmp.id, type: callee.type, loc };
  }
  L.noteEdge(`%${inst.def.name}.constructor`);
  const args = L.completeArgs(expr.arguments ?? [], inst.ctorParams, loc, expr);
  args.push(callee);
  const made: IrExpr = { kind: "new", className: inst.def.name, args, type: { kind: "object", className: inst.def.name }, loc };
  return stmts.length === 0 ? made : { kind: "seqExpr", stmts, result: made, type: made.type, loc };
}

export { STRING, VOID };

/** `V.<member>` where V is an evaluation object: `name` is the class's
 * constant NamedEvaluation name; every other member (Function.prototype's
 * `length`/`call`/`prototype`, ...) keeps a named fence. */
export function lowerEvalClassProperty(L: Lowerer, expr: ts.PropertyAccessExpression, staticInfo: ClassInfo): IrExpr | null {
  const loc = locOf(expr);
  const inst = staticInfo.evalStaticOf!;
  const member = expr.name.text;
  // A static field or method is an ordinary member of the evaluation object.
  if (staticInfo.fields.has(member) || staticInfo.methods.has(member)) return null;
  if (member !== "name") {
    L.unsupported("SC1090", expr, `the member '${member}' of a class value minted by a class expression inside a function (only '.name' and the declared statics are carried by the per-evaluation class)`);
  }
  const recv = L.lowerExpr(expr.expression);
  const name: IrExpr = { kind: "strLit", value: inst.def.jsName ?? "", type: STRING, loc };
  if (recv.kind === "varRef") return name;
  return { kind: "seqExpr", stmts: [{ kind: "exprStmt", expr: recv, loc }], result: name, type: STRING, loc };
}

/** `x instanceof V` where V is an evaluation object: x must be an instance of
 * the evaluated class AND carry this very evaluation. */
export function lowerEvalClassInstanceOf(L: Lowerer, expr: ts.BinaryExpression, staticInfo: ClassInfo, loc: import("../../ir/nodes.js").SrcLoc): IrExpr {
  const inst = staticInfo.evalStaticOf!;
  const left = L.lowerExpr(expr.left);
  if (left.type.kind !== "object") {
    L.unsupported("SC1090", expr, "'instanceof' on values other than class instances (narrow union-typed values first)");
  }
  const stmts: IrStmt[] = [];
  let leftRef: IrExpr = left;
  if (left.kind !== "varRef") {
    const tmp = L.declareHiddenLocal("%iofl", left.type);
    stmts.push({ kind: "varDecl", localId: tmp.id, init: left, loc });
    leftRef = { kind: "varRef", localId: tmp.id, type: left.type, loc };
  }
  let right = L.lowerExpr(expr.right);
  if (right.kind !== "varRef") {
    const tmp = L.declareHiddenLocal("%iofr", right.type);
    stmts.push({ kind: "varDecl", localId: tmp.id, init: right, loc });
    right = { kind: "varRef", localId: tmp.id, type: right.type, loc };
  }
  const leftClass = left.type.className;
  const instT: IrType = { kind: "object", className: inst.def.name };
  const finish = (result: IrExpr): IrExpr =>
    stmts.length === 0 ? result : { kind: "seqExpr", stmts, result, type: BOOL, loc };
  const sameOrBelow = leftClass === inst.def.name || L.isSubclassOf(leftClass, inst.def.name);
  const above = L.isSubclassOf(inst.def.name, leftClass);
  if (!sameOrBelow && !above) return finish({ kind: "boolLit", value: false, type: BOOL, loc });
  const clsOf = (obj: IrExpr): IrExpr => ({
    kind: "fieldGet", obj, className: inst.def.name, field: "%cls",
    type: { kind: "object", className: staticInfo.def.name }, loc,
  });
  const sameEval = (obj: IrExpr): IrExpr => ({ kind: "bin", op: "===", left: clsOf(obj), right, type: BOOL, loc });
  if (sameOrBelow) return finish(sameEval(leftRef));
  // The operand is a strict ancestor's type: it may hold some other class.
  const test: IrExpr = { kind: "instanceOf", value: leftRef, className: inst.def.name, type: BOOL, loc };
  const down: IrExpr = { kind: "downcast", value: leftRef, type: instT, loc };
  return finish({ kind: "logical", op: "&&", left: test, right: sameEval(down), type: BOOL, loc });
}
