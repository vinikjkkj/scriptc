/* WHICH REQUIRES ALWAYS THROW, decided on syntax and the filesystem alone.
 *
 * Node answers `require(x)` with MODULE_NOT_FOUND when nothing resolves x, and a
 * module whose body requires such an x at its top level throws the same error
 * to whoever required it. Everything the module's body would have done after
 * that statement never runs, and the modules that code alone would have loaded
 * are never loaded.
 *
 * Two consumers agree on the answer, which is why it lives here: the module
 * graph walk (program.ts) does not follow the requires of statements that never
 * run, and the lowering (lowering/lower-stmts.ts, lower-modules.ts) does not
 * lower them. A graph that kept a module the lowering skips would compile code
 * Node never loads; a lowering that skipped what the graph dropped would fence
 * at a site for a module "not part of the compiled graph". */
import * as ts from "./ts7/adapter.js";
import { canonicalBuiltinModule, isRelativeSpecifier } from "./shared.js";
import { probeNodeRequireRefusal, probeRelativeRequireRefusal } from "./npm.js";
import { isCjsJsFile, isJsSourceFile, requireSpecOf, resolveImport } from "./program.js";

/** What the analysis needs from its caller: the program, and how a require
 * written in `sf` resolves to a program module (null for a builtin, JSON, or
 * nothing). The lowering resolves through the Lowerer (declaration twins
 * included); the graph walk resolves through its own tables. */
export interface RequireThrowCtx {
  readonly program: ts.Program;
  depOf(sf: ts.SourceFile, spec: string): ts.SourceFile | null;
}

/** The refusal a RELATIVE `require(spec)` earns when neither Node's loader nor
 * the compiled program holds a module at that path. Null when the program has
 * the file (or it is JSON), or the specifier is not relative. */
export function relativeRequireRefusal(ctx: RequireThrowCtx, sf: ts.SourceFile, spec: string): { message: string } | null {
  if (!isRelativeSpecifier(spec)) return null;
  if (resolveImport(ctx.program, sf, spec) !== null) return null;
  return probeRelativeRequireRefusal(sf.fileName, spec);
}

const moduleInitThrowsCache = new WeakMap<ts.SourceFile, boolean>();

/** True when evaluating this CommonJS module's body ALWAYS throws: one of its
 * own top-level statements throws MODULE_NOT_FOUND every time it runs (an
 * uninstalled package, a missing relative file, or a require of another module
 * that itself always throws), and no top-level statement before it can return.
 * pg's native client opens with
 * `try { Native = require('pg-native') } catch (e) { throw e }`, so requiring it
 * is MODULE_NOT_FOUND where pg-native is not installed, and so is requiring the
 * module that re-exports it. */
export function moduleInitAlwaysThrows(ctx: RequireThrowCtx, sf: ts.SourceFile, seen: Set<ts.SourceFile> = new Set()): boolean {
  const cached = moduleInitThrowsCache.get(sf);
  if (cached !== undefined) return cached;
  if (seen.has(sf) || !isJsSourceFile(sf) || !isCjsJsFile(sf) || ts.isExternalModule(sf)) return false;
  const top = seen.size === 0;
  seen.add(sf);
  let result = false;
  for (const st of sf.statements) {
    if (statementAlwaysThrowsOnRequire(ctx, st, seen)) {
      result = true;
      break;
    }
    if (containsReturn(st)) break;
  }
  seen.delete(sf);
  if (top || result) moduleInitThrowsCache.set(sf, result);
  return result;
}

function containsReturn(node: ts.Node): boolean {
  let found = false;
  const walk = (n: ts.Node): void => {
    if (found) return;
    if (ts.isReturnStatement(n)) {
      found = true;
      return;
    }
    if (n !== node && ts.isFunctionLike(n)) return;
    if (ts.isClassDeclaration(n) || ts.isClassExpression(n)) return;
    ts.forEachChild(n, walk);
  };
  walk(node);
  return found;
}

const shadowCache = new WeakMap<ts.SourceFile, boolean>();

/** The file declares its own binding named `require` (a function, a variable,
 * a parameter, a class, an import): a call spelled `require(...)` there may
 * be that binding and not the module global, so no rule that reads `require`
 * as the CommonJS loader applies to it. Scope is not resolved (a declaration
 * anywhere in the file declines the rule): declining only keeps the old
 * behaviour for that file. */
export function fileDeclaresRequire(sf: ts.SourceFile): boolean {
  const known = shadowCache.get(sf);
  if (known !== undefined) return known;
  let found = false;
  const walk = (n: ts.Node): void => {
    if (found) return;
    if (
      (ts.isFunctionDeclaration(n) || ts.isClassDeclaration(n) || ts.isVariableDeclaration(n) ||
        ts.isParameter(n) || ts.isImportSpecifier(n) || ts.isImportClause(n) || ts.isNamespaceImport(n) ||
        ts.isFunctionExpression(n) || ts.isClassExpression(n)) &&
      n.name !== undefined && ts.isIdentifier(n.name) && n.name.text === "require"
    ) {
      found = true;
      return;
    }
    ts.forEachChild(n, walk);
  };
  walk(sf);
  shadowCache.set(sf, found);
  return found;
}

