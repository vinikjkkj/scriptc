import { globSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { analyze, renderCoverage } from "@scriptc/compiler";

const repoRoot = join(import.meta.dirname, "../..");
/* POSIX spelling on BOTH sides. The diagnostics the analyzer renders carry
 * forward slashes on every host, but `coverage.file` is the entry path as
 * the caller spelled it — join() hands that back with backslashes on win32,
 * so normalizing only the needle (c3c35d2's fix elsewhere) still stripped
 * nothing here and every snapshot header came out absolute. Worse than
 * cosmetic: renderCoverage lays its code column out against the widest
 * line, so an absolute header silently re-flowed every table too. No-op
 * off win32. */
const posix = (s: string): string => s.split("\\").join("/");
const repoRootPosix = posix(repoRoot);
const fixture = (name: string) => join(repoRoot, "tests/coverage-fixtures", name);

function report(path: string, opts: { dynamic?: boolean } = {}): string {
  const { coverage } = analyze(path, opts);
  return renderCoverage({
    ...coverage,
    file: posix(coverage.file).replace(repoRootPosix + "/", ""),
  });
}

test("mixed program: percentage and grouped blockers", async () => {
  await expect(report(fixture("mixed.ts"))).toMatchFileSnapshot(
    "__snapshots__/coverage-mixed.txt",
  );
});

test("dynamic-capable blockers split from static rejections", async () => {
  // SC2010/SC2011/SC2012 sites group under "runs with --dynamic";
  // constructs no flag fixes stay under "blockers".
  await expect(report(fixture("dynamic-mix.ts"))).toMatchFileSnapshot(
    "__snapshots__/coverage-dynamic-mix.txt",
  );
});

test("--dynamic analysis: island sites count as compiled-dynamically", async () => {
  // The same fixture analyzed as a --dynamic build: the island-capable
  // sites LOWER (splitting out of "compile statically" into "compile
  // dynamically") and only the flag-independent rejections remain
  // blockers — this report is the "distance to a working build" view.
  await expect(report(fixture("dynamic-mix.ts"), { dynamic: true })).toMatchFileSnapshot(
    "__snapshots__/coverage-dynamic-mix-dynamic.txt",
  );
});

test("unreached blockers report in their own group", async () => {
  // Bodies nothing on the entry path reaches lower only for analysis:
  // their blockers render dim, under "in unreached code" — and the same
  // program BUILDS (the differential dead-strip tests pin that side).
  await expect(report(fixture("unreached.ts"))).toMatchFileSnapshot(
    "__snapshots__/coverage-unreached.txt",
  );
});

test("unreached JS blockers are listed, not just counted (lowerer.ts remainder pass)", async () => {
  // unusedJsCorner is never called. The remainder lowerer that analyzes
  // unreached bodies for coverage reports `e.code = 42` and `e.fatal = true`
  // as ordinary blockers of the unreached group (a refusal is never
  // deferred to a runtime fence), dimmed because a build never lowers them.
  await expect(report(fixture("unreached-js-fences.js"))).toMatchFileSnapshot(
    "__snapshots__/coverage-unreached-js-fences.txt",
  );
});

test("an IR-validation failure sinks the verdict and reports as itself", () => {
  // The rendering half of the same fix, pinned without depending on a
  // program that still trips the validator — after the cast-launder fences
  // the mutation sweep finds none, which is the point of the fences.
  // An ICE is not a blocker (nothing in the source is unsupported) and not
  // advice (the program does not build), so it renders under its own
  // heading, ABOVE the verdict, and the verdict below it can no longer be
  // green.
  const base = {
    file: "x.ts",
    stats: { statementsTotal: 3, statementsFailed: 0, statementsIsland: 0, functionsSkipped: 0 },
    diagnostics: [],
    preflightFailed: false,
  };
  const green = renderCoverage(base);
  expect(green).toContain("fully static");

  const ice = renderCoverage({
    ...base,
    ice: [
      {
        code: "SC9001",
        message:
          "internal compiler error: in %init.0: call %obj.keys.0 arg 0: expected record, got object — please report this",
        loc: { file: "x.ts", start: 0, end: 0 },
      },
    ],
  });
  expect(ice).not.toContain("fully static");
  expect(ice).toContain("internal compiler error");
  expect(ice).toContain("SC9001");
  // Still an honest 100% on the STATEMENT line: every statement lowered.
  // What failed is the module, and the report must not confuse the two.
  expect(ice).toContain("compile statically    3");
});

test("fully static program reports 100%", () => {
  const out = report(join(repoRoot, "tests/corpus/400-fib.ts"));
  expect(out).toContain("(100%)");
  expect(out).toContain("fully static");
});

test("fully static JavaScript program reports 100%", () => {
  const out = report(join(repoRoot, "tests/corpus/1590-js-unannotated.js"));
  expect(out).toContain("(100%)");
  expect(out).toContain("fully static");
});

test("JS inference gaps land where 'any' lands: SC2011 static, island dynamic", async () => {
  // The js-gap fixture's tsconfig turns noImplicitAny off, so the untyped
  // parameter types `any` — the static analysis reports the site as
  // dynamic-capable (SC2011) while the JSDoc-typed neighbor stays static.
  await expect(report(fixture("js-gap/gap.js"))).toMatchFileSnapshot(
    "__snapshots__/coverage-js-gap.txt",
  );
  await expect(report(fixture("js-gap/gap.js"), { dynamic: true })).toMatchFileSnapshot(
    "__snapshots__/coverage-js-gap-dynamic.txt",
  );
});

test("dyn object-literal accessors: what lowers, and what refuses by name", async () => {
  // A get/set accessor in a CHECKED-DYNAMIC object literal lowers (one
  // dyn.defineProp per accessor key, carrying the literal's own enumerable
  // and configurable descriptor). This fixture holds only the shapes that
  // still REFUSE, and pins each message: the fold would otherwise put the
  // key in a position, or under a definition rule, Node does not.
  await expect(report(fixture("dyn-object-literal-accessors.js"))).toMatchFileSnapshot(
    "__snapshots__/coverage-dyn-object-literal-accessors.txt",
  );
});

test("npm package sites attribute per package", async () => {
  // Every site of a package-declared value groups into one SC2013 line
  // naming the package ("values from the 'mathkit' package ..."), inside
  // the "runs with --dynamic" group — reusing the diagnostics fixture so
  // the two views of the same program stay in sync.
  await expect(report(join(repoRoot, "tests/diagnostics/npm-imports/main.ts"))).toMatchFileSnapshot(
    "__snapshots__/coverage-npm-packages.txt",
  );
});

test("lazy edges inventory: unresolvable require()/import() targets mark as lazy traps", async () => {
  // The lazy-traps npm fixture builds (Node's per-kind edge semantics:
  // require fails at the call, import() at evaluation) — the coverage
  // table lists every blocked-but-lazy specifier with the lazy-trap
  // marker instead of reporting SC2030 blockers.
  await expect(
    report(join(repoRoot, "tests/fixtures/npm/cases/lazy-traps/main.ts"), { dynamic: true }),
  ).toMatchFileSnapshot("__snapshots__/coverage-npm-lazy-traps.txt");
});

test("lazy builtin edges mark in the builtins table, __require sites included", async () => {
  // The esbuild-require fixture routes external requires through the
  // bundle's __require helper — its literal call sites collect as require
  // edges, so the builtins table lists node:os/node:tty (shimmed) and
  // node:stream as a lazy trap (unshimmed, reached only by the
  // never-called require) without failing the build.
  await expect(
    report(join(repoRoot, "tests/fixtures/npm/cases/esbuild-require/main.ts"), { dynamic: true }),
  ).toMatchFileSnapshot("__snapshots__/coverage-npm-lazy-builtin.txt");
});

test("import fences no longer stop analysis: percentage plus module blockers", async () => {
  // The fenced module reports ONE grouped blocker (the import line plus
  // every use of its bindings carry the same message); the rest of the
  // program still counts. Lives in the node-types fixture: builtin
  // specifiers only RESOLVE (typecheck) with @types/node adopted — the
  // fallback world turns them into tsc errors, which stay fatal. The same
  // file must FAIL a build (compile() keeps preflight fatal).
  await expect(
    report(join(repoRoot, "tests/fixtures/node-types/import-fences.ts")),
  ).toMatchFileSnapshot("__snapshots__/coverage-import-fences.txt");
});

test("a whole-export root that is REBOUND after the export keeps its fence", () => {
  // `module.exports = <root>` over a root the alias path cannot carry gets
  // storage of its own — Node's snapshot of the value the root had at that
  // statement. Its one soundness condition is that nothing can rebind the
  // root afterwards: storage would then answer the snapshot while a requirer
  // read resolving through the alias path answers the LIVE binding, and a
  // compiled program that picks one of two different answers is the
  // silent-divergence trap, not a lowering. The write analysis decides it
  // (writes provably before the export are admitted — corpus
  // 1714-cjs-whole-export-root), and this fixture rebinds after, so the
  // refusal stands.
  const out = report(fixture("cjs-whole-export-rebound/main.cjs"));
  expect(out).toContain("exporting the mutable 'let' binding 'j' by reference");
});

test("a module.exports TABLE entry over a rebindable let keeps its fence", () => {
  // The table entry asks the same question the whole-export root asks, and
  // for the same reason: Node copies the binding's VALUE into the table at
  // the export statement while this lowering exports it by REFERENCE, so
  // the two part company exactly when something assigns the binding later.
  // A binding whose every write provably runs before the export compiles
  // (corpus 7163-cjs-export-a-settled-let); these two do not.
  //
  // The fixture exists because the shared analysis is symbol-sensitive: a
  // SHORTHAND property name binds to the PROPERTY symbol, so tracking that
  // symbol finds no writes in either file and both would compile -- and
  // both would print a value Node does not print, silently.
  const out = report(fixture("cjs-table-export-mutable/main.cjs"));
  expect(out).toContain("exporting the mutable 'let' binding 'n' by reference");
  // Both sites, grouped: one for the rebound let, one for the function write.
  expect(out).toMatch(/×2\s+exporting the mutable 'let' binding 'n' by reference/);
});

test("'exports[<literal>]' lowers; a key only the runtime knows keeps its fence", () => {
  // `exports[k] = v` is the SAME attachment as `exports.k = v`, spelled with
  // a key: Node defines the property the key names and nothing else differs.
  // The recognizer admits it only when the key is a LITERAL whose property
  // name is a compile-time constant, so this fixture is a PAIR -- four
  // attachments that must lower, and five keys that must still fence. The
  // second half is load-bearing: admitting the general element access would
  // name at compile time a property Node names at run time, which is the
  // silent-divergence trap, not a lowering.
  const out = report(fixture("cjs-export-element-access/main.cjs"));
  // The refused half, by count: an identifier key, an arithmetic key, a
  // template key, a call-expression key, and `1e400` -- a NumericLiteral
  // whose property name is "Infinity", not its own spelling.
  expect(out).toMatch(/×5\s+the reference to 'exports' \(a binding form with no lowering\)/);
  // The admitted half carries no site at all: before the element-access arm
  // this same fixture reported 8.
  expect(out).not.toMatch(/×8\s/);
});

test("a STRING written to an error's `code` lands in ScrError's slot; anything else keeps its fence", () => {
  // `err.code = 'ETIMEDOUT'` is the WRITE twin of the error.code read.
  // ScrError's third slot is already in %Error's layout (`%code`) and the
  // runtime stamps it at every fs/exec throw site, so a STRING written
  // through the base view lands exactly where error.code reads back --
  // which is why `err.name = v` and `err.message = v`, the other two
  // ScrError slots, have always lowered while this one did not.
  //
  // The admitted half is three writes (a literal, a subclass receiver, a
  // string-TYPED non-literal RHS) plus the `name` control. The two writes
  // the slot cannot represent (a NUMBER, and a property with no slot at
  // all) used to stay fenced; own expando properties on error objects now
  // carry them, so the whole fixture is static. The binary agrees with
  // Node on both backends (run checked by hand, C and LLVM).
  const out = report(fixture("error-code-slot-write.js"));
  expect(out).not.toMatch(/assignment to non-variables/);
  expect(out).toContain("(100%)");
  expect(out).toContain("fully static");
});

test("a nested `module.exports.<n> =` assigns the global its own nested READ answers from", () => {
  // The write twin of the CJS export-member read. A top-level
  // `module.exports.<n> = v` registers an export global; lower-exprs' read
  // arm answers from that global ANYWHERE in the file -- nested reads
  // included -- and says so: "the global IS the storage every `exports.Sub
  // =` statement assigns". Write positions were excluded from it and
  // handed to the export-assignment machinery, which walks sf.statements
  // only, so a nested write to a top-level-attached member fell to
  // "assignment to non-variables" while a nested read of that same member
  // lowered. One storage, two answers.
  //
  // The members with NO top-level attachment used to be the refused half
  // (no global, nothing to assign); members written only inside function
  // bodies now join the export table, so the fixture is fully static.
  const out = report(fixture("cjs-export-member-nested-write/main.cjs"));
  expect(out).not.toMatch(/assignment to non-variables/);
  expect(out).toContain("fully static");
});

test("type errors block analysis", () => {
  const out = report(fixture("type-errors.ts"));
  expect(out).toContain("not analyzable");
  expect(out).toContain("1 TypeScript error");
});

test("type errors render the same code frame a build prints", () => {
  const { coverage, sourceTexts } = analyze(fixture("type-errors.ts"));
  const out = renderCoverage(coverage, { sourceTexts });
  expect(out).toContain("not analyzable");
  expect(out).toContain("error SC0001");
  // The frame gutter with the offending line, exactly the build renderer.
  expect(out).toMatch(/\d+ \| /);
  expect(out).toContain("^");
});

test("bare '.' and '..' imports are relative edges (the vercel-CLI dialect)", () => {
  // `from '..'` / `from '.'` resolve as directory imports to the target's
  // index module — exactly what the project's bundler-resolution checker
  // answered — so the graph loads and everything compiles statically.
  const out = report(fixture("dot-parent/main.ts"));
  expect(out).toContain("(100%)");
  expect(out).toContain("fully static");
});

test("a cycle whose top level calls a builtin with a builtin function value is admitted", () => {
  // vercel's link.ts cluster: `promisify(fs.readFile)` at a cycle member's
  // top level. Callee and callable argument are both dts-rooted — no user
  // code can run in the init window — so no SC1016 and the analysis
  // renders statement counts (the statement itself may stay a
  // statement-LEVEL blocker; that is a different fence).
  const out = report(fixture("cycle-inert-builtin/main.ts"));
  expect(out).not.toContain("circular imports");
  expect(out).toContain("statements analyzed");
});
