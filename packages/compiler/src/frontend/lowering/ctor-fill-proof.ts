/* The construction-site fill proof for a constructor-filled array field.
 *
 *   class Msg {
 *     public readonly ids: number[]
 *     constructor(public readonly count: number) {
 *       this.ids = new Array(this.count)
 *     }
 *   }
 *   function parse(n: number) {
 *     const m = new Msg(n)
 *     for (let i = 0; i < n; i++) m.ids[i] = read()
 *     return m
 *   }
 *
 * The array is created in the constructor and filled by a counting loop at
 * the construction site (pg-protocol's ParameterDescriptionMessage and
 * CopyResponse). The local-declaration proof (fullFillLoopFollows) cannot see
 * across the constructor, so this proof establishes the same fact at the
 * CLASS level, conservatively:
 *
 *   1. The constructor body is exactly `this.F = new Array(A)`, where A is a
 *      constructor parameter (or a `this.` parameter property). Property
 *      initializers and parameter defaults are literals, so constructing runs
 *      no user code before the array exists or is filled.
 *   2. The class has no heritage clause, no type parameters, one constructor,
 *      and no static members.
 *   3. Every reference to the class in the program is a `new C(...)` callee,
 *      a declaration, an import or export specifier, or a type reference. No
 *      other reference can construct it, subclass it or reach its constructor.
 *      Every `new` whose callee is not an identifier and whose text names the
 *      constructor (`.constructor`) declines the class.
 *   4. Every `new C(args)` is `const x = new C(args)` immediately followed by
 *      `for (let i = 0; i < T; i += 1 | i++) x.F[i] = e`, where T is the
 *      argument at A's parameter position, an identifier bound by a `const`
 *      (so the bound cannot change), and e does not mention x.
 *
 * Under those rules no user code runs between the construction and the fill,
 * `x` is not reachable before the loop ends, and the loop writes every index
 * 0..T-1. The array's holes are therefore never observable, and its scalar
 * slots need no absent value. Anything else declines, and the existing SC2020
 * refusal stands. */
import * as ts from "../ts7/adapter.js";
import type { Lowerer } from "./lowerer.js";

const memo = new WeakMap<Lowerer, Map<ts.ClassDeclaration, boolean>>();

/** True when the `new Array(A)` expression is the constructor-field initializer
 * of a class whose every construction site fills it (see the header). */
export function ctorFieldFillProven(L: Lowerer, expr: ts.NewExpression): boolean {
  const assign = expr.parent;
  if (!ts.isBinaryExpression(assign) || assign.operatorToken.kind !== ts.SyntaxKind.EqualsToken) return false;
  if (assign.right !== expr) return false;
  if (!ts.isPropertyAccessExpression(assign.left) || assign.left.expression.kind !== ts.SyntaxKind.ThisKeyword) {
    return false;
  }
  const stmt = assign.parent;
  if (!ts.isExpressionStatement(stmt)) return false;
  const body = stmt.parent;
  if (!ts.isBlock(body) || body.statements.length !== 1) return false;
  const ctor = body.parent;
  if (!ts.isConstructorDeclaration(ctor) || ctor.body !== body) return false;
  const cls = ctor.parent;
  if (!ts.isClassDeclaration(cls)) return false;
  if (!expr.arguments || expr.arguments.length !== 1) return false;
  const arg = expr.arguments[0]!;
  let pname: string | undefined;
  if (ts.isIdentifier(arg)) pname = arg.text;
  else if (
    ts.isPropertyAccessExpression(arg) && arg.expression.kind === ts.SyntaxKind.ThisKeyword && ts.isIdentifier(arg.name)
  ) {
    pname = arg.name.text;
  }
  if (pname === undefined) return false;
  const k = ctor.parameters.findIndex((p) => ts.isIdentifier(p.name) && p.name.text === pname);
  if (k < 0 || ctor.parameters[k]!.dotDotDotToken !== undefined) return false;

  let perClass = memo.get(L);
  if (perClass === undefined) {
    perClass = new Map();
    memo.set(L, perClass);
  }
  const known = perClass.get(cls);
  if (known !== undefined) return known;
  const ok = classFillProven(L, cls, ctor, k);
  perClass.set(cls, ok);
  return ok;
}

function isLiteralInit(e: ts.Expression): boolean {
  return (
    ts.isStringLiteral(e) || ts.isNumericLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e) ||
    e.kind === ts.SyntaxKind.TrueKeyword || e.kind === ts.SyntaxKind.FalseKeyword ||
    e.kind === ts.SyntaxKind.NullKeyword
  );
}

