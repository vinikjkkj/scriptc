/* FUNCTION-CONSTRUCTOR STAGING.
 *
 *     new Function(P1, ..., Pn, BODY)      Function(P1, ..., Pn, BODY)
 *     Function.apply(null, [P1, ..., Pn, BODY])
 *
 * compiles functions from text at run time, which a native binary cannot do. When
 * every argument is a ROPE of program-known constants and typed data holes, the
 * text is known at build time up to the holes, so the construct is rewritten into
 * the function expression the text denotes. Holes (`JSON.stringify(e)`) are the
 * run-time values the text would have carried as literals: the text of the hole is
 * captured where the Function expression would have run and re-read where the
 * literal would have been parsed (`JSON.parse`), the exact value (and a fresh
 * object per evaluation) the parsed literal has.
 *
 * Soundness (each failure leaves the site untouched, so the loud SC2020 build
 * error stays; nothing becomes a run-time throw):
 *  - the whole text must fold; a hole must sit in expression position;
 *  - the parameter list and the body must each parse on their own (what the
 *    Function constructor requires; Node throws SyntaxError at run time otherwise);
 *  - Function bodies see only the GLOBAL scope: every free identifier of the new
 *    function must not resolve to any declaration at the site, and the CommonJS
 *    wrapper names (require, module, ...) and `anonymous` are refused;
 *  - a hole reached through a `const` binding is re-evaluated at the site, so it
 *    must be stable (a literal, or an identifier with no writes).
 * Purely syntactic (typescript5, the sanctioned parsing island). */
import ts from "typescript5";

interface Edit {
  start: number;
  end: number;
  text: string;
}

type Piece = { k: "c"; s: string } | { k: "h"; call: ts.CallExpression };
type Rope = Piece[];
/** One build-time VARIANT of a text: the choices (guards) that select it and its rope. */
interface Guard {
  cond: ts.Expression;
  pos: boolean;
}
interface Alt {
  guards: Guard[];
  rope: Rope;
}
const MAX_VARIANTS = 64;

function joinGuards(a: Guard[], b: Guard[]): Guard[] | null {
  const out = [...a];
  for (const g of b) {
    const same = out.find((x) => x.cond === g.cond);
    if (same === undefined) out.push(g);
    else if (same.pos !== g.pos) return null; // contradictory: this combination cannot happen
  }
  return out;
}
function cat(a: Alt[], b: Alt[]): Alt[] | null {
  const out: Alt[] = [];
  for (const x of a) {
    for (const y of b) {
      const g = joinGuards(x.guards, y.guards);
      if (g === null) continue;
      out.push({ guards: g, rope: [...x.rope, ...y.rope] });
      if (out.length > MAX_VARIANTS) return null;
    }
  }
  return out;
}

const WRAPPER_NAMES = new Set(["require", "module", "exports", "__filename", "__dirname", "anonymous"]);

/* ── scopes ─────────────────────────────────────────────────────────────── */

function bindingNames(b: ts.BindingName, out: Set<string>): void {
  if (ts.isIdentifier(b)) {
    out.add(b.text);
    return;
  }
  for (const e of b.elements) if (ts.isBindingElement(e)) bindingNames(e.name, out);
}

function isFnLike(n: ts.Node): n is ts.FunctionLikeDeclaration {
  return (
    ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n) || ts.isMethodDeclaration(n) ||
    ts.isConstructorDeclaration(n) || ts.isGetAccessorDeclaration(n) || ts.isSetAccessorDeclaration(n)
  );
}

/** Names `var` hoists to the function scope (deep, not into nested functions). */
function collectVars(n: ts.Node, out: Set<string>): void {
  if (ts.isVariableDeclarationList(n) && (n.flags & (ts.NodeFlags.Let | ts.NodeFlags.Const)) === 0) {
    for (const d of n.declarations) bindingNames(d.name, out);
  }
  if (isFnLike(n) || ts.isClassLike(n)) return;
  ts.forEachChild(n, (c) => collectVars(c, out));
}

