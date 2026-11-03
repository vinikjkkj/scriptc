/* NEVER-RUN RUN-TIME REQUIRE: a `require(e)` whose specifier is a run-time
 * value is a compile refusal (SC2020), because the module it would answer is
 * a namespace object a linked program has no value for. The one case that is
 * exact WITHOUT such a value is a require that provably never executes.
 *
 * The shape (protobufjs `inquire`, bundled by esbuild into zapo's
 * spec/proto):
 *
 *   t.exports = function (e) { try { return require(e) } catch { return null } }
 *
 * The function F holding the require is stored into a CommonJS module
 * object, read back by esbuild's `__commonJS` wrapper, returned from it, and
 * stored in a field of the util object. Nothing ever reads that field. The
 * deadreq slice (2026-10-28) showed a store-only field proof cannot close
 * it, because F flows through the wrapper and the util object is exported to
 * the rest of the bundle. This module closes it with a whole-file value-flow
 * proof instead.
 *
 * WHAT IS PROVED. F is never invoked: no call, construct, `.call` /
 * `.apply` / `.bind`, or hand-off to code the proof cannot see is reachable
 * from F's value. Every proof step is fail-closed: any construct the proof
 * does not model, met on a path that carries F (or an object that holds F),
 * makes the proof fail and the refusal stays.
 *
 * THE MODEL.
 *  - Abstract values are strings: `o:<site>` an object literal, `m:<site>` /
 *    `u:<site>` the module object and the initial exports object of an
 *    esbuild-wrapper instance, `f:<site>` a function, `i:<site>` a wrapper
 *    instance (callable, answers the module's exports), `H` the esbuild
 *    helper itself, and `T`, the top value: anything the proof does not
 *    model, which by the invariant below is never sensitive.
 *  - The esbuild helper `r = (cb, mod) => function () { return mod ||
 *    (0, cb[getOwnPropertyNames(cb)[0]])((mod = {exports: {}}).exports, mod),
 *    mod.exports }` is recognised by its exact shape (names alpha-renamed,
 *    `getOwnPropertyNames` checked to be the global's), and `r({key(e, t)
 *    {...}})` is modelled directly: the callback's two parameters are the
 *    instance's exports object and module object, and a call of the
 *    instance answers the module's `exports` slot as it stands after the
 *    callback ran (the initial exports object only when the instance can be
 *    re-entered during its own initialisation, or when the callback never
 *    stores `exports`).
 *  - SENSITIVE values are F itself and every object with a slot that holds
 *    a sensitive value. Sensitive facts are propagated to a fixpoint from F:
 *    to variables (every reference), to object slots (every read of that
 *    name whose base can be the object), to call results of functions whose
 *    callers are all visible, to parameters of resolved callees, and to
 *    `this` of resolved method callees.
 *  - Every OCCURRENCE of a sensitive value must sit in a context the proof
 *    models (see classify): a harmless test (`typeof`, `!`, `===`, a
 *    condition), a propagating context (parentheses, `||`, `&&`, `?:`,
 *    comma, assignment, a variable initialiser, a visible return), a
 *    property read or method call on a sensitive object with a literal name,
 *    or an argument of a fully resolved callee. A call or construct OF F, an
 *    escape into an unresolved callee, an unresolved store base, an array or
 *    object literal, a spread, a destructuring, a computed key on a
 *    sensitive object, `for-in`, `delete`, an update expression, arithmetic,
 *    a throw: all fail the proof.
 *  - INVARIANT: a value the proof calls `T` is never sensitive. It holds
 *    because every way a sensitive value can reach any other place is one of
 *    the classified occurrence contexts, and a hand-off the proof cannot
 *    follow fails. Direct `eval` and `with` anywhere in the file fail the
 *    proof up front.
 *
 * All walks are iterative (explicit stacks); the solver is a monotone
 * fixpoint, so a failure met on a partial state is also a failure on the
 * final one. */
import * as ts from "../ts7/adapter.js";
import { DYN, BOOL, IrExpr, SrcLoc, STRING } from "../../ir/nodes.js";
import { probeNodeRequireRefusal } from "../npm.js";
import { relativeRequireRefusal } from "../require-throws.js";
import { nodeThrowExpr } from "./lowerer.js";
import type { Lowerer } from "./lowerer.js";
import { refusalMessage } from "./lower-requirestack.js";

const OBJECT_PROTO_NAMES = new Set([
  "constructor", "hasOwnProperty", "isPrototypeOf", "propertyIsEnumerable", "toLocaleString", "toString", "valueOf",
  "__defineGetter__", "__defineSetter__", "__lookupGetter__", "__lookupSetter__", "__proto__",
]);
/** Object.prototype members that, called on a sensitive object, neither run
 * user code nor hand the receiver anywhere. */
const HARMLESS_PROTO_CALLS = new Set(["hasOwnProperty", "isPrototypeOf", "propertyIsEnumerable", "toString", "toLocaleString"]);

class Fail extends Error {}

function fail(why: string): never {
  throw new Fail(why);
}

function key(n: ts.Node): string {
  return `${n.pos}:${n.end}:${n.kind}`;
}

function strip(e: ts.Expression): ts.Expression {
  let x = e;
  while (ts.isParenthesizedExpression(x)) x = x.expression;
  return x;
}

function isFunctionNode(n: ts.Node): boolean {
  return (
    n.kind === ts.SyntaxKind.FunctionDeclaration ||
    n.kind === ts.SyntaxKind.FunctionExpression ||
    n.kind === ts.SyntaxKind.ArrowFunction ||
    n.kind === ts.SyntaxKind.MethodDeclaration ||
    n.kind === ts.SyntaxKind.GetAccessor ||
    n.kind === ts.SyntaxKind.SetAccessor ||
    n.kind === ts.SyntaxKind.Constructor
  );
}

function enclosingFunction(n: ts.Node): ts.Node | undefined {
  let p = n.parent;
  while (p !== undefined && !isFunctionNode(p)) p = p.parent;
  return p;
}

const HELPER_RE = /^\((\w+),(\w+)\)=>function\w*\(\)\{return\2\|\|\(0,\1\[(\w+)\(\1\)\[0\]\]\)\(\(\2=\{exports:\{\}\}\)\.exports,\2\),\2\.exports\}$/;

interface Inst {
  call: ts.CallExpression;
  cb: ts.Node;
  site: string;
}

interface FileIndex {
  sf: ts.SourceFile;
  /** Reference identifiers by text. */
  idsByText: Map<string, ts.Identifier[]>;
  /** Property accesses with a literal name, by name (reads and writes). */
  accessesByName: Map<string, ts.Node[]>;
  /** Element accesses whose key is not a string literal. */
  computed: ts.Node[];
  /** [pos, end) of the esbuild helper arrows (their bodies are modelled). */
  helperRanges: Array<[number, number]>;
  helperKeys: Set<string>;
  helperNodes: ts.Node[];
  badConstruct: string | null;
}

function isNameChild(id: ts.Node): boolean {
  const p = id.parent;
  if (p === undefined) return false;
  switch (p.kind) {
    case ts.SyntaxKind.PropertyAccessExpression:
      return (p as ts.PropertyAccessExpression).name === id || key((p as ts.PropertyAccessExpression).name) === key(id);
    case ts.SyntaxKind.PropertyAssignment:
    case ts.SyntaxKind.MethodDeclaration:
    case ts.SyntaxKind.GetAccessor:
    case ts.SyntaxKind.SetAccessor:
    case ts.SyntaxKind.PropertyDeclaration:
    case ts.SyntaxKind.EnumMember:
      return key((p as ts.PropertyAssignment).name) === key(id);
    case ts.SyntaxKind.BindingElement:
      return (p as ts.BindingElement).propertyName !== undefined && key((p as ts.BindingElement).propertyName!) === key(id);
    case ts.SyntaxKind.LabeledStatement:
    case ts.SyntaxKind.BreakStatement:
    case ts.SyntaxKind.ContinueStatement:
      return true;
    default:
      return false;
  }
}

function isDeclName(id: ts.Node): boolean {
  const p = id.parent;
  if (p === undefined) return false;
  switch (p.kind) {
    case ts.SyntaxKind.VariableDeclaration:
    case ts.SyntaxKind.Parameter:
    case ts.SyntaxKind.FunctionDeclaration:
    case ts.SyntaxKind.FunctionExpression:
    case ts.SyntaxKind.BindingElement:
    case ts.SyntaxKind.ClassDeclaration:
    case ts.SyntaxKind.ClassExpression:
      return (p as ts.VariableDeclaration).name !== undefined && key((p as ts.VariableDeclaration).name) === key(id);
    default:
      return false;
  }
}

