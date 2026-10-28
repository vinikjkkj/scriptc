/* LIVE export objects (a CommonJS JS module whose export object is used as a VALUE).
 *
 * `exports` / `module.exports` passed, stored or aliased (`merge(exports, src)`,
 * `new Codec(opts, module.exports)`, `var alias = module.exports`) is the one
 * object Node shares between every writer and every reader. Writes through
 * a callee land in it after the module body ran, so a static per-member
 * global (the export table) would silently diverge from it. A LIVE module
 * keeps its whole export object in the module's exports bag (cjsExportsBagOf):
 * a dyn object created at module init. Every member write and read in the
 * module, every bare `exports` / `module.exports` value, and every member read,
 * call and bare value of a requirer's namespace binding goes through that bag.
 * No member gets a static global, so no reader can see a stale copy.
 *
 * TABLE EXPORTS (`module.exports = { k: v, ... }`, the only replacement): the table is live when
 * the export object is WRITTEN or ESCAPES as a value, decided closed-world over the program: a member
 * write, a `__defineSetter__`/`__defineGetter__`/`Object.defineProperty` on the object, or a value use
 * of it, in the module itself or in ANY requirer's `const m = require(spec)` binding (outsideEscapesOf).
 * A live table stores each entry into the bag at its statement (liveTableStmt), so a requirer's
 * `m.k = v` (liveWriteBagOf), `m.k op= v` (liveCompoundStmtOf) and `m[k] = v` land in the object the
 * module reads back. A table with accessor, spread or computed entries keeps the static table, and a
 * file that names a bare `exports` after its replacement keeps its refusal (orphanTableWriteOf).
 *
 * Gates (any miss keeps today's behaviour): CommonJS JS file; no whole-export replacement other than
 * one literal table (`tableShapeOf`); a live table has no bare `exports` identifier; `exports` /
 * `module.exports` used as a value, or a requirer write / escape, makes the object live. Shadowed
 * names are not the export object.
 *
 * The walk is ITERATIVE (explicit stack): it can run before the compiler's depth
 * guard, and errors.test.ts compiles a 7000-level nested expression. */
import * as ts from "../ts7/adapter.js";
import { BOOL, DYN, F64, STRING, VOID, type IrExpr, type IrStmt, type SrcLoc } from "../../ir/nodes.js";
import { cjsExportAssignmentOf, cjsWholeExportAssignmentOf, isCjsJsFile, isModuleExportsAccess, npmStaticDepSf7, requireSpecOf, resolveImport } from "../program.js";
import { isRelativeSpecifier } from "../shared.js";
import type { Lowerer } from "./lowerer.js";
import { compoundCombine, cjsExportsBagOf } from "./lower-exprs.js";

const liveMemo = new WeakMap<ts.SourceFile, boolean>();

/** True when `n` (an `exports` identifier or a `module.exports` access) is read as a VALUE: not the
 * object of a property or element access, not a property name, not the target of an assignment.
 * Decided on the source text around the node, not on parent pointers (the adapter's parents do not
 * always name the property access that owns the identifier). */
export function isValueUse(n: ts.Node): boolean {
  const text = n.getSourceFile().text;
  let i = n.getStart() - 1;
  while (i >= 0 && /\s/.test(text[i]!)) i--;
  if (text[i] === ".") return false;
  let j = n.end;
  while (j < text.length && /\s/.test(text[j]!)) j++;
  const c = text[j];
  if (c === "." || c === "[") return false;
  if (c === "?" && text[j + 1] === ".") return false;
  // `Object.defineProperty(exports, "K", {...})` (and Reflect's): the accessor/value definition the
  // export-accessor machinery answers (cjsExportsGetterDefineOf). The object does not escape.
  const par = n.parent;
  if (par !== undefined && ts.isCallExpression(par) && par.arguments[0] === n) {
    const callee = par.expression;
    if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) &&
        (callee.expression.text === "Object" || callee.expression.text === "Reflect") &&
        (callee.name.text === "defineProperty" || callee.name.text === "defineProperties")) return false;
  }
  if (c === "=" && text[j + 1] !== "=" && text[j + 1] !== ">") return false;
  return true;
}

