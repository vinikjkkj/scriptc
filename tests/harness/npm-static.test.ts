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
import { exeName } from "./exe.js";

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
    // the price-list mini packages (cases 4031-4032, 4061-4064) and the
    // computed-key receiver pair (4111-4112)
    ...globSync(
      join(
        fixturesRoot,
        "npm/node_modules/{bangvoid,bangvoidval,bangprotolong,protolong,pbkeyrecv,litrecv,keyedreach,keyedstrnum,recvmech,vshadow,tostrreach}/**/*.{js,json}",
      ),
    ).sort(),
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
    outPath: join(outDir, exeName("program")),
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
    // modtable is esbuild's `__commonJS` WHOLE — the module table (the
    // dyntable half above) plus the ACCESS path the table is reached
    // through: `var o = Object.getOwnPropertyNames` (a builtin in VALUE
    // position, lifted to a real function over the same runtime walk the
    // call form uses) bound at module scope and read from inside the
    // memoizing thunk, which is a monomorphized instance that takes no
    // captures — so the binding needs STORAGE, not a thread. The three
    // modules cross-require through the thunk, so the differential also
    // pins that each body runs exactly once, in first-call order.
    ["modtable", "modtable-cli.ts"],
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

  // The BUNDLER MODULE TABLE, pinned with nothing left over: esbuild's
  // `__commonJS`, `r({ "node_modules/x.js"(e, t) {...} })`, which is what
  // zapo's `spec/proto/index.js` is built out of nineteen times.
  //
  // This was a tier-2 partial pinned at exactly two fences, and they were
  // ONE construct wearing two faces. `var o = Object.getOwnPropertyNames`
  // is a builtin in VALUE position; fencing it poisoned the declaration,
  // which left the JS binding with no module global, which left it an
  // %init-body local — and the memoizing thunk that reads it is a
  // MONOMORPHIZED instance that takes no captures, so the read fenced a
  // second time on a capture with nothing to thread. Measured on this
  // fixture: lifting the value alone dropped two fences to one; giving the
  // binding its global dropped one to zero. Both halves are needed and
  // neither is the object model — the second fence disappears for a
  // plain function value in the same position, which is the control.
  //
  // The differential is in the tier-1 list above. This pins the COVERAGE
  // so a regression surfaces as a frontier move rather than a byte diff:
  // no build diagnostic, no runtime fence, and every statement static.
  test("the esbuild module table compiles with nothing left over", () => {
    const { coverage } = analyze(join(pilotRoot, "modtable-cli.ts"), { npmStatic: ["modtable"] });
    expect(coverage.npmStatic).toEqual([{ package: "modtable", status: "static" }]);
    expect(coverage.preflightFailed).toBe(false);
    expect(coverage.diagnostics).toHaveLength(0);
    expect(coverage.runtimeFences ?? []).toHaveLength(0);
    expect(coverage.stats.statementsFailed).toBe(0);
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
    const result = await compile(entry, { outPath: join(outDir, exeName("program")), outDir, sanitize, npmStatic: ["wslinked"] });
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

  /* ── 4031-4032: the UMD wrapper's forcing `!`, and the wall behind it ─
   * This WAS a price list and is now a receipt. The lowering that closes
   * 4032 was written by one block, measured on zapo, and REVERTED because
   * the QR gate went red 4 runs of 4; the wall behind it was fixed by the
   * next block; and it is now shipped on top of that wall. What is left
   * of the price list is 4062 and 4063, and the ORDER is the thing to
   * carry away, not the count.
   *
   * 4032 is zapo's own shape. A shipped package whose entire module body
   * is `!function(root, factory){…}(globalRef, factory)`: the wrapper
   * returns nothing, so `ensureBool` met a `void` operand it had no arm
   * for and the WHOLE module factory became one SC2001 fence. In zapo
   * that factory is `node_modules/long/umd/index.js`, which is why a
   * compiled zapo had never had `Long`, and why that fence was the ONE
   * trap a plain QR run executed — at module init, before zapo's first
   * log line. Statement position discards the boolean, so the statement
   * is now its operand's statement and the factory runs. 4063 is the
   * control that keeps the VALUE-position fence honest.
   *
   * 4031 was why 4032 could not simply be closed, and it is not a
   * historical note — it is a HARD DEPENDENCY, measured as a 2x2 on
   * zapo's QR gate. Let the factory run and protobufjs decodes 64-bit
   * fields as Long INSTANCES; zapo's `notAfter?: (number|Long|null)` then
   * meets the emitted record walkers, which read members OWN-ONLY while a
   * Long carries `toNumber` on its PROTOTYPE. Ship the `!` rule WITHOUT
   * the prototype-walking read and zapo goes from working to 0 QR /
   * exit 1 / ~20 s, the socket closing 1006 thirteen to sixteen times.
   * The walkers now take `scr_dyn_obj_data_get` — JS's [[Get]] minus
   * accessors — and an inherited method reaches a record field BOUND to
   * its receiver, so 4031 byte-matches Node and 4061 pins the other five
   * axes plus the union-arm control. If 4031's fix is ever reverted, the
   * `!` rule must come out in the same commit.
   *
   * 4062 is what is LEFT of that wall. It no longer stops zapo (the QR
   * prints), but the refusal is real:
   * the union arm's func leaf is an EXACT signature test, and a shipped
   * package's untyped `L.prototype.toNumber` boxes as `func()=>dyn`
   * against a `func()=>f64` target. Reading the prototype cannot help
   * that, and 4061 isolates it from both sides: its
   * `union-arm-inherited-data` is the removal control (the same union
   * with the method taken out — it passes), and its
   * `union-arm-method-typed-unknown` is the discriminator (the same arm
   * with the method declared `(): unknown`, so the target signature is
   * `func()=>dyn` — it passes too), and `union-arm-method-typed-number`
   * is the same discriminator from the VALUE side: `makeTyped` is `make`
   * with `>>>0` in the method body and nothing else, which makes the
   * closure infer `() => number` and box `func()=>f64`, and it passes.
   *
   * That last line is why zapo works. Its declaration
   * (`spec/proto/index.d.ts:45`, `toNumber(): number`) is the strict
   * side, but the real `long` package's body is
   * `this.unsigned?(this.high>>>0)*f+(this.low>>>0):this.high*f+(this.low>>>0)`
   * — the `>>>0` types it, so it boxes `func()=>f64` and the signature
   * test passes. The own-only read was zapo's ONLY blocker, and closing
   * it takes the QR gate green with the `!` lowering applied on top.
   * 4062's refusal is real and stands, but it is NOT zapo's case.
   *
   * The alarming shape is why all of these exist: ZERO fences,
   * `coverage` says "fully static", and the binary still throws. No trap
   * census can see any of it — and worse, on this exact change the trap
   * census moved 57/47/0 -> 56/46/0 in the configuration that was
   * BROKEN as well as the one that works, so it could not tell them
   * apart either.
   */
  // 4032 was the PRICE LIST for the forcing `!`, and the price has now
  // been paid: statement-position `!e` lowers as its operand's statement,
  // so the UMD factory runs and the module body's single SC2001 is gone.
  // The directory keeps its `-on-purpose` suffix so the ts7 order-parity
  // baseline stays additive; the suffix is historical, like 4031's.
  //
  // The zero-fence assertion is the load-bearing one. Before, this
  // program had exactly one runtime fence and a "fully static" coverage
  // report at the same time; now it has neither the fence nor the
  // divergence, and the binary byte-matches Node.
  test("4032: the UMD wrapper's forcing ! runs the module factory", async () => {
    const entry = join(fixturesRoot, "npm/cases/4032-bang-void-umd-on-purpose/main.ts");
    const { coverage } = analyze(entry, { npmStatic: ["bangvoid"] });
    expect(coverage.npmStatic).toEqual([{ package: "bangvoid", status: "static" }]);
    expect(coverage.preflightFailed).toBe(false);
    expect(coverage.diagnostics).toHaveLength(0);
    expect(coverage.runtimeFences ?? []).toHaveLength(0);
    const binary = await buildStatic(entry, ["bangvoid"]);
    const [nodeRes, nativeRes] = await Promise.all([
      runBinary("node", [entry]),
      runBinary(binary, []),
    ]);
    expect(nodeRes.stdout.toString("utf8")).toBe("factory ran: global\nok true\n");
    expect(nativeRes.stdout.toString("utf8")).toBe(nodeRes.stdout.toString("utf8"));
    expect(nativeRes.exitCode).toBe(nodeRes.exitCode);
    expect(nativeRes.exitCode).toBe(0);
  }, 180_000);

  /* ── 4064: THE CONJUNCTION, and the instrument the suite did not have ─
   * Every pin above tests ONE fix. 4032 needs only the `!` rule; 4031 and
   * 4061 need only the prototype-walking record read. Each passed on a
   * tree that had its own fix and not the other — and that is exactly how
   * a functionally BROKEN configuration got past every instrument in this
   * repo, because zapo needs both and nothing pinned the pair.
   *
   * The 2x2, measured on zapo's QR gate, and again at lab scale here on
   * four compilers built from `528bcf74`:
   *
   *   neither fix           SC2001 values of type 'void'      THROWS
   *   prototype walk only   SC2001 values of type 'void'      THROWS
   *   `!` rule only         expected function at $.toNumber   THROWS
   *   both                  `global 7 0 false 7`              Node's bytes
   *
   * Read the COLUMNS too, because that is the finding: 4031 is green in
   * the "prototype walk only" configuration and 4032 is green in the
   * "`!` rule only" one — and "`!` rule only" is the configuration that
   * takes zapo from working to 0 QR / exit 1 / ~20 s. A single-fix
   * fixture is green in a broken build by construction; it is testing its
   * own fix and nothing else. 4064 is green in exactly one column and it
   * is the working one.
   *
   * The two failing messages are also the reason the walls hid each other
   * for two blocks: `expected function at $.toNumber, got undefined` is
   * both what 4031 threw on ITS base and what block/protoinit saw at
   * `$.notAfter`. Two blocks read one string as two different walls,
   * because it was two different walls.
   *
   * And the trap census reads 57/47/0 for rows 1 and 2 and 56/46/0 for
   * rows 3 and 4, so it puts the BROKEN configuration on the
   * better-looking side. This program is the instrument that does not.
   */
  test("4064: the UMD bang and the prototype walk are needed TOGETHER", async () => {
    const entry = join(fixturesRoot, "npm/cases/4064-umd-bang-prototype-conjunction/main.ts");
    const { coverage } = analyze(entry, { npmStatic: ["bangprotolong"] });
    expect(coverage.npmStatic).toEqual([{ package: "bangprotolong", status: "static" }]);
    expect(coverage.preflightFailed).toBe(false);
    expect(coverage.diagnostics).toHaveLength(0);
    expect(coverage.runtimeFences ?? []).toHaveLength(0);
    const binary = await buildStatic(entry, ["bangprotolong"]);
    const [nodeRes, nativeRes] = await Promise.all([
      runBinary("node", [entry]),
      runBinary(binary, []),
    ]);
    expect(nodeRes.stdout.toString("utf8")).toBe("global 7 0 false 7\n");
    expect(nativeRes.stdout.toString("utf8")).toBe(nodeRes.stdout.toString("utf8"));
    expect(nativeRes.exitCode).toBe(nodeRes.exitCode);
    expect(nativeRes.exitCode).toBe(0);
  }, 180_000);

  /* -- 4111-4112: `o[k](...)` binds `o`, and the 64-bit decimal ----------
   *
   * 4064 proved a compiled zapo finally HAS `Long`. It could not show the
   * VALUE: every 64-bit field decoded to 0, and to NaN on the tree before
   * `long` was installed. The attribution stopped at "inside
   * readLongVarint", which is wrong -- readLongVarint writes the correct
   * bits on every payload, and 4111's `rawbits` row prints them
   * (1:2097152, Node's exact low/high for 2^53+1) from the very same
   * LongBits the wrong rows read.
   *
   * What was wrong is the line that turns those bits into a value:
   *
   *     var t = util.Long ? "toLong" : "toNumber";
   *     util.merge(Reader.prototype, {
   *       uint64: function () { return readLongVarint.call(this)[t](true); } });
   *
   * an ELEMENT-spelled method call, lowered as a keyed read plus a
   * receiverless call. With the receiver dropped, toLong reads `this.lo`
   * as undefined and `0 | undefined` is 0; toNumber reads the same
   * undefined and `undefined + 4294967296 * undefined` is NaN. ONE bug,
   * two spellings -- and 4111 prints both of them in one program on one
   * build, next to the dot-spelled control that is correct, so the pair
   * cannot be read as two separate faults again.
   *
   * On base, 4111 prints:
   *
   *     rawbits 2^53+1     = 1:2097152                        (reader OK)
   *     computed 2^53+1    = 0 (low=0 high=0 unsigned=true)
   *     static   2^53+1    = 9007199254740993 (low=1 high=2097152 ...)
   *     num computed 42    = NaN
   *     num static   42    = 42
   *
   * 9007199254740993 is 2^53+1, which a double cannot hold, so this row
   * cannot be passed by a path that collapses 64-bit fields into a number.
   *
   * 4112 grids the axes and is the fixture that separates this failure
   * from the several things it resembled: the member READ is fine
   * (typeofMember says "function"), the function VALUE is fine (twoStep
   * calls it correctly with an explicit receiver), the dot form was always
   * fine -- and the four keyed rows were wrong in four different spellings
   * of the key, so it was never about the key being dynamic. The row that
   * names the mechanism is fromMethod against closureKey: the SAME source
   * expression reported `this === undefined` from a plain function and
   * `this === <the caller's receiver>` from a method, because the callee
   * ran under the ambient-receiver window the ENCLOSING call had pushed.
   */
  test("4111: protobufjs's uint64 reader decodes 2^53+1 to its exact decimal", async () => {
    const entry = join(fixturesRoot, "npm/cases/4111-protobuf-uint64-computed-key-receiver/main.ts");
    const { coverage } = analyze(entry, { npmStatic: ["pbkeyrecv"] });
    expect(coverage.npmStatic).toEqual([{ package: "pbkeyrecv", status: "static" }]);
    expect(coverage.preflightFailed).toBe(false);
    expect(coverage.diagnostics).toHaveLength(0);
    expect(coverage.runtimeFences ?? []).toHaveLength(0);
    const binary = await buildStatic(entry, ["pbkeyrecv"]);
    const [nodeRes, nativeRes] = await Promise.all([
      runBinary("node", [entry]),
      runBinary(binary, []),
    ]);
    const out = nodeRes.stdout.toString("utf8");
    // the decimal itself, pinned rather than only compared
    expect(out).toContain("computed 2^53+1    = 9007199254740993 (low=1 high=2097152 unsigned=true)");
    expect(out).toContain("rawbits 2^53+1     = 1:2097152");
    expect(out).toContain("computed i64max    = 9223372036854775807");
    expect(out).toContain("num computed 42    = 42");
    expect(nativeRes.stdout.toString("utf8")).toBe(out);
    expect(nativeRes.exitCode).toBe(nodeRes.exitCode);
    expect(nativeRes.exitCode).toBe(0);
  }, 180_000);

  test("4112: `o[k](...)` binds o, in every spelling of the key", async () => {
    const entry = join(fixturesRoot, "npm/cases/4112-computed-key-method-call-receiver-axes/main.ts");
    const { coverage } = analyze(entry, { npmStatic: ["pbkeyrecv"] });
    expect(coverage.npmStatic).toEqual([{ package: "pbkeyrecv", status: "static" }]);
    expect(coverage.preflightFailed).toBe(false);
    expect(coverage.diagnostics).toHaveLength(0);
    expect(coverage.runtimeFences ?? []).toHaveLength(0);
    const binary = await buildStatic(entry, ["pbkeyrecv"]);
    const [nodeRes, nativeRes] = await Promise.all([
      runBinary("node", [entry]),
      runBinary(binary, []),
    ]);
    const out = nodeRes.stdout.toString("utf8");
    // every keyed row answers what the dot row answers
    expect(out).toContain("closureKey      = self lo=5 hi=7");
    expect(out).toContain("fromMethod      = self lo=5 hi=7");
    expect(out).toContain("dotName         = self lo=5 hi=7");
    expect(nativeRes.stdout.toString("utf8")).toBe(out);
    expect(nativeRes.exitCode).toBe(nodeRes.exitCode);
    expect(nativeRes.exitCode).toBe(0);
  }, 180_000);

  /* -- 4114: HOW FAR the element spelling now reaches, and where it stops
   *
   * 4111 and 4112 pin the receiver. This pins the REACH, in both
   * directions at once, because "the receiver binds now" understates what
   * changed and "keyed calls work" overstates it.
   *
   * On BASE the element spelling could not reach a prototype method at
   * ALL: every row below answers "is not a function", push and slice and
   * hasOwnProperty included, because a keyed READ finds nothing on a
   * prototype and a receiverless call then calls undefined.
   *
   *   row        base (element)      branch (element)      dot (both)  Node
   *   dPush      is not a function   1-2-3-4               1-2-3-4     1-2-3-4
   *   dSlice     is not a function   2-3                   2-3         2-3
   *   dHasOwn    is not a function   true                  true        true
   *   dFnApply   is not a function   2                     2           2
   *   dFnCall    is not a function   3                     -           3
   *   dReduce    is not a function   LOUD not-supported    SC1090 rt   6
   *   dFlat      is not a function   LOUD not-supported    SC1090 rt   1,2,3
   *
   * ("SC1090 rt" is a RUNTIME fence, not a compile refusal -- the dot rows
   *  are caught by the program's own try/catch, which is why they print at
   *  all. An SCxxxx tag does not imply compile time.)
   *   dUpper     is not a function   is not a function     AB          AB
   *   dToString  is not a function   is not a function     5           5
   *
   * dReduce/dFlat CHANGE MESSAGE and still fail: "is not a function" was a
   * lie (Node has reduce), and the loud refusal is the stance the dot
   * spelling already takes. The two spellings now agree about what they
   * cannot do, where before they disagreed about what it even was.
   *
   * dUpper/dToString are the RESIDUAL GAP and this is their price tag: a
   * dyn STRING or NUMBER receiver is answered by the frontend's static
   * method tables on the dot path, and the element path routes through the
   * runtime dispatch, which has no such arm. Not a regression -- base is
   * equally wrong -- but the parity is improved, not complete.
   */
  test("4114: how far a keyed method call reaches on a dyn receiver (price list)", async () => {
    const entry = join(fixturesRoot, "npm/cases/4114-keyed-method-call-reach-on-purpose/main.ts");
    const { coverage } = analyze(entry, { npmStatic: ["keyedreach"] });
    expect(coverage.npmStatic).toEqual([{ package: "keyedreach", status: "static" }]);
    expect(coverage.preflightFailed).toBe(false);
    expect(coverage.diagnostics).toHaveLength(0);
    const binary = await buildStatic(entry, ["keyedreach"]);
    const nativeRes = await runBinary(binary, []);
    const rows = new Map(
      nativeRes.stdout
        .toString("utf8")
        .split("\n")
        .filter((l) => l.includes(" = "))
        .map((l) => [l.slice(0, l.indexOf(" = ")).trim(), l.slice(l.indexOf(" = ") + 3)] as const),
    );
    // WHAT THE FIX BOUGHT -- these five were "is not a function" on base
    expect(rows.get("dPush")).toBe("1-2-3-4");
    expect(rows.get("dSlice")).toBe("2-3");
    expect(rows.get("dHasOwn")).toBe("true");
    expect(rows.get("dFnApply")).toBe("2");
    expect(rows.get("dFnCall")).toBe("3");
    // ... and each answers exactly what its DOT twin answers
    expect(rows.get("dPush")).toBe(rows.get("tPush"));
    expect(rows.get("dSlice")).toBe(rows.get("tSlice"));
    expect(rows.get("dHasOwn")).toBe(rows.get("tHasOwn"));
    expect(rows.get("dFnApply")).toBe(rows.get("tFnApply"));
    // HONEST REFUSALS -- still failing, no longer lying about why
    expect(rows.get("dReduce")).toBe("THREW 'Array.prototype.reduce' on a dynamic value is not supported yet");
    expect(rows.get("dFlat")).toBe("THREW 'Array.prototype.flat' on a dynamic value is not supported yet");
    // THE RESIDUAL GAP -- HALF CLOSED, and the two halves went different
    // ways, which is the whole reason this row is worth reading.
    //
    // dToString: CLOSED, wrong -> Node-exact. Base said `THREW n[KB] is
    // not a function`, which was a LIE (Node has Number.prototype.
    // toString), and it now answers 5, the same as its dot twin.
    //
    // dUpper: NOT closed. It moved LIE -> honest refusal, which is
    // progress of a different and lesser kind. The reason is a LINK-LINE
    // one, not a semantic one: toUpperCase's only correct implementation
    // is scr_str_case_conv in scr_regex.c, behind libregexp's Unicode case
    // tables, and naming it from scr_dyn_invoke.c would pull the regex
    // engine into every binary making any dyn method call. An ASCII-only
    // inline conversion was refused: silently wrong for non-ASCII is worse
    // than a fence. Pinned with its own row in 4152.
    //
    // The closed row is asserted EQUAL to its dot twin rather than to a
    // literal, because equality of the two spellings is the property that
    // was broken; the fenced row is asserted against its exact message,
    // because the message is what changed.
    expect(rows.get("dUpper")).toBe("THREW 'String.prototype.toUpperCase' on a dynamic value is not supported yet");
    expect(rows.get("dToString")).toBe("5");
    expect(rows.get("tUpper")).toBe("AB");
    expect(rows.get("tToString")).toBe("5");
    expect(rows.get("dToString")).toBe(rows.get("tToString"));
    // and a name nothing declares is still Node's own message, both ways
    expect(rows.get("dMissing")).toBe("THREW o[K6] is not a function");
    expect(rows.get("dNumMiss")).toBe("THREW n[K6] is not a function");
    expect(nativeRes.exitCode).toBe(0);
  }, 180_000);

  /* -- 4153: how many receiver mechanisms are there? (discriminator) -----
   *
   * Three gaps in this repo have each been described as "the receiver
   * machinery". This case answers, by measurement, how many mechanisms
   * that is -- and the answer is more than one, which is what the eleven
   * previous "do these share a root?" investigations also found.
   *
   * THE DECISIVE ROW is m1CallDotFromMethod. It makes the failing call
   * from inside a METHOD whose receiver is a different object (tag=OUTER).
   * A call primitive that merely forgot to bind leaves the ambient `this`
   * window holding the ENCLOSING frame's receiver, so the callee reports
   * OUTER rather than undefined -- a POSITIVE signature, not an absence.
   * It reports OUTER. That is the same signature block/varint measured for
   * the dyn tier before it routed the element spelling through
   * scr_dyn_invoke, and it proves the record-tier gap (4113) is that same
   * mechanism at a second call primitive: lowerRecordFieldCall emits a
   * `callValue` through a `recordGet`, and nothing on that path pushes.
   *
   * THE SAME ROWS PROVE THE OTHER TWO ARE NOT THAT. m3ReadElem/m4ReadElem
   * read `undefined` where Node says `function`: the member never
   * resolved, so there was never a `this` to drop. Member RESOLUTION, and
   * closed separately in 4151 -- which is why closing it moved three rows
   * here and left m1* untouched.
   *
   * A FINDING NOT PREVIOUSLY RECORDED: the keyed READ and the keyed CALL
   * resolve DIFFERENTLY. m2CallInhElem answers `true` while m2ReadInhElem
   * answers `undefined` for the same member on the same object --
   * scr_dyn_invoke walks the prototype chain, sc_dyn_key_get does not.
   * m2ReadInhDot shows the DOT read is equally blind and m5ReadElem shows
   * it is not specific to objects. Node says `function` to all three.
   * Silent, no diagnostic, nothing in the trap census. Priced, not closed:
   * making the dyn read walk the prototype chain is a change to what every
   * `o[k]` in the corpus returns, which is not a thing to do on evidence
   * gathered about method calls.
   *
   * CONTROLS BOTH WAYS: m1CtorControl (a constructed receiver binds, so
   * the dyn tier is not what is broken) and m1NoThisControl (a record
   * method that never reads `this` is correct everywhere, so M1 pins one
   * thing and not two). Both hold on both sides and both backends.
   */
  test("4153: the receiver gaps are not one mechanism (discriminator)", async () => {
    const entry = join(fixturesRoot, "npm/cases/4153-receiver-mechanism-discriminator-on-purpose/main.ts");
    const { coverage } = analyze(entry, { npmStatic: ["recvmech"] });
    expect(coverage.npmStatic).toEqual([{ package: "recvmech", status: "static" }]);
    expect(coverage.preflightFailed).toBe(false);
    const binary = await buildStatic(entry, ["recvmech"]);
    const [nodeRes, nativeRes] = await Promise.all([
      runBinary("node", [entry]),
      runBinary(binary, []),
    ]);
    const node = nodeRes.stdout.toString("utf8").replace(/\r\n/g, "\n");
    const native = nativeRes.stdout.toString("utf8").replace(/\r\n/g, "\n");
    const rows = new Map(
      native.split("\n").filter((l) => l.includes(" = "))
        .map((l) => [l.slice(0, l.indexOf(" = ")).trim(), l.slice(l.indexOf(" = ") + 3)] as const),
    );
    expect(rows.size).toBe(25);

    // -- CONTROLS. If either of these fails the rest measures nothing.
    expect(rows.get("m1CtorControl")).toBe("obj tag=C");
    expect(rows.get("m1NoThisControl")).toBe("no-this-ok");

    // -- MECHANISM 1: RECEIVER BINDING, via the ambient window.
    // The member resolves...
    expect(rows.get("m1ReadDot")).toBe("function");
    // ...the call runs, and only `this` is wrong...
    expect(rows.get("m1CallDot")).toBe("undefined");
    // ...and it is wrong by LEAKING THE CALLER, which is the signature.
    expect(rows.get("m1CallDotFromMethod")).toBe("obj tag=OUTER");
    expect(node.includes("m1CallDotFromMethod = obj tag=L")).toBe(true);

    // -- MECHANISM 2: MEMBER RESOLUTION. Nothing resolved, so nothing to
    // bind -- which is why 4151 closed the CALL rows below without
    // touching either READ row.
    expect(rows.get("m3ReadElem")).toBe("undefined");
    expect(rows.get("m4ReadElem")).toBe("undefined");
    expect(rows.get("m3CallElem")).toBe("[ab]");
    expect(rows.get("m4CallElem")).toBe("5");
    expect(rows.get("m3CallElem")).toBe(rows.get("m3CallDot"));
    expect(rows.get("m4CallElem")).toBe(rows.get("m4CallDot"));

    // -- MECHANISM 3: the READ/CALL asymmetry, priced not closed.
    expect(rows.get("m2CallInhElem")).toBe("true");
    expect(rows.get("m2ReadInhElem")).toBe("undefined");
    expect(rows.get("m2ReadInhDot")).toBe("undefined");
    expect(rows.get("m5ReadElem")).toBe("undefined");
    expect(rows.get("m5CallElem")).toBe("1-2-3-4");
    // Node disagrees with every one of those four reads.
    expect(node.includes("m2ReadInhElem       = function")).toBe(true);

    // The divergence is asserted, not merely described.
    expect(native).not.toBe(node);
    expect(nativeRes.exitCode).toBe(0);
  }, 180_000);

  /* -- 4151: `o[k](...)` reaches String and Number methods --------------
   *
   * BYTE-IDENTICAL to Node v25.9.0, 30 lines, on both backends. On base
   * 28 of those 30 lines differ, identically on both backends -- so the
   * gap and its close are in the frontend/runtime, not a backend artifact.
   *
   * The gap was two disjoint tables in two languages. `s.toUpperCase()` on
   * a dyn receiver never reaches the runtime: the frontend claims it out
   * of DYN_STRING_ONLY_METHODS and rewrites it to a static intrinsic. The
   * ELEMENT spelling cannot consult a compile-time table -- its key is a
   * runtime value -- so it went to scr_dyn_invoke, whose STR arm held
   * seven names and whose NUM receiver had no arm at all, and answered
   * "is not a function" for names Node plainly has.
   *
   * That answer was a LIE, not a fence, and the worst-shaped one: it reads
   * as a missing MEMBER rather than a missing IMPLEMENTATION, so a program
   * feature-detecting with `if (s[k])` takes the wrong branch in silence.
   *
   * MEMBER RESOLUTION, NOT RECEIVER BINDING -- measured, not argued.
   * `typeof s[k]` was `undefined` on base where Node says `function`: the
   * member never resolved, so there was never a `this` to drop. That is
   * what separates this from 4113 below, where the member DOES resolve,
   * the call DOES run, and only the receiver is wrong. Two gaps that both
   * look like "the receiver machinery" and are not one mechanism.
   *
   * Every row is asserted against its own DOT twin as well as against
   * Node, because equality of the two spellings is the property that was
   * broken and the one a future change could break again.
   */
  test("4151: the element spelling reaches String and Number methods", async () => {
    const entry = join(fixturesRoot, "npm/cases/4151-keyed-string-number-methods/main.ts");
    const { coverage } = analyze(entry, { npmStatic: ["keyedstrnum"] });
    expect(coverage.npmStatic).toEqual([{ package: "keyedstrnum", status: "static" }]);
    expect(coverage.preflightFailed).toBe(false);
    expect(coverage.diagnostics).toHaveLength(0);
    const binary = await buildStatic(entry, ["keyedstrnum"]);
    const [nodeRes, nativeRes] = await Promise.all([
      runBinary("node", [entry]),
      runBinary(binary, []),
    ]);
    const node = nodeRes.stdout.toString("utf8").replace(/\r\n/g, "\n");
    const native = nativeRes.stdout.toString("utf8").replace(/\r\n/g, "\n");
    // A zero-denominator guard: a comparison of two empty strings is not a
    // pass, and an assertion that never sees a row is not a measurement.
    expect(node.split("\n").filter((l) => l.includes(" = ")).length).toBe(28);
    expect(native).toBe(node);
    // Every row computed its own verdict; not one may read DIFFER.
    expect(native.includes("DIFFER")).toBe(false);
    expect(native.includes("is not a function")).toBe(false);
    expect(nativeRes.exitCode).toBe(0);
  }, 180_000);

  /* -- 4154: valueOf on a dyn receiver, and the shadowing control --------
   *
   * BYTE-IDENTICAL to Node v25.9.0, 9 lines, both backends. On base 5 of
   * those 9 differ, and they differ in TWO different wrong ways for one
   * name: `s.valueOf()` refused with SC1090 (the frontend's by-name
   * decline) while `s[k]()` said "o[VO] is not a function" (the runtime's
   * missing arm). Node answers valueOf for every receiver kind.
   *
   * THE CONTROL IS THE POINT of this case, not the fix. An Object.prototype
   * arm that answered valueOf unconditionally would SHADOW a user's own
   * member, which is the classic way this kind of change goes wrong.
   * scr_dyn_invoke's OBJ arm does its own table lookup first and only falls
   * through to dyn_object_proto_method on a miss, so it cannot -- and
   * ownVoElem/ownVoDot/ownTsElem/ownTsDot/ownHopElem assert that. Those
   * five rows pass on BASE too: they are not a claim about the change,
   * they are the guard on it, and a guard that only holds after the change
   * proves nothing.
   *
   * The moved rows assert IDENTITY (r === o), not a printed shape, because
   * "returns the receiver" is the property and a structurally equal copy
   * would satisfy a shape check while being the wrong answer.
   *
   * NOT MEASURED: a null-prototype dictionary, where Node throws for both
   * spellings. Reaching that shape needs Object.setPrototypeOf, which is
   * itself SC2020, so the row would fail for a reason this case is not
   * about. Recorded as a gap rather than pinned wrongly.
   */
  test("4154: valueOf answers on every dyn kind, and own members still win", async () => {
    const entry = join(fixturesRoot, "npm/cases/4154-dyn-valueof-and-own-member-shadowing/main.ts");
    const { coverage } = analyze(entry, { npmStatic: ["vshadow"] });
    expect(coverage.npmStatic).toEqual([{ package: "vshadow", status: "static" }]);
    expect(coverage.preflightFailed).toBe(false);
    expect(coverage.diagnostics).toHaveLength(0);
    const binary = await buildStatic(entry, ["vshadow"]);
    const [nodeRes, nativeRes] = await Promise.all([
      runBinary("node", [entry]),
      runBinary(binary, []),
    ]);
    const node = nodeRes.stdout.toString("utf8").replace(/\r\n/g, "\n");
    const native = nativeRes.stdout.toString("utf8").replace(/\r\n/g, "\n");
    expect(node.split("\n").filter((l) => l.includes(" = ")).length).toBe(9);
    // THE CONTROL, spelled out rather than left to the whole-output compare
    expect(native.includes("ownVoElem   = OWN-VO")).toBe(true);
    expect(native.includes("ownTsElem   = OWN-TS")).toBe(true);
    expect(native.includes("ownHopElem  = OWN-HOP")).toBe(true);
    // ...and identity, not shape
    expect(native.includes("plainVoElem = true/")).toBe(true);
    expect(native.includes("arrVoElem   = true/")).toBe(true);
    expect(native).toBe(node);
    expect(native.includes("is not a function")).toBe(false);
    expect(nativeRes.exitCode).toBe(0);
  }, 180_000);

  /* -- 4152: what the element spelling still cannot do (price list) ------
   *
   * The residual after 4151, pinned so it cannot quietly become a lie
   * again. Two of these rows are the good direction and two are not:
   *
   *   rSplitFenced / rToFixedFenced  LIE -> honest refusal. Base said
   *     "s[SPL] is not a function" (Node has split); it now names the
   *     unimplemented method. Still not Node's answer.
   *   rSplitDot                      the DOT twin ANSWERS `a,b`, which is
   *     what makes the row above an asymmetry rather than a shared gap.
   *   rToFixedDot                    the dot twin refuses too, so toFixed
   *     is the one name where both spellings agree and both are wrong.
   *   rTrulyMissing                  the ANSWER is right, the MESSAGE is
   *     not Node's: `s["nope"] is not a function` where Node prints
   *     `s.nope is not a function`. Pre-existing, unchanged here.
   */
  test("4152: what a keyed String/Number call still refuses (price list)", async () => {
    const entry = join(fixturesRoot, "npm/cases/4152-keyed-strnum-residual-on-purpose/main.ts");
    const { coverage } = analyze(entry, { npmStatic: ["keyedstrnum"] });
    expect(coverage.npmStatic).toEqual([{ package: "keyedstrnum", status: "static" }]);
    expect(coverage.preflightFailed).toBe(false);
    const binary = await buildStatic(entry, ["keyedstrnum"]);
    const [nodeRes, nativeRes] = await Promise.all([
      runBinary("node", [entry]),
      runBinary(binary, []),
    ]);
    const node = nodeRes.stdout.toString("utf8").replace(/\r\n/g, "\n");
    const native = nativeRes.stdout.toString("utf8").replace(/\r\n/g, "\n");
    const rows = new Map(
      native.split("\n").filter((l) => l.includes(" = "))
        .map((l) => [l.slice(0, l.indexOf(" = ")).trim(), l.slice(l.indexOf(" = ") + 3)] as const),
    );
    expect(rows.size).toBe(7);
    // THE PRICE, pinned exactly. When one of these fails, that gap closed.
    //
    // toUpperCase/toLowerCase are here for a LINK-LINE reason, not a
    // semantic one: their only correct implementation is scr_str_case_conv
    // in scr_regex.c, which reaches libregexp's Unicode case tables, and
    // naming it from scr_dyn_invoke.c would pull the regex engine into
    // every binary that makes any dyn method call. An ASCII-only inline
    // conversion was refused outright -- it would be a silent wrong answer
    // for non-ASCII, the failure mode this whole line of work is about.
    expect(rows.get("rUpper")).toBe("THREW 'String.prototype.toUpperCase' on a dynamic value is not supported yet | AB | DIFFER");
    expect(rows.get("rLower")).toBe("THREW 'String.prototype.toLowerCase' on a dynamic value is not supported yet | ab | DIFFER");
    expect(rows.get("rSplitFenced")).toBe("THREW 'String.prototype.split' on a dynamic value is not supported yet");
    expect(rows.get("rToFixedFenced")).toBe("THREW 'Number.prototype.toFixed' on a dynamic value is not supported yet");
    expect(rows.get("rSplitDot")).toBe("a,b");
    expect(rows.get("rTrulyMissing")).toBe('THREW s["nope"] is not a function');
    // ...and the divergence from Node is asserted, not merely described.
    expect(native).not.toBe(node);
    expect(node.includes("rSplitFenced   = a,b")).toBe(true);
    expect(nativeRes.exitCode).toBe(0);
  }, 180_000);

  /* -- 4113: a PRICE LIST, found while gridding 4112 and DECLINED --------
   *
   * `o.m()` where `o` is an object LITERAL whose fields have no one common
   * type lowers to a typed RECORD with a function-typed field, and the
   * call through that field DROPS the receiver: `this` is undefined inside
   * `m` where Node binds `o`. No diagnostic, no fence, nothing in the trap
   * census -- a wrong ANSWER, which is the failure mode this repo has
   * learned to fear most, and the same failure mode 4111 is about.
   *
   * It is NOT the bug 4111/4112 fix, and this pin exists to say so with a
   * measurement instead of a sentence. That one was the checked-dynamic
   * path; this one never reaches the dyn tier. Measured on base fbabf176
   * and on the branch, on BOTH backends, all four cells identical:
   *
   *     Node    lit=self L     arrEl=self A0   ctor=self C
   *     here    lit=undefined  arrEl=undefined ctor=self C
   *
   * `ctor` is the control: the same member shape on a CONSTRUCTED object
   * binds correctly, so this is specific to the record lowering.
   *
   * The pin asserts the DIVERGENCE, so whoever closes it gets a red test
   * pointing at this note rather than a silent baseline drift.
   */
  test("4113: a method on an object literal loses its receiver (price list)", async () => {
    const entry = join(fixturesRoot, "npm/cases/4113-object-literal-method-receiver-on-purpose/main.ts");
    const { coverage } = analyze(entry, { npmStatic: ["litrecv"] });
    expect(coverage.npmStatic).toEqual([{ package: "litrecv", status: "static" }]);
    expect(coverage.preflightFailed).toBe(false);
    expect(coverage.diagnostics).toHaveLength(0);
    // and there is no runtime fence either -- that is the whole complaint
    expect(coverage.runtimeFences ?? []).toHaveLength(0);
    const binary = await buildStatic(entry, ["litrecv"]);
    const [nodeRes, nativeRes] = await Promise.all([
      runBinary("node", [entry]),
      runBinary(binary, []),
    ]);
    const node = nodeRes.stdout.toString("utf8");
    const native = nativeRes.stdout.toString("utf8");
    expect(node).toBe("lit   = self L\narrEl = self A0\nctor  = self C\n");
    // THE PRICE, pinned exactly. When this fails, the gap closed.
    expect(native).toBe("lit   = undefined\narrEl = undefined\nctor  = self C\n");
    expect(native).not.toBe(node);
    expect(nativeRes.exitCode).toBe(0);
  }, 180_000);

  /* -- 4142: a PRICE LIST for the reach `toString` does NOT have ---------
   *
   * `x.toString()` on a record-typed receiver resolves to
   * Object.prototype.toString in the CHECKER (the structural type declares
   * no toString). Corpus 4141 closes the half where the runtime value is
   * still the class instance -- the lowering now dispatches to the class's
   * own toString. This is the OTHER half: where the binding MATERIALIZES a
   * record, the class is gone and there is nothing left to reach.
   *
   * A REPRESENTATION loss, not a lookup miss, and measured identical on
   * base 8eb37c53 and on this branch, so it is neither a regression of the
   * 4141 fix nor closed by it:
   *
   *     Node  proto=L:7 own=O:8 shadow=own:9 none=[object Object] deep=deep:11
   *           bare THREW "z.toString is not a function"
   *           param/field/elem/relet = Own(1)
   *     here  every row "[object Object]"
   *
   * `none` is the control: a value with no toString anywhere answers
   * "[object Object]" in Node too, so the one row that AGREES says the pin
   * is about the reach and not about the constant.
   *
   * The `proto` row is zapo's `Long.toString` in six lines -- a shipped
   * package's class instance behind a checked cast, with toString on the
   * prototype. It is why that fence stays: forcing it prints
   * "[object Object]" where Node prints the certificate serial.
   *
   * The pin asserts the DIVERGENCE, so whoever closes it gets a red test
   * pointing at this note.
   */
  test("4142: a materialized record loses the toString it was built from (price list)", async () => {
    const entry = join(fixturesRoot, "npm/cases/4142-record-receiver-tostring-reach-on-purpose/main.ts");
    const { coverage } = analyze(entry, { npmStatic: ["tostrreach"] });
    expect(coverage.npmStatic).toEqual([{ package: "tostrreach", status: "static" }]);
    expect(coverage.preflightFailed).toBe(false);
    expect(coverage.diagnostics).toHaveLength(0);
    // and no fence either -- that is the whole complaint
    expect(coverage.runtimeFences ?? []).toHaveLength(0);
    const binary = await buildStatic(entry, ["tostrreach"]);
    const [nodeRes, nativeRes] = await Promise.all([
      runBinary("node", [entry]),
      runBinary(binary, []),
    ]);
    const node = nodeRes.stdout.toString("utf8");
    const native = nativeRes.stdout.toString("utf8");
    expect(node).toBe(
      [
        "proto  = L:7",
        "own    = O:8",
        "shadow = own:9",
        "none   = [object Object]",
        "deep   = deep:11",
        "bare   THREW z.toString is not a function",
        "param  = Own(1)",
        "field  = Own(1)",
        "elem   = Own(1)",
        "relet  = Own(1)",
        "radix  = r0",
        "tuple  = a,1",
        "",
      ].join("\n"),
    );
    // THE PRICE, pinned exactly. When this fails, the gap closed.
    expect(native).toBe(
      [
        "proto  = [object Object]",
        "own    = [object Object]",
        "shadow = [object Object]",
        "none   = [object Object]",
        "deep   = [object Object]",
        "bare   = [object Object]",
        "param  = [object Object]",
        "field  = [object Object]",
        "elem   = [object Object]",
        "relet  = [object Object]",
        "radix  = [object Object]",
        "tuple  = [object Object]",
        "",
      ].join("\n"),
    );
    expect(native).not.toBe(node);
    expect(nativeRes.exitCode).toBe(0);
  }, 180_000);

  // 4063: the VALUE position is untouched, and this is the control that
  // says so. `const b = !voidCall()` still needs a boolean where the
  // operand's type has no ToBoolean, and ensureBool still refuses it.
  // Without this, "statement-position `!` lowers" would be indistinguishable
  // from "`!` stopped fencing".
  test("4063: a VALUE-position ! over a void operand is still refused", () => {
    const entry = join(fixturesRoot, "npm/cases/4063-bang-void-value-position-on-purpose/main.ts");
    const { coverage } = analyze(entry, { npmStatic: ["bangvoidval"] });
    expect(coverage.npmStatic).toEqual([{ package: "bangvoidval", status: "static" }]);
    expect(coverage.preflightFailed).toBe(false);
    expect(coverage.diagnostics).toHaveLength(0); // it BUILDS; the fence is runtime
    const fences = coverage.runtimeFences ?? [];
    expect(fences).toHaveLength(1);
    expect(fences[0]?.code).toBe("SC2001");
    expect(fences[0]?.message).toMatch(/values of type 'void' cannot be compiled yet/);
  }, 120_000);

  test("4031: a checked cast to a record with a method reads the prototype", async () => {
    const entry = join(fixturesRoot, "npm/cases/4031-prototype-method-record-cast-on-purpose/main.ts");
    const { coverage } = analyze(entry, { npmStatic: ["protolong"] });
    expect(coverage.npmStatic).toEqual([{ package: "protolong", status: "static" }]);
    expect(coverage.preflightFailed).toBe(false);
    expect(coverage.diagnostics).toHaveLength(0);
    // The part that made this dangerous: NOTHING is deferred. A trap
    // census over this program reported a clean bill of health while the
    // binary threw `expected function at $.toNumber, got undefined`.
    expect(coverage.runtimeFences ?? []).toHaveLength(0);
    const binary = await buildStatic(entry, ["protolong"]);
    const [nodeRes, nativeRes] = await Promise.all([
      runBinary("node", [entry]),
      runBinary(binary, []),
    ]);
    expect(nodeRes.stdout.toString("utf8")).toBe("7 0 false 7\n");
    expect(nativeRes.stdout.toString("utf8")).toBe(nodeRes.stdout.toString("utf8"));
    expect(nativeRes.exitCode).toBe(nodeRes.exitCode);
    expect(nativeRes.exitCode).toBe(0);
  }, 180_000);

  // 4061: the other five [[Get]] axes plus the union-ARM control (the
  // matcher, a different emitted function from the builder 4031 drives).
  // Node's answers were measured first; the pin is a byte-match, and the
  // `THREW` line is Node's too — a null-prototype dictionary inherits
  // nothing, so `v.toNumber is not a function` on both sides.
  test("4061: [[Get]] axes — inherited, non-enumerable, shadowed, deep, null-proto, union arm", async () => {
    const entry = join(fixturesRoot, "npm/cases/4061-prototype-get-axes/main.ts");
    const { coverage } = analyze(entry, { npmStatic: ["protolong"] });
    expect(coverage.npmStatic).toEqual([{ package: "protolong", status: "static" }]);
    expect(coverage.preflightFailed).toBe(false);
    expect(coverage.diagnostics).toHaveLength(0);
    expect(coverage.runtimeFences ?? []).toHaveLength(0);
    const binary = await buildStatic(entry, ["protolong"]);
    const [nodeRes, nativeRes] = await Promise.all([
      runBinary("node", [entry]),
      runBinary(binary, []),
    ]);
    expect(nodeRes.stdout.toString("utf8")).toBe(
      [
        "inherited-enumerable-method 7 0 false 7",
        "inherited-nonenumerable-method 21 42",
        "own-nonenumerable-data 1 5",
        "shadow-own-wins own",
        "two-levels-up 9 9",
        "nullproto-inherits-nothing THREW",
        "union-arm-inherited-data data 9 3",
        "union-arm-number num 5",
        "union-arm-method-typed-unknown long 7",
        "union-arm-method-typed-number long 7",
        "",
      ].join("\n"),
    );
    expect(nativeRes.stdout.toString("utf8")).toBe(nodeRes.stdout.toString("utf8"));
    expect(nativeRes.exitCode).toBe(nodeRes.exitCode);
    expect(nativeRes.exitCode).toBe(0);
  }, 180_000);

  // 4062: ON PURPOSE. Both lines diverge from Node, both with zero
  // fences and a "fully static" coverage report, and the second one is
  // the wall zapo's SC2001 is still behind.
  test("4062: a prototype ACCESSOR and a method-bearing union arm are still refused", async () => {
    const entry = join(fixturesRoot, "npm/cases/4062-prototype-get-still-refused-on-purpose/main.ts");
    const { coverage } = analyze(entry, { npmStatic: ["protolong"] });
    expect(coverage.npmStatic).toEqual([{ package: "protolong", status: "static" }]);
    expect(coverage.preflightFailed).toBe(false);
    expect(coverage.diagnostics).toHaveLength(0);
    // Neither refusal is a fence — this is what "no trap census can see
    // it" means, stated as an assertion rather than a comment.
    expect(coverage.runtimeFences ?? []).toHaveLength(0);
    const binary = await buildStatic(entry, ["protolong"]);
    const [nodeRes, nativeRes] = await Promise.all([
      runBinary("node", [entry]),
      runBinary(binary, []),
    ]);
    expect(nodeRes.stdout.toString("utf8")).toBe(
      [
        "prototype-accessor 1 42",
        "union-arm-with-method long 7",
        'roundtrip-owns-the-inherited 9 3 {"z":9}',
        "",
      ].join("\n"),
    );
    expect(nodeRes.exitCode).toBe(0);
    // Inverted on purpose, and the three lines have THREE causes: the
    // accessor is out of the borrow-only walk's contract; the union arm
    // is the exact-signature test on `func()=>dyn` vs `func()=>f64`; the
    // round trip is record materialization writing every declared field
    // as an own key, so `w` re-emerges owned.
    expect(nativeRes.stdout.toString("utf8")).toBe(
      [
        "prototype-accessor THREW",
        "union-arm-with-method THREW",
        'roundtrip-owns-the-inherited 9 3 {"z":9,"w":3}',
        "",
      ].join("\n"),
    );
    expect(nativeRes.exitCode).toBe(0);
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
  /* -- 4181: a `var` in a body that is MONOMORPHIZED more than once ------
   *
   * FAILS ON BASE, and as a BUILD error: `hoistVarBinding`'s memo lived on
   * the LOWERER, keyed by the checker's `ts.Symbol`. `--npm-static`
   * compiles one implicit-any JS body ONCE PER ARGUMENT-TYPE INSTANCE and
   * every instance re-lowers the same AST, so instance 1 was handed
   * instance 0's IrLocal -- no `varDecl` in instance 1's frame, no local
   * registered in it, and the declaration still lowering to a plain
   * `assign`. Base emits ELEVEN of them across eight of the nine row
   * families here, `SC9001: assign to undeclared local/global "x.0"`, and
   * `--best-effort` correctly refuses to defer an ICE, so nothing built.
   *
   * WHAT THE DISCRIMINATOR IS, measured on a one-variable-at-a-time grid
   * rather than argued: TWO INSTANCES. Not the read count -- r2 (read
   * zero times), r3 (read once) and r1 (read twice) all ICE on base and
   * all three answer Node here. c3 is the same `var` shape called at ONE
   * argument type and builds on base; r4 is called at three and base
   * emits TWO ICEs for it (`%m0.r4%1` and `%m0.r4%2`), which is the
   * instance count showing through the diagnostic.
   *
   * CONTROLS: c1 and c2 are the `let`/`const` twins of r1 and r4 at two
   * argument types (block-scoped bindings never enter hoistVarBinding at
   * all), and c3 is the single-instantiation `var`. All three pass on
   * BASE as well -- they are the guard on the change, not a claim about
   * it, and a guard that only holds after the change proves nothing.
   *
   * The rows are not all one shape: r5 is two declarators in one `var`
   * statement, r6 a redeclaration that must MERGE onto one slot, r7 the
   * parameter-merge branch, r8 a `var` written in a loop whose `i` and
   * `t` outlive it, r9 a `for (var v of ...)` binding that still holds
   * the last element afterwards. Each is a different writer of the memo.
   *
   * NOT MEASURED HERE: `var p = typeof p` over a number-bound parameter.
   * It is a separate, pre-existing SC1090 runtime fence ("'string' values
   * where 'number' is expected"), reachable on both sides once the ICE is
   * gone, so r7 keeps the merge inside the parameter's bound type rather
   * than pinning a refusal this case is not about.
   */
  test("4181: a `var` in a monomorphized body gets one slot per instance", async () => {
    const entry = join(fixturesRoot, "npm/cases/4181-monomorphized-var-hoisting/main.ts");
    const { coverage } = analyze(entry, { npmStatic: ["monovar"] });
    expect(coverage.npmStatic).toEqual([{ package: "monovar", status: "static" }]);
    expect(coverage.preflightFailed).toBe(false);
    expect(coverage.diagnostics).toHaveLength(0);
    const binary = await buildStatic(entry, ["monovar"]);
    const [nodeRes, nativeRes] = await Promise.all([
      runBinary("node", [entry]),
      runBinary(binary, []),
    ]);
    const node = nodeRes.stdout.toString("utf8").replace(/\r\n/g, "\n");
    const native = nativeRes.stdout.toString("utf8").replace(/\r\n/g, "\n");
    // A zero-denominator guard: comparing two empty strings is not a pass,
    // and an assertion that never sees a row is not a measurement.
    const rows = new Map(
      native.split("\n").filter((l) => l.includes(" = "))
        .map((l) => [l.slice(0, l.indexOf(" = ")).trim(), l.slice(l.indexOf(" = ") + 3)] as const),
    );
    expect(node.split("\n").filter((l) => l.includes(" = ")).length).toBe(24);
    expect(rows.size).toBe(24);

    // -- CONTROLS FIRST. If any of these fails the rest measures nothing.
    expect(rows.get("c1a")).toBe("number");
    expect(rows.get("c1b")).toBe("obj");
    expect(rows.get("c2a")).toBe("number/number");
    expect(rows.get("c2b")).toBe("object/object");
    expect(rows.get("c3a")).toBe("number!");

    // -- Each instance answers for ITS OWN argument type. The failure this
    // pins would have been a shared slot, so a row where the two instances
    // agree could not tell the two apart: every pair below differs.
    expect(rows.get("r1a")).toBe("number");
    expect(rows.get("r1b")).toBe("obj");
    expect(rows.get("r3a")).toBe("number");
    expect(rows.get("r3b")).toBe("object");
    expect(rows.get("r4a")).toBe("number/number");
    expect(rows.get("r4b")).toBe("string/string");
    expect(rows.get("r4c")).toBe("object/object");
    // r8/r9: `i`, `t` and `v` are read AFTER their loops -- one
    // function-scoped slot per instance, re-assigned and never reset.
    expect(rows.get("r8a")).toBe("nnn:3:number");
    expect(rows.get("r8b")).toBe("ooo:3:object");
    expect(rows.get("r9a")).toBe("number122");
    expect(rows.get("r9b")).toBe("object122");

    expect(native).toBe(node);
    expect(nativeRes.exitCode).toBe(0);
  }, 180_000);

  test("a copied workspace member classifies identically to a symlinked one", () => {
    const { coverage } = analyze(join(fixturesRoot, "npm/cases/workspace-copied/main.ts"));
    expect(coverage.preflightFailed).toBe(false);
    const all = JSON.stringify(coverage.diagnostics);
    expect(all).toContain("wscopied");
    expect(all).not.toContain("nothing installed resolves");
    expect(all).not.toContain("implicitly has an 'any' type");
  }, 120_000);
});