/** let/const/class/function names declared by the direct statements of a block. */
function lexicalNames(stmts: readonly ts.Statement[], out: Set<string>): void {
  for (const s of stmts) {
    if (ts.isVariableStatement(s) && (s.declarationList.flags & (ts.NodeFlags.Let | ts.NodeFlags.Const)) !== 0) {
      for (const d of s.declarationList.declarations) bindingNames(d.name, out);
    } else if ((ts.isFunctionDeclaration(s) || ts.isClassDeclaration(s)) && s.name !== undefined) {
      out.add(s.name.text);
    } else if (ts.isImportDeclaration(s) && s.importClause !== undefined) {
      const c = s.importClause;
      if (c.name !== undefined) out.add(c.name.text);
      if (c.namedBindings !== undefined) {
        if (ts.isNamespaceImport(c.namedBindings)) out.add(c.namedBindings.name.text);
        else for (const e of c.namedBindings.elements) out.add(e.name.text);
      }
    }
  }
}

function fnScopeNames(f: ts.FunctionLikeDeclaration, out: Set<string>): void {
  for (const p of f.parameters) bindingNames(p.name, out);
  if (!ts.isArrowFunction(f)) out.add("arguments");
  if (ts.isFunctionExpression(f) && f.name !== undefined) out.add(f.name.text);
  if (f.body !== undefined) {
    collectVars(f.body, out);
    if (ts.isBlock(f.body)) lexicalNames(f.body.statements, out);
  }
}

/** Does a declaration of `name` enclose `node`? (any enclosing scope) */
interface Decl {
  varDecl?: ts.VariableDeclaration;
  isParam: boolean;
}
function findDecl(name: string, node: ts.Node): Decl | null {
  for (let a: ts.Node | undefined = node.parent; a !== undefined; a = a.parent) {
    if (isFnLike(a)) {
      for (const p of a.parameters) {
        const s = new Set<string>();
        bindingNames(p.name, s);
        if (s.has(name)) return { isParam: true };
      }
      if (name === "arguments" && !ts.isArrowFunction(a)) return { isParam: false };
      if (ts.isFunctionExpression(a) && a.name?.text === name) return { isParam: false };
      if (a.body !== undefined && ts.isBlock(a.body)) {
        const v = findVarDecl(name, a.body, true);
        if (v !== undefined) return v;
        const l = new Set<string>();
        lexicalNames(a.body.statements, l);
        if (l.has(name)) return { isParam: false };
      }
    } else if (ts.isBlock(a) || ts.isSourceFile(a) || ts.isCaseBlock(a)) {
      const stmts = ts.isCaseBlock(a) ? a.clauses.flatMap((c) => [...c.statements]) : a.statements;
      for (const s of stmts) {
        if (ts.isVariableStatement(s) && (s.declarationList.flags & (ts.NodeFlags.Let | ts.NodeFlags.Const)) !== 0) {
          const d = declIn(s.declarationList, name);
          if (d !== undefined) return d;
        }
      }
      const l = new Set<string>();
      lexicalNames(stmts, l);
      if (l.has(name)) return { isParam: false };
      if (ts.isSourceFile(a)) {
        const v = findVarDecl(name, a, true);
        if (v !== undefined) return v;
      }
    } else if (ts.isForStatement(a) || ts.isForInStatement(a) || ts.isForOfStatement(a)) {
      const init = ts.isForStatement(a) ? a.initializer : a.initializer;
      if (init !== undefined && ts.isVariableDeclarationList(init)) {
        const d = declIn(init, name);
        if (d !== undefined) return d;
      }
    } else if (ts.isCatchClause(a)) {
      if (a.variableDeclaration !== undefined) {
        const s = new Set<string>();
        bindingNames(a.variableDeclaration.name, s);
        if (s.has(name)) return { isParam: false };
      }
    } else if (ts.isClassLike(a) && a.name?.text === name) {
      return { isParam: false };
    }
  }
  return null;
}

