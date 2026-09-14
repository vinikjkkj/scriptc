/* PER-TREE path aliases for --provenance-sources.
 *
 * THE DEFECT. tsconfig "paths" is per-PROJECT; tsgo takes ONE table per
 * program. Every mapped package's alias table was merged into that one
 * table, so two attested checkouts that spell the same alias key -- which is
 * the NORMAL case, because a monorepo's shared tsconfig is extended by every
 * package in it, and two packages of one repo are routinely two different
 * COMMITS -- had to share an answer. tsgo tries a key's targets in order and
 * takes the first that resolves to an existing file, and both checkouts have
 * a file at the same aliased location, so the loser's own source silently
 * compiled against the winner's tree.
 *
 * The loud face of that was 21 x SC1014; the quiet face is the one that
 * matters. Measured on zapo-rest 1.8.2: with the package order reversed, 325
 * of the program's 350 modules moved from the zapo-js@1.8.2 checkout to the
 * @zapo-js/store-sqlite checkout (zapo-js@1.8.0's tree) -- a whole different
 * VERSION of the program's main dependency -- with ZERO diagnostics. The
 * README's "import order is load-bearing" was that bug's receipt.
 *
 * THE FIX. tsgo has no per-file resolution hook (no resolveModuleNames, no
 * resolveModuleNameLiterals on the 7.0.2 sync API -- the fs hooks are
 * readFile/fileExists/directoryExists/realpath/getAccessibleEntries and none
 * of them is told WHO is asking). The one hook that does know the file is
 * readFile, because it is called with that file's path. So the scoping is
 * done in the TEXT: as each file of a mapped source tree is served, the
 * specifiers that its OWN tree's alias table covers are rewritten to
 * RELATIVE specifiers naming the file the tree's own tsconfig points at.
 *
 * Relative, rather than a synthetic per-tree alias key, on purpose. A
 * synthetic key has to be un-synthesized again at every consumer that reads
 * a specifier back out of the AST -- the preflight fences, the lowering
 * module graph, the CJS link check, every diagnostic that quotes a
 * specifier -- and a missed one is silent. A relative specifier is the most
 * ordinary thing in this compiler: resolve.ts resolves it, the lowering's
 * resolveImport resolves it, no fence fires on it, and the alias table stops
 * being consulted for those files at all. The rewrite is exact (a real
 * parse, not a regex) and it names the SAME file the prescan already chose
 * for that tree -- bareImportsOf has always resolved aliases per package.
 *
 * Extensions are kept ("./client/index.ts", not "./client/index"): the
 * frontend forces allowImportingTsExtensions with bundler resolution, so the
 * explicit form needs no probing and cannot land on a .tsx/.mts twin.
 *
 * What is NOT rewritten: a specifier that names a package the DRIVER has
 * installed -- a registered package ENTRY, or an EXTERNAL (installed but not
 * attestable). "zapo-js/store" is spelled by store-sqlite's source AND is a
 * subpath export of the installed zapo-js, and Node resolves it to the
 * installed package -- one copy, shared module state. That is the same rule
 * the prescan applies (bareImportsOf's viaAlias) and the two must apply it
 * identically: a specifier the preflight resolves to an npm package while
 * tsgo resolves it into the checkout is one import the two worlds disagree
 * about, with nothing said. The ENTRY half of it is also the order
 * provenancePaths has always used (bySpecifier is written last). */
import { readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import ts from "typescript5";
import { tsgoPath } from "./shared.js";
import { isProvenanceExternalSpecifier, provenanceAliasScopeOf, provenanceEntryFor, type AliasPattern } from "./provenance-registry.js";

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

const SOURCE_EXT = /\.(ts|tsx|mts|cts|js|mjs|cjs|jsx)$/;

/** The TypeScript file an alias target pattern points at, probing the
 * extensions and the directory index. The twin of provenance.ts's
 * resolveAliasTarget -- deliberately the same candidate order, because the
 * two must choose the same file or the prescan and the checker disagree. */
function resolveAliasTarget(target: string): string | null {
  if (/\.(ts|tsx|mts|cts)$/.test(target) && isFile(target)) return target;
  for (const ext of [".ts", ".tsx", ".mts", ".cts"]) {
    if (isFile(target + ext)) return target + ext;
  }
  for (const idx of ["index.ts", "index.tsx", "index.mts", "index.cts"]) {
    const p = join(target, idx);
    if (isFile(p)) return p;
  }
  return null;
}

/** The file `specifier` names under `patterns`, or null. tsc's rule: among
 * matching patterns the longest literal prefix wins (`patterns` is stored
 * pre-sorted), and within one pattern the targets are tried in order. */
function aliasTargetFile(patterns: readonly AliasPattern[], specifier: string): string | null {
  for (const a of patterns) {
    let subbed: readonly string[];
    if (a.suffix === null) {
      if (specifier !== a.prefix) continue;
      subbed = a.targets;
    } else {
      if (specifier.length < a.prefix.length + a.suffix.length) continue;
      if (!specifier.startsWith(a.prefix) || !specifier.endsWith(a.suffix)) continue;
      const wildcard = specifier.slice(a.prefix.length, specifier.length - a.suffix.length);
      subbed = a.targets.map((t) => t.split("*").join(wildcard));
    }
    for (const t of subbed) {
      const file = resolveAliasTarget(t);
      if (file !== null) return file;
    }
  }
  return null;
}

/** The relative specifier naming `target` from `fromFile`, slash-spelled and
 * always explicitly relative (Node and tsc both read a bare "client/x.ts" as
 * a PACKAGE). */
function relativeSpecifier(fromFile: string, target: string): string {
  const rel = relative(dirname(resolve(fromFile)), resolve(target)).replace(/\\/g, "/");
  return rel.startsWith(".") ? rel : `./${rel}`;
}

/** Every module-specifier string literal in `text`, with the span of the
 * literal's CONTENT (quotes excluded). Same forms the prescan collects
 * (provenance.ts moduleSpecifiersLite): import/export declarations,
 * `import()`, and single-argument `require()`, plus the `import("…")` TYPE
 * node a declaration file spells its whole import surface with. */
function specifierSpans(text: string, fileName: string): { spec: string; start: number; end: number }[] {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  const out: { spec: string; start: number; end: number }[] = [];
  const push = (node: ts.StringLiteralLike): void => {
    // getStart/getEnd span the QUOTES; the content is one character inside
    // each. A literal is never zero-width, so this cannot invert.
    out.push({ spec: node.text, start: node.getStart(sf) + 1, end: node.getEnd() - 1 });
  };
  const visit = (n: ts.Node): void => {
    if (
      (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) &&
      n.moduleSpecifier !== undefined &&
      ts.isStringLiteral(n.moduleSpecifier)
    ) {
      push(n.moduleSpecifier);
    } else if (ts.isImportTypeNode(n) && ts.isLiteralTypeNode(n.argument) && ts.isStringLiteral(n.argument.literal)) {
      push(n.argument.literal);
    } else if (ts.isExternalModuleReference(n) && ts.isStringLiteral(n.expression)) {
      // `import x = require("…")` — the CJS-interop form. Not a
      // CallExpression, so the branch below never sees it.
      push(n.expression);
    } else if (ts.isCallExpression(n)) {
      const arg = n.arguments[0];
      if (
        arg !== undefined &&
        ts.isStringLiteralLike(arg) &&
        (n.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(n.expression) && n.expression.text === "require" && n.arguments.length === 1))
      ) {
        push(arg);
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/** How many specifiers were rewritten, per file -- the only way to tell "no
 * aliases in this tree" from "the rewriter never ran". The two look
 * identical from outside, and the second is how a pass like this fails
 * silently: the tree-root derivation was digest-based at first, which is a
 * shape the manifest-pinned fixtures do not have, so the whole fixture suite
 * ran unscoped and passed every assertion it had. Exported so a harness can
 * positive-control the pass rather than infer it from a green result. */
const rewritten = new Map<string, number>();

export function provenanceAliasRewrites(): ReadonlyMap<string, number> {
  return rewritten;
}

export function clearProvenanceAliasRewrites(): void {
  rewritten.clear();
}

/** The text tsgo should see for `fileName`, or null when this file needs no
 * rewriting (not inside a mapped source tree, not a source file, or its tree
 * declares no alias the file spells). Returning null is the fast path and is
 * what every file of a flagless build takes.
 *
 * `read` supplies the bytes -- the caller owns the disk read so a shadow
 * stacked under this one (--npm-static's) still wins. */
export function provenanceAliasRewrite(fileName: string, read: () => string | undefined): string | null {
  const scope = provenanceAliasScopeOf(fileName);
  if (scope === null) return null;
  if (!SOURCE_EXT.test(fileName)) return null;
  let text: string | undefined;
  try {
    text = read();
  } catch {
    return null;
  }
  if (text === undefined) return null;
  // Prefilter: a file that spells none of the tree's alias prefixes cannot
  // have a match, and parsing it would be the whole cost of this pass for
  // nothing. `prefixes` is the set of literal prefixes, so this is
  // conservative in the safe direction (it can only admit extra files).
  const body = text;
  if (!scope.prefixes.some((p) => body.includes(p))) return null;
  const spans = specifierSpans(body, fileName);
  const edits: { start: number; end: number; text: string }[] = [];
  for (const { spec, start, end } of spans) {
    // A registered package ENTRY keeps precedence over the tree's own alias:
    // that is Node's answer (the installed package, one copy) and it is the
    // order provenancePaths has always used. So does an EXTERNAL — a package
    // the driver has installed that simply was not attestable. Both are the
    // same rule the prescan applies (bareImportsOf's viaAlias), and the two
    // have to apply it identically: a specifier the preflight resolves to an
    // npm package and tsgo resolves into the checkout is one import the two
    // worlds disagree about, with nothing said.
    if (provenanceEntryFor(spec) !== null || isProvenanceExternalSpecifier(spec)) continue;
    const target = aliasTargetFile(scope.patterns, spec);
    if (target === null) continue;
    edits.push({ start, end, text: relativeSpecifier(fileName, target) });
  }
  if (edits.length === 0) return null;
  let out = "";
  let at = 0;
  for (const e of edits) {
    out += body.slice(at, e.start) + e.text;
    at = e.end;
  }
  out += body.slice(at);
  rewritten.set(tsgoPath(fileName), edits.length);
  return out;
}

/** The disk read the shadow uses when nothing above it answered. */
export function readSourceForRewrite(fileName: string): string | undefined {
  try {
    return readFileSync(fileName, "utf8");
  } catch {
    return undefined;
  }
}
