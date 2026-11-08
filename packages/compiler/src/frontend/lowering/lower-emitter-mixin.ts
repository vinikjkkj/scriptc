/* `applyMixin(Y, EventEmitter)`: the ioredis shape. A helper copies every
 * own name of EventEmitter.prototype onto Y.prototype through
 * Object.defineProperty (utils/applyMixin.js). Node then makes Y an emitter
 * for every program that reads it through the EventEmitter API.
 *
 * The compiler does not model Y as an emitter-rooted class (Y extends some
 * other program class, so its layout has no ScrEmitter prefix). Instead the
 * recogniser marks Y, Y gets ONE hidden trailing field of the runtime
 * emitter type (its initializer is `new EventEmitter()`, eager, which is
 * not observable through the EventEmitter API), and an EventEmitter member
 * call on a Y receiver lowers through lowerEmitterMethodCall on that field,
 * exactly like `this.ee.emit(...)` on an ordinary field of EventEmitter type.
 *
 * Recognition is by shape: a top-level `applyMixin(Y, EventEmitter)`
 * statement whose callee is a same-file function whose body walks
 * getOwnPropertyNames and calls defineProperty. */
import * as ts from "../ts7/adapter.js";
import type { Lowerer } from "./lowerer.js";
import type { IrExpr } from "../../ir/nodes.js";
import { BOOL, EMITTER_CELL_NAMES, EMITTER_MIXIN_FIELD_NAME, RUNTIME_EMITTER_CLASS, UNDEFINED_T } from "../../ir/nodes.js";
import { locOf } from "../program.js";
import { lowerEmitterMethodCall } from "./lower-emitter.js";
import type { ClassInfo } from "./lower-classes.js";
import { dtsWitnessClassOf } from "./lower-twin-witness.js";

/** The hidden instance slot holding the ScrEmitter for a mixin-grafted class. */
export const EMITTER_MIXIN_FIELD = EMITTER_MIXIN_FIELD_NAME;

/** The EventEmitter API members a graft installs on Y (Node's prototype names). */
const EMITTER_API = new Set([
  "on", "once", "off", "emit", "addListener", "removeListener", "removeAllListeners",
  "prependListener", "prependOnceListener", "listenerCount", "listeners", "rawListeners",
  "eventNames", "setMaxListeners", "getMaxListeners",
]);

/** The helper's exact copy loop, with its two parameters named (derived, mixin):
 * the statement is compared after removing whitespace and semicolons, so the
 * JS and any reformatting agree, and any other body (an extra statement, a
 * different descriptor source, a skipped name) is not this shape. */
function canonicalCopy(d: string, m: string): string {
  return `Object.getOwnPropertyNames(${m}.prototype).forEach((name)=>{Object.defineProperty(${d}.prototype,name,Object.getOwnPropertyDescriptor(${m}.prototype,name));})`;
}
function squash(text: string): string {
  return text.replace(/\s+/g, "").replace(/;/g, "");
}
function isApplyMixinBody(fn: ts.Node): boolean {
  if (!ts.isFunctionDeclaration(fn) && !ts.isFunctionExpression(fn) && !ts.isArrowFunction(fn)) return false;
  if (fn.parameters.length !== 2 || !fn.body || !ts.isBlock(fn.body) || fn.body.statements.length !== 1) return false;
  const [p0, p1] = fn.parameters;
  if (!p0 || !p1 || !ts.isIdentifier(p0.name) || !ts.isIdentifier(p1.name)) return false;
  const stmt = fn.body.statements[0]!;
  return squash(stmt.getText()) === squash(canonicalCopy(p0.name.text, p1.name.text));
}

/** The symbol a name resolves to (aliases followed), or undefined. */
function symbolOfName(L: Lowerer, n: ts.Node): ts.Symbol | undefined {
  let sym = L.checker.getSymbolAtLocation(n);
  if (sym && (sym.flags & ts.SymbolFlags.Alias) !== 0) sym = L.checker.getAliasedSymbol(sym);
  return sym;
}

/** Strip parentheses and the `(0, f)` comma head esbuild/tsc emit around a
 * callee (`(0, applyMixin_1.default)(Redis, events_1.EventEmitter)`). */
function unwrapCallee(e: ts.Expression): ts.Expression {
  let x: ts.Expression = e;
  for (;;) {
    if (ts.isParenthesizedExpression(x)) x = x.expression;
    else if (ts.isBinaryExpression(x) && x.operatorToken.kind === ts.SyntaxKind.CommaToken) x = x.right;
    else return x;
  }
}