function buildIndex(sf: ts.SourceFile): FileIndex {
  const idx: FileIndex = {
    sf,
    idsByText: new Map(),
    accessesByName: new Map(),
    computed: [],
    helperRanges: [],
    helperKeys: new Set(),
    helperNodes: [],
    badConstruct: null,
  };
  const stack: ts.Node[] = [sf];
  const kids: ts.Node[] = [];
  while (stack.length > 0) {
    const n = stack.pop()!;
    if (n.kind === ts.SyntaxKind.ArrowFunction && n.end - n.pos < 300) {
      const txt = sf.text.slice(n.pos, n.end).replace(/\s+/g, "");
      const m = HELPER_RE.exec(txt);
      if (m !== null) {
        idx.helperRanges.push([n.pos, n.end]);
        idx.helperKeys.add(key(n));
        idx.helperNodes.push(n);
        continue;
      }
    }
    switch (n.kind) {
      case ts.SyntaxKind.WithStatement:
        idx.badConstruct = "a with statement";
        break;
      case ts.SyntaxKind.ImportDeclaration:
      case ts.SyntaxKind.ExportDeclaration:
      case ts.SyntaxKind.ExportAssignment:
      case ts.SyntaxKind.ImportEqualsDeclaration:
      case ts.SyntaxKind.ExportSpecifier:
        idx.badConstruct = "ES module import/export syntax";
        break;
      case ts.SyntaxKind.Identifier: {
        const id = n as ts.Identifier;
        if (id.text === "eval" && !isNameChild(id)) idx.badConstruct = "a direct eval";
        if (!isNameChild(id) && !isDeclName(id)) {
          let a = idx.idsByText.get(id.text);
          if (a === undefined) idx.idsByText.set(id.text, (a = []));
          a.push(id);
        }
        break;
      }
      case ts.SyntaxKind.PropertyAccessExpression: {
        const nm = (n as ts.PropertyAccessExpression).name.text;
        let a = idx.accessesByName.get(nm);
        if (a === undefined) idx.accessesByName.set(nm, (a = []));
        a.push(n);
        break;
      }
      case ts.SyntaxKind.ElementAccessExpression: {
        const arg = (n as ts.ElementAccessExpression).argumentExpression;
        if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) {
          let a = idx.accessesByName.get(arg.text);
          if (a === undefined) idx.accessesByName.set(arg.text, (a = []));
          a.push(n);
        } else idx.computed.push(n);
        break;
      }
    }
    kids.length = 0;
    n.forEachChild((c) => {
      kids.push(c);
    });
    for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]!);
  }
  return idx;
}

const indexCache = new WeakMap<object, Map<string, FileIndex>>();

function indexOf(L: Lowerer, sf: ts.SourceFile): FileIndex {
  let m = indexCache.get(L);
  if (m === undefined) indexCache.set(L, (m = new Map()));
  const have = m.get(sf.fileName);
  if (have !== undefined && have.sf.text.length === sf.text.length) return have;
  const built = buildIndex(sf);
  m.set(sf.fileName, built);
  return built;
}

const verdictCache = new WeakMap<object, Map<string, ProvenRequire | string>>();

/** What the whole-file proof established about a run-time require. */
export interface ProvenRequire {
  /** Every call site of the enclosing function F (empty: F is never invoked). */
  calls: ts.CallExpression[];
}

/** The proof for the run-time require `call`: every way its enclosing
 * function can be invoked (none, or a closed list of visible call sites), or
 * the reason the proof failed. */
export function proveRuntimeRequire(L: Lowerer, call: ts.CallExpression): ProvenRequire | string {
  const sf = call.getSourceFile();
  const f = enclosingFunction(call);
  if (f === undefined) return "the require is not inside a function";
  const vk = `${sf.fileName}#${key(f)}`;
  let vm = verdictCache.get(L);
  if (vm === undefined) verdictCache.set(L, (vm = new Map()));
  const have = vm.get(vk);
  if (have !== undefined) return have;
  let verdict: ProvenRequire | string;
  try {
    verdict = { calls: new Prover(L, indexOf(L, sf), f, call).run() };
  } catch (e) {
    if (e instanceof Fail) verdict = e.message;
    else throw e;
  }
  vm.set(vk, verdict);
  return verdict;
}

type VS = Set<string>;
const TOP = "T";
/** A primitive (null, undefined, a number, a string, a boolean): calling one
 * throws, and it carries nothing. */
const PRIM = "P";

class Prover {
  private readonly symCache = new Map<string, string>();
  private readonly refsCache = new Map<string, Map<string, ts.Identifier[]>>();
  private readonly insts = new Map<string, Inst>();
  private readonly instByCb = new Map<string, Inst>();
  private readonly fnNodes = new Map<string, ts.Node>();
  private readonly litNodes = new Map<string, ts.ObjectLiteralExpression>();

  private memo = new Map<string, VS>();
  private inProgress = new Set<string>();
  /** The least fixpoint, built up across rounds: a query that meets itself
   * answers what it has so far, and the next round answers more. */
  private partial = new Map<string, VS>();
  private slotMemo = new Map<string, VS>();
  private slotInProgress = new Set<string>();

  private sensSyms = new Set<string>();
  private sensSlots = new Map<string, Set<string>>();
  private sensRets = new Set<string>();
  private sensThis = new Set<string>();
  /** The sensitive objects each method may receive as `this`. */
  private thisVals = new Map<string, Set<string>>();
  private changed = false;
  private readonly fVal: string;
  /** The visible call sites of F (callee position), by node key. */
  private readonly fCalls = new Map<string, ts.CallExpression>();

  constructor(
    private readonly L: Lowerer,
    private readonly idx: FileIndex,
    private readonly fnode: ts.Node,
    private readonly req: ts.CallExpression,
  ) {
    this.fVal = this.fnVal(fnode);
  }

  /* ---------------------------------------------------------------- run */

  run(): ts.CallExpression[] {
    if (this.idx.badConstruct !== null) fail(`the file has ${this.idx.badConstruct}`);
    const fn = this.fnode;
    if (this.fVal === "H") fail("the function is the esbuild helper");
    if (this.instByCbNode(fn) !== undefined) fail("the require is in a module body, which runs when the module initialises");
    if (fn.kind === ts.SyntaxKind.MethodDeclaration || fn.kind === ts.SyntaxKind.GetAccessor || fn.kind === ts.SyntaxKind.SetAccessor || fn.kind === ts.SyntaxKind.Constructor) {
      fail("the function is a method or accessor");
    }
    // The wrapper callbacks are discovered lazily by evaluating the helper
    // calls; register every one up front so a callback is never mistaken for
    // an unknown function.
    this.registerAllInsts();
    for (let round = 0; round < 64; round++) {
      this.changed = false;
      this.memo = new Map();
      this.slotMemo = new Map();
      this.round();
      if (!this.changed) {
        const calls = [...this.fCalls.values()];
        if (calls.length > 0) this.checkClosedForm();
        return calls;
      }
    }
    fail("the fixpoint did not settle");
  }

  /** F is invoked: its require must be `require(e)` with `e` the never
   * reassigned first parameter, so the call sites' first arguments are the
   * whole set of specifiers that reach it. */
  private checkClosedForm(): void {
    const f = this.fnode as ts.FunctionDeclaration;
    if ((this.fnode.kind as number) === (ts.SyntaxKind.MethodDeclaration as number)) fail("the function is a method");
    const p0 = f.parameters[0];
    if (p0 === undefined || !ts.isIdentifier(p0.name) || p0.initializer !== undefined || p0.dotDotDotToken !== undefined) fail("the function's first parameter is not a plain name");
    const arg = this.req.arguments[0];
    if (this.req.arguments.length !== 1 || arg === undefined) fail("the require does not take exactly one argument");
    const a = strip(arg);
    if (!ts.isIdentifier(a) || this.symKey(a) !== this.symKey(p0.name)) fail("the require's specifier is not the first parameter");
    if (this.usesArguments(f)) fail("the function reads `arguments`");
    const sk = this.symKey(p0.name);
    for (const ref of this.refsOfSymKey(sk)) {
      if (this.isWriteTarget(ref) || this.isOtherWrite(ref)) fail("the specifier parameter is reassigned");
    }
    for (const c of this.fCalls.values()) {
      if (c.arguments.length < 1 || c.arguments.some((x) => ts.isSpreadElement(x))) fail("a call site of the function passes no plain specifier");
    }
  }