function unshadowed(L: Lowerer, n: ts.Identifier): boolean {
  const sym = L.checker.getSymbolAtLocation(n);
  if (sym === undefined) return true;
  for (const d of L.checker.declarationsOf(sym)) {
    for (let f: ts.Node | undefined = n.parent; f !== undefined && !ts.isSourceFile(f); f = f.parent) {
      if (ts.isFunctionLike(f) && d.pos >= f.pos && d.end <= f.end) return false;
    }
  }
  return true;
}

/** How an export-object reference `r` (a `module.exports` access, or a require binding's identifier, or a
 * `require(spec)` call) is used: "write" when a member of it is stored or defined (`r.k = v`, `r.k++`,
 * `delete r.k`, `r.__defineSetter__(k, f)`, `Object.defineProperty(r, ...)`), "escape" when the object
 * itself is a value (passed, stored, compared, aliased), "read" for a member read or call, "replace" for
 * the `module.exports = ...` replacement itself. A value escape and a write both make the object live. */
export function exportObjectUseOf(r: ts.Expression): "write" | "escape" | "read" | "replace" {
  let node: ts.Node = r;
  let p = node.parent;
  while (p !== undefined && ts.isParenthesizedExpression(p)) { node = p; p = p.parent; }
  if (p === undefined) return "escape";
  if (ts.isBinaryExpression(p) && p.left === node) {
    return p.operatorToken.kind === ts.SyntaxKind.EqualsToken ? "replace" : "write";
  }
  if (ts.isPropertyAccessExpression(p) || ts.isElementAccessExpression(p)) {
    if (p.expression !== node) return "escape";
    let gp: ts.Node | undefined = p.parent;
    while (gp !== undefined && ts.isParenthesizedExpression(gp)) gp = gp.parent;
    if (gp !== undefined && ts.isBinaryExpression(gp) && gp.left === p) {
      const k = gp.operatorToken.kind;
      const isAssign = k >= ts.SyntaxKind.FirstAssignment && k <= ts.SyntaxKind.LastAssignment;
      if (isAssign) return "write";
    }
    if (gp !== undefined && (ts.isPrefixUnaryExpression(gp) || ts.isPostfixUnaryExpression(gp)) &&
        (gp.operator === ts.SyntaxKind.PlusPlusToken || gp.operator === ts.SyntaxKind.MinusMinusToken)) return "write";
    if (gp !== undefined && ts.isDeleteExpression(gp)) return "write";
    if (ts.isPropertyAccessExpression(p) && gp !== undefined && ts.isCallExpression(gp) && gp.expression === p &&
        p.name.text.startsWith("__define")) return "write";
    return "read";
  }
  if (ts.isCallExpression(p) && p.arguments[0] === node) {
    const callee = p.expression;
    if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) &&
        (callee.expression.text === "Object" || callee.expression.text === "Reflect") &&
        (callee.name.text === "defineProperty" || callee.name.text === "defineProperties" ||
         callee.name.text === "assign" || callee.name.text === "set" || callee.name.text === "deleteProperty")) return "write";
    // Read-only consumers: they enumerate or print the object and cannot store into it.
    if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)) {
      const o = callee.expression.text;
      const m = callee.name.text;
      if ((o === "Object" && (m === "keys" || m === "values" || m === "entries" || m === "getOwnPropertyNames" ||
           m === "getOwnPropertyDescriptor" || m === "getOwnPropertyDescriptors" || m === "hasOwn")) ||
          (o === "JSON" && m === "stringify") ||
          (o === "console" && (m === "log" || m === "info" || m === "warn" || m === "error" || m === "debug"))) return "read";
    }
  }
  // Read-only operators: `'k' in o`, `typeof o`, `!o`, and every equality test (identity is refused separately).
  if (ts.isBinaryExpression(p) && p.right === node && p.operatorToken.kind === ts.SyntaxKind.InKeyword) return "read";
  // Equality tests compare IDENTITY: both sides are the module's one bag (liveIdentityRefOf), so the object is
  // a value that must be live.
  if (ts.isTypeOfExpression(p) || (ts.isPrefixUnaryExpression(p) && p.operator === ts.SyntaxKind.ExclamationToken)) return "read";
  return "escape";
}