function declIn(list: ts.VariableDeclarationList, name: string): Decl | undefined {
  for (const d of list.declarations) {
    const s = new Set<string>();
    bindingNames(d.name, s);
    if (s.has(name)) return ts.isIdentifier(d.name) ? { varDecl: d, isParam: false } : { isParam: false };
  }
  return undefined;
}

function findVarDecl(name: string, root: ts.Node, top: boolean): Decl | undefined {
  let found: Decl | undefined;
  const walk = (n: ts.Node): void => {
    if (found !== undefined) return;
    if (ts.isVariableDeclarationList(n) && (n.flags & (ts.NodeFlags.Let | ts.NodeFlags.Const)) === 0) {
      const d = declIn(n, name);
      if (d !== undefined) {
        found = d;
        return;
      }
    }
    if (!top && (isFnLike(n) || ts.isClassLike(n))) return;
    if (n !== root && (isFnLike(n) || ts.isClassLike(n))) return;
    ts.forEachChild(n, walk);
  };
  walk(root);
  return found;
}

/* ── free names of the new function ─────────────────────────────────────── */

function isReferencePosition(n: ts.Identifier): boolean {
  const p = n.parent;
  if (ts.isPropertyAccessExpression(p)) return p.name !== n;
  if (ts.isQualifiedName(p)) return p.left === n;
  if (ts.isPropertyAssignment(p)) return p.name !== n;
  if (
    ts.isMethodDeclaration(p) || ts.isPropertyDeclaration(p) || ts.isGetAccessorDeclaration(p) ||
    ts.isSetAccessorDeclaration(p) || ts.isEnumMember(p)
  ) {
    return p.name !== n;
  }
  if (ts.isBindingElement(p)) return p.propertyName !== n && p.name !== n;
  if (ts.isVariableDeclaration(p) || ts.isParameter(p)) return p.name !== n;
  if (ts.isFunctionDeclaration(p) || ts.isFunctionExpression(p) || ts.isClassDeclaration(p) || ts.isClassExpression(p)) {
    return p.name !== n;
  }
  if (ts.isLabeledStatement(p) || ts.isBreakOrContinueStatement(p)) return false;
  if (ts.isMetaProperty(p)) return false;
  return true;
}

function freeNames(fn: ts.FunctionExpression): Set<string> {
  const free = new Set<string>();
  const visit = (n: ts.Node, scopes: Set<string>[]): void => {
    if (ts.isIdentifier(n)) {
      if (isReferencePosition(n) && !scopes.some((s) => s.has(n.text))) free.add(n.text);
      return;
    }
    if (isFnLike(n)) {
      const s = new Set<string>();
      fnScopeNames(n, s);
      if (ts.isFunctionDeclaration(n) && n.name !== undefined) {
        // the declaration's own name belongs to the enclosing scope (hoisted there)
      }
      const inner = [...scopes, s];
      for (const p of n.parameters) visit(p, inner);
      if (n.body !== undefined) {
        if (ts.isBlock(n.body)) for (const st of n.body.statements) visit(st, inner);
        else visit(n.body, inner);
      }
      return;
    }
    if (ts.isBlock(n) || ts.isCaseBlock(n)) {
      const s = new Set<string>();
      lexicalNames(ts.isCaseBlock(n) ? n.clauses.flatMap((c) => [...c.statements]) : n.statements, s);
      ts.forEachChild(n, (c) => visit(c, [...scopes, s]));
      return;
    }
    if (ts.isForStatement(n) || ts.isForInStatement(n) || ts.isForOfStatement(n)) {
      const s = new Set<string>();
      const init = n.initializer;
      if (init !== undefined && ts.isVariableDeclarationList(init) && (init.flags & (ts.NodeFlags.Let | ts.NodeFlags.Const)) !== 0) {
        for (const d of init.declarations) bindingNames(d.name, s);
      }
      ts.forEachChild(n, (c) => visit(c, [...scopes, s]));
      return;
    }
    if (ts.isCatchClause(n)) {
      const s = new Set<string>();
      if (n.variableDeclaration !== undefined) bindingNames(n.variableDeclaration.name, s);
      ts.forEachChild(n, (c) => visit(c, [...scopes, s]));
      return;
    }
    if (ts.isClassLike(n) && n.name !== undefined) {
      const s = new Set<string>([n.name.text]);
      ts.forEachChild(n, (c) => visit(c, [...scopes, s]));
      return;
    }
    ts.forEachChild(n, (c) => visit(c, scopes));
  };
  const top = new Set<string>();
  fnScopeNames(fn, top);
  top.delete(fn.name?.text ?? "");
  const inner = [top];
  for (const p of fn.parameters) visit(p, inner);
  if (fn.body !== undefined) for (const st of fn.body.statements) visit(st, inner);
  return free;
}

