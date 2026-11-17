/* The mechanical inventory behind docs/flags-and-env.md: every CLI flag and subcommand, every environment variable the tool reads or sets, and every
 * getenv() of the runtime that a compiled program carries. Extracted from the SOURCE (TypeScript through the TypeScript AST, C and shell by pattern),
 * so adding a flag or an env read without documenting it is a test failure (flags-env-doc.test.ts) rather than something a reviewer has to remember.
 *
 * WHAT COUNTS, and why each rule exists:
 *  - CLI: the keys of CLI_OPTIONS (node:util parseArgs) in packages/cli/src/main.ts, the `--no-<key>` spelling of every boolean (parseArgs runs with
 *    allowNegative), the short aliases, and the subcommand words main() compares against.
 *  - tool env: `process.env.X`, `process.env["X"]`, `const { X } = process.env` and an `env`-named call/property whose argument is a literal name,
 *    in packages/cli/src and packages/compiler/src (not tests), plus the same in scripts/. A bare string literal that LOOKS like one of this project's
 *    variables (SCRIPTC_*, SCR_*) also counts: those are set for a child process or passed through a helper (envFlag("SCRIPTC_X")), which the AST rule cannot see.
 *    The test harness, perf rigs and CI workflows are scanned for this project's own SCRIPTC_* names only.
 *    Names the tool only mentions inside strings it prints for the compiled program's own process.env are not reads of the tool and are not matched.
 *  - runtime env: getenv("X") and helper calls whose callee name contains `env` and whose first argument is a literal name, in packages/runtime/src
 *    (.c and .h), plus the `getenv(\"X\")` text the compiler emits into programs.
 *  - build-time knobs: `#ifndef SCR_X` guards in packages/runtime/src: a compile-time default that SCRIPTC_PROF_CFLAGS (-DSCR_X=...) overrides.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";

export const repoRoot = join(import.meta.dirname, "../..");

export interface Item {
  name: string;
  /** repo-relative files that mention it (first few) */
  where: string[];
}

function walk(dir: string, accept: (f: string) => boolean, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (e === "node_modules" || e === "dist" || e === "build" || e === ".git" || e === ".scriptc") continue;
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, accept, out);
    else if (accept(p)) out.push(p);
  }
  return out;
}

function add(map: Map<string, Set<string>>, name: string, file: string): void {
  let s = map.get(name);
  if (s === undefined) map.set(name, (s = new Set()));
  s.add(relative(repoRoot, file).split("\\").join("/"));
}

function toItems(map: Map<string, Set<string>>): Item[] {
  return [...map.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([name, w]) => ({ name, where: [...w].sort().slice(0, 4) }));
}

const PROJECT_NAME = /^(SCRIPTC|SCR)_[A-Z0-9_]+$/;

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

function isProcessEnv(n: ts.Node): boolean {
  return ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "process" && n.name.text === "env";
}

/** Env names read in one TypeScript/JavaScript source text. */
export function envNamesOf(text: string, file: string, into: Map<string, Set<string>>): void {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith(".ts") ? ts.ScriptKind.TS : ts.ScriptKind.JS);
  const visit = (n: ts.Node): void => {
    if (ts.isPropertyAccessExpression(n) && isProcessEnv(n.expression)) add(into, n.name.text, file);
    else if (ts.isElementAccessExpression(n) && isProcessEnv(n.expression) && ts.isStringLiteralLike(n.argumentExpression)) add(into, n.argumentExpression.text, file);
    else if (ts.isVariableDeclaration(n) && n.initializer !== undefined && isProcessEnv(n.initializer) && ts.isObjectBindingPattern(n.name)) {
      for (const el of n.name.elements) {
        const key = el.propertyName ?? el.name;
        if (ts.isIdentifier(key) || ts.isStringLiteralLike(key)) add(into, key.text, file);
      }
    } else if (ts.isPropertyAssignment(n) && ts.isIdentifier(n.name) && n.name.text === "env" && ts.isObjectLiteralExpression(n.initializer)) {
      // a child process's environment: `spawn(cmd, { env: { ...process.env, SCR_X: "1" } })`
      for (const p of n.initializer.properties) if (ts.isPropertyAssignment(p) && (ts.isIdentifier(p.name) || ts.isStringLiteralLike(p.name)) && PROJECT_NAME.test(p.name.text)) add(into, p.name.text, file);
    } else if (ts.isStringLiteralLike(n) && /^SCRIPTC_[A-Z0-9_]+$/.test(n.text)) add(into, n.text, file);
    ts.forEachChild(n, visit);
  };
  visit(sf);
}