/** Whether the file has a bare `exports` identifier (not the name of a `.exports` property). A table export
 * (`module.exports = {...}`) keeps the orphan-object reads of `exports` after the replacement, so the live
 * table form does not model them: a file that names `exports` at all keeps the static table. */
function hasBareExportsIdent(sf: ts.SourceFile): boolean {
  const stack: ts.Node[] = [sf];
  while (stack.length > 0) {
    const n = stack.pop()!;
    if (ts.isIdentifier(n) && n.text === "exports") {
      const p = n.parent;
      if (!(p !== undefined && ts.isPropertyAccessExpression(p) && p.name === n)) return true;
    }
    ts.forEachChild(n, (c) => {
      stack.push(c);
    });
  }
  return false;
}

/** The shape of a CommonJS file's whole-export statements: "none" (no replacement), "table" (exactly one
 * replacement, `module.exports = { literal }` as a statement, and no bare `exports` in the file), or "other"
 * (any other replacement, which keeps the static export machinery). */
function tableShapeOf(sf: ts.SourceFile): "none" | "table" | "other" {
  let whole = 0;
  let table = false;
  for (const stmt of sf.statements) {
    if (cjsWholeExportAssignmentOf(stmt) === null) continue;
    whole++;
    const rec = cjsExportAssignmentOf(stmt);
    // Only plain `name: value` / shorthand entries: the live statement stores each one; accessor, spread and
    // computed entries keep the static table (their own lifts).
    if (whole === 1 && rec?.kind === "table" && rec.obj !== null && ts.isExpressionStatement(stmt) &&
        stmt.expression === rec.expr && isModuleExportsAccess(rec.expr.left) &&
        rec.obj.properties.every((p) => ts.isShorthandPropertyAssignment(p) ||
          (ts.isPropertyAssignment(p) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name) || ts.isNumericLiteral(p.name))))) table = true;
    else return "other";
  }
  if (whole === 0) return "none";
  if (!table || hasBareExportsIdent(sf)) return "other";
  return "table";
}

/** The CommonJS module a `require(spec)` call loads, resolved from `from`, or null. */
function requireTargetOfSpec(L: Lowerer, from: ts.SourceFile, spec: string): ts.SourceFile | null {
  const dep = isRelativeSpecifier(spec)
    ? resolveImport(L.program, from, spec) ?? null
    : npmStaticDepSf7(L.program, from, spec);
  if (dep === null) return null;
  // An npm package's entry is its declaration (`index.d.ts`); the module object is the compiled twin.
  const js = dep.isDeclarationFile ? L.declTwinSourceOf(dep) : dep;
  return js !== null && isCjsJsFile(js) ? js : null;
}

const escapeMemo = new WeakMap<ts.Program, Set<ts.SourceFile>>();

/** Every CommonJS module whose export object is WRITTEN or escapes as a value through a require binding of
 * it, anywhere in the program (closed world): a `const d = require(spec)` whose uses are member writes or
 * value escapes, and a direct `require(spec).k = v`. Decided once per program. */