/* ── ropes ──────────────────────────────────────────────────────────────── */

function unparen(e: ts.Expression): ts.Expression {
  while (ts.isParenthesizedExpression(e)) e = e.expression;
  return e;
}

/** Is `name` (as resolved at `at`) written anywhere in the file? Conservative: any write to any binding
 * of that name counts. */
function writtenAnywhere(name: string, sf: ts.SourceFile): boolean {
  let written = false;
  const hasName = (n: ts.Node): boolean => {
    let hit = false;
    const w = (c: ts.Node): void => {
      if (ts.isIdentifier(c) && c.text === name) hit = true;
      ts.forEachChild(c, w);
    };
    w(n);
    return hit;
  };
  const walk = (n: ts.Node): void => {
    if (written) return;
    if (ts.isBinaryExpression(n) && n.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && n.operatorToken.kind <= ts.SyntaxKind.LastAssignment) {
      const l = unparen(n.left);
      if (ts.isIdentifier(l) ? l.text === name : (ts.isArrayLiteralExpression(l) || ts.isObjectLiteralExpression(l)) && hasName(l)) written = true;
    }
    if ((ts.isPrefixUnaryExpression(n) || ts.isPostfixUnaryExpression(n)) && (n.operator === ts.SyntaxKind.PlusPlusToken || n.operator === ts.SyntaxKind.MinusMinusToken)) {
      const o = unparen(n.operand);
      if (ts.isIdentifier(o) && o.text === name) written = true;
    }
    if ((ts.isForInStatement(n) || ts.isForOfStatement(n)) && !ts.isVariableDeclarationList(n.initializer) && hasName(n.initializer)) {
      written = true;
    }
    ts.forEachChild(n, walk);
  };
  walk(sf);
  return written;
}

function isStableIdent(e: ts.Identifier, sf: ts.SourceFile): boolean {
  const d = findDecl(e.text, e);
  if (d === null) return false;
  if (d.varDecl !== undefined && (d.varDecl.parent.flags & ts.NodeFlags.Const) !== 0) return true;
  return !writtenAnywhere(e.text, sf);
}

function isStableHole(e: ts.Expression, sf: ts.SourceFile): boolean {
  e = unparen(e);
  if (ts.isStringLiteralLike(e) || ts.isNumericLiteral(e)) return true;
  if (e.kind === ts.SyntaxKind.TrueKeyword || e.kind === ts.SyntaxKind.FalseKeyword || e.kind === ts.SyntaxKind.NullKeyword) {
    return true;
  }
  return ts.isIdentifier(e) && isStableIdent(e, sf);
}

const PURE_BINARY = new Set<number>([
  ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken, ts.SyntaxKind.LessThanToken, ts.SyntaxKind.GreaterThanToken,
  ts.SyntaxKind.LessThanEqualsToken, ts.SyntaxKind.GreaterThanEqualsToken, ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.BarBarToken,
]);