  private round(): void {
    const occs: ts.Node[] = [];
    const fn = this.fnode;
    if (fn.kind === ts.SyntaxKind.FunctionDeclaration) {
      const nm = (fn as ts.FunctionDeclaration).name;
      if (nm === undefined) fail("an anonymous function declaration");
      this.markSym(this.symKey(nm));
    } else {
      const nm = (fn as ts.FunctionExpression).name;
      if (nm !== undefined && ts.isIdentifier(nm)) this.markSym(this.symKey(nm));
      occs.push(fn);
    }
    for (const sk of [...this.sensSyms]) {
      for (const id of this.refsOfSymKey(sk)) if (!this.isWriteTarget(id)) occs.push(id);
    }
    for (const [o, names] of [...this.sensSlots]) {
      for (const name of names) {
        for (const acc of this.idx.accessesByName.get(name) ?? []) {
          if (this.inHelper(acc) || this.isWriteTarget(acc)) continue;
          if (this.pts((acc as ts.PropertyAccessExpression).expression).has(o)) occs.push(acc);
        }
      }
    }
    // Instances whose call answers a sensitive value.
    for (const inst of this.insts.values()) {
      const res = this.instResult(inst);
      let sens = false;
      for (const v of res) if (this.isSens(v)) sens = true;
      if (sens) this.addRet("i:" + inst.site);
    }
    for (const r of [...this.sensRets]) {
      for (const c of this.callersOf(r)) occs.push(c);
    }
    for (const fk of [...this.sensThis]) {
      const f = this.fnNodes.get(fk);
      if (f === undefined) continue;
      for (const t of this.thisNodes(f)) occs.push(t);
    }
    // An object literal holding a sensitive slot is itself a sensitive value.
    for (const o of this.sensSlots.keys()) {
      const lit = this.litNodes.get(o);
      if (lit !== undefined) occs.push(lit);
    }
    for (const o of occs) this.classify(o);
    // A computed key on a sensitive object could read or write any slot.
    const sensObjs = new Set(this.sensSlots.keys());
    if (sensObjs.size > 0) {
      for (const acc of this.idx.computed) {
        if (this.inHelper(acc)) continue;
        const base = this.pts((acc as ts.ElementAccessExpression).expression);
        for (const v of base) if (sensObjs.has(v)) fail("a computed key on a sensitive object");
      }
    }
  }

  private inHelper(n: ts.Node): boolean {
    for (const [a, b] of this.idx.helperRanges) if (n.pos >= a && n.end <= b) return true;
    return false;
  }

  /* ------------------------------------------------------------ symbols */

  /** The symbol an identifier REFERS to. A shorthand property name
   * (`{ load }`) answers the property symbol from getSymbolAtLocation, so it
   * is asked for the value symbol instead; any other identifier whose symbol
   * is not a variable-like binding is a shape the proof does not model. */
  private symbolOf(id: ts.Identifier): ReturnType<ts.TypeChecker["getSymbolAtLocation"]> {
    const par = id.parent;
    if (par !== undefined && par.kind === ts.SyntaxKind.ShorthandPropertyAssignment) {
      return this.L.checker.getShorthandAssignmentValueSymbol(par);
    }
    const sym = this.L.checker.getSymbolAtLocation(id);
    if (sym !== undefined && sym !== null) {
      for (const d of this.L.checker.declarationsOf(sym)) {
        switch (d.kind) {
          case ts.SyntaxKind.VariableDeclaration:
          case ts.SyntaxKind.Parameter:
          case ts.SyntaxKind.FunctionDeclaration:
          case ts.SyntaxKind.FunctionExpression:
          case ts.SyntaxKind.BindingElement:
          case ts.SyntaxKind.ClassDeclaration:
          case ts.SyntaxKind.ClassExpression:
          case ts.SyntaxKind.SourceFile: // `module` / `exports` of a CommonJS file
            break;
          default:
            if (!d.getSourceFile().isDeclarationFile) fail(`an identifier bound by a ${ts.SyntaxKind[d.kind]}`);
        }
      }
    }
    return sym;
  }

  private symKey(id: ts.Identifier): string {
    const k = key(id);
    const have = this.symCache.get(k);
    if (have !== undefined) return have;
    const sym = this.symbolOf(id);
    let out: string;
    if (sym === undefined || sym === null) out = "g:" + id.text;
    else {
      const decls = this.L.checker.declarationsOf(sym);
      out = decls.length === 0 ? "g:" + id.text : "s:" + key(decls[0]!) + ":" + id.text;
    }
    this.symCache.set(k, out);
    return out;
  }

  private declsOf(id: ts.Identifier): readonly ts.Node[] {
    const sym = this.symbolOf(id);
    if (sym === undefined || sym === null) return [];
    return this.L.checker.declarationsOf(sym);
  }

  private refsByText(text: string): Map<string, ts.Identifier[]> {
    let m = this.refsCache.get(text);
    if (m !== undefined) return m;
    m = new Map();
    for (const id of this.idx.idsByText.get(text) ?? []) {
      if (this.inHelper(id)) continue;
      const k = this.symKey(id);
      let a = m.get(k);
      if (a === undefined) m.set(k, (a = []));
      a.push(id);
    }
    this.refsCache.set(text, m);
    return m;
  }

  private refsOfSymKey(sk: string): ts.Identifier[] {
    const text = sk.slice(sk.lastIndexOf(":") + 1);
    return this.refsByText(text).get(sk) ?? [];
  }

  /** True when `n` is the target of a plain `=` (a write, not a read). */
  private isWriteTarget(n: ts.Node): boolean {
    const p = n.parent;
    if (p === undefined) return false;
    return (
      p.kind === ts.SyntaxKind.BinaryExpression &&
      (p as ts.BinaryExpression).operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      key((p as ts.BinaryExpression).left) === key(n)
    );
  }

  /* ------------------------------------------------------------- values */

  private fnVal(n: ts.Node): string {
    if (this.idx.helperKeys.has(key(n))) return "H";
    const k = "f:" + key(n);
    this.fnNodes.set(k, n);
    return k;
  }

  private litVal(n: ts.ObjectLiteralExpression): string {
    const k = "o:" + key(n);
    this.litNodes.set(k, n);
    return k;
  }

  private isSens(v: string): boolean {
    return v === this.fVal || this.sensSlots.has(v);
  }

  private instByCbNode(n: ts.Node): Inst | undefined {
    return this.instByCb.get(key(n));
  }

  /** The wrapper instance a `r({...})` call creates, or null for a shape the
   * model does not cover. */
  private instOfCall(call: ts.CallExpression): Inst | null {
    const k = key(call);
    const have = this.insts.get("i:" + k);
    if (have !== undefined) return have;
    if (call.arguments.length !== 1) return null;
    const arg = strip(call.arguments[0]!);
    if (!ts.isObjectLiteralExpression(arg) || arg.properties.length !== 1) return null;
    const prop = arg.properties[0]!;
    let cb: ts.Node | undefined;
    if (ts.isMethodDeclaration(prop)) cb = prop;
    else if (ts.isPropertyAssignment(prop)) {
      const init = strip(prop.initializer);
      if (init.kind === ts.SyntaxKind.FunctionExpression || init.kind === ts.SyntaxKind.ArrowFunction) cb = init;
    }
    if (cb === undefined) return null;
    const inst: Inst = { call, cb, site: k };
    this.insts.set("i:" + k, inst);
    this.instByCb.set(key(cb), inst);
    return inst;
  }

  private registerAllInsts(): void {
    // Every call whose callee is the helper variable creates an instance.
    const seen = new Set<string>();
    for (const arrow of this.idx.helperNodes) {
      if (!this.helperLooksUpGlobalOwnNames(arrow)) fail("the esbuild helper's key lookup is not the global Object.getOwnPropertyNames");
      const decl = arrow.parent;
      if (decl === undefined || !ts.isVariableDeclaration(decl) || !ts.isIdentifier(decl.name)) continue;
      for (const ref of this.refsOfSymKey(this.symKey(decl.name))) {
        const p = ref.parent;
        if (p !== undefined && ts.isCallExpression(p) && key(strip(p.expression)) === key(ref)) {
          if (seen.has(key(p))) continue;
          seen.add(key(p));
          this.instOfCall(p);
        }
      }
    }
  }