function outsideEscapesOf(L: Lowerer): Set<ts.SourceFile> {
  const known = escapeMemo.get(L.program);
  if (known !== undefined) return known;
  const out = new Set<ts.SourceFile>();
  for (const f of L.program.getSourceFiles()) {
    if (f.isDeclarationFile || !f.text.includes("require(")) continue;
    const bindings = new Map<string, ts.VariableDeclaration[]>();
    const stack: ts.Node[] = [f];
    while (stack.length > 0) {
      const n = stack.pop()!;
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer !== undefined && requireSpecOf(n.initializer) !== null) {
        const list = bindings.get(n.name.text) ?? [];
        list.push(n);
        bindings.set(n.name.text, list);
      }
      // A direct `require(spec).k = v` (or `.__defineSetter__`, `++`, `delete`) writes the export object too.
      if (ts.isCallExpression(n)) {
        const spec = requireSpecOf(n);
        if (spec !== null && (exportObjectUseOf(n) === "write" || exportObjectUseOf(n) === "escape")) {
          const dep = requireTargetOfSpec(L, f, spec);
          if (dep !== null) out.add(dep);
        }
      }
      ts.forEachChild(n, (c) => {
        stack.push(c);
      });
    }
    if (bindings.size === 0) continue;
    const stack2: ts.Node[] = [f];
    while (stack2.length > 0) {
      const n = stack2.pop()!;
      if (ts.isIdentifier(n) && bindings.has(n.text)) {
        const sym = L.checker.getSymbolAtLocation(n);
        const decl = sym ? L.checker.declarationsOf(sym).find(ts.isVariableDeclaration) : undefined;
        const isDecl = n.parent !== undefined && ts.isVariableDeclaration(n.parent) && n.parent.name === n;
        if (decl !== undefined && !isDecl && bindings.get(n.text)!.includes(decl)) {
          const use = exportObjectUseOf(n);
          if (use === "write" || use === "escape") {
            const spec = requireSpecOf(decl.initializer!)!;
            const dep = requireTargetOfSpec(L, f, spec);
            if (dep !== null) out.add(dep);
          }
        }
      }
      ts.forEachChild(n, (c) => {
        stack2.push(c);
      });
    }
  }
  escapeMemo.set(L.program, out);
  return out;
}

function computeLive(L: Lowerer, sf: ts.SourceFile): boolean {
  if (!isCjsJsFile(sf)) return false;
  const shape = tableShapeOf(sf);
  if (shape === "other") return false;
  if (outsideEscapesOf(L).has(sf)) return true;
  if (shape === "table") {
    // A literal table export: live when the module's own object is written or escapes as a value
    // (`module.exports.k = v`, `module.exports.__defineSetter__(...)`, `const self = module.exports`).
    const stack: ts.Node[] = [sf];
    while (stack.length > 0) {
      const n = stack.pop()!;
      if (isModuleExportsAccess(n as ts.Expression)) {
        const use = exportObjectUseOf(n as ts.Expression);
        if (use === "write" || use === "escape") return true;
      }
      ts.forEachChild(n, (c) => {
        stack.push(c);
      });
    }
    return false;
  }
  const stack: ts.Node[] = [sf];
  while (stack.length > 0) {
    const n = stack.pop()!;
    if (ts.isIdentifier(n) && n.text === "exports" && isValueUse(n) && unshadowed(L, n)) {
      return true;
    }
    if (isModuleExportsAccess(n as ts.Expression) && isValueUse(n)) {
      const m = (n as ts.PropertyAccessExpression).expression;
      if (ts.isIdentifier(m) && unshadowed(L, m)) return true;
    }
    ts.forEachChild(n, (c) => {
      stack.push(c);
    });
  }
  return false;
}

/** True when the file's export object is a live (bag-held) object. */
export function liveExportsOf(L: Lowerer, sf: ts.SourceFile): boolean {
  const known = liveMemo.get(sf);
  if (known !== undefined) return known;
  const r = computeLive(L, sf);
  liveMemo.set(sf, r);
  return r;
}

/** The bag of a live module as a DYN value (the module's export object). A reference from ANOTHER module
 * (a require binding, possibly a function-local `require` that never ran the module's init) runs the module's
 * init first: the bag is created there (lower-modules.ts), so the reference must see it created. The module's
 * own references (`loc.file` is the module) read its bag directly, since the module is initializing. */