/** A build-time CHOICE: a condition made only of stable identifiers, literals, `typeof`, `!` and comparisons, so
 * evaluating it at the construction site selects the same variant the original evaluation order would. */
function isPureCondition(e: ts.Expression, sf: ts.SourceFile): boolean {
  e = unparen(e);
  if (isStableHole(e, sf)) return true;
  if (ts.isPrefixUnaryExpression(e) && e.operator === ts.SyntaxKind.ExclamationToken) return isPureCondition(e.operand, sf);
  if (ts.isTypeOfExpression(e)) return isPureCondition(e.expression, sf);
  if (ts.isIdentifier(e) && e.text === "undefined") return true;
  if (ts.isBinaryExpression(e) && PURE_BINARY.has(e.operatorToken.kind)) {
    return isPureCondition(e.left, sf) && isPureCondition(e.right, sf);
  }
  return false;
}

class Folder {
  constructor(private readonly sf: ts.SourceFile, private readonly shadowed: Set<string>) {}

  private const1(s: string): Alt[] {
    return [{ guards: [], rope: [{ k: "c", s }] }];
  }

  /** The variants of a STRING-valued expression, or null. `viaConst`: reached through a const binding (holes
   * must then be stable, because the site re-evaluates them). */
  str(e: ts.Expression, viaConst: boolean, depth = 0): Alt[] | null {
    if (depth > 24) return null;
    e = unparen(e);
    if (ts.isStringLiteralLike(e)) return this.const1(e.text);
    if (ts.isTemplateExpression(e)) {
      let out: Alt[] | null = this.const1(e.head.text);
      for (const span of e.templateSpans) {
        const v = this.any(span.expression, viaConst, depth + 1);
        if (v === null) return null;
        out = cat(out!, v);
        if (out === null) return null;
        out = cat(out, this.const1(span.literal.text));
        if (out === null) return null;
      }
      return out;
    }
    if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const l = this.str(e.left, viaConst, depth + 1);
      if (l !== null) {
        const r = this.any(e.right, viaConst, depth + 1);
        return r === null ? null : cat(l, r);
      }
      const r = this.str(e.right, viaConst, depth + 1);
      if (r === null) return null;
      const lv = this.any(e.left, viaConst, depth + 1);
      return lv === null ? null : cat(lv, r);
    }
    if (ts.isConditionalExpression(e)) {
      if (!isPureCondition(e.condition, this.sf)) return null;
      const a = this.str(e.whenTrue, viaConst, depth + 1);
      const b = this.str(e.whenFalse, viaConst, depth + 1);
      if (a === null || b === null) return null;
      const out = [
        ...a.map((x) => ({ guards: joinGuards(x.guards, [{ cond: e.condition, pos: true }]), rope: x.rope })),
        ...b.map((x) => ({ guards: joinGuards(x.guards, [{ cond: e.condition, pos: false }]), rope: x.rope })),
      ].filter((x): x is Alt => x.guards !== null);
      return out.length > MAX_VARIANTS ? null : out;
    }
    if (ts.isCallExpression(e)) {
      // JSON.stringify(e): a DATA hole (textual value of a literal)
      if (
        ts.isPropertyAccessExpression(e.expression) && ts.isIdentifier(e.expression.expression) &&
        e.expression.expression.text === "JSON" && e.expression.name.text === "stringify" &&
        e.arguments.length === 1 && !this.shadowed.has("JSON") && !ts.isSpreadElement(e.arguments[0]!)
      ) {
        if (viaConst && !isStableHole(e.arguments[0]!, this.sf)) return null;
        return [{ guards: [], rope: [{ k: "h", call: e }] }];
      }
      // [..string texts..].join(<const separator>), the array literal inline or a const used only here
      if (ts.isPropertyAccessExpression(e.expression) && e.expression.name.text === "join" && e.arguments.length <= 1) {
        const arr = this.arrayLiteral(e.expression.expression);
        if (arr !== null) {
          const sepArg = e.arguments[0];
          const sep = sepArg === undefined ? this.const1(",") : this.str(sepArg, viaConst, depth + 1);
          if (sep === null || sep.some((a) => a.guards.length > 0 || a.rope.some((p) => p.k !== "c"))) return null;
          let out: Alt[] | null = [{ guards: [], rope: [] }];
          for (let i = 0; i < arr.elements.length; i++) {
            const el = arr.elements[i]!;
            if (ts.isSpreadElement(el) || ts.isOmittedExpression(el)) return null;
            const r = this.str(el, viaConst || arr !== unparen(e.expression.expression), depth + 1);
            if (r === null) return null;
            if (i > 0) out = cat(out!, sep);
            if (out === null) return null;
            out = cat(out, r);
            if (out === null) return null;
          }
          return out;
        }
      }
      return null;
    }
    if (ts.isIdentifier(e)) {
      if (e.text === "undefined") return null;
      const d = findDecl(e.text, e);
      if (d === null || d.varDecl === undefined) return null;
      const v = d.varDecl;
      if ((v.parent.flags & ts.NodeFlags.Const) === 0 || v.initializer === undefined || v.pos >= e.pos) return null;
      return this.str(v.initializer, true, depth + 1);
    }
    return null;
  }

  /** An array literal, or an identifier of a const array literal referenced nowhere else (so nothing can have
   * changed its contents). */
  private arrayLiteral(e: ts.Expression): ts.ArrayLiteralExpression | null {
    e = unparen(e);
    if (ts.isArrayLiteralExpression(e)) return e;
    if (!ts.isIdentifier(e)) return null;
    const d = findDecl(e.text, e);
    if (d?.varDecl === undefined || (d.varDecl.parent.flags & ts.NodeFlags.Const) === 0) return null;
    const init = d.varDecl.initializer;
    if (init === undefined || !ts.isArrayLiteralExpression(unparen(init)) || d.varDecl.pos >= e.pos) return null;
    let refs = 0;
    const w = (n: ts.Node): void => {
      if (ts.isIdentifier(n) && n.text === e.text) refs++;
      ts.forEachChild(n, w);
    };
    w(this.sf);
    return refs === 2 ? (unparen(init) as ts.ArrayLiteralExpression) : null;
  }

  /** A value spliced into text: a string text, or a literal whose text is fixed. */
  any(e: ts.Expression, viaConst: boolean, depth: number): Alt[] | null {
    const u = unparen(e);
    if (ts.isNumericLiteral(u)) return this.const1(String(Number(u.text)));
    if (u.kind === ts.SyntaxKind.TrueKeyword) return this.const1("true");
    if (u.kind === ts.SyntaxKind.FalseKeyword) return this.const1("false");
    if (u.kind === ts.SyntaxKind.NullKeyword) return this.const1("null");
    if (ts.isIdentifier(u)) {
      // a const bound to a literal: its text is fixed
      const d = findDecl(u.text, u);
      const init = d?.varDecl?.initializer;
      if (
        d?.varDecl !== undefined && (d.varDecl.parent.flags & ts.NodeFlags.Const) !== 0 && init !== undefined &&
        d.varDecl.pos < u.pos
      ) {
        const i = unparen(init);
        if (
          ts.isNumericLiteral(i) || i.kind === ts.SyntaxKind.TrueKeyword || i.kind === ts.SyntaxKind.FalseKeyword ||
          i.kind === ts.SyntaxKind.NullKeyword
        ) {
          return this.any(i, viaConst, depth + 1);
        }
      }
    }
    return this.str(e, viaConst, depth);
  }
}