  /** `(e,t)=>function(){... e[o(e)[0]] ...}`: `o` must be a variable
   * initialised to the global Object.getOwnPropertyNames. */
  private helperLooksUpGlobalOwnNames(arrow: ts.Node): boolean {
    const txt = this.idx.sf.text.slice(arrow.pos, arrow.end).replace(/\s+/g, "");
    const m = HELPER_RE.exec(txt);
    if (m === null) return false;
    const decl = this.declOfNameInScope(arrow, m[3]!);
    if (decl === undefined || !ts.isVariableDeclaration(decl) || decl.initializer === undefined) return false;
    const init = strip(decl.initializer);
    if (!ts.isPropertyAccessExpression(init) || init.name.text !== "getOwnPropertyNames") return false;
    const obj = strip(init.expression);
    if (!ts.isIdentifier(obj) || obj.text !== "Object") return false;
    // `Object` must be the ambient global: no declaration of it in this file.
    return this.declsOf(obj).every((d) => d.getSourceFile().fileName !== this.idx.sf.fileName);
  }

  private declOfNameInScope(from: ts.Node, name: string): ts.Node | undefined {
    // Walk the helper body for the identifier and ask the checker.
    const stack: ts.Node[] = [from];
    const kids: ts.Node[] = [];
    while (stack.length > 0) {
      const n = stack.pop()!;
      if (n.kind === ts.SyntaxKind.Identifier && (n as ts.Identifier).text === name && !isNameChild(n)) {
        const ds = this.declsOf(n as ts.Identifier);
        return ds[0];
      }
      kids.length = 0;
      n.forEachChild((c) => {
        kids.push(c);
      });
      for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]!);
    }
    return undefined;
  }

  /* ---------------------------------------------------------------- pts */

  /** Merge `out` into the persistent answer of `k`; growth schedules a round. */
  private settle(k: string, out: VS): VS {
    const have = this.partial.get(k);
    const merged = new Set(out);
    if (have === undefined) {
      this.partial.set(k, new Set(merged));
      if (merged.size > 0) this.changed = true;
      return merged;
    }
    for (const v of merged) {
      if (!have.has(v)) {
        have.add(v);
        this.changed = true;
      }
    }
    for (const v of have) merged.add(v);
    return merged;
  }

  pts(e: ts.Node): VS {
    const k = key(e);
    const have = this.memo.get(k);
    if (have !== undefined) return have;
    if (this.inProgress.has(k)) return new Set(this.partial.get(k) ?? []);
    this.inProgress.add(k);
    let out: VS;
    try {
      out = this.settle(k, this.ptsUncached(e));
    } finally {
      this.inProgress.delete(k);
    }
    this.memo.set(k, out);
    return out;
  }

  private ptsUncached(e: ts.Node): VS {
    switch (e.kind) {
      case ts.SyntaxKind.ParenthesizedExpression:
        return this.pts((e as ts.ParenthesizedExpression).expression);
      case ts.SyntaxKind.Identifier:
        return this.ptsSym(e as ts.Identifier);
      case ts.SyntaxKind.ThisKeyword: {
        // `this` of a method that is called on sensitive receivers: those
        // receivers (and anything else that may call it).
        let f = enclosingFunction(e);
        while (f !== undefined && f.kind === ts.SyntaxKind.ArrowFunction) f = enclosingFunction(f);
        const recv = f === undefined ? undefined : this.thisVals.get(this.fnVal(f));
        return recv === undefined ? new Set([TOP]) : new Set([...recv, TOP]);
      }
      case ts.SyntaxKind.FunctionExpression:
      case ts.SyntaxKind.ArrowFunction:
        return new Set([this.fnVal(e)]);
      case ts.SyntaxKind.ObjectLiteralExpression:
        return new Set([this.litVal(e as ts.ObjectLiteralExpression)]);
      case ts.SyntaxKind.PropertyAccessExpression:
        return this.ptsMember(this.pts((e as ts.PropertyAccessExpression).expression), (e as ts.PropertyAccessExpression).name.text);
      case ts.SyntaxKind.ElementAccessExpression: {
        const a = (e as ts.ElementAccessExpression).argumentExpression;
        if (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a)) {
          return this.ptsMember(this.pts((e as ts.ElementAccessExpression).expression), a.text);
        }
        return new Set([TOP]);
      }
      case ts.SyntaxKind.CallExpression:
        return this.ptsCall(e as ts.CallExpression);
      case ts.SyntaxKind.NullKeyword:
      case ts.SyntaxKind.TrueKeyword:
      case ts.SyntaxKind.FalseKeyword:
      case ts.SyntaxKind.NumericLiteral:
      case ts.SyntaxKind.StringLiteral:
      case ts.SyntaxKind.NoSubstitutionTemplateLiteral:
      case ts.SyntaxKind.TypeOfExpression:
      case ts.SyntaxKind.VoidExpression:
        return new Set([PRIM]);
      case ts.SyntaxKind.PrefixUnaryExpression:
        return (e as ts.PrefixUnaryExpression).operator === ts.SyntaxKind.ExclamationToken ? new Set([PRIM]) : new Set([TOP]);
      case ts.SyntaxKind.ConditionalExpression:
        return union(this.pts((e as ts.ConditionalExpression).whenTrue), this.pts((e as ts.ConditionalExpression).whenFalse));
      case ts.SyntaxKind.BinaryExpression: {
        const b = e as ts.BinaryExpression;
        switch (b.operatorToken.kind) {
          case ts.SyntaxKind.EqualsToken:
          case ts.SyntaxKind.CommaToken:
            return this.pts(b.right);
          case ts.SyntaxKind.BarBarToken:
          case ts.SyntaxKind.AmpersandAmpersandToken:
          case ts.SyntaxKind.QuestionQuestionToken:
            return union(this.pts(b.left), this.pts(b.right));
          case ts.SyntaxKind.EqualsEqualsToken:
          case ts.SyntaxKind.EqualsEqualsEqualsToken:
          case ts.SyntaxKind.ExclamationEqualsToken:
          case ts.SyntaxKind.ExclamationEqualsEqualsToken:
          case ts.SyntaxKind.InstanceOfKeyword:
          case ts.SyntaxKind.InKeyword:
            return new Set([PRIM]);
          default:
            return new Set([TOP]);
        }
      }
      default:
        return new Set([TOP]);
    }
  }

  private ptsSym(id: ts.Identifier): VS {
    const sk = this.symKey(id);
    const mk = "S" + sk;
    const have = this.memo.get(mk);
    if (have !== undefined) return have;
    if (this.inProgress.has(mk)) return new Set(this.partial.get(mk) ?? []);
    this.inProgress.add(mk);
    let out: VS = new Set();
    try {
      const decls = this.declsOf(id);
      if (decls.length === 0 || decls.every((d) => d.getSourceFile().isDeclarationFile || d.kind === ts.SyntaxKind.SourceFile)) {
        // An ambient global: the global object itself, or a builtin.
        if (id.text === "undefined" || id.text === "NaN" || id.text === "Infinity") out.add(PRIM);
        else if (id.text === "global" || id.text === "globalThis" || id.text === "window" || id.text === "self") out.add("G:");
        else out.add("G:" + id.text);
        out = this.settle(mk, out);
        this.memo.set(mk, out);
        return out;
      }
      for (const d of decls) {
        switch (d.kind) {
          case ts.SyntaxKind.VariableDeclaration: {
            const vd = d as ts.VariableDeclaration;
            const gp = vd.parent?.parent;
            if (vd.parent !== undefined && vd.parent.kind === ts.SyntaxKind.CatchClause) out.add(TOP);
            else if (gp !== undefined && (gp.kind === ts.SyntaxKind.ForInStatement || gp.kind === ts.SyntaxKind.ForOfStatement)) out.add(TOP);
            else if (!ts.isIdentifier(vd.name)) out.add(TOP);
            else if (vd.initializer !== undefined) for (const v of this.pts(vd.initializer)) out.add(v);
            break;
          }
          case ts.SyntaxKind.Parameter:
            for (const v of this.ptsParam(d as ts.ParameterDeclaration)) out.add(v);
            break;
          case ts.SyntaxKind.FunctionDeclaration:
            out.add(this.fnVal(d));
            break;
          case ts.SyntaxKind.FunctionExpression:
            out.add(this.fnVal(d));
            break;
          default:
            out.add(TOP);
        }
      }
      // Assignments to the variable.
      for (const ref of this.refsOfSymKey(sk)) {
        const p = ref.parent;
        if (p === undefined) continue;
        if (this.isWriteTarget(ref)) {
          for (const v of this.pts((p as ts.BinaryExpression).right)) out.add(v);
        } else if (this.isOtherWrite(ref)) out.add(TOP);
      }
      out = this.settle(mk, out);
    } finally {
      this.inProgress.delete(mk);
    }
    this.memo.set(mk, out);
    return out;
  }

  /** A write that is not a plain `=`: compound, update, destructuring or
   * for-in/of target. */
  private isOtherWrite(ref: ts.Identifier): boolean {
    const p = ref.parent;
    if (p === undefined) return false;
    if (p.kind === ts.SyntaxKind.BinaryExpression) {
      const b = p as ts.BinaryExpression;
      const op = b.operatorToken.kind;
      return key(b.left) === key(ref) && op >= ts.SyntaxKind.FirstAssignment && op <= ts.SyntaxKind.LastAssignment && op !== ts.SyntaxKind.EqualsToken;
    }
    if (p.kind === ts.SyntaxKind.PrefixUnaryExpression || p.kind === ts.SyntaxKind.PostfixUnaryExpression) {
      const op = (p as ts.PrefixUnaryExpression).operator;
      return op === ts.SyntaxKind.PlusPlusToken || op === ts.SyntaxKind.MinusMinusToken;
    }
    if (p.kind === ts.SyntaxKind.ForInStatement || p.kind === ts.SyntaxKind.ForOfStatement) return key((p as ts.ForInStatement).initializer) === key(ref);
    if (p.kind === ts.SyntaxKind.ArrayLiteralExpression || p.kind === ts.SyntaxKind.ShorthandPropertyAssignment || p.kind === ts.SyntaxKind.SpreadAssignment || p.kind === ts.SyntaxKind.PropertyAssignment || p.kind === ts.SyntaxKind.SpreadElement) {
      // A destructuring assignment target: the pattern is the left side of
      // an `=` or a for-in/of head.
      let q: ts.Node | undefined = p;
      while (q !== undefined && (q.kind === ts.SyntaxKind.ArrayLiteralExpression || q.kind === ts.SyntaxKind.ObjectLiteralExpression || q.kind === ts.SyntaxKind.PropertyAssignment || q.kind === ts.SyntaxKind.ShorthandPropertyAssignment || q.kind === ts.SyntaxKind.SpreadAssignment || q.kind === ts.SyntaxKind.SpreadElement || q.kind === ts.SyntaxKind.ParenthesizedExpression)) {
        const up: ts.Node | undefined = q.parent;
        if (up === undefined) return false;
        if (up.kind === ts.SyntaxKind.BinaryExpression) return key((up as ts.BinaryExpression).left) === key(q) && (up as ts.BinaryExpression).operatorToken.kind === ts.SyntaxKind.EqualsToken;
        if (up.kind === ts.SyntaxKind.ForInStatement || up.kind === ts.SyntaxKind.ForOfStatement) return key((up as ts.ForInStatement).initializer) === key(q);
        q = up;
      }
    }
    return false;
  }

  private ptsParam(d: ts.ParameterDeclaration): VS {
    const fn = d.parent;
    const out: VS = new Set();
    if (fn === undefined || !ts.isIdentifier(d.name) || d.dotDotDotToken !== undefined) return new Set([TOP]);
    if (d.initializer !== undefined) for (const v of this.pts(d.initializer)) out.add(v);
    const i = fn.kind === ts.SyntaxKind.Constructor ? -1 : (fn as ts.FunctionDeclaration).parameters.findIndex((q) => key(q) === key(d));
    if (i < 0) return new Set([TOP]);
    const inst = this.instByCbNode(fn);
    if (inst !== undefined) {
      if (i === 0) out.add("u:" + inst.site);
      else if (i === 1) out.add("m:" + inst.site);
      return out;
    }
    const callers = this.closedCallers(fn);
    if (callers === null) {
      out.add(TOP);
      return out;
    }
    for (const c of callers) {
      if (c.arguments.some((a) => ts.isSpreadElement(a))) {
        out.add(TOP);
        continue;
      }
      const a = c.arguments[i];
      if (a !== undefined) for (const v of this.pts(a)) out.add(v);
    }
    return out;
  }

  /** The call sites of `fn` when every reference to it is a direct call, or
   * null when its value can reach a caller the proof cannot see. */
  private closedCallers(fn: ts.Node): ts.CallExpression[] | null {
    const out: ts.CallExpression[] = [];
    let sk: string | null = null;
    if (fn.kind === ts.SyntaxKind.FunctionDeclaration) {
      const nm = (fn as ts.FunctionDeclaration).name;
      if (nm === undefined) return null;
      sk = this.symKey(nm);
    } else if (fn.kind === ts.SyntaxKind.FunctionExpression || fn.kind === ts.SyntaxKind.ArrowFunction) {
      let p = fn.parent;
      let child: ts.Node = fn;
      while (p !== undefined && p.kind === ts.SyntaxKind.ParenthesizedExpression) {
        child = p;
        p = p.parent;
      }
      if (p === undefined) return null;
      if (ts.isCallExpression(p) && key(p.expression) === key(child)) return [p];
      if (ts.isVariableDeclaration(p) && p.initializer !== undefined && key(p.initializer) === key(child) && ts.isIdentifier(p.name)) {
        sk = this.symKey(p.name);
        // The variable must be assigned only by this declaration.
        if (this.declsOf(p.name).length !== 1) return null;
      } else return null;
    } else return null;
    for (const ref of this.refsOfSymKey(sk)) {
      const p = ref.parent;
      if (p !== undefined && ts.isCallExpression(p) && key(p.expression) === key(ref)) {
        out.push(p);
        continue;
      }
      // The declaration's own name is not in the reference index.
      return null;
    }
    return out;
  }

  private ptsMember(base: VS, name: string): VS {
    const out: VS = new Set();
    for (const v of base) {
      if (v.startsWith("G:")) {
        out.add(v === "G:" ? "G:" + name : v + "." + name);
        continue;
      }
      if (v === PRIM) {
        out.add(PRIM); // a property of a primitive is a primitive or a builtin
        continue;
      }
      if (v === TOP || v.startsWith("f:") || v.startsWith("i:") || v === "H") {
        out.add(TOP);
        continue;
      }
      const s = this.slotVals(v, name);
      for (const x of s) out.add(x);
      if (s.size === 0 && OBJECT_PROTO_NAMES.has(name)) out.add(TOP);
    }
    return out;
  }

  /** Every value stored in slot `name` of object `o`. */
  private slotVals(o: string, name: string): VS {
    const mk = `${o}.${name}`;
    const have = this.slotMemo.get(mk);
    if (have !== undefined) return have;
    if (this.slotInProgress.has(mk)) return new Set(this.partial.get("L" + mk) ?? []);
    this.slotInProgress.add(mk);
    let out: VS = new Set();
    try {
      if (o.startsWith("o:")) {
        const lit = this.litNodes.get(o)!;
        for (const p of lit.properties) {
          if (ts.isPropertyAssignment(p) && !ts.isComputedPropertyName(p.name)) {
            if (propName(p.name) === name) for (const v of this.pts(p.initializer)) out.add(v);
          } else if (ts.isMethodDeclaration(p) && !ts.isComputedPropertyName(p.name)) {
            if (propName(p.name) === name) out.add(this.fnVal(p));
          } else if (ts.isShorthandPropertyAssignment(p)) {
            if (propName(p.name) === name) for (const v of this.ptsSym(p.name as ts.Identifier)) out.add(v);
          } else out.add(TOP);
        }
      }
      for (const acc of this.idx.accessesByName.get(name) ?? []) {
        if (this.inHelper(acc)) continue;
        const par = acc.parent;
        if (par === undefined || par.kind !== ts.SyntaxKind.BinaryExpression) continue;
        const b = par as ts.BinaryExpression;
        const op = b.operatorToken.kind;
        if (key(b.left) !== key(acc)) continue;
        if (op !== ts.SyntaxKind.EqualsToken && !(op >= ts.SyntaxKind.FirstAssignment && op <= ts.SyntaxKind.LastAssignment)) continue;
        if (!this.pts((acc as ts.PropertyAccessExpression).expression).has(o)) continue;
        if (op === ts.SyntaxKind.EqualsToken) for (const v of this.pts(b.right)) out.add(v);
        else out.add(TOP);
      }
      out = this.settle("L" + mk, out);
    } finally {
      this.slotInProgress.delete(mk);
    }
    this.slotMemo.set(mk, out);
    return out;
  }

  private ptsCall(call: ts.CallExpression): VS {
    const out: VS = new Set();
    for (const v of this.pts(call.expression)) {
      if (v === "H") {
        const inst = this.instOfCall(call);
        out.add(inst !== null ? "i:" + inst.site : TOP);
      } else if (v.startsWith("i:")) {
        for (const x of this.instResult(this.insts.get(v)!)) out.add(x);
      } else if (v.startsWith("f:")) {
        for (const x of this.retOf(this.fnNodes.get(v)!)) out.add(x);
      } else if (v === PRIM) {
        out.add(TOP); // calling a primitive throws
      } else if (v.startsWith("G:") && builtinReturnsPrimitive(v)) {
        out.add(PRIM);
      } else out.add(TOP);
    }
    return out;
  }

  private instResult(inst: Inst): VS {
    const out: VS = new Set();
    const stored = this.slotVals("m:" + inst.site, "exports");
    for (const v of stored) out.add(v);
    if (stored.size === 0 || this.reentrant(inst)) out.add("u:" + inst.site);
    return out;
  }

  /** The instance can be invoked during its own initialisation: some call
   * site of it lies inside a wrapper callback that is itself reachable from
   * the instance's callback (a dependency cycle), or in a function outside
   * every callback (which any callback might run). */
  private reentrant(inst: Inst): boolean {
    const sites = this.callSitesOfInst(inst);
    if (sites === null) return true;
    const cbOf = (n: ts.Node): Inst | null => {
      let p: ts.Node | undefined = n.parent;
      while (p !== undefined) {
        const i = this.instByCb.get(key(p));
        if (i !== undefined) return i;
        p = p.parent;
      }
      return null;
    };
    // Reachability over instances: A -> B when a call site of B is lexically
    // inside A's callback.
    const reaches = (from: Inst, goal: Inst, seen: Set<string>): boolean => {
      if (seen.has(from.site)) return false;
      seen.add(from.site);
      for (const other of this.insts.values()) {
        const os = this.callSitesOfInst(other);
        if (os === null) return true;
        const inside = os.some((s) => s.pos >= from.cb.pos && s.end <= from.cb.end);
        if (!inside) continue;
        if (other.site === goal.site) return true;
        if (reaches(other, goal, seen)) return true;
      }
      return false;
    };
    for (const s of sites) {
      const host = cbOf(s);
      if (host === null) {
        // Outside every callback: harmless only at module level, never in a function.
        if (enclosingFunction(s) !== undefined) return true;
        continue;
      }
      if (host.site === inst.site) return true;
      if (reaches(inst, host, new Set())) return true;
    }
    return false;
  }

  private callSitesOfInst(inst: Inst): ts.CallExpression[] | null {
    const call = inst.call;
    const p = call.parent;
    if (p === undefined) return null;
    let child: ts.Node = call;
    let q: ts.Node | undefined = p;
    while (q !== undefined && q.kind === ts.SyntaxKind.ParenthesizedExpression) {
      child = q;
      q = q.parent;
    }
    if (q !== undefined && ts.isCallExpression(q) && key(strip(q.expression)) === key(strip(child as ts.Expression))) return [q];
    if (q !== undefined && ts.isVariableDeclaration(q) && q.initializer !== undefined && key(strip(q.initializer)) === key(call) && ts.isIdentifier(q.name)) {
      if (this.declsOf(q.name).length !== 1) return null;
      const out: ts.CallExpression[] = [];
      for (const ref of this.refsOfSymKey(this.symKey(q.name))) {
        const rp = ref.parent;
        if (rp !== undefined && ts.isCallExpression(rp) && key(rp.expression) === key(ref)) out.push(rp);
        else return null;
      }
      return out;
    }
    return null;
  }

  private retOf(fn: ts.Node): VS {
    const f = fn as ts.FunctionDeclaration;
    const out: VS = new Set();
    if (f.asteriskToken !== undefined || (f.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) ?? false)) return new Set([TOP]);
    if (fn.kind === ts.SyntaxKind.ArrowFunction && f.body !== undefined && !ts.isBlock(f.body)) return this.pts(f.body);
    if (f.body === undefined) return new Set([TOP]);
    for (const r of this.returnsOf(f)) if (r.expression !== undefined) for (const v of this.pts(r.expression)) out.add(v);
    return out;
  }

  private returnsOf(fn: ts.Node): ts.ReturnStatement[] {
    const out: ts.ReturnStatement[] = [];
    const body = (fn as ts.FunctionDeclaration).body;
    if (body === undefined) return out;
    const stack: ts.Node[] = [body];
    const kids: ts.Node[] = [];
    while (stack.length > 0) {
      const n = stack.pop()!;
      if (n.kind === ts.SyntaxKind.ReturnStatement) out.push(n as ts.ReturnStatement);
      if (isFunctionNode(n)) continue;
      kids.length = 0;
      n.forEachChild((c) => {
        kids.push(c);
      });
      for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]!);
    }
    return out;
  }

  private thisNodes(fn: ts.Node): ts.Node[] {
    const out: ts.Node[] = [];
    if (fn.kind === ts.SyntaxKind.ArrowFunction) fail("sensitive `this` reaches an arrow function");
    const body = (fn as ts.FunctionDeclaration).body;
    if (body === undefined) return out;
    const stack: ts.Node[] = [body];
    const kids: ts.Node[] = [];
    while (stack.length > 0) {
      const n = stack.pop()!;
      if (n.kind === ts.SyntaxKind.ThisKeyword) out.push(n);
      if (isFunctionNode(n) && n.kind !== ts.SyntaxKind.ArrowFunction) continue;
      kids.length = 0;
      n.forEachChild((c) => {
        kids.push(c);
      });
      for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]!);
    }
    return out;
  }

  private usesArguments(fn: ts.Node): boolean {
    const body = (fn as ts.FunctionDeclaration).body;
    if (body === undefined) return true;
    const stack: ts.Node[] = [body];
    const kids: ts.Node[] = [];
    while (stack.length > 0) {
      const n = stack.pop()!;
      if (n.kind === ts.SyntaxKind.Identifier && (n as ts.Identifier).text === "arguments") return true;
      if (isFunctionNode(n) && n.kind !== ts.SyntaxKind.ArrowFunction) continue;
      kids.length = 0;
      n.forEachChild((c) => {
        kids.push(c);
      });
      for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]!);
    }
    return false;
  }

  /* -------------------------------------------------------- sens facts */

  private markSym(sk: string): void {
    if (sk.startsWith("g:")) fail("a sensitive value reaches a global variable");
    if (!this.sensSyms.has(sk)) {
      this.sensSyms.add(sk);
      this.changed = true;
    }
  }

  private markSlot(o: string, name: string): void {
    let s = this.sensSlots.get(o);
    if (s === undefined) this.sensSlots.set(o, (s = new Set()));
    if (!s.has(name)) {
      s.add(name);
      this.changed = true;
    }
  }

  private addRet(r: string): void {
    if (r.startsWith("i:")) {
      const inst = this.insts.get(r)!;
      if (this.callSitesOfInst(inst) === null) fail("a sensitive wrapper instance is used other than by calling it");
    }
    if (!this.sensRets.has(r)) {
      this.sensRets.add(r);
      this.changed = true;
    }
  }

  private markThis(fk: string, receiver: string): void {
    if (!this.sensThis.has(fk)) {
      this.sensThis.add(fk);
      this.changed = true;
    }
    let r = this.thisVals.get(fk);
    if (r === undefined) this.thisVals.set(fk, (r = new Set()));
    if (!r.has(receiver)) {
      r.add(receiver);
      this.changed = true;
    }
  }

  private callersOf(r: string): ts.CallExpression[] {
    if (r.startsWith("i:")) return this.callSitesOfInst(this.insts.get(r)!)!;
    const fn = this.fnNodes.get(r)!;
    const c = this.closedCallers(fn);
    if (c === null) fail("a function that returns a sensitive value can be called from code the proof cannot see");
    return c;
  }

  /* ------------------------------------------------------- occurrences */

  private classify(start: ts.Node): void {
    let e: ts.Node = start;
    for (;;) {
      const next = this.step(e);
      if (next === null) return;
      e = next;
    }
  }

  /** Classify one occurrence of a sensitive value: null when the context is
   * fully handled, the parent when the value flows on into it. */
  private step(e: ts.Node): ts.Node | null {
    const p = e.parent;
    if (p === undefined) fail("a sensitive value without a context");
    const ek = key(e);
    switch (p.kind) {
      case ts.SyntaxKind.ParenthesizedExpression:
        return p;
      case ts.SyntaxKind.BinaryExpression: {
        const b = p as ts.BinaryExpression;
        const op = b.operatorToken.kind;
        const isLeft = key(b.left) === ek;
        switch (op) {
          case ts.SyntaxKind.CommaToken:
            return isLeft ? null : p;
          case ts.SyntaxKind.BarBarToken:
          case ts.SyntaxKind.AmpersandAmpersandToken:
          case ts.SyntaxKind.QuestionQuestionToken:
            return p;
          case ts.SyntaxKind.EqualsToken:
            if (isLeft) return null;
            this.assign(b.left, e);
            return p;
          case ts.SyntaxKind.EqualsEqualsToken:
          case ts.SyntaxKind.EqualsEqualsEqualsToken:
          case ts.SyntaxKind.ExclamationEqualsToken:
          case ts.SyntaxKind.ExclamationEqualsEqualsToken:
          case ts.SyntaxKind.InstanceOfKeyword:
          case ts.SyntaxKind.InKeyword:
            return null;
          default:
            fail(`a sensitive value is an operand of '${ts.tokenToString(op) ?? op}'`);
        }
        break;
      }
      case ts.SyntaxKind.ConditionalExpression:
        return key((p as ts.ConditionalExpression).condition) === ek ? null : p;
      case ts.SyntaxKind.PrefixUnaryExpression:
        if ((p as ts.PrefixUnaryExpression).operator === ts.SyntaxKind.ExclamationToken) return null;
        fail("a sensitive value is an operand of a unary operator");
        break;
      case ts.SyntaxKind.TypeOfExpression:
      case ts.SyntaxKind.VoidExpression:
      case ts.SyntaxKind.ExpressionStatement:
        return null;
      case ts.SyntaxKind.IfStatement:
      case ts.SyntaxKind.WhileStatement:
      case ts.SyntaxKind.DoStatement:
        return null;
      case ts.SyntaxKind.ForStatement:
        if ((p as ts.ForStatement).condition !== undefined && key((p as ts.ForStatement).condition!) === ek) return null;
        fail("a sensitive value in a for statement header");
        break;
      case ts.SyntaxKind.SwitchStatement:
      case ts.SyntaxKind.CaseClause:
        return null;
      case ts.SyntaxKind.VariableDeclaration: {
        const vd = p as ts.VariableDeclaration;
        if (!ts.isIdentifier(vd.name)) fail("a sensitive value is destructured");
        this.markSym(this.symKey(vd.name));
        return null;
      }
      case ts.SyntaxKind.ReturnStatement: {
        const f = enclosingFunction(p);
        if (f === undefined) fail("a sensitive return outside a function");
        this.sensReturn(f);
        return null;
      }
      case ts.SyntaxKind.ArrowFunction:
        if (key((p as ts.ArrowFunction).body) === ek) {
          this.sensReturn(p);
          return null;
        }
        fail("a sensitive value in an arrow function head");
        break;
      case ts.SyntaxKind.PropertyAssignment:
      case ts.SyntaxKind.ShorthandPropertyAssignment: {
        // A sensitive value written into an object literal: a slot of that
        // literal's object, which is then itself sensitive.
        const pa = p as ts.PropertyAssignment;
        const lit = p.parent;
        const nm = propName(pa.name);
        if (lit === undefined || !ts.isObjectLiteralExpression(lit) || nm === null || ts.isComputedPropertyName(pa.name)) fail("a sensitive value in an object literal with a computed key");
        if (p.kind === ts.SyntaxKind.PropertyAssignment && key(pa.initializer) !== ek) fail("a sensitive value used as a property name");
        this.markSlot(this.litVal(lit), nm);
        return null;
      }
      case ts.SyntaxKind.PropertyAccessExpression:
        this.memberUse(p as ts.PropertyAccessExpression, e, (p as ts.PropertyAccessExpression).name.text);
        return null;
      case ts.SyntaxKind.ElementAccessExpression: {
        const ea = p as ts.ElementAccessExpression;
        if (key(ea.expression) === ek && (ts.isStringLiteral(ea.argumentExpression) || ts.isNoSubstitutionTemplateLiteral(ea.argumentExpression))) {
          this.memberUse(ea, e, ea.argumentExpression.text);
          return null;
        }
        fail("a sensitive value is used as a computed key or has a computed key read from it");
        break;
      }
      case ts.SyntaxKind.CallExpression: {
        const c = p as ts.CallExpression;
        if (key(c.expression) === ek) {
          const v = this.pts(e);
          if (!v.has(this.fVal)) fail("a sensitive object is called");
          for (const x of v) if (x !== this.fVal && this.isSens(x)) fail("a callee may be the function or a sensitive object");
          // F is called here: a visible call site (its specifiers are read
          // from the arguments by the caller of the proof).
          this.fCalls.set(key(c), c);
          return null;
        }
        const i = c.arguments.findIndex((a) => key(a) === ek);
        this.argTo(c, i);
        return null;
      }
      default:
        fail(`a sensitive value in a ${ts.SyntaxKind[p.kind]}`);
    }
    return null;
  }

  private sensReturn(f: ts.Node): void {
    if (this.instByCbNode(f) !== undefined) return; // a wrapper ignores its callback's result
    const fk = this.fnVal(f);
    if (fk === "H") return;
    if (this.closedCallers(f) === null) fail("a function that returns a sensitive value can be called from code the proof cannot see");
    this.addRet(fk);
  }

  /** `base.name` with the sensitive value `e` as the base. */
  private memberUse(acc: ts.Node, e: ts.Node, name: string): void {
    const par = acc.parent;
    const base = this.pts(e);
    const isWrite = par !== undefined && par.kind === ts.SyntaxKind.BinaryExpression && key((par as ts.BinaryExpression).left) === key(acc) && (par as ts.BinaryExpression).operatorToken.kind === ts.SyntaxKind.EqualsToken;
    if (par !== undefined) {
      if (par.kind === ts.SyntaxKind.BinaryExpression && key((par as ts.BinaryExpression).left) === key(acc) && !isWrite) {
        const op = (par as ts.BinaryExpression).operatorToken.kind;
        if (op >= ts.SyntaxKind.FirstAssignment && op <= ts.SyntaxKind.LastAssignment) fail("a compound assignment to a member of a sensitive value");
      }
      if (par.kind === ts.SyntaxKind.DeleteExpression) fail("delete on a member of a sensitive value");
      if (par.kind === ts.SyntaxKind.PrefixUnaryExpression || par.kind === ts.SyntaxKind.PostfixUnaryExpression) {
        const op = (par as ts.PrefixUnaryExpression).operator;
        if (op === ts.SyntaxKind.PlusPlusToken || op === ts.SyntaxKind.MinusMinusToken) fail("an update of a member of a sensitive value");
      }
    }
    if (isWrite) return; // a store into a sensitive object: harmless here
    if (base.has(this.fVal)) {
      if (name !== "name" && name !== "length") fail(`'${name}' read from the function`);
      return;
    }
    if (name === "__proto__" || name === "valueOf" || name === "__lookupGetter__" || name === "__lookupSetter__" || name === "__defineGetter__" || name === "__defineSetter__") {
      fail(`'${name}' on a sensitive object`);
    }
    const isCallee = par !== undefined && ts.isCallExpression(par) && key(par.expression) === key(acc);
    if (!isCallee) return;
    // A method call on a sensitive object.
    for (const o of base) {
      if (!this.sensSlots.has(o)) continue;
      const vals = this.slotVals(o, name);
      if (vals.size === 0) {
        if (HARMLESS_PROTO_CALLS.has(name)) continue;
        fail(`method '${name}' of a sensitive object has no visible definition`);
      }
      for (const v of vals) {
        if (v === PRIM) continue; // calling a primitive throws; the receiver goes nowhere
        if (v.startsWith("G:")) {
          if (!builtinIgnoresThis(v)) fail(`method '${name}' of a sensitive object is the builtin ${v.slice(2)}, which may keep its receiver`);
          continue;
        }
        if (!v.startsWith("f:")) fail(`method '${name}' of a sensitive object is not a visible function (${[...vals].join(",")})`);
        const fnode = this.fnNodes.get(v)!;
        if (fnode.kind === ts.SyntaxKind.ArrowFunction) fail("a sensitive receiver reaches an arrow function method");
        this.markThis(v, o);
      }
    }
  }

  private argTo(c: ts.CallExpression, i: number): void {
    const callee = this.pts(c.expression);
    for (const v of callee) {
      if (!v.startsWith("f:")) fail("a sensitive value is passed to a callee the proof cannot resolve");
      const fnode = this.fnNodes.get(v)!;
      const params = (fnode as ts.FunctionDeclaration).parameters;
      if (c.arguments.some((a) => ts.isSpreadElement(a))) fail("a sensitive value is passed alongside a spread");
      if (this.usesArguments(fnode)) fail("a callee that receives a sensitive value reads `arguments`");
      const q = params[i];
      if (q === undefined) continue;
      if (!ts.isIdentifier(q.name) || q.dotDotDotToken !== undefined) fail("a sensitive value is bound to a destructured or rest parameter");
      this.markSym(this.symKey(q.name));
    }
    if (callee.size === 0) fail("a sensitive value is passed to a callee with no visible definition");
  }

  private assign(left: ts.Expression, value: ts.Node): void {
    void value;
    const l = strip(left);
    if (ts.isIdentifier(l)) {
      this.markSym(this.symKey(l));
      return;
    }
    let baseExpr: ts.Expression;
    let name: string;
    if (ts.isPropertyAccessExpression(l)) {
      baseExpr = l.expression;
      name = l.name.text;
    } else if (ts.isElementAccessExpression(l) && (ts.isStringLiteral(l.argumentExpression) || ts.isNoSubstitutionTemplateLiteral(l.argumentExpression))) {
      baseExpr = l.expression;
      name = l.argumentExpression.text;
    } else fail("a sensitive value is stored through an unsupported target");
    const bases = this.pts(baseExpr);
    if (bases.has(TOP)) fail(`a sensitive value is stored into '.${name}' of an object the proof cannot resolve`);
    for (const o of bases) {
      if (!(o.startsWith("o:") || o.startsWith("m:") || o.startsWith("u:"))) fail("a sensitive value is stored into a function");
      this.markSlot(o, name);
    }
  }
}