export function liveBagRef(L: Lowerer, sf: ts.SourceFile, loc: SrcLoc): IrExpr {
  const bag: IrExpr = { kind: "varRef", localId: cjsExportsBagOf(L, sf), type: DYN, loc };
  const init = L.initNameOf.get(sf);
  if (loc.file === sf.fileName || init === undefined || L.asyncInitFiles.has(sf)) return bag;
  L.noteEdge(init);
  return {
    kind: "seqExpr",
    stmts: [{ kind: "exprStmt", expr: { kind: "call", callee: init, args: [], type: VOID, loc }, loc }],
    result: bag,
    type: DYN,
    loc,
  };
}

/** The live module a requirer's namespace binding (`const m = require("./x")`)
 * names, or null. The binding must be a CommonJS namespace binding
 * (cjsLocalModuleBindingOf) whose dep is live. */
export function liveDepOfBinding(L: Lowerer, recv: ts.Expression): ts.SourceFile | null {
  if (!ts.isIdentifier(recv) || !L.cjsLocalModuleBindingOf(recv)) return null;
  const dep = L.cjsBindingRequireDepOf(recv);
  if (dep === null) return null;
  const live = liveTwinOf(L, dep);
  // A module the program graph does not load (a `require` only nested functions name: no top-level edge)
  // has no init to run at the reference, so its bag may not exist yet. Such a binding keeps the static path's
  // refusal rather than reading a bag nothing created; an async-init module has no synchronous init either.
  if (live === null || L.initNameOf.get(live) === undefined || L.asyncInitFiles.has(live)) return null;
  return live;
}

/** The LIVE compiled module a requirer's binding resolves to: the module itself when it is a
 * live CommonJS JS file, or its compiled twin when the binding resolved to the module's
 * declaration (`.d.ts`) and that twin is live. Null otherwise. */
export function liveTwinOf(L: Lowerer, sf: ts.SourceFile): ts.SourceFile | null {
  if (!sf.isDeclarationFile) return liveExportsOf(L, sf) ? sf : null;
  const twin = L.declTwinSourceOf(sf);
  return twin !== null && liveExportsOf(L, twin) ? twin : null;
}

/** The live module a NAMED import binding (`import { getDecoder } from "m"`, or a value
 * destructured from a declaration) names, read through the declaration's compiled twin. */
export function liveNamedTwinOf(L: Lowerer, sym: ts.Symbol): ts.SourceFile | null {
  const decls = L.checker.declarationsOf(sym);
  if (decls.length === 0) return null;
  const sf = decls[0]!.getSourceFile();
  if (!sf.isDeclarationFile) return null;
  return liveTwinOf(L, sf);
}

/** True when `init` evaluates to a live export object: the module's own `exports` / `module.exports`
 * (in a live file), or a requirer's namespace binding over a live module. */
export function isLiveExportValue(L: Lowerer, init: ts.Expression): boolean {
  let e: ts.Expression = init;
  while (ts.isParenthesizedExpression(e)) e = e.expression;
  if (ts.isIdentifier(e) && e.text === "exports" && isCjsJsFile(e.getSourceFile()) && unshadowed(L, e)) {
    return liveExportsOf(L, e.getSourceFile());
  }
  if (isModuleExportsAccess(e)) {
    const m = e.expression as ts.Identifier;
    return isCjsJsFile(e.getSourceFile()) && unshadowed(L, m) && liveExportsOf(L, e.getSourceFile());
  }
  if (ts.isIdentifier(e)) return liveDepOfBinding(L, e) !== null;
  return false;
}

/** A binding name whose initializer is a live export object: its storage is the DYN bag reference
 * (`var alias = module.exports`), not the checker's record of the export object. */
export function isLiveAliasName(L: Lowerer, name: ts.Identifier): boolean {
  const d = name.parent;
  if (!ts.isVariableDeclaration(d) || d.name !== name || d.initializer === undefined) return false;
  return isLiveExportValue(L, d.initializer);
}