function classFillProven(L: Lowerer, cls: ts.ClassDeclaration, ctor: ts.ConstructorDeclaration, k: number): boolean {
  if (cls.typeParameters !== undefined || cls.heritageClauses !== undefined || cls.name === undefined) return false;
  let ctors = 0;
  for (const m of cls.members) {
    if (ts.isConstructorDeclaration(m)) {
      ctors++;
      continue;
    }
    if (ts.isPropertyDeclaration(m)) {
      if ((ts.getModifiers(m) ?? []).some((mod) => mod.kind === ts.SyntaxKind.StaticKeyword)) return false;
      if (m.initializer !== undefined && !isLiteralInit(m.initializer)) return false;
      continue;
    }
    if (ts.isClassStaticBlockDeclaration(m)) return false;
    if ((ts.getModifiers(m) ?? []).some((mod) => mod.kind === ts.SyntaxKind.StaticKeyword)) return false;
  }
  if (ctors !== 1) return false;
  for (const p of ctor.parameters) {
    if (p.initializer !== undefined && !isLiteralInit(p.initializer)) return false;
  }

  const checker = L.checker;
  const clsSym = checker.getSymbolAtLocation(cls.name);
  if (clsSym === undefined) return false;
  const resolve = (id: ts.Identifier): ts.Symbol | undefined => {
    let s = checker.getSymbolAtLocation(id);
    if (s !== undefined && (s.flags & ts.SymbolFlags.Alias) !== 0) s = checker.getAliasedSymbol(s);
    return s;
  };

  // Walk every non-declaration program file, iteratively (the 7000-level
  // guard: no recursion over user ASTs).
  const sites: ts.NewExpression[] = [];
  const name = cls.name.text;
  for (const sf of L.program.getSourceFiles()) {
    if (sf.isDeclarationFile) continue;
    const stack: ts.Node[] = [sf];
    while (stack.length > 0) {
      const node = stack.pop()!;
      if (ts.isIdentifier(node) && node.text === name) {
        const s = resolve(node);
        if (s === clsSym) {
          const p = node.parent;
          if (ts.isNewExpression(p) && p.expression === node) sites.push(p);
          else if (p === cls) {
            // the declaration's own name
          } else if (
            ts.isImportSpecifier(p) || ts.isExportSpecifier(p) || ts.isImportClause(p) ||
            (ts.isTypeReferenceNode(p) && p.typeName === node)
          ) {
            // declaration-side or type-side mention: constructs nothing
          } else {
            return false;
          }
        }
      }
      if (ts.isNewExpression(node) && !(ts.isIdentifier(node.expression) && resolve(node.expression) === clsSym)) {
        // A `new` that is not `new C` by name may still build C: through an
        // alias, `.constructor`, a call of a value typed as C's constructor.
        // Its resolved signature is the test. An unresolved callee of type
        // any cannot be ruled out, so it declines.
        const sig = checker.getResolvedSignature(node);
        if (sig === undefined) {
          if ((checker.getTypeAtLocation(node.expression).flags & ts.TypeFlags.Any) !== 0) return false;
        } else {
          const d = checker.signatureDeclaration(sig);
          if (d !== undefined && d.parent === cls) return false;
        }
      }
      ts.forEachChild(node, (c) => {
        stack.push(c);
      });
    }
  }
  if (sites.length === 0) return false;
  for (const site of sites) {
    if (!siteFills(L, site, k)) return false;
  }
  return true;
}

/** `const x = new C(..., T, ...)` immediately followed by the counting fill of
 * x's field, with the bound T at parameter position k. */