/** The function declaring the helper behind a callee symbol. Follows one
 * `exports.default = applyMixin` alias chain (CommonJS re-export) to the
 * declaration; null for anything that is not a plain function. */
function helperFunctionOf(L: Lowerer, sym: ts.Symbol | undefined, depth = 0): ts.Node | null {
  if (!sym || depth > 3) return null;
  for (const d of L.checker.declarationsOf(sym)) {
    // A helper shipped as a declaration (provenance: the .d.ts of the npm
    // package): its body lives in the compiled JS twin, read by name.
    if (ts.isFunctionDeclaration(d) && d.getSourceFile().isDeclarationFile) {
      const twin = d.name ? L.declTwinSourceOf(d.getSourceFile()) : null;
      const fn = twin?.statements.find(
        (st): st is ts.FunctionDeclaration => ts.isFunctionDeclaration(st) && st.name?.text === d.name?.text,
      );
      if (fn !== undefined) return fn;
      continue;
    }
    if (ts.isFunctionDeclaration(d)) return d;
    if (ts.isVariableDeclaration(d) && d.initializer && (ts.isFunctionExpression(d.initializer) || ts.isArrowFunction(d.initializer))) return d.initializer;
    if (ts.isBinaryExpression(d) && ts.isIdentifier(d.right)) {
      const inner = helperFunctionOf(L, symbolOfName(L, d.right), depth + 1);
      if (inner !== null) return inner;
    }
  }
  return null;
}

/** The grafted class identifier of a recognised `applyMixin(Y, EventEmitter)`
 * call, or null. The callee resolves to a plain function whose body is exactly
 * the descriptor copy loop, and the second argument resolves to the runtime
 * EventEmitter (bare, or a namespace member such as `events_1.EventEmitter`). */
export function emitterMixinCallTarget(L: Lowerer, call: ts.CallExpression): ts.Identifier | null {
  if (call.arguments.length !== 2) return null;
  const [target, mixin] = call.arguments;
  if (!target || !mixin || !ts.isIdentifier(target)) return null;
  const callee = unwrapCallee(call.expression);
  const calleeName = ts.isPropertyAccessExpression(callee) ? callee.name : ts.isIdentifier(callee) ? callee : null;
  if (calleeName === null) return null;
  const helper = helperFunctionOf(L, symbolOfName(L, calleeName));
  if (helper === null || !isApplyMixinBody(helper)) return null;
  const mixinName = ts.isPropertyAccessExpression(mixin) ? mixin.name : ts.isIdentifier(mixin) ? mixin : null;
  if (mixinName === null) return null;
  if (L.builtinEmitterInfoOf(symbolOfName(L, mixinName)) === null) return null;
  return target;
}

/** True when a top-level `applyMixin(<decl>, EventEmitter)` statement grafts
 * the emitter onto the class declared by `decl`. */
export function appliesEmitterMixin(L: Lowerer, decl: ts.ClassLikeDeclaration): boolean {
  if (!decl.name) return false;
  for (const st of decl.getSourceFile().statements) {
    if (!ts.isExpressionStatement(st) || !ts.isCallExpression(st.expression)) continue;
    const target = emitterMixinCallTarget(L, st.expression);
    if (target !== null && target.text === decl.name.text) return true;
  }
  return false;
}

/** True when this top-level statement is the recognised graft call itself
 * (lowered to nothing: the hidden slot already holds the emitter). */
export function isEmitterMixinStatement(L: Lowerer, stmt: ts.Statement): boolean {
  return ts.isExpressionStatement(stmt) && ts.isCallExpression(stmt.expression) &&
    stmt.parent !== undefined && ts.isSourceFile(stmt.parent) &&
    emitterMixinCallTarget(L, stmt.expression) !== null;
}

/** The hidden-field read on a receiver value. */
function slotOf(L: Lowerer, className: string, recv: IrExpr, loc: ReturnType<typeof locOf>): IrExpr {
  return {
    kind: "fieldGet",
    obj: recv,
    className,
    field: EMITTER_MIXIN_FIELD,
    type: { kind: "object", className: RUNTIME_EMITTER_CLASS },
    loc,
  };
}

/** `recv.<emitter member>(...)` on a grafted class. Null when the call is not
 * an EventEmitter member on such a receiver (the caller keeps its path). */