/** A value lowered to the checked-dynamic tier (the bag holds dyn values; a closure or a primitive is boxed). */
export function dynValueOf(L: Lowerer, node: ts.Expression): IrExpr {
  const lowered = ts.isNumericLiteral(node) ? L.lowerExpr(node) : L.lowerExprExpecting(node, DYN);
  return lowered.type.kind === "dyn" ? lowered : L.coerceInto(node, lowered, DYN);
}

/** The live table statement `module.exports = { k: v, ... }` of a live module: the bag is created (or kept)
 * and every entry is stored into it at this statement, so the bag holds the values Node's export object
 * holds here. Entries Node defines in a form the bag cannot carry keep their fence. */
export function liveTableStmt(L: Lowerer, sf: ts.SourceFile, obj: ts.ObjectLiteralExpression, loc: SrcLoc): IrStmt {
  const bag = cjsExportsBagOf(L, sf);
  const bagRef = (): IrExpr => ({ kind: "varRef", localId: bag, type: DYN, loc });
  const body: IrStmt[] = [
    { kind: "assign", localId: bag, value: { kind: "libCall", fn: "cls.propsEnsure", args: [bagRef()], type: DYN, loc }, loc },
  ];
  for (const prop of obj.properties) {
    let key: string | null = null;
    let valueNode: ts.Expression | null = null;
    if (ts.isShorthandPropertyAssignment(prop)) {
      const sn = prop.name as ts.Identifier;
      key = sn.text;
      valueNode = sn;
    } else if (ts.isPropertyAssignment(prop)) {
      // A computed name is not a static key; the table keeps its fence.
      const pn = prop.name;
      if (ts.isIdentifier(pn) || ts.isStringLiteral(pn)) key = pn.text;
      else if (ts.isNumericLiteral(pn)) key = String(Number(pn.text));
      valueNode = prop.initializer;
    }
    if (key === null || valueNode === null) {
      L.unsupported(
        "SC1090",
        prop,
        "module.exports table entries beyond plain 'name: value' properties in a module whose export object is written (methods, accessors, spreads, computed names)",
      );
      continue;
    }
    body.push({
      kind: "exprStmt",
      expr: {
        kind: "libCall",
        fn: "dyn.keySet",
        args: [bagRef(), { kind: "strLit", value: key, type: STRING, loc }, dynValueOf(L, valueNode)],
        type: VOID,
        loc,
      },
      loc,
    });
  }
  return { kind: "block", body, loc };
}

/** The bag a member WRITE on a requirer's namespace binding lands in (`d.k = v` with `d = require(M)`, M
 * live), or null when the receiver is not a live binding. */
export function liveWriteBagOf(L: Lowerer, recv: ts.Expression, loc: SrcLoc): IrExpr | null {
  const ld = liveDepOfBinding(L, recv);
  return ld === null ? null : liveBagRef(L, ld, loc);
}

/** `R.__defineSetter__(k, f)` / `R.__defineGetter__(k, f)`: Node defines an ENUMERABLE, CONFIGURABLE accessor on
 * R. R is the bag of a live export object (`module.exports` of a live module, or a live requirer binding), or any
 * checked-dynamic value; the accessor is the dyn defineProperty's, which runs the setter/getter on every access.
 * Null for any other receiver (its own lowering keeps its answer). */