/* ── the rewrite ────────────────────────────────────────────────────────── */

function mergeConst(r: Rope): Rope {
  const out: Rope = [];
  for (const p of r) {
    const last = out[out.length - 1];
    if (p.k === "c" && last !== undefined && last.k === "c") last.s += p.s;
    else out.push(p.k === "c" ? { k: "c", s: p.s } : p);
  }
  return out;
}

function parseOk(fileName: string, text: string): ts.SourceFile | null {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const diags = (sf as unknown as { parseDiagnostics?: readonly unknown[] }).parseDiagnostics ?? [];
  return diags.length === 0 ? sf : null;
}

function functionOf(sf: ts.SourceFile): ts.FunctionExpression | null {
  if (sf.statements.length !== 1) return null;
  const st = sf.statements[0]!;
  if (!ts.isExpressionStatement(st) || !ts.isParenthesizedExpression(st.expression)) return null;
  const f = st.expression.expression;
  return ts.isFunctionExpression(f) ? f : null;
}

export function functionCtorEdits(fileName: string, text: string): string | null {
  if (!/\bFunction\b/.test(text)) return null;
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  // `Function` / `JSON` rebound anywhere in the file: do nothing at all.
  const bound = new Set<string>();
  const collectAll = (n: ts.Node): void => {
    if (ts.isVariableDeclaration(n) || ts.isParameter(n)) bindingNames(n.name, bound);
    else if ((ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isClassLike(n)) && n.name !== undefined) bound.add(n.name.text);
    else if (ts.isImportClause(n) && n.name !== undefined) bound.add(n.name.text);
    else if (ts.isImportSpecifier(n) || ts.isNamespaceImport(n)) bound.add(n.name.text);
    ts.forEachChild(n, collectAll);
  };
  collectAll(sf);
  if (bound.has("Function")) return null;
  const folder = new Folder(sf, bound);
  const edits: Edit[] = [];

  /** The function expression one variant denotes, or null when it cannot be proven equal to the constructor. */
  const render = (site: ts.Expression, ropes: Rope[], vi: number): string | null => {
    const bodyRope: Rope = ropes.length === 0 ? [] : ropes[ropes.length - 1]!;
    const paramRopes = ropes.slice(0, Math.max(0, ropes.length - 1));
    const holes: ts.CallExpression[] = [];
    const tag = `__sc_ft${site.getStart(sf)}_${vi}_`;
    const text1 = (r: Rope): string => mergeConst(r).map((p) => (p.k === "c" ? p.s : `${tag}${holes.push(p.call) - 1}`)).join("");
    const params = paramRopes.map(text1).join(",");
    const body = text1(bodyRope);
    // Parse the parameter list and the body ON THEIR OWN (the Function constructor does), then the combination.
    const pOnly = parseOk(fileName, `(function anonymous(${params}\n) {\n})`);
    const bOnly = parseOk(fileName, `(function anonymous(\n) {\n${body}\n})`);
    if (pOnly === null || bOnly === null) return null;
    const pFn = functionOf(pOnly);
    const bFn = functionOf(bOnly);
    if (pFn === null || bFn === null || bFn.parameters.length !== 0 || pFn.body.statements.length !== 0) return null;
    const whole = `(function anonymous(${params}\n) {\n${body}\n})`;
    const wsf = parseOk(fileName, whole);
    if (wsf === null) return null;
    const wFn = functionOf(wsf);
    if (wFn === null) return null;
    // every placeholder: exactly once, as a plain reference, never a statement of its own
    const seen = new Map<string, number>();
    let bad = false;
    const scan = (n: ts.Node): void => {
      if (ts.isIdentifier(n) && n.text.startsWith(tag)) {
        seen.set(n.text, (seen.get(n.text) ?? 0) + 1);
        if (!isReferencePosition(n) || ts.isExpressionStatement(n.parent) || ts.isShorthandPropertyAssignment(n.parent)) bad = true;
      }
      ts.forEachChild(n, scan);
    };
    scan(wsf);
    if (bad || seen.size !== holes.length || [...seen.values()].some((c) => c !== 1)) return null;
    // free identifiers of the new function must all be globals at the site
    for (const name of freeNames(wFn)) {
      if (name.startsWith(tag)) continue;
      if (WRAPPER_NAMES.has(name)) return null;
      if (findDecl(name, site) !== null) return null;
    }
    if (holes.length === 0) return whole;
    const names = holes.map((_, i) => `${tag}${i}`);
    const reread = (n: string): string => `(${n} === undefined || ${n} === "undefined" ? undefined : JSON.parse(${n}))`;
    let inner = whole;
    for (const n of names) inner = inner.replace(new RegExp(`\\b${n}\\b`, "g"), reread(n));
    return `(function (${names.join(", ")}) { return ${inner}; })(${holes.map((h) => h.getText(sf)).join(", ")})`;
  };

  const rewrite = (site: ts.Expression, args: readonly ts.Expression[]): void => {
    if (args.some((a) => ts.isSpreadElement(a))) return;
    const perArg: Alt[][] = [];
    for (const a of args) {
      const r = folder.str(a, false);
      if (r === null) return;
      perArg.push(r);
    }
    // product over the arguments (each variant keeps one rope per argument)
    interface V {
      guards: Guard[];
      ropes: Rope[];
    }
    let vs: V[] = [{ guards: [], ropes: [] }];
    for (const alts of perArg) {
      const next: V[] = [];
      for (const v of vs) {
        for (const a of alts) {
          const g = joinGuards(v.guards, a.guards);
          if (g === null) continue;
          next.push({ guards: g, ropes: [...v.ropes, a.rope] });
        }
      }
      if (next.length > MAX_VARIANTS) return;
      vs = next;
    }
    if (vs.length === 0) return;
    const texts: string[] = [];
    for (let i = 0; i < vs.length; i++) {
      const t = render(site, vs[i]!.ropes, i);
      if (t === null) return;
      texts.push(t);
    }
    const guardText = (g: Guard[]): string =>
      g.map((x) => (x.pos ? `(${x.cond.getText(sf)})` : `!(${x.cond.getText(sf)})`)).join(" && ");
    let out = texts[texts.length - 1]!;
    if (vs.length > 1) {
      for (let i = vs.length - 2; i >= 0; i--) out = `${guardText(vs[i]!.guards)} ? ${texts[i]!} : ${out}`;
      out = `(${out})`;
    }
    edits.push({ start: site.getStart(sf), end: site.getEnd(), text: out });
  };

  const visit = (n: ts.Node): void => {
    if (ts.isNewExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "Function") {
      rewrite(n, n.arguments ?? []);
      return;
    }
    if (ts.isCallExpression(n)) {
      const c = n.expression;
      if (ts.isIdentifier(c) && c.text === "Function") {
        rewrite(n, n.arguments);
        return;
      }
      if (
        ts.isPropertyAccessExpression(c) && ts.isIdentifier(c.expression) && c.expression.text === "Function" &&
        c.name.text === "apply" && n.arguments.length === 2
      ) {
        const t = unparen(n.arguments[0]!);
        const arr = unparen(n.arguments[1]!);
        const nullish = t.kind === ts.SyntaxKind.NullKeyword || (ts.isIdentifier(t) && t.text === "undefined") ||
          ts.isVoidExpression(t);
        if (nullish && ts.isArrayLiteralExpression(arr)) {
          rewrite(n, arr.elements);
          return;
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  if (edits.length === 0) return null;
  edits.sort((a, b) => a.start - b.start);
  let out = "";
  let at = 0;
  for (const ed of edits) {
    if (ed.start < at) continue;
    out += text.slice(at, ed.start) + ed.text;
    at = ed.end;
  }
  return out + text.slice(at);
}