/** The environment variables the CLI, the compiler and the scripts read or set. */
export function toolEnv(): Item[] {
  const into = new Map<string, Set<string>>();
  const roots = [join(repoRoot, "packages/cli/src"), join(repoRoot, "packages/compiler/src"), join(repoRoot, "scripts")];
  for (const root of roots) {
    for (const f of walk(root, (p) => /\.(ts|mts|mjs|cjs|js)$/.test(p) && !/\.test\.[mc]?[tj]s$/.test(p))) envNamesOf(readFileSync(f, "utf8"), f, into);
  }
  // shell and PowerShell scripts: only this project's own names (a shell script reads dozens of generic variables that are not its interface)
  for (const f of walk(join(repoRoot, "scripts"), (p) => /\.(sh|ps1)$/.test(p))) {
    for (const m of readFileSync(f, "utf8").matchAll(/\b(SCRIPTC_[A-Z0-9_]+)\b/g)) add(into, m[1]!, f);
  }
  // the test harness, the perf/bench rigs and the CI workflows: this project's own names only (a test reads and sets dozens of generic variables)
  const harnessRoots = ["tests/harness", "tests/perf", "tests/bench", "tests/driver-rigs", ".github/workflows"].map((r) => join(repoRoot, r));
  const harnessFiles = [join(repoRoot, "vitest.config.ts"), ...harnessRoots.flatMap((r) => walk(r, (p) => /\.(ts|mts|mjs|cjs|js|sh|yml|yaml|py)$/.test(p)))];
  for (const f of harnessFiles) {
    if (f.endsWith("flags-env-inventory.ts") || f.endsWith("flags-env-doc.test.ts")) continue;
    for (const m of readFileSync(f, "utf8").matchAll(/\b(SCRIPTC_[A-Z0-9_]+)\b/g)) add(into, m[1]!, f);
  }
  const items = toItems(into);
  // Not environment variables: a name only ever matched as a project-looking string in a message or a corpus path.
  return items.filter((i) => ENV_NAME.test(i.name));
}

/** The environment names one runtime C text reads: getenv("X") and helper calls whose callee name contains `env` with a literal first argument. */
export function runtimeNamesOfText(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/getenv\(\s*"([A-Za-z_][A-Za-z0-9_]*)"\s*\)/g)) out.add(m[1]!);
  for (const m of text.matchAll(/\b[a-z_0-9]*env[a-z_0-9]*\(\s*"([A-Z][A-Z0-9_]{2,})"/g)) out.add(m[1]!);
  return [...out];
}

/** getenv("X") and env-helper literals in the runtime, plus the getenv the compiler emits. */
export function runtimeEnv(): Item[] {
  const into = new Map<string, Set<string>>();
  const rt = join(repoRoot, "packages/runtime/src");
  for (const f of walk(rt, (p) => /\.(c|h)$/.test(p))) for (const name of runtimeNamesOfText(readFileSync(f, "utf8"))) add(into, name, f);
  for (const f of walk(join(repoRoot, "packages/compiler/src"), (p) => /\.ts$/.test(p))) {
    for (const m of readFileSync(f, "utf8").matchAll(/getenv\(\s*\\?"([A-Za-z_][A-Za-z0-9_]*)\\?"\s*\)/g)) add(into, m[1]!, f);
  }
  return toItems(into);
}

/** `#ifndef SCR_X` compile-time defaults of the runtime. */
export function buildKnobs(): Item[] {
  const into = new Map<string, Set<string>>();
  for (const f of walk(join(repoRoot, "packages/runtime/src"), (p) => /\.(c|h)$/.test(p))) {
    const text = readFileSync(f, "utf8");
    for (const m of text.matchAll(/^#ifndef\s+(SCR_[A-Z0-9_]+)\s*\n#\s*define\s+\1\b/gm)) if (!m[1]!.endsWith("_H")) add(into, m[1]!, f);
  }
  return toItems(into);
}

export interface CliInventory {
  flags: Item[];
  shorts: string[];
  commands: string[];
}

/** The CLI surface of packages/cli/src/main.ts. */
export function cli(): CliInventory {
  return cliFromText(readFileSync(join(repoRoot, "packages/cli/src/main.ts"), "utf8"));
}

/** The CLI surface of a main.ts text (also what the test's planted-flag control runs on). */
export function cliFromText(text: string): CliInventory {
  const file = join(repoRoot, "packages/cli/src/main.ts");
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const flags = new Map<string, Set<string>>();
  const shorts: string[] = [];
  const commands = new Set<string>();
  const here = "packages/cli/src/main.ts";
  const visit = (n: ts.Node): void => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === "CLI_OPTIONS" && n.initializer !== undefined) {
      let init: ts.Expression = n.initializer;
      while (ts.isAsExpression(init) || ts.isParenthesizedExpression(init)) init = init.expression;
      if (ts.isObjectLiteralExpression(init)) {
        for (const p of init.properties) {
          if (!ts.isPropertyAssignment(p)) continue;
          const key = ts.isIdentifier(p.name) || ts.isStringLiteralLike(p.name) ? p.name.text : null;
          if (key === null) continue;
          add(flags, `--${key}`, here);
          if (ts.isObjectLiteralExpression(p.initializer)) {
            let boolean = false;
            let defaultTrue = false;
            for (const q of p.initializer.properties) {
              if (!ts.isPropertyAssignment(q) || !ts.isIdentifier(q.name)) continue;
              if (q.name.text === "type" && ts.isStringLiteralLike(q.initializer) && q.initializer.text === "boolean") boolean = true;
              if (q.name.text === "short" && ts.isStringLiteralLike(q.initializer)) shorts.push(`-${q.initializer.text}`);
              if (q.name.text === "default" && q.initializer.kind === ts.SyntaxKind.TrueKeyword) defaultTrue = true;
            }
            // allowNegative: every boolean also accepts --no-<key>; the two that matter are spelled out in --help (keep-c defaults to true)
            if (boolean && defaultTrue) add(flags, `--no-${key}`, here);
          }
        }
      }
    }
    // the subcommand words: `command === "build"`, `command !== "run"`
    if (ts.isBinaryExpression(n) && (n.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken || n.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken)) {
      const [l, r] = [n.left, n.right];
      if (ts.isIdentifier(l) && l.text === "command" && ts.isStringLiteralLike(r)) commands.add(r.text);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return { flags: toItems(flags), shorts: [...new Set(shorts)].sort(), commands: [...commands].sort() };
}