export function defineAccessorCallOf(L: Lowerer, call: ts.CallExpression, loc: SrcLoc): IrExpr | null {
  const callee = call.expression;
  if (!ts.isPropertyAccessExpression(callee) || callee.questionDotToken !== undefined) return null;
  const name = callee.name.text;
  if (name !== "__defineSetter__" && name !== "__defineGetter__") return null;
  if (call.arguments.length !== 2 || call.arguments.some(ts.isSpreadElement)) return null;
  const recvNode = callee.expression;
  let recv: IrExpr | null = null;
  if (isModuleExportsAccess(recvNode) && isCjsJsFile(recvNode.getSourceFile()) && liveExportsOf(L, recvNode.getSourceFile())) {
    recv = liveBagRef(L, recvNode.getSourceFile(), loc);
  } else if (ts.isIdentifier(recvNode)) {
    recv = liveWriteBagOf(L, recvNode, loc);
  }
  if (recv === null) {
    // A receiver typed `any` / `unknown` (or JS implicit any) is the checked-dynamic tier; anything else keeps its own lowering.
    const tf = L.typeOf(recvNode).flags;
    const dynTyped = (tf & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) !== 0 || L.mapTypeOf(L.typeOf(recvNode))?.kind === "dyn";
    if (!dynTyped) return null;
    recv = L.lowerExprExpecting(recvNode, DYN);
  }
  const key = L.lowerExprExpecting(call.arguments[0]!, STRING);
  if (key.type.kind !== "string") return null;
  const fn = dynValueOf(L, call.arguments[1]!);
  const flag = (v: boolean): IrExpr => ({ kind: "dynFrom", value: { kind: "boolLit", value: v, type: BOOL, loc }, type: DYN, loc });
  const desc: IrExpr = {
    kind: "dynObjLit",
    fields: [
      { key: { kind: "strLit", value: name === "__defineSetter__" ? "set" : "get", type: STRING, loc }, value: fn },
      { key: { kind: "strLit", value: "enumerable", type: STRING, loc }, value: flag(true) },
      { key: { kind: "strLit", value: "configurable", type: STRING, loc }, value: flag(true) },
    ],
    type: DYN,
    loc,
  };
  return { kind: "libCall", fn: "dyn.defineProp", args: [recv, key, desc], type: DYN, loc };
}

/** The bag of a LIVE export object named by `node`: `module.exports` of a live module, a bare `exports` of a live
 * module (not shadowed), or a live requirer binding. Null for any other node. */
export function liveRecvBagOf(L: Lowerer, node: ts.Expression, loc: SrcLoc): IrExpr | null {
  if (isModuleExportsAccess(node)) {
    const sf = node.getSourceFile();
    return isCjsJsFile(sf) && liveExportsOf(L, sf) ? liveBagRef(L, sf, loc) : null;
  }
  if (ts.isIdentifier(node)) {
    if (node.text === "exports") {
      const sf = node.getSourceFile();
      return isCjsJsFile(sf) && liveExportsOf(L, sf) && unshadowed(L, node) && L.resolveLocal(node) === null
        ? liveBagRef(L, sf, loc) : null;
    }
    return liveWriteBagOf(L, node, loc);
  }
  return null;
}

/** A compound assignment (`R.k op= rhs`) or increment (`R.k++`) over a live export object: the read-modify-write
 * on the bag, with the operator's own JS conversion (compoundCombine's dyn arm). Null for any other target. */
export function liveCompoundStmtOf(
  L: Lowerer,
  access: ts.Expression,
  op: "+" | "-" | "*" | "/" | "%" | "**" | "&" | "|" | "^" | "<<" | ">>" | ">>>",
  rhsNode: ts.Expression | null,
  blame: ts.Node,
  loc: SrcLoc,
): IrStmt | null {
  if (!ts.isPropertyAccessExpression(access) || access.questionDotToken !== undefined) return null;
  const bag = liveRecvBagOf(L, access.expression, loc);
  if (bag === null) return null;
  const key: IrExpr = { kind: "strLit", value: access.name.text, type: STRING, loc };
  const read: IrExpr = { kind: "dynKeyGet", key, optional: true, value: bag, type: DYN, loc };
  const rhs: IrExpr = rhsNode === null ? { kind: "dynFrom", value: { kind: "numLit", value: 1, type: F64, loc }, type: DYN, loc } : dynValueOf(L, rhsNode);
  const combined = compoundCombine(L, op, read, rhs, DYN, blame, access, rhsNode ?? blame, loc);
  if (combined === null) return null;
  const stored = combined.toSlot(combined.natural);
  return { kind: "exprStmt", expr: { kind: "libCall", fn: "dyn.keySet", args: [liveRecvBagOf(L, access.expression, loc)!, key, stored], type: VOID, loc }, loc };
}

