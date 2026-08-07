/* --npm-static: opted-in npm packages' shipped JS compiles STATICALLY as
 * program modules (no island) — the slice-2 pilot. Three tiers pinned
 * here:
 *
 *   1. GREEN pilots (escape-string-regexp, slash — real packages, vendored
 *      under tests/fixtures/npm-static): fully static builds whose stdout
 *      byte-matches Node across the argv-free programs.
 *   2. HONEST PARTIALS (ms, picocolors, commander): the packages COMPILE
 *      (preflight admits them; the coverage report says "static") but
 *      carry runtime fences on driven paths — the coverage numbers are
 *      pinned so the frontier only moves deliberately.
 *   3. The FALLBACK contract: a package whose preflight refuses (an
 *      unshimmed-builtin require inside its files) drops back to the
 *      island under --dynamic with a coverage note — never a build
 *      failure, and the flag never changes a flagless build.
 *
 * The flag defaults OFF: nothing here touches the production npm/island
 * lanes (npm.test.ts, vercel-e2e.test.ts pin those). */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { globSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, test } from "vitest";
import { analyze, compile } from "@scriptc/compiler";

const execFileAsync = promisify(execFile);
const repoRoot = join(import.meta.dirname, "../..");
const fixturesRoot = join(repoRoot, "tests/fixtures");
const pilotRoot = join(fixturesRoot, "npm-static");
const cacheDir = join(repoRoot, "node_modules/.cache/scriptc-tests");
const sanitize = process.env["SCRIPTC_SAN"] === "1";

interface RunResult {
  stdout: Buffer;
  exitCode: number;
}

async function runBinary(cmd: string, args: string[]): Promise<RunResult> {
  try {
    const { stdout } = await execFileAsync(cmd, args, { encoding: "buffer" });
    return { stdout, exitCode: 0 };
  } catch (err) {
    const e = err as { code?: unknown; stdout?: Buffer };
    if (typeof e.code !== "number" || !Buffer.isBuffer(e.stdout)) throw err;
    return { stdout: e.stdout, exitCode: e.code };
  }
}

/** Compile one pilot statically (no --dynamic — the whole point) with the
 * named packages opted in; cache-keyed over the program and the vendored
 * packages. */
async function buildStatic(entry: string, npmStatic: string[] | "auto"): Promise<string> {
  const hash = createHash("sha256");
  const inputs = [
    entry,
    ...globSync(join(pilotRoot, "**/node_modules/**/*.{js,mjs,cjs,json,d.ts}")).sort(),
    // the bundler-emitted-CJS mini packages (cases 2465-2469, 2556-2557)
    ...globSync(join(fixturesRoot, "npm/node_modules/gt*/**/*.{js,json}")).sort(),
  ];
  for (const f of inputs) hash.update(f).update(readFileSync(f));
  const key = hash
    .update(npmStatic === "auto" ? "auto" : npmStatic.join(","))
    .update(sanitize ? "san" : "plain")
    .digest("hex")
    .slice(0, 16);
  const outDir = join(cacheDir, `npm-static-${key}`);
  mkdirSync(outDir, { recursive: true });
  const result = await compile(entry, {
    outPath: join(outDir, "program"),
    outDir,
    sanitize,
    npmStatic,
    // Pinned: the suite pins --npm-static's FRONTEND frontier (coverage
    // numbers, fence sites); the backend lane is held fixed so those pins
    // move only when the frontend moves.
    backend: "c",
  });
  if (!result.ok) {
    throw new Error(
      "npm-static pilot failed to compile:\n" +
        result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"),
    );
  }
  return result.binaryPath;
}