function siteFills(L: Lowerer, site: ts.NewExpression, k: number): boolean {
  const decl = site.parent;
  if (!ts.isVariableDeclaration(decl) || !ts.isIdentifier(decl.name) || decl.initializer !== site) return false;
  const list = decl.parent;
  if (!ts.isVariableDeclarationList(list) || list.declarations.length !== 1) return false;
  const stmt = list.parent;
  if (!ts.isVariableStatement(stmt)) return false;
  const owner = stmt.parent as ts.Node & { statements?: readonly ts.Statement[] };
  const stmts = owner.statements;
  if (!stmts) return false;
  const at = stmts.indexOf(stmt);
  const loop = at >= 0 ? stmts[at + 1] : undefined;
  if (!loop || !ts.isForStatement(loop)) return false;
  const args = site.arguments;
  if (!args || args.length <= k) return false;
  const bound = args[k]!;
  if (!ts.isIdentifier(bound)) return false;
  // The bound must be a const: its value cannot change before the loop test.
  let bsym = L.checker.getSymbolAtLocation(bound);
  if (bsym !== undefined && (bsym.flags & ts.SymbolFlags.Alias) !== 0) bsym = L.checker.getAliasedSymbol(bsym);
  const bdecl = bsym ? L.checker.valueDeclarationOf(bsym) : undefined;
  if (bdecl === undefined || !boundNeverChanges(bdecl, bound.text)) return false;
  const init = loop.initializer;
  if (!init || !ts.isVariableDeclarationList(init) || init.declarations.length !== 1) return false;
  const iDecl = init.declarations[0]!;
  if (!ts.isIdentifier(iDecl.name) || !iDecl.initializer) return false;
  if (iDecl.initializer.kind !== ts.SyntaxKind.NumericLiteral || iDecl.initializer.getText() !== "0") return false;
  const iName = iDecl.name.text;
  const cond = loop.condition;
  if (!cond || !ts.isBinaryExpression(cond) || cond.operatorToken.kind !== ts.SyntaxKind.LessThanToken ||
      !ts.isIdentifier(cond.left) || cond.left.text !== iName || !ts.isIdentifier(cond.right) ||
      cond.right.text !== bound.text) {
    return false;
  }
  const inc = loop.incrementor;
  if (!inc) return false;
  const byOne =
    (ts.isPostfixUnaryExpression(inc) && inc.operator === ts.SyntaxKind.PlusPlusToken &&
      ts.isIdentifier(inc.operand) && inc.operand.text === iName) ||
    (ts.isBinaryExpression(inc) && inc.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken &&
      ts.isIdentifier(inc.left) && inc.left.text === iName && inc.right.getText() === "1");
  if (!byOne) return false;
  const body = loop.statement;
  const one = ts.isBlock(body) ? (body.statements.length === 1 ? body.statements[0] : undefined) : body;
  if (one === undefined || !ts.isExpressionStatement(one)) return false;
  const w = one.expression;
  if (!ts.isBinaryExpression(w) || w.operatorToken.kind !== ts.SyntaxKind.EqualsToken) return false;
  const el = w.left;
  if (!ts.isElementAccessExpression(el) || !ts.isIdentifier(el.argumentExpression) ||
      el.argumentExpression.text !== iName) {
    return false;
  }
  const field = el.expression;
  if (!ts.isPropertyAccessExpression(field) || !ts.isIdentifier(field.expression) ||
      field.expression.text !== decl.name.text) {
    return false;
  }
  // The written value must not name the array's owner (it could read a hole).
  const xName = decl.name.text;
  let mentions = false;
  const stack: ts.Node[] = [w.right];
  while (stack.length > 0) {
    const n = stack.pop()!;
    if (ts.isIdentifier(n) && n.text === xName) mentions = true;
    ts.forEachChild(n, (c) => {
      stack.push(c);
    });
  }
  return !mentions;
}

/** A const binding, or a parameter that its function never assigns (no `=`,
 * compound assignment, `++` or `--` on that name anywhere in the function). */
function boundNeverChanges(decl: ts.Node, name: string): boolean {
  if (ts.isVariableDeclaration(decl)) {
    const list = decl.parent;
    return ts.isVariableDeclarationList(list) && (ts.getCombinedNodeFlags(list) & ts.NodeFlags.Const) !== 0;
  }
  if (!ts.isParameter(decl) || !ts.isIdentifier(decl.name)) return false;
  const fn = decl.parent;
  if (!fn) return false;
  const stack: ts.Node[] = [fn];
  while (stack.length > 0) {
    const n = stack.pop()!;
    if (ts.isBinaryExpression(n) && n.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
        n.operatorToken.kind <= ts.SyntaxKind.LastAssignment && ts.isIdentifier(n.left) && n.left.text === name) {
      return false;
    }
    if ((ts.isPrefixUnaryExpression(n) || ts.isPostfixUnaryExpression(n)) &&
        (n.operator === ts.SyntaxKind.PlusPlusToken || n.operator === ts.SyntaxKind.MinusMinusToken) &&
        ts.isIdentifier(n.operand) && n.operand.text === name) {
      return false;
    }
    ts.forEachChild(n, (c) => {
      stack.push(c);
    });
  }
  return true;
}