/** Static functions of the well-known global constructors and namespaces
 * ignore `this`, neither return it nor keep it (`Buffer.from`, `Array.from`,
 * `Object.keys`, `Math.max`, ...). A `prototype` member is a method that
 * works ON its receiver and is never in this set. */
const THIS_IGNORING_ROOTS = new Set(["Buffer", "Array", "Object", "Math", "Number", "String", "JSON", "Uint8Array", "Symbol", "Date", "Reflect", "BigInt", "Boolean", "Promise"]);
function builtinIgnoresThis(v: string): boolean {
  const path = v.slice(2).split(".");
  if (path.length < 2 || !THIS_IGNORING_ROOTS.has(path[0]!)) return false;
  return !path.includes("prototype") && !path.includes("constructor") && !path.includes("__proto__");
}

const PRIMITIVE_BUILTINS = new Set([
  "G:Boolean", "G:Number", "G:String", "G:parseInt", "G:parseFloat", "G:isNaN", "G:isFinite", "G:Date.now", "G:Array.isArray",
  "G:Buffer.isBuffer", "G:Buffer.byteLength", "G:JSON.stringify", "G:Object.is", "G:Number.isInteger", "G:String.fromCharCode",
]);
/** Builtin calls that always answer a primitive. */
function builtinReturnsPrimitive(v: string): boolean {
  return PRIMITIVE_BUILTINS.has(v) || v.startsWith("G:Math.");
}

