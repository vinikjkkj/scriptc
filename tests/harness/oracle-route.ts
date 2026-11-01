/* The Node oracle's source for one corpus entry, shared by every suite that
 * runs corpus programs under Node (differential, llvm-differential,
 * linux-differential, windows-differential).
 *
 * Node runs a .ts entry with type STRIPPING, and stripping refuses syntax
 * that has runtime meaning: `import x = require(m)` ("TypeScript import
 * equals declaration is not supported in strip-only mode",
 * ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX). Such a program's oracle is tsc's
 * CommonJS transpile, which binds x to module.exports exactly as the
 * statement does. Decorator programs (`// @tsc-decorators`) run tsc's ES2022
 * downlevel instead. Every other program runs as written (null). */
import { createHash } from "node:crypto";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import ts5 from "typescript";

/** A TS `import x = require(...)` statement (not `import type`-less bare
 * `import x = N.y`, which is an entity alias and erasable). */
const IMPORT_EQUALS_REQUIRE = /^\s*import\s+(?:type\s+)?[A-Za-z_$][\w$]*\s*=\s*require\s*\(/m;

export interface OracleText {
  /** "dec" (tsc ES2022 downlevel, .mjs) or "cjs" (tsc CommonJS transpile, .cjs). */
  readonly kind: "dec" | "cjs";
  readonly ext: "mjs" | "cjs";
  /** sha256 prefix of the typescript version and the source bytes. */
  readonly key: string;
  readonly text: string;
}

/** The oracle text for a program, or null when Node runs the file as written. */
export function oracleTextFor(file: string, src: string, decorators: boolean): OracleText | null {
  const cjs = IMPORT_EQUALS_REQUIRE.test(src);
  if (!cjs && !decorators) return null;
  const key = createHash("sha256").update(ts5.version).update("\0").update(src).digest("hex").slice(0, 16);
  const text = ts5.transpileModule(src, {
    compilerOptions: {
      target: ts5.ScriptTarget.ES2022,
      module: cjs ? ts5.ModuleKind.CommonJS : ts5.ModuleKind.ESNext,
    },
    fileName: file,
  }).outputText;
  return cjs
    ? { kind: "cjs", ext: "cjs", key, text }
    : { kind: "dec", ext: "mjs", key, text };
}

/** Atomic publish of an oracle file under `dir` (concurrent suites write the
 * same content-keyed name; rename keeps readers from a truncated file). */
export function publishOracle(dir: string, name: string, text: string): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
  return path;
}