export function lowerEmitterMixinCall(L: Lowerer, call: ts.CallExpression): IrExpr | null {
  if (!ts.isPropertyAccessExpression(call.expression)) return null;
  const access = call.expression;
  if (access.questionDotToken !== undefined || !EMITTER_API.has(access.name.text)) return null;
  const info = graftInfoOfReceiver(L, L.typeOf(access.expression));
  if (info === null) return null;
  const emitterInfo = L.classes.get(RUNTIME_EMITTER_CLASS);
  if (!emitterInfo) return null;
  const loc = locOf(call);
  const recv = L.lowerExpr(access.expression);
  // The slot is read through the receiver's own IR class (its layout holds the
  // grafted class's fields as a prefix), so a subclass receiver type-checks.
  const recvCls = recv.type.kind === "object" ? recv.type.className : info.def.name;
  return lowerEmitterMethodCall(L, call, access, emitterInfo, undefined, slotOf(L, recvCls, recv, loc));
}

/** The grafted class a receiver type is, or null. A receiver typed by the
 * declaration file (the `.d.ts` `Redis` of an npm package) is paired with its
 * implementation class (dtsWitnessClassOf), whose ClassInfo holds the graft:
 * the same twin the applyMixin helper body was read from. */
function graftInfoOfReceiver(L: Lowerer, recvT: ts.Type): ClassInfo | null {
  const mapped = L.mapTypeOf(recvT);
  if (mapped?.kind === "object") {
    // The nearest grafted class on the receiver's chain: a subclass of a
    // grafted class holds the same slot, declared by the graft's own layout.
    for (let c: ClassInfo | null | undefined = L.classes.get(mapped.className); c; c = c.base) {
      if (c.emitterMixin === true) return c;
    }
  }
  const impl = dtsWitnessClassOf(L, recvT);
  if (impl !== null && ts.isClassDeclaration(impl) && impl.name !== undefined) {
    const sym = L.checker.getSymbolAtLocation(impl.name);
    for (let c: ClassInfo | null | undefined = sym ? L.classBySymbol.get(sym) : undefined; c; c = c.base) {
      if (c.emitterMixin === true) return c;
    }
  }
  return null;
}

/** Is `stmt` the statement `EventEmitter.call(this)` (the emitter's constructor run on `this`)? */
function isEmitterInitStatement(L: Lowerer, stmt: ts.Statement): boolean {
  if (!ts.isExpressionStatement(stmt)) return false;
  let e: ts.Expression = stmt.expression;
  while (ts.isParenthesizedExpression(e)) e = e.expression;
  if (!ts.isCallExpression(e) || !ts.isPropertyAccessExpression(e.expression) || e.expression.name.text !== "call") return false;
  if (e.arguments.length !== 1 || e.arguments[0]!.kind !== ts.SyntaxKind.ThisKeyword) return false;
  let inner: ts.Expression = e.expression.expression;
  while (ts.isParenthesizedExpression(inner) || ts.isAsExpression(inner) || ts.isAssertionExpression(inner)) {
    inner = (inner as ts.ParenthesizedExpression | ts.AsExpression | ts.TypeAssertion).expression;
  }
  const innerName = ts.isPropertyAccessExpression(inner) ? inner.name : ts.isIdentifier(inner) ? inner : null;
  return innerName !== null && L.builtinEmitterInfoOf(symbolOfName(L, innerName)) !== null;
}

/** Does a statement contain a `return` outside any nested function (it could leave the constructor before a later statement)? */
function containsReturn(n: ts.Node): boolean {
  let found = false;
  ts.walkPreorder(n, (x) => {
    if (x.kind === ts.SyntaxKind.ReturnStatement) {
      found = true;
      return "stop";
    }
    if (x !== n && (ts.isFunctionLike(x) || ts.isClassDeclaration(x) || ts.isClassExpression(x))) return "skip";
    return undefined;
  });
  return found;
}

/** The top-level `EventEmitter.call(this)` statement of a grafted class's own constructor, when every statement before
 * it is free of `return` (so the call certainly runs, once the constructor gets past it): the place the emitter's own
 * keys (_events, _eventsCount, _maxListeners) are born on every instance. Null when the class has no such statement
 * (a conditional call, a call in a method, no call: the keys then appear at a place the order record cannot state). */
export function graftCtorEmitterInit(L: Lowerer, decl: ts.ClassLikeDeclaration): ts.Statement | null {
  const ctor = decl.members.find((m): m is ts.ConstructorDeclaration => ts.isConstructorDeclaration(m) && m.body !== undefined);
  if (ctor === undefined || ctor.body === undefined) return null;
  const stmts = ctor.body.statements;
  for (let i = 0; i < stmts.length; i++) {
    const s = stmts[i]!;
    if (isEmitterInitStatement(L, s)) return s;
    if (containsReturn(s)) return null;
  }
  return null;
}