function union(a: VS, b: VS): VS {
  const o = new Set(a);
  for (const v of b) o.add(v);
  return o;
}

function propName(n: ts.PropertyName): string | null {
  if (ts.isIdentifier(n) || ts.isStringLiteral(n) || ts.isNumericLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text;
  return null;
}

/** The specifier a call site's first argument names when it is a build-time
 * constant (a string literal, or an expression of a string-literal type). */
function constantSpecifier(L: Lowerer, arg: ts.Expression): string | null {
  if (ts.isStringLiteralLike(arg)) return arg.text;
  const t = L.typeOf(arg);
  if (t.isStringLiteralType()) {
    const v = (t as { value?: unknown }).value;
    if (typeof v === "string") return v;
  }
  return null;
}

/** An expression the proof says never evaluates: a throw that names itself
 * (catchable, because the program's own catch may sit around it; it only
 * exists so a hole in the proof is not a silently wrong answer). */
function unreachable(why: string, loc: SrcLoc): IrExpr {
  return nodeThrowExpr(1, "ERR_SCRIPTC_UNREACHABLE", `scriptc: unreachable run-time require (${why})`, DYN, loc);
}

/** The lowering of a run-time require whose enclosing function the whole-file
 * proof pinned down, or null when the proof or the exactness conditions do
 * not hold (the caller then keeps the SC2020 refusal).
 *
 *  - F never invoked: the require never runs; an unreachable placeholder.
 *  - F invoked only at visible call sites whose first arguments are build-time
 *    constants, EVERY one of which Node itself cannot resolve: the require
 *    answers Node's own catchable MODULE_NOT_FOUND for exactly the specifier
 *    it was handed (the optional-dependency idiom, `inquire("long")`). A
 *    specifier Node does resolve needs the module as a value, which has no
 *    representation, so a single resolvable one keeps the refusal. */
export function lowerProvenRuntimeRequire(L: Lowerer, call: ts.CallExpression, loc: SrcLoc): IrExpr | null {
  const proof = proveRuntimeRequire(L, call);
  if (typeof proof === "string") return null;
  if (proof.calls.length === 0) return unreachable("the enclosing function is never invoked", loc);
  const sf = call.getSourceFile();
  const specs: string[] = [];
  for (const c of proof.calls) {
    const spec = constantSpecifier(L, c.arguments[0]!);
    if (spec === null) return null;
    if (!specs.includes(spec)) specs.push(spec);
  }
  const arms: Array<{ spec: string; throwExpr: IrExpr }> = [];
  for (const spec of specs) {
    if (spec === "") {
      arms.push({
        spec,
        throwExpr: nodeThrowExpr(1, "ERR_INVALID_ARG_VALUE", "The argument 'id' must be a non-empty string. Received ''", DYN, loc),
      });
      continue;
    }
    const refusal = probeNodeRequireRefusal(sf.fileName, spec);
    if (refusal !== null) {
      arms.push({ spec, throwExpr: nodeThrowExpr(0, "MODULE_NOT_FOUND", refusalMessage(L, call, spec, refusal.message), DYN, loc) });
      continue;
    }
    const rel = relativeRequireRefusal(L.requireThrowCtx, sf, spec);
    if (rel !== null) {
      arms.push({ spec, throwExpr: nodeThrowExpr(0, "MODULE_NOT_FOUND", refusalMessage(L, call, spec, rel.message), DYN, loc) });
      continue;
    }
    return null; // Node resolves it: the module value is needed
  }
  const e = L.lowerExprExpecting(call.arguments[0]!, DYN);
  // The proof says no other specifier reaches here; the fall-through is a
  // trap that names itself, so a hole in the proof is loud, not a wrong answer.
  let out: IrExpr = unreachable("a specifier outside the proven set reached the require", loc);
  for (let i = arms.length - 1; i >= 0; i--) {
    const arm = arms[i]!;
    const test: IrExpr = {
      kind: "dynScalarEq",
      left: e,
      right: { kind: "strLit", value: arm.spec, type: STRING, loc },
      type: BOOL,
      loc,
    };
    out = { kind: "ternary", cond: test, then: arm.throwExpr, else_: out, type: DYN, loc };
  }
  return out;
}