/** `Object.defineProperty(R, k, desc)` over a LIVE export object R (`module.exports` of a live module, `exports`,
 * or a live requirer binding): the descriptor defines the member on the bag, exactly as on the object Node
 * defines it on. Null for any other target. */
export function liveDefinePropOf(L: Lowerer, call: ts.CallExpression, loc: SrcLoc): IrExpr | null {
  if (call.arguments.length !== 3 || call.arguments.some(ts.isSpreadElement)) return null;
  const bag = liveRecvBagOf(L, call.arguments[0]!, loc);
  if (bag === null) return null;
  const key = L.lowerExprExpecting(call.arguments[1]!, STRING);
  if (key.type.kind !== "string") return null;
  const desc = L.lowerExprExpecting(call.arguments[2]!, DYN);
  if (desc.type.kind !== "dyn") return null;
  return { kind: "libCall", fn: "dyn.defineProp", args: [bag, key, desc], type: DYN, loc };
}

/** True when `recv` is a require binding of a CommonJS module whose export is a literal table AND which also names
 * a bare `exports` (after the replacement `exports` is the discarded object, which the live table form does not
 * model). A member write through such a binding has no lowering: the caller refuses it at compile time. */
export function orphanTableWriteOf(L: Lowerer, recv: ts.Expression): boolean {
  if (!ts.isIdentifier(recv)) return false;
  const dep = L.cjsBindingRequireDepOf(recv);
  if (dep === null || !isCjsJsFile(dep)) return false;
  let whole = 0;
  let table = false;
  for (const stmt of dep.statements) {
    if (cjsWholeExportAssignmentOf(stmt) === null) continue;
    whole++;
    const rec = cjsExportAssignmentOf(stmt);
    if (whole === 1 && rec?.kind === "table" && rec.obj !== null) table = true;
  }
  return table && hasBareExportsIdent(dep);
}

/** A property key of a dynamic access over a live export object: a string key as is, a number, boolean or dyn key
 * converted by the operator's own ToString (`toString`, the element path's stance). Null for another key type. */
export function liveKeyOf(L: Lowerer, arg: ts.Expression): IrExpr | null {
  let key = L.lowerExpr(arg);
  if (key.type.kind === "f64" || key.type.kind === "bool" || key.type.kind === "dyn") {
    key = { kind: "toString", operand: key, type: STRING, loc: key.loc };
  }
  return key.type.kind === "string" ? key : null;
}

/** The DYN bag of a LIVE export object reference (`require` binding, the module's own `exports` /
 * `module.exports`, or an alias variable holding one), or null. Identity compares of these are exact: every
 * reference to one module is the same bag object. */
export function liveIdentityRefOf(L: Lowerer, e: ts.Expression, loc: SrcLoc): IrExpr | null {
  let x: ts.Expression = e;
  while (ts.isParenthesizedExpression(x)) x = x.expression;
  const dep = liveDepOfBinding(L, x);
  if (dep !== null) return liveBagRef(L, dep, loc);
  if (isLiveExportValue(L, x)) return liveBagRef(L, x.getSourceFile(), loc);
  if (ts.isIdentifier(x)) {
    const sym = L.checker.getSymbolAtLocation(x);
    const decl = sym ? L.checker.declarationsOf(sym).find(ts.isVariableDeclaration) : undefined;
    if (decl !== undefined && decl.initializer !== undefined && isLiveExportValue(L, decl.initializer)) {
      const lowered = L.lowerExpr(x);
      if (lowered.type.kind === "dyn") return lowered;
    }
  }
  return null;
}