/** `(EventEmitter as any).call(this)` inside a grafted class's own declaration:
 * Node initialises the emitter's own state on `this`, and the hidden slot is
 * created eagerly by the field initialiser, so the call is a no-op. Null for
 * any other call. */
export function emitterCtorCallOnGraft(L: Lowerer, call: ts.CallExpression): IrExpr | null {
  if (!ts.isPropertyAccessExpression(call.expression) || call.expression.name.text !== "call") return null;
  let inner: ts.Expression = call.expression.expression;
  while (ts.isParenthesizedExpression(inner) || ts.isAsExpression(inner) || ts.isAssertionExpression(inner)) {
    inner = (inner as ts.ParenthesizedExpression | ts.AsExpression | ts.TypeAssertion).expression;
  }
  if (call.arguments.length !== 1 || call.arguments[0]!.kind !== ts.SyntaxKind.ThisKeyword) return null;
  const innerName = ts.isPropertyAccessExpression(inner) ? inner.name : ts.isIdentifier(inner) ? inner : null;
  if (innerName === null || L.builtinEmitterInfoOf(symbolOfName(L, innerName)) === null) return null;
  let cls: ts.Node | undefined = call.parent;
  while (cls && !ts.isClassDeclaration(cls)) cls = cls.parent;
  if (!cls || !ts.isClassDeclaration(cls) || !appliesEmitterMixin(L, cls)) return null;
  const loc = locOf(call);
  const undef: IrExpr = { kind: "unitLit", unit: "undefined", type: UNDEFINED_T, loc };
  // The statement that is the class's constructor-level init: the emitter's own keys are born here, on this
  // instance, so the order record notes them now (the member table lists them where the record puts them).
  const initStmt = graftCtorEmitterInit(L, cls);
  if (initStmt === null || !ts.isExpressionStatement(initStmt) || initStmt.getStart() > call.getStart() || initStmt.getEnd() < call.getEnd()) return undef;
  const self = L.lowerExpr(call.arguments[0]!);
  if (self.type.kind !== "object") return undef;
  const className = self.type.className;
  return {
    kind: "seqExpr",
    stmts: EMITTER_CELL_NAMES.map((field) => ({ kind: "ordNote" as const, obj: self, className, field, loc })),
    // The statement's value is discarded (the call is the constructor-level statement itself).
    result: { kind: "boolLit", value: true, type: BOOL, loc },
    type: BOOL,
    loc,
  };
}

/* ── the helper body is not a write the program can reach ────────────────────────────────────────────────────────────
 * protoescape's fence (lower-protoescape.ts) refuses a write into a `prototype` object read from a dynamic value, in a program that crosses
 * an evaluated class into untyped code. The copy loop of a recognised applyMixin helper IS such a write, but its every call site in the
 * program is a recognised graft statement lowered to nothing, so the loop can never run. That is only a proof when nothing else reaches
 * the helper, so this walks the whole program: every call that resolves to it must be a graft statement, it may be named only by its
 * declaration and by an `exports.<name> = helper` alias, and every `require` binding of its module may be used only as `<binding>.<name>`
 * where <name> is such an alias. Anything else (the helper passed as a value, a computed member of the module object, a call that is
 * not a graft) leaves the write standing for the fence to refuse. */
const graftOnlyMemo = new WeakMap<Lowerer, { file: string; start: number; end: number }[]>();

function helperDisplayName(h: ts.Node): string | null {
  if (ts.isFunctionDeclaration(h) && h.name) return h.name.text;
  const p = h.parent;
  if (p !== undefined && ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) return p.name.text;
  return null;
}