describe(`npm-static pilots${sanitize ? " (sanitized)" : ""}`, () => {
  // Tier 1: fully static, byte-exact against Node. ms's driven surface —
  // BOTH the parse and format directions — joined when implicit-any
  // monomorphization and aliased-typeof narrowing landed; its one
  // remaining fence sits on the garbage-input path (pinned below), which
  // ms-cli.ts deliberately never drives.
  test.for([
    ["escape-string-regexp", "escape-cli.ts"],
    ["slash", "slash-cli.ts"],
    ["ms", "ms-cli.ts"],
    // dualist pins the "node" exports condition: Node runs ./node.js
    // (yaml's browser-vs-node shape) and the opted-in resolution must
    // land on the SAME artifact, never the browser build.
    ["dualist", "dualist-cli.ts"],
    // varintish is untyped bitwise arithmetic end to end — the varint /
    // zigzag / 64-bit-split core of a generated protobuf runtime. Every
    // operand of every `&`, `|`, `^`, `<<`, `>>`, `>>>` is an implicit-any
    // parameter, so the whole package rides the checked-dynamic path; the
    // operators are ToInt32/ToUint32 by specification, so a static build
    // owes Node the same bytes and this differential is the proof.
    ["varintish", "varint-cli.ts"],
    // dyntable is shorthand METHODS in a dyn object literal — the value half
    // of esbuild's `__commonJS` module table. The helper's parameter is
    // untyped, so each table's contextual type is `any` and the literal
    // takes the JS declaration fallback (a dyn object, not a record); the
    // methods lower through the same lowerLambda the record path gives the
    // identical node. String-literal keys no C identifier can spell, a
    // numeric key, closures over the enclosing scope, a method calling a
    // sibling entry, and the source-order interleaving of effectful
    // property values are all driven, so the differential is the proof
    // that the lowered closures carry the right values and not just a
    // compiling shape.
    ["dyntable", "dyntable-cli.ts"],
    // fnmembers attaches its whole API as members of a module-level
    // function — the pre-ES6 namespace-object idiom, untyped end to end.
    // Function members are per-(symbol × key) module globals, and the
    // export-table spelling of the receiver names the same function
    // object, so the importer's reads and the package's own writes meet
    // at one storage.
    ["fnmembers", "fnmembers-cli.ts"],
    // fnprops writes own properties ONTO a function value that arrives
    // through the checked-dynamic path — the other half of the same
    // idiom, where the receiver is a dyn function box rather than a name
    // the frontend can route to a module global. The read side already
    // answered from the closure's property table while the WRITE threw
    // "Cannot create property 'k' on function", so this program compiled
    // with no diagnostic and no fence and then died at run time. Every
    // observable it prints is a Node answer: the read back, own-property
    // presence (the call protobufjs's encode guards every field with),
    // `in`, Object.keys, Object.assign, and — the one that decides where
    // the table lives — a SECOND box of the same function value seeing
    // the same properties.
    ["fnprops", "fnprops-cli.ts"],
  ] as const)("%s compiles statically and byte-matches Node", async ([pkg, file]) => {
    const entry = join(pilotRoot, file);
    const binary = await buildStatic(entry, [pkg]);
    const [nodeRes, nativeRes] = await Promise.all([
      runBinary("node", [entry]),
      runBinary(binary, []),
    ]);
    expect(nativeRes.stdout.toString("utf8")).toBe(nodeRes.stdout.toString("utf8"));
    expect(nativeRes.exitCode).toBe(nodeRes.exitCode);
  }, 120_000);

  // Tier 1, auto mode: the eligibility heuristics pick escape-string-regexp
  // (own .d.ts, unminified, no transform markers) without naming it.
  test("--npm-static=auto opts the eligible pilot in", () => {
    const { coverage } = analyze(join(pilotRoot, "escape-cli.ts"), { npmStatic: "auto" });
    expect(coverage.npmStatic).toEqual([
      { package: "escape-string-regexp", status: "static" },
    ]);
    expect(coverage.preflightFailed).toBe(false);
    expect(coverage.stats.statementsFailed).toBe(0);
  }, 120_000);

  // Auto's runtime-JS probe anchors at the IMPORTING file, not the entry:
  // shouty is installed only in inner/'s node_modules (the pnpm-monorepo
  // shape — vercel's CLI deps live in packages/cli/node_modules while the
  // analysis driver sits outside every package realm), so an entry-anchored
  // probe answers "no runtime JS entry resolves" for an ordinary install.
  test("--npm-static=auto probes runtime JS from the importing file's realm", async () => {
    const entry = join(pilotRoot, "nested/main.ts");
    const { coverage } = analyze(entry, { npmStatic: "auto" });
    expect(coverage.npmStatic).toEqual([{ package: "shouty", status: "static" }]);
    expect(coverage.preflightFailed).toBe(false);
    expect(coverage.stats.statementsFailed).toBe(0);
    const binary = await buildStatic(entry, "auto");
    const [nodeRes, nativeRes] = await Promise.all([
      runBinary("node", [entry]),
      runBinary(binary, []),
    ]);
    expect(nativeRes.stdout.toString("utf8")).toBe(nodeRes.stdout.toString("utf8"));
    expect(nativeRes.exitCode).toBe(nodeRes.exitCode);
  }, 120_000);

  // Auto refuses ms: it ships no own .d.ts (the declared-claim criterion),
  // so the import keeps today's story — and the explicit opt-in below is
  // the user's override.
  test("--npm-static=auto refuses a package with no own .d.ts", () => {
    const { coverage } = analyze(join(pilotRoot, "ms-cli.ts"), { npmStatic: "auto" });
    expect(coverage.npmStatic).toEqual([
      {
        package: "ms",
        status: "fallback",
        detail: "auto: it ships no own .d.ts declaration surface",
      },
    ]);
  }, 120_000);

  // ms's coverage, pinned: aliased-typeof narrowing carried the entry
  // conditional (`var type = typeof val` — the checker only narrows const
  // aliases), and the whole driven surface is static. What remains is
  // parse()'s undefined-returning GARBAGE paths against its JSDoc
  // `@return {Number}` claim: two bare `return;`s stay runtime fences,
  // and the switch's `return undefined` now COMPILES to the stranded-unit
  // trap (divergence 335) — the same loud TypeError, thrown by compiled
  // code instead of a deferred fence. Node answers undefined there, a
  // value the declared representation cannot hold, so each path traps
  // loudly instead of misbehaving. The frontier only moves deliberately.
  test("ms compiles static with the JSDoc-contradicting undefined returns pinned", () => {
    const { coverage } = analyze(join(pilotRoot, "ms-cli.ts"), { npmStatic: ["ms"] });
    expect(coverage.npmStatic).toEqual([{ package: "ms", status: "static" }]);
    expect(coverage.preflightFailed).toBe(false);
    expect(coverage.diagnostics).toHaveLength(0); // builds — fences are runtime
    const fences = coverage.runtimeFences ?? [];
    expect(fences.length).toBe(2);
    for (const f of fences) {
      expect(f.message).toMatch(/bare 'return'/);
    }
  }, 120_000);

  // protobufjs static-module's ONEOF ACCESSOR family, pinned in REFUSAL
  // ORDER rather than as a differential — oneofish does not compile, and
  // the point of the pin is WHICH construct refuses first.
  //
  // A census of the QR-path closure of a real generated protobuf bundle
  // counts 45 `Object.defineProperty` refusals inside it and 44 of them are
  // this shape. That count is misleading, and this fixture is the
  // reproduction: replacing those 44 calls with a bare read of the SAME
  // receiver leaves the total trap count byte-identical and moves all 44
  // onto the `.prototype` fence one for one. The receiver is the blocker —
  // a prototype object is not a value here — so a descriptor-side
  // `defineProperty` lowering would uncover it at the same statement and
  // move nothing. The four families below are the whole idiom, and each is
  // owned by a different rule; when any of them lands, this pin fails and
  // the next reader gets a corrected picture instead of the stale 45.
  test("the protobufjs oneof-accessor idiom refuses at the receiver, not the descriptor", () => {
    const { coverage } = analyze(join(pilotRoot, "oneof-cli.ts"), { npmStatic: ["oneofish"] });
    expect(coverage.npmStatic).toEqual([{ package: "oneofish", status: "static" }]);
    expect(coverage.preflightFailed).toBe(false);
    expect(coverage.diagnostics).toHaveLength(0); // builds — fences are runtime
    const fences = coverage.runtimeFences ?? [];
    const byFamily = (re: RegExp): number => fences.filter((f) => re.test(f.message)).length;
    expect(fences.length).toBe(7);
    // `Msg.prototype.field = null` — the prototype DEFAULTS.
    expect(byFamily(/assignment to non-variables/)).toBe(2);
    // `Object.hasOwnProperty.call(m, k)` — encode's presence predicate.
    expect(byFamily(/Function\.prototype\.call on a compiled function value/)).toBe(2);
    // `new Payload(p)` — [[Construct]] on a plain JS function.
    expect(byFamily(/constructing values other than classes declared in the program/)).toBe(1);
    // The two oneof accessors themselves — and the hint names the receiver.
    const defprop = fences.filter((f) => /'Object\.defineProperty'/.test(f.message));
    expect(defprop).toHaveLength(2);
    for (const f of defprop) {
      expect(f.code).toBe("SC2020");
      expect(f.hint).toMatch(/the RECEIVER is a prototype object/);
    }
  }, 120_000);

  // Tier 2, and the frontier this pins is the BUNDLER MODULE TABLE:
  // esbuild's `__commonJS`, `r({ "node_modules/x.js"(e, t) {...} })`, which
  // is what zapo's `spec/proto/index.js` is built out of nineteen times.
  //
  // The methods now lower (each one is a bundled module body), so the whole
  // table COMPILES and the module bodies are visible to the compiler. What
  // is left is the OTHER half of the same helper, and it is one construct
  // wearing two faces: `var o = Object.getOwnPropertyNames` is a builtin in
  // VALUE position, and `o` captured by the returned thunk then has no
  // static storage to thread. Both fences sit on the table's ACCESS path,
  // so the package compiles and traps on use.
  //
  // Pinned at exactly two, by message: if a method refusal ever comes back
  // it lands here as a third, and if the value-position lift ever arrives
  // this drops to zero and the package graduates to tier 1.
  test("the esbuild module table compiles, with only the getOwnPropertyNames pair left", () => {
    const { coverage } = analyze(join(pilotRoot, "modtable-cli.ts"), { npmStatic: ["modtable"] });
    expect(coverage.npmStatic).toEqual([{ package: "modtable", status: "static" }]);
    expect(coverage.preflightFailed).toBe(false);
    expect(coverage.diagnostics).toHaveLength(0); // builds — fences are runtime
    const fences = coverage.runtimeFences ?? [];
    expect(fences.map((f) => f.message).sort()).toEqual([
      expect.stringContaining("'Object.getOwnPropertyNames'") as string,
      expect.stringContaining("the binding 'o' captured through a plain nested function") as string,
    ]);
    // the module bodies are REACHED: the three method bodies more than
    // doubled the statements the compiler sees (20 behind the refusal)
    expect(coverage.stats.statementsTotal).toBeGreaterThan(35);
  }, 120_000);

  // fnmembers's frontier, pinned: the pre-ES6 namespace-object idiom
  // compiles with NOTHING left over — no build diagnostic and no runtime
  // fence. Before function members reached untyped JS this same program
  // did not build at all: the writes fell through to "assignment to
  // non-variables" and every read of a member was a hard "reading 'X'
  // from a value of type '{ (…): …; X: … }'" error.
  test("fnmembers's function-member idiom compiles with nothing left over", () => {
    const { coverage } = analyze(join(pilotRoot, "fnmembers-cli.ts"), { npmStatic: ["fnmembers"] });
    expect(coverage.npmStatic).toEqual([{ package: "fnmembers", status: "static" }]);
    expect(coverage.preflightFailed).toBe(false);
    expect(coverage.diagnostics).toHaveLength(0);
    expect(coverage.runtimeFences ?? []).toHaveLength(0);
    expect(coverage.stats.statementsFailed).toBe(0);
  }, 120_000);

  // fnprops's frontier, pinned. This one compiles clean on BOTH sides of
  // the fix — the write reached the dyn keyed write all along and simply
  // threw there — so this pin does not guard the runtime behaviour (the
  // differential above does). What it guards is that the whole shape
  // stays on the static path: if any of the keyed write, Object.hasOwn,
  // `in`, Object.keys or Object.assign over a function value ever falls
  // back to a fence, the count moves here first.
  test("fnprops's function-value property writes stay on the static path", () => {
    const { coverage } = analyze(join(pilotRoot, "fnprops-cli.ts"), { npmStatic: ["fnprops"] });
    expect(coverage.npmStatic).toEqual([{ package: "fnprops", status: "static" }]);
    expect(coverage.preflightFailed).toBe(false);
    expect(coverage.diagnostics).toHaveLength(0);
    expect(coverage.runtimeFences ?? []).toHaveLength(0);
    expect(coverage.stats.statementsFailed).toBe(0);
  }, 120_000);

  // Tier 2: commander opts in and COMPILES as program modules — the
  // coverage floor is pinned (≥85% of ~1200 statements static) so frontier
  // regressions surface here, while the remaining runtime fences keep the
  // differential on the island lane (npm.test.ts) for now. Implicit-any
  // monomorphization moved the driven frontier BEHIND the typed-value →
  // untyped-param boundary (methods like _registerCommand and local
  // helpers like knownBy now instantiate per argument types); the next
  // fences are implicit-any FIELD writes of class instances (`cmd.parent
  // = this` — the field inferred `any` from its ctor null) and
  // getter/setter JSDoc union returns (`cmd.name()` → string | Command).
  test("commander compiles static at the pinned coverage floor", () => {
    const { coverage } = analyze(join(fixturesRoot, "commander-calc/calc-npm-static.ts"), {
      npmStatic: ["commander"],
    });
    expect(coverage.npmStatic).toEqual([{ package: "commander", status: "static" }]);
    expect(coverage.preflightFailed).toBe(false);
    expect(coverage.diagnostics).toHaveLength(0); // builds — fences are runtime
    const total = coverage.stats.statementsTotal + (coverage.unreached?.stats.statementsTotal ?? 0);
    const failed = coverage.stats.statementsFailed + (coverage.unreached?.stats.statementsFailed ?? 0);
    expect(total).toBeGreaterThan(1000); // the whole package joined the program
    expect((total - failed) / total).toBeGreaterThanOrEqual(0.85);
  }, 180_000);

  // Tier 3: the island fallback — esbundled's chunk requires "net", an
  // unshimmed-builtin edge preflight refuses for a static package, so the
  // opt-in DROPS with a note and the --dynamic build keeps the exact
  // island behavior lazybuiltin.ts pins in npm.test.ts.
  test("a preflight-refused package falls back to the island with a note", () => {
    const { coverage } = analyze(join(fixturesRoot, "npm/divergent/lazybuiltin.ts"), {
      dynamic: true,
      npmStatic: ["esbundled"],
    });
    const statuses = coverage.npmStatic ?? [];
    expect(statuses).toHaveLength(1);
    expect(statuses[0]?.package).toBe("esbundled");
    expect(statuses[0]?.status).toBe("fallback");
    expect(coverage.preflightFailed).toBe(false);
  }, 120_000);

  // AUTO drops a package whose opt-in breaks the PROGRAM's own typecheck
  // (the .d.ts-overload vs inferred-surface gap — commander's chaining
  // shape in miniature): chainy's declared `name(): string / name(v):
  // this` overloads admit the chained spelling, its inferred surface
  // (`string | Chainy`) does not, so auto answers fallback with the
  // inferred-surface note and the program stays analyzable. Explicit
  // opt-ins keep the errors (the user asked for exactly that package).
  test("auto falls back when the program fails against an inferred surface", () => {
    const { coverage } = analyze(join(pilotRoot, "chainy-cli.ts"), { npmStatic: "auto" });
    expect(coverage.npmStatic).toEqual([
      {
        package: "chainy",
        status: "fallback",
        detail: "auto: the program does not typecheck against its inferred surface",
      },
    ]);
    expect(coverage.preflightFailed).toBe(false);
  }, 120_000);

  // Non-opted UNTYPED node_modules packages keep the checked-dynamic
  // surface: maxNodeModuleJsDepth (active on every --npm-static load)
  // would otherwise admit their JS and replace the flagless `any` with an
  // inferred surface — changing the PROGRAM's own types under a flag that
  // promised to touch only the opted-in packages (the jaro-winkler
  // shape). The fs shadow serves those files as the any-surface stub:
  // typegapped's import types `any` (its use sites meet the ordinary
  // any fences, never its own checker errors), while
  // escape-string-regexp compiles statically beside it.
  test("a non-opted untyped package keeps the checked-dynamic any surface", () => {
    const { coverage } = analyze(join(pilotRoot, "typegap-mix.ts"), {
      dynamic: true,
      npmStatic: ["escape-string-regexp"],
    });
    expect(coverage.preflightFailed).toBe(false);
    expect(coverage.npmStatic).toEqual([{ package: "escape-string-regexp", status: "static" }]);
    // typegapped's own checker errors never gate; the one report is the
    // consumer's any-value fence — the same story a flagless island
    // import of an untyped package tells.
    expect(coverage.diagnostics).toHaveLength(1);
    expect(coverage.diagnostics[0]?.code).toBe("SC1090");
    expect(coverage.diagnostics[0]?.message).toMatch(/console\.log of 'any'/);
  }, 120_000);

  // WORKSPACE-LINKED packages: node_modules/wslinked is a symlink whose
  // realpath lies outside every node_modules (the monorepo-internal
  // install every workspace tool produces). The opt-in compiles its
  // shipped dist statically as program modules — the fs shadow hides the
  // declaration twins along the realpath'd internal edges, resolution
  // lands on the runtime JS, and the binary byte-matches Node.
  test("a workspace-linked package compiles statically under --npm-static", async () => {
    const entry = join(fixturesRoot, "npm/cases/workspace-linked/main.ts");
    const { coverage } = analyze(entry, { npmStatic: ["wslinked"] });
    expect(coverage.npmStatic).toEqual([{ package: "wslinked", status: "static" }]);
    expect(coverage.preflightFailed).toBe(false);
    expect(coverage.stats.statementsFailed).toBe(0);

    // Flavor-split like every fixed-name build dir: the other flavor's
    // concurrent suite runs this same test (with a different sanitize
    // flag, even) and must not share the dir.
    const outDir = join(cacheDir, `npm-static-workspace-${sanitize ? "san" : "plain"}`);
    mkdirSync(outDir, { recursive: true });
    const result = await compile(entry, { outPath: join(outDir, "program"), outDir, sanitize, npmStatic: ["wslinked"] });
    if (!result.ok) throw new Error(result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"));
    const [nodeRes, nativeRes] = await Promise.all([
      runBinary("node", [entry]),
      runBinary(result.binaryPath, []),
    ]);
    expect(nativeRes.stdout.toString("utf8")).toBe(nodeRes.stdout.toString("utf8"));
    expect(nativeRes.exitCode).toBe(nodeRes.exitCode);
  }, 120_000);

  // The FLAGLESS classification of the same workspace link: an npm import
  // like any other — island-capable sites (per-package attribution naming
  // 'wslinked'), never "nothing installed resolves it".
  test("a workspace-linked package classifies as an npm import without flags", () => {
    const { coverage } = analyze(join(fixturesRoot, "npm/cases/workspace-linked/main.ts"));
    expect(coverage.preflightFailed).toBe(false);
    const all = JSON.stringify(coverage.diagnostics);
    expect(all).toContain("wslinked");
    expect(all).not.toContain("nothing installed resolves");
  }, 120_000);

  /* ── bundler-emitted CJS: the getter-table export shapes (cases
   * 2465-2469) ─ the canonical-table rewrite types each shape's named
   * exports by their resolved values, the compiled binaries byte-match
   * Node, and the consumer-anchored offender attribution degrades what
   * inference cannot carry. */

  // 2465: the esbuild __export getter table (renamed local, member-access
  // getter body, mutable-var snapshot) + a lexer-visible-but-valueless
  // chunk-wrapped name binding undefined, exactly Node.
  // 2466: the esbuild __reExport star (+ annotation spread) over a plain
  // CJS sibling.
  // 2467: the tsc __exportStar barrel (defineProperty __esModule stamp,
  // void-init preamble, own member export beside the stars).
  // 2468: the Object.defineProperty(exports, 'n', { get }) re-export
  // family plus a scalar member export.
  test.for([
    ["2465-getter-table", "gtable"],
    ["2466-getter-star", "gtstar"],
    ["2467-star-barrel", "gtbarrel"],
    ["2468-defineprop-exports", "gtdefine"],
  ] as const)("bundler-emitted CJS %s compiles statically and byte-matches Node", async ([caseDir, pkg]) => {
    const entry = join(fixturesRoot, "npm/cases", caseDir, "main.ts");
    const { coverage } = analyze(entry, { npmStatic: [pkg] });
    expect(coverage.npmStatic).toEqual([{ package: pkg, status: "static" }]);
    expect(coverage.preflightFailed).toBe(false);
    expect(coverage.diagnostics).toHaveLength(0); // builds — fences are runtime
    const binary = await buildStatic(entry, [pkg]);
    const [nodeRes, nativeRes] = await Promise.all([
      runBinary("node", [entry]),
      runBinary(binary, []),
    ]);
    expect(nativeRes.stdout.toString("utf8")).toBe(nodeRes.stdout.toString("utf8"));
    expect(nativeRes.exitCode).toBe(nodeRes.exitCode);
  }, 180_000);

  /* ── 2556-2557: esbuild's __toESM interop around EXTERNAL (unbundled)
   * dependencies ─ the wrapper erases (the recognized helper pads down to
   * the bare require it wraps), member accesses model on the required
   * package's canonical table, `.default` binds the module for plain-CJS
   * targets (and unconditionally under the `, 1` node-mode variant) and
   * stays a member read for __esModule-stamped ones; interop the
   * recognizer cannot finish degrades the package with a note naming the
   * construct. */

  // 2556: gtwrap wraps a plain-CJS external (gtcore — default IS the
  // module) and an esbuild-bundle external (gtable — stamped, named
  // getter passthrough); driven paths byte-match Node, and the undriven
  // inline `__toESM(require(…)).tag` form costs nothing.
  test("bundler-emitted CJS 2556-toesm-external compiles statically and byte-matches Node", async () => {
    const entry = join(fixturesRoot, "npm/cases/2556-toesm-external/main.ts");
    const { coverage } = analyze(entry, { npmStatic: ["gtwrap", "gtcore", "gtable"] });
    expect(coverage.npmStatic).toEqual([
      { package: "gtwrap", status: "static" },
      { package: "gtcore", status: "static" },
      { package: "gtable", status: "static" },
    ]);
    expect(coverage.preflightFailed).toBe(false);
    expect(coverage.diagnostics).toHaveLength(0);
    const binary = await buildStatic(entry, ["gtwrap", "gtcore", "gtable"]);
    const [nodeRes, nativeRes] = await Promise.all([
      runBinary("node", [entry]),
      runBinary(binary, []),
    ]);
    expect(nativeRes.stdout.toString("utf8")).toBe(nodeRes.stdout.toString("utf8"));
    expect(nativeRes.exitCode).toBe(nodeRes.exitCode);
  }, 180_000);

  // The interop's require edge is a require like any other: with only
  // gtwrap opted in, the erased wrapper's require("gtcore") meets the
  // existing SC1010 fence anchored in gtwrap's files, and the package
  // degrades with the module-naming note — preflight and lowering agree.
  test("__toESM of an unopted dependency degrades the wrapping package with the require note", () => {
    const entry = join(fixturesRoot, "npm/cases/2556-toesm-external/main.ts");
    const { coverage } = analyze(entry, { npmStatic: ["gtwrap"] });
    expect(coverage.preflightFailed).toBe(false);
    expect(coverage.npmStatic).toEqual([
      {
        package: "gtwrap",
        status: "fallback",
        detail: expect.stringContaining("'gtcore'") as string,
      },
    ]);
  }, 120_000);

  // 2557: a __toESM whose TEXT deviates beyond the structural recognizer
  // (a hand-rolled block-body interop). The rewrite must not guess: the
  // package degrades to the island with a note NAMING the construct —
  // never a failed build, and never the silent alternative (the live
  // helper chain's `var __create = Object.create;` fences at module load
  // while the report claims "static").
  test("a deviant __toESM helper degrades the package with a construct-naming note", () => {
    const entry = join(fixturesRoot, "npm/cases/2557-toesm-drift/main.ts");
    const { coverage } = analyze(entry, { npmStatic: ["gtdrift", "gtcore"] });
    expect(coverage.preflightFailed).toBe(false);
    expect(coverage.npmStatic).toEqual([
      {
        package: "gtdrift",
        status: "fallback",
        detail: expect.stringContaining("__toESM") as string,
      },
      { package: "gtcore", status: "static" },
    ]);
  }, 120_000);

  // Auto must not newly admit what the recognition cannot finish: the
  // eligibility heuristics pick gtdrift (own .d.ts, unminified, no
  // runtime markers), the attempt runs, and the SAME construct-naming
  // degrade answers — the preflight refusal and the lowering agree.
  test("--npm-static=auto degrades a deviant __toESM package with the same note", () => {
    const entry = join(fixturesRoot, "npm/cases/2557-toesm-drift/main.ts");
    const { coverage } = analyze(entry, { npmStatic: "auto" });
    expect(coverage.npmStatic).toEqual([
      {
        package: "gtdrift",
        status: "fallback",
        detail: expect.stringContaining("__toESM") as string,
      },
    ]);
  }, 120_000);

  // 2469: a TYPE-ONLY surface name (an interface) has no JS value the
  // inferred surface can carry — the import-site SC0001 NAMES the package,
  // and the consumer-anchored attribution degrades exactly it to the
  // island with the note, never a failed gate. Explicit opt-ins degrade
  // like auto's: the ratified bundle-shape behavior.
  test("a consumer-anchored surface break degrades the named package with a note", () => {
    const entry = join(fixturesRoot, "npm/cases/2469-bundle-offender/main.ts");
    const { coverage } = analyze(entry, { npmStatic: ["gtghost"] });
    expect(coverage.preflightFailed).toBe(false);
    expect(coverage.npmStatic).toEqual([
      {
        package: "gtghost",
        status: "fallback",
        detail: expect.stringContaining("inferred export surface breaks 1 import site") as string,
      },
    ]);
  }, 120_000);

  // The build-transform-marker relaxation: a getter-table bundle with its
  // own .d.ts is now ELIGIBLE for auto (the esbuild/tsc CJS stamps no
  // longer disqualify — only a bundler RUNTIME like webpack's registry
  // does), and the attempt succeeds outright here.
  test("--npm-static=auto opts a getter-table bundle in", () => {
    const entry = join(fixturesRoot, "npm/cases/2465-getter-table/main.ts");
    const { coverage } = analyze(entry, { npmStatic: "auto" });
    expect(coverage.npmStatic).toEqual([{ package: "gtable", status: "static" }]);
    expect(coverage.preflightFailed).toBe(false);
  }, 120_000);

  // The COPIED workspace shape classifies exactly like the symlinked one:
  // node_modules/wscopied is a real directory (no realpath escape — some
  // workspace installers copy members into node_modules), so detection
  // reads the workspace ROOT's "workspaces" globs instead. The member is
  // UNTYPED: its implicit-any module error (the import-site 7016) must
  // never gate — the package is the program author's own workspace code —
  // and the flagless build reports the same island-capable per-package
  // attribution the symlinked twin gets.
  test("a copied workspace member classifies identically to a symlinked one", () => {
    const { coverage } = analyze(join(fixturesRoot, "npm/cases/workspace-copied/main.ts"));
    expect(coverage.preflightFailed).toBe(false);
    const all = JSON.stringify(coverage.diagnostics);
    expect(all).toContain("wscopied");
    expect(all).not.toContain("nothing installed resolves");
    expect(all).not.toContain("implicitly has an 'any' type");
  }, 120_000);
});