/** A statement whose only effect is a binding, an assignment or a bare
 * `require("x")` that throws MODULE_NOT_FOUND every time it runs: the package
 * is not installed, the relative file does not exist, or the required module's
 * own body always throws (moduleInitAlwaysThrows). Also a `try` whose block
 * does that and whose handler always rethrows or returns. */
export function statementAlwaysThrowsOnRequire(ctx: RequireThrowCtx, stmt: ts.Statement, seen?: Set<ts.SourceFile>): boolean {
  let init: ts.Expression | undefined;
  if (ts.isTryStatement(stmt)) {
    // `try { Native = require('pg-native') } catch (e) { throw e }`: the try
    // block never completes normally (one of its own statements throws
    // MODULE_NOT_FOUND every time) and the handler never completes normally
    // either (it rethrows, or returns), so control never leaves the statement
    // by falling through. A handler that logs and carries on is not this shape
    // and keeps the statements after it.
    if (stmt.catchClause === undefined) return false;
    if (!stmt.tryBlock.statements.some((s) => statementAlwaysThrowsOnRequire(ctx, s, seen))) return false;
    return stmt.catchClause.block.statements.some((s) => ts.isThrowStatement(s) || ts.isReturnStatement(s));
  }
  if (ts.isVariableStatement(stmt) && stmt.declarationList.declarations.length === 1) {
    init = stmt.declarationList.declarations[0]!.initializer;
  } else if (ts.isExpressionStatement(stmt)) {
    init = stmt.expression;
    // `Native = require('pg-native')` / `module.exports = require('./client')`:
    // the assignment's value is the call.
    if (ts.isBinaryExpression(init) && init.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      init = init.right;
    }
  }
  if (init === undefined) return false;
  const spec = requireSpecOf(init);
  if (spec === null || canonicalBuiltinModule(spec) !== null) return false;
  const sf = stmt.getSourceFile();
  if (fileDeclaresRequire(sf)) return false;
  if (!isRelativeSpecifier(spec) && probeNodeRequireRefusal(sf.fileName, spec) !== null) return true;
  if (relativeRequireRefusal(ctx, sf, spec) !== null) return true;
  const dep = ctx.depOf(sf, spec);
  return dep !== null && moduleInitAlwaysThrows(ctx, dep, seen);
}

/** True when a statement the compiler has DECIDED never runs may be left
 * unlowered: it declares nothing whose effect outlives the branch. A `var`
 * (or a function declaration) inside hoists to the enclosing function, so
 * skipping it would drop a binding the rest of the function can read; both
 * keep the branch lowered. Nested function bodies are not entered (their own
 * `var`s belong to them). */
export function deadBranchSkippable(node: ts.Node): boolean {
  let ok = true;
  const walk = (n: ts.Node): void => {
    if (!ok) return;
    if (ts.isFunctionDeclaration(n)) {
      ok = false;
      return;
    }
    if (ts.isVariableDeclarationList(n) && (n.flags & ts.NodeFlags.BlockScoped) === 0) {
      ok = false;
      return;
    }
    if (n !== node && ts.isFunctionLike(n)) return;
    ts.forEachChild(n, walk);
  };
  walk(node);
  return ok;
}

/** The top-level statements of a module the lowering lowers IN ORDER as the
 * module's body: what lower-modules.ts splitFiles leaves in `topStmts` (it
 * hoists function and class declarations out, flattens namespaces, and drops
 * type-only and import/export plumbing). */
function isBodyStatement(stmt: ts.Statement): boolean {
  return !(
    ts.isFunctionDeclaration(stmt) || ts.isClassDeclaration(stmt) || ts.isModuleDeclaration(stmt) ||
    ts.isInterfaceDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt) || ts.isImportDeclaration(stmt) ||
    ts.isExportDeclaration(stmt)
  );
}

/** The top-level statements of `sf` that never run, as nodes: every body
 * statement after the first one that always throws on its require, provided
 * ALL of them may be skipped (deadBranchSkippable) -- the exact condition the
 * lowering applies before it stops lowering the module's body. Empty when the
 * module's body runs to its end. */
export function deadTopLevelStatements(ctx: RequireThrowCtx, sf: ts.SourceFile): ts.Statement[] {
  if (!isJsSourceFile(sf)) return [];
  const body = sf.statements.filter(isBodyStatement);
  for (let i = 0; i < body.length - 1; i++) {
    if (statementAlwaysThrowsOnRequire(ctx, body[i]!)) {
      const rest = body.slice(i + 1);
      return rest.every(deadBranchSkippable) ? rest : [];
    }
  }
  return [];
}