function helperOnlyGrafted(L: Lowerer, h: ts.Node, files: readonly ts.SourceFile[]): boolean {
  const name = helperDisplayName(h);
  if (name === null) return false;
  const hFile = h.getSourceFile();
  // the export names an `exports.<n> = helper` alias gives it
  const exportNames = new Set<string>();
  for (const st of hFile.statements) {
    if (!ts.isExpressionStatement(st) || !ts.isBinaryExpression(st.expression) || st.expression.operatorToken.kind !== ts.SyntaxKind.EqualsToken) continue;
    const l = st.expression.left, r = st.expression.right;
    if (ts.isIdentifier(r) && r.text === name && ts.isPropertyAccessExpression(l) && ts.isIdentifier(l.expression) &&
        (l.expression.text === "exports" || l.expression.text === "module")) {
      exportNames.add(l.name.text);
    }
  }
  const resolvesToHelper = (n: ts.Node): boolean => helperFunctionOf(L, symbolOfName(L, n)) === h;
  let ok = true;
  for (const sf of files) {
    if (!ok) break;
    if (sf.isDeclarationFile) continue;
    const text = sf.text;
    const mentions = text.includes(name) || [...exportNames].some((e) => text.includes(e));
    if (!mentions) continue;
    const moduleBindings = new Set<ts.Symbol>();
    ts.walkPreorder(sf, (n) => {
      if (!ok) return "stop";
      // a require binding of the helper's module
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer !== undefined && ts.isCallExpression(n.initializer) &&
          ts.isIdentifier(n.initializer.expression) && n.initializer.expression.text === "require") {
        const sym = L.checker.getSymbolAtLocation(n.name);
        const tsym = sym ? L.checker.getTypeOfSymbolAtLocation(sym, n.name).getSymbol() : undefined;
        const decl = tsym ? L.checker.declarationsOf(tsym)[0] : undefined;
        if (sym !== undefined && decl !== undefined && decl.getSourceFile() === hFile) moduleBindings.add(sym);
      }
      if (ts.isCallExpression(n)) {
        const callee = unwrapCallee(n.expression);
        const cn = ts.isPropertyAccessExpression(callee) ? callee.name : ts.isIdentifier(callee) ? callee : null;
        if (cn !== null && (cn.text === name || exportNames.has(cn.text)) && resolvesToHelper(cn)) {
          const stmt = n.parent;
          const asStatement = stmt !== undefined && ts.isExpressionStatement(stmt) && stmt.parent !== undefined && ts.isSourceFile(stmt.parent) && stmt.expression === n;
          if (!asStatement || emitterMixinCallTarget(L, n) === null) ok = false;
        }
      }
      return undefined;
    });
    if (!ok) break;
    // names and member reads of the helper outside call position, and uses of a module binding other than `<binding>.<exportName>`
    ts.walkPreorder(sf, (n) => {
      if (!ok) return "stop";
      if (ts.isIdentifier(n)) {
        const par = n.parent;
        if (par === undefined) return undefined;
        if (n.text === name && resolvesToHelper(n)) {
          const isDecl = (ts.isFunctionDeclaration(par) && par.name === n) || (ts.isVariableDeclaration(par) && par.name === n);
          const isAlias = ts.isBinaryExpression(par) && par.right === n && ts.isPropertyAccessExpression(par.left) &&
            ts.isIdentifier(par.left.expression) && (par.left.expression.text === "exports" || par.left.expression.text === "module");
          const isCallee = ts.isCallExpression(par) && unwrapCallee(par.expression) === n;
          const isMemberCallee = ts.isPropertyAccessExpression(par) && par.name === n;
          if (!isDecl && !isAlias && !isCallee && !isMemberCallee) ok = false;
        }
        if (moduleBindings.size > 0) {
          const sym = L.checker.getSymbolAtLocation(n);
          if (sym !== undefined && moduleBindings.has(sym)) {
            const declName = ts.isVariableDeclaration(par) && par.name === n;
            const member = ts.isPropertyAccessExpression(par) && par.expression === n && exportNames.has(par.name.text);
            if (!declName && !member) ok = false;
          }
        }
      }
      if (ts.isPropertyAccessExpression(n) && exportNames.has(n.name.text) && resolvesToHelper(n.name)) {
        let c: ts.Node = n;
        let p = c.parent;
        while (p !== undefined && (ts.isParenthesizedExpression(p) || (ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.CommaToken && p.right === c))) {
          c = p;
          p = c.parent;
        }
        const aliasLeft = p !== undefined && ts.isBinaryExpression(p) && p.left === c && p.operatorToken.kind === ts.SyntaxKind.EqualsToken;
        if (!(p !== undefined && ts.isCallExpression(p) && p.expression === c) && !aliasLeft) ok = false;
      }
      return undefined;
    });
  }
  return ok;
}

/** The source ranges of the recognised applyMixin helpers that nothing but a graft statement reaches: a write inside one never runs. */
export function graftOnlyHelperRanges(L: Lowerer): { file: string; start: number; end: number }[] {
  const memo = graftOnlyMemo.get(L);
  if (memo !== undefined) return memo;
  const out: { file: string; start: number; end: number }[] = [];
  const files = L.program.getSourceFiles();
  for (const sf of files) {
    if (sf.isDeclarationFile || !sf.text.includes("getOwnPropertyNames")) continue;
    ts.walkPreorder(sf, (n) => {
      if ((ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n)) && isApplyMixinBody(n) && helperOnlyGrafted(L, n, files)) {
        out.push({ file: sf.fileName, start: n.getStart(), end: n.end });
      }
      return undefined;
    });
  }
  graftOnlyMemo.set(L, out);
  return out;
}
