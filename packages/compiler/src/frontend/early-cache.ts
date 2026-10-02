/* The INPUT-keyed early build cache.
 *
 * The problem it exists for: backend/cc.ts keys its native cache on the bytes
 * of the emitted translation unit (`cBytes` at the `readFile(opts.cPath)` in
 * compileC). That key cannot be computed until the whole frontend and codegen
 * have already run, so even a genuine cc-cache HIT pays them in full.
 * Measured on zapo-rest/app182: a warm hit is 25.5 minutes, of which 99.6% is
 * frontend + codegen and 0.4% is the native stage the cache actually removes.
 *
 * This cache is keyed on what the frontend READS instead, so it can answer
 * before any of that work happens.
 *
 * ── What it caches, and what it deliberately does not ────────────────────
 *
 * CACHED: the emitted program TU (.c/.ll), its split parts and shared header,
 * the optional IR dump, and the metadata a caller cannot re-derive without an
 * IrModule — the backend that emitted, any LLVM tier refusal, the ~50 native
 * link gates (ProgramNativeFeatures), the SC6xxx advisories, and the
 * --npm-static outcomes.
 *
 * NOT CACHED: the executable. A hit still runs compileC, which re-derives its
 * own key from the restored TU's bytes and hits its own cache. That keeps the
 * binary's identity chain — driver version, runtime fingerprint, forced
 * includes, the five hardening fixes this tree carries in cc.ts — entirely in
 * cc.ts's hands, and costs the 0.4% the table above measured. Duplicating a
 * native-artifact cache here is how a stale binary gets shipped.
 *
 * ── The key ──────────────────────────────────────────────────────────────
 *
 * Two halves, and both are load-bearing:
 *
 * 1. An EXPLICIT key over everything that is not a file: the compiler dist
 *    that is actually executing, the Node version, cwd, the entry and output
 *    paths, every CompileOptions field, the target/driver, the resolved
 *    provenance source set, and EVERY `SCRIPTC_*` environment variable except
 *    the three that only configure this cache. The env rule is a blanket, not
 *    an allowlist, on purpose: cc.ts records what an allowlist cost last time
 *    — a forced-include header outside the fingerprint let a deliberately
 *    broken census rebuild to a byte-identical exe and report its pre-break
 *    numbers, and the test that exists to catch that passed in 1.3 s. A knob
 *    added tomorrow is in this key today.
 *
 * 2. A replayed INPUT SNAPSHOT (frontend/input-tracker.ts): every filesystem
 *    observation the frontend made, including the ones that FAILED. A cache
 *    that recorded only successful reads would be wrong — dropping a file
 *    that wins module resolution earlier changes the program while every
 *    recorded read still matches byte for byte.
 *
 * ── Granularity: whole program, and why ──────────────────────────────────
 *
 * Per-library would be the prize: a block editing its own entry changes 0.79%
 * of the input. But our frontend has no per-library boundary to cache at.
 * lowerToIr produces ONE IrModule for the closed graph, shape unification and
 * integer-slot inference run across module boundaries, validateModule runs
 * over the whole thing, and the emitter answers one TU (split by SIZE, never
 * by module). Caching a per-package fragment would first require separate
 * compilation, which is a compiler change, not a cache. So this is a
 * whole-program key: it makes an UNCHANGED rebuild nearly free and does
 * nothing for an edited one. See the block report for the measurement that
 * decides whether the second half is worth building. */

import { createHash } from "node:crypto";
import { chmod, copyFile, mkdir, readFile, readdir, rename, rm, utimes, writeFile } from "node:fs/promises";
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  frontendInputsStillMatch,
  validFrontendInputSnapshot,
  type FrontendInputExclusions,
  type FrontendInputSnapshot,
} from "./input-tracker.js";
import type { LoweringFragment } from "./lowering/fragment.js";
import type { ScrDiagnostic } from "../diagnostics/diagnostic.js";
import type { NpmStaticStatus } from "../coverage/report.js";

/** The IR-derived native link gates. Structurally `Record<string, boolean>`;
 * declared here so this module does not import from index.ts (which imports
 * this one). */
export type CachedNativeFeatures = Record<string, boolean>;

interface CachedArtifact {
  /** Name inside the cache entry directory. */
  name: string;
  /** Destination, relative to outDir. */
  rel: string;
  digest: string;
}

export interface EarlyBuildMetadata {
  backend: "c" | "llvm";
  llvmRefusal: string | null;
  features: CachedNativeFeatures;
  advisories: ScrDiagnostic[];
  /** Only the sources an advisory actually points at. The full sourceTexts
   * map is the whole 13 MB input; rendering needs the handful of files the
   * advisories name. */
  advisorySourceTexts: Record<string, string>;
  npmStatic: NpmStaticStatus[];
}

interface EarlyBuildStamp {
  version: 1;
  key: string;
  frontend: FrontendInputSnapshot;
  artifacts: CachedArtifact[];
  meta: EarlyBuildMetadata;
  integrity: string;
}

/** Everything that is an input to the build but is NOT a file. */
export interface EarlyBuildCacheOptions {
  entryPath: string;
  outDir: string;
  outPath: string;
  /** Canonical JSON of the CompileOptions the caller passed. */
  compileOptions: string;
  /** Canonical JSON of the resolved provenance source set, or "null". */
  provenance: string;
  /** Build target triple / platform / arch, already resolved. */
  target: string;
  /** The compiler driver spelling (SCRIPTC_CC or its default). */
  cc: string;
  /** Host Node runtime — its builtin-module inventory participates in
   * frontend classification. */
  nodeVersion: string;
  /** Digest of the compiler `dist` tree that is actually executing. */
  implementation: string;
  /** Digest of the SCRIPTC_* environment. */
  environment: string;
  /** cc.ts's SCRIPTC_PROF_CFLAGS discriminator, which folds the CONTENTS of
   * every file a `-include` names and not merely the flag string naming it.
   *
   * The environment digest above already carries the flag STRING, and an
   * instrument lives in the header, not in the string — editing the header
   * leaves the string byte-identical. cc.ts's own comment records what that
   * cost: a build handed back a binary carrying the PREVIOUS instrument, and
   * a block reported three runs as successful which had measured the old
   * header. The native key folds these bytes; folding them here too means
   * this cache does not depend on a downstream component to be right. */
  profFlavor: string;
  /** process.cwd(): tsgo resolves relative to it. */
  cwd: string;
}

export interface EarlyBuildCacheHit {
  cPath: string;
  cPathParts: string[];
  cPathHeader: string | undefined;
  irPath: string | undefined;
  meta: EarlyBuildMetadata;
}

export interface EarlyBuildCachePublish {
  cPath: string;
  cPathParts: string[];
  cPathHeader: string | undefined;
  irPath: string | undefined;
  meta: EarlyBuildMetadata;
  frontend: FrontendInputSnapshot;
}

function digestBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/* ── the explicit half of the key ────────────────────────────────────────── */

/** Every SCRIPTC_* variable except the four that configure THIS cache and
 * nothing else. A blanket rather than an allowlist: see the header comment. */
const CACHE_ONLY_ENV = new Set([
  "SCRIPTC_CACHE_DIR",
  "SCRIPTC_NO_CACHE",
  "SCRIPTC_CACHE_MAX_MB",
  // Verify mode MUST be excluded or it cannot observe the thing it checks:
  // this fingerprint is a blanket over every other SCRIPTC_*, so a verify
  // flag inside the key would change every key, force a cold miss, and leave
  // no hit to verify. Same shape as SCRIPTC_CACHE_DEBUG, which is still IN
  // the key and must never be used to instrument a cached build.
  "SCRIPTC_CACHE_VERIFY",
]);

export function scriptcEnvironmentFingerprint(env: NodeJS.ProcessEnv = process.env): string {
  const hash = createHash("sha256").update("scriptc-env-v1\0");
  for (const name of Object.keys(env).filter((n) => n.startsWith("SCRIPTC_") && !CACHE_ONLY_ENV.has(n)).sort()) {
    hash.update(name).update("\0").update(env[name] ?? "").update("\0");
  }
  return hash.digest("hex");
}

/** The compiler `dist` tree this process is running FROM — not the package
 * root, not the source checkout. Two reasons it is the right tree:
 *
 *  - It is what actually executes. A branch under test keeps the package
 *    version unchanged, so a version string separates nothing.
 *  - It is resolved through `import.meta.url`, so when a CLI's
 *    node_modules/@scriptc/compiler is an absolute symlink into ANOTHER
 *    checkout — which has cost this project a 49-minute build — the
 *    fingerprint is that other checkout's, and the cache cannot cross the two.
 */
let implementationMemo: Promise<string> | null = null;
export function compilerImplementationDir(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..");
}
export function compilerImplementationFingerprint(): Promise<string> {
  implementationMemo ??= (async () => {
    const root = compilerImplementationDir();
    const files: string[] = [];
    const walk = async (directory: string): Promise<void> => {
      const entries = await readdir(directory, { withFileTypes: true });
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) await walk(path);
        else if (entry.isFile()) files.push(path);
      }
    };
    await walk(root);
    const hash = createHash("sha256").update("scriptc-compiler-impl-v1\0");
    for (const file of files) {
      hash.update(relative(root, file).replaceAll("\\", "/")).update("\0").update(await readFile(file)).update("\0");
    }
    return hash.digest("hex");
  })();
  return implementationMemo;
}

function cacheKey(options: EarlyBuildCacheOptions): string {
  return createHash("sha256")
    .update("early-build-v1\0")
    .update(options.implementation).update("\0")
    .update(options.nodeVersion).update("\0")
    .update(resolve(options.cwd)).update("\0")
    .update(resolve(options.entryPath)).update("\0")
    .update(resolve(options.outDir)).update("\0")
    .update(resolve(options.outPath)).update("\0")
    .update(options.compileOptions).update("\0")
    .update(options.provenance).update("\0")
    .update(options.target).update("\0")
    .update(options.cc).update("\0")
    .update(options.environment).update("\0")
    .update(options.profFlavor)
    .digest("hex");
}

function entryDir(root: string, options: EarlyBuildCacheOptions): string {
  return join(root, "early-build", cacheKey(options));
}

function stampIntegrity(stamp: Omit<EarlyBuildStamp, "integrity">): string {
  return createHash("sha256").update("early-build-stamp-v1\0").update(JSON.stringify(stamp)).digest("hex");
}

/* ── output exclusions ───────────────────────────────────────────────────── */

/** The compiler's own outputs must not invalidate the frontend that produced
 * them: outDir does not exist on a first build and the frontend observes it
 * MISSING, then emission creates it. Directory CONTENT stays tracked — a user
 * file appearing in outDir still invalidates resolution. */
function outputExclusions(options: EarlyBuildCacheOptions, publish: EarlyBuildCachePublish | EarlyBuildCacheHit): FrontendInputExclusions {
  const stem = basename(options.entryPath).replace(/\.(ts|js|mjs|cjs)$/, "");
  const artifacts = [
    publish.cPath,
    ...publish.cPathParts,
    ...(publish.cPathHeader === undefined ? [] : [publish.cPathHeader]),
    ...(publish.irPath === undefined ? [] : [publish.irPath]),
    options.outPath,
    // Both possible TU spellings and every part slot the sweep may remove,
    // so a build that changes lane or split shape does not invalidate itself.
    join(options.outDir, `${stem}.c`),
    join(options.outDir, `${stem}.ll`),
    join(options.outDir, `${stem}.scrh`),
    join(options.outDir, `${stem}.ir.json`),
    ...Array.from({ length: 32 }, (_, i) => join(options.outDir, `${stem}.part${i + 1}.c`)),
  ].map((path) => resolve(path));
  const outputDirectories = new Set<string>();
  for (const artifact of artifacts) {
    for (let directory = dirname(artifact); ; directory = dirname(directory)) {
      outputDirectories.add(directory);
      if (dirname(directory) === directory) break;
    }
  }
  return { outputPaths: artifacts, outputDirectories };
}

/* ── read ────────────────────────────────────────────────────────────────── */

function validMetadata(value: unknown): value is EarlyBuildMetadata {
  if (value === null || typeof value !== "object") return false;
  const meta = value as Partial<EarlyBuildMetadata>;
  if (meta.backend !== "c" && meta.backend !== "llvm") return false;
  if (meta.llvmRefusal !== null && typeof meta.llvmRefusal !== "string") return false;
  if (meta.features === null || typeof meta.features !== "object") return false;
  if (!Object.values(meta.features).every((flag) => typeof flag === "boolean")) return false;
  if (!Array.isArray(meta.advisories) || !Array.isArray(meta.npmStatic)) return false;
  if (meta.advisorySourceTexts === null || typeof meta.advisorySourceTexts !== "object") return false;
  return Object.values(meta.advisorySourceTexts).every((text) => typeof text === "string");
}

async function readVerified(path: string, expected: string): Promise<Buffer | null> {
  try {
    const bytes = await readFile(path);
    return digestBytes(bytes) === expected ? bytes : null;
  } catch {
    return null;
  }
}

async function installBytes(bytes: Uint8Array, destination: string): Promise<void> {
  await mkdir(dirname(destination), { recursive: true });
  const tmp = join(dirname(destination), `.scriptc-early-${process.pid}-${Math.random().toString(36).slice(2)}`);
  try {
    await writeFile(tmp, bytes);
    await rename(tmp, destination).catch(async () => {
      // Windows rename does not replace an existing destination.
      await rm(destination, { force: true });
      await rename(tmp, destination);
    });
  } finally {
    await rm(tmp, { force: true }).catch(() => undefined);
  }
}

/* ── the counter ─────────────────────────────────────────────────────────
 *
 * A hit is logged per occurrence; a miss is logged not at all. That asymmetry
 * makes the log a COUNT with no denominator, and a reader who sees "14 hits,
 * 0 misses" will take the zero for a measurement rather than for the absence
 * of an instrument. Reconstructing the denominator costs a walk of the cache
 * directory and an argument about whether eviction moved it.
 *
 * So the program keeps the pair itself and derives its own rate. Deliberately
 * NOT behind a SCRIPTC_* flag: every such variable except the four in
 * CACHE_ONLY_ENV is folded into the key, so a flag that switched this on
 * would change every key and measure a cache it had just emptied. Always on,
 * two increments.
 *
 * Reported once per process, and ONLY once the process has consulted the
 * cache more than once. A rate over a single consultation is not a rate --
 * it restates the per-hit line that already prints -- and emitting it would
 * append a line to every one-off CLI build, which is noise for every user of
 * the tool. packages/cli/test/flush.test.ts is where that showed up: it
 * asserts stderr ENDS with the diagnostic count, and an exit-time write lands
 * after it.
 *
 * One process compiles many programs -- the corpus harness calls compile()
 * in-process -- so the pair is per worker, which is the granularity worth
 * reading. */
let cacheConsultations = 0;
let cacheHits = 0;
let exitReportArmed = false;
/* Captured on the first consultation: the exit handler needs a root, and the
 * root arrives per call. */
let counterRoot: string | null = null;
/* Distinguishes this process's file from one a RECYCLED pid left behind in an
 * earlier run. A measurer sums the files written inside its own window. */
let counterStartedAt = 0;

export function earlyCacheCounters(): { consultations: number; hits: number } {
  return { consultations: cacheConsultations, hits: cacheHits };
}

/** Exported for tests: the counters are process-global, so a test that
 * asserts on them must start from a known point. */
export function resetEarlyCacheCounters(): void {
  cacheConsultations = 0;
  cacheHits = 0;
  counterRoot = null;
  counterStartedAt = 0;
}

/** Write this process's pair under the cache root, one file per process.
 *
 * A file rather than a harness hook, and a file rather than stderr alone,
 * because stderr is the channel that is broken: vitest forwards writes made
 * DURING a test and drops an exit handler's, so the pair was invisible in
 * exactly the log it exists for. The filesystem is not on that path. It also
 * keeps working outside vitest -- a manual build, a block script, some other
 * CI -- where no afterAll or reporter exists to hang a hook on.
 *
 * Separately callable so it can be tested: an exit handler cannot be.
 * Returns the path written, or null when there was nothing worth writing.
 *
 * MUST stay synchronous. An exit handler runs with no further turns of the
 * loop, so an async write never lands -- the counter would be silently empty,
 * which is the failure this whole item is about. */
export function writeEarlyCacheCounterFile(root: string): string | null {
  if (cacheConsultations < 2) return null;
  try {
    const directory = join(root, "counters");
    mkdirSync(directory, { recursive: true });
    const file = join(directory, `${process.pid}-${counterStartedAt}.json`);
    writeFileSync(
      file,
      JSON.stringify({
        pid: process.pid,
        startedAt: new Date(counterStartedAt).toISOString(),
        consultations: cacheConsultations,
        hits: cacheHits,
      }),
    );
    return file;
  } catch {
    // An exit handler that throws takes the process's exit code with it.
    return null;
  }
}

function armExitReport(): void {
  if (exitReportArmed) return;
  exitReportArmed = true;
  process.on("exit", () => {
    if (cacheConsultations < 2) return;
    const rate = ((cacheHits / cacheConsultations) * 100).toFixed(1);
    if (counterRoot !== null) writeEarlyCacheCounterFile(counterRoot);
    process.stderr.write(
      `scriptc: early cache ${cacheHits}/${cacheConsultations} hits (${rate}%)\n`,
    );
  });
}

/** The read itself. Counting lives in the exported wrapper below so that it
 * happens on EVERY return path, of which this function has many. */
async function readEarlyBuildCacheUncounted(
  root: string,
  options: EarlyBuildCacheOptions,
): Promise<EarlyBuildCacheHit | null> {
  const directory = entryDir(root, options);
  try {
    const stamp = JSON.parse(await readFile(join(directory, "stamp.json"), "utf8")) as EarlyBuildStamp;
    const { integrity, ...unsigned } = stamp;
    if (
      stamp.version !== 1 ||
      stamp.key !== cacheKey(options) ||
      !validFrontendInputSnapshot(stamp.frontend) ||
      !validMetadata(stamp.meta) ||
      !Array.isArray(stamp.artifacts) ||
      !stamp.artifacts.every(
        (artifact) =>
          artifact !== null &&
          typeof artifact === "object" &&
          typeof artifact.name === "string" &&
          /^[A-Za-z0-9._-]+$/.test(artifact.name) &&
          typeof artifact.rel === "string" &&
          !artifact.rel.includes("..") &&
          /^[0-9a-f]{64}$/.test(artifact.digest),
      ) ||
      stampIntegrity(unsigned) !== integrity
    ) {
      return null;
    }

    const destinations = stamp.artifacts.map((artifact) => resolve(options.outDir, artifact.rel));
    const hit: EarlyBuildCacheHit = {
      cPath: destinations[0]!,
      cPathParts: [],
      cPathHeader: undefined,
      irPath: undefined,
      meta: stamp.meta,
    };
    // Roles are positional by construction on publish: [TU, header?, parts…,
    // ir?]. The stamp records each artifact's role in its name.
    for (const [index, artifact] of stamp.artifacts.entries()) {
      const destination = destinations[index]!;
      if (artifact.name === "program.tu") hit.cPath = destination;
      else if (artifact.name === "program.header") hit.cPathHeader = destination;
      else if (artifact.name.startsWith("program.part")) hit.cPathParts.push(destination);
      else if (artifact.name === "program.ir.json") hit.irPath = destination;
      else return null;
    }

    if (!frontendInputsStillMatch(stamp.frontend, outputExclusions(options, hit))) return null;

    const bytes = await Promise.all(
      stamp.artifacts.map((artifact) => readVerified(join(directory, artifact.name), artifact.digest)),
    );
    if (bytes.some((b) => b === null)) return null;

    for (const [index, artifact] of stamp.artifacts.entries()) {
      void artifact;
      await installBytes(bytes[index]!, destinations[index]!);
    }
    const now = new Date();
    await Promise.all(
      ["stamp.json", ...stamp.artifacts.map((a) => a.name)].map((name) =>
        utimes(join(directory, name), now, now).catch(() => undefined),
      ),
    );
    return hit;
  } catch {
    return null;
  }
}

/** Consult the cache, and count the consultation.
 *
 * The counter file is written HERE, on every consultation, not from an exit
 * handler. process.on("exit") DOES NOT FIRE in a vitest worker -- measured,
 * not assumed: a probe registering one produced nothing across a passing run.
 * That, and not any stderr routing, is why the first version of this counter
 * was invisible in the gate. A number that only lands when a process exits
 * cleanly is a number that does not land here.
 *
 * Cost is one small synchronous write against a compile of hundreds of
 * milliseconds, and it survives SIGKILL, worker termination and crashes,
 * which an exit handler does not. */
export async function readEarlyBuildCache(
  root: string | null,
  options: EarlyBuildCacheOptions,
): Promise<EarlyBuildCacheHit | null> {
  if (root === null) return null;
  armExitReport();
  if (counterRoot === null) {
    counterRoot = root;
    counterStartedAt = Date.now();
  }
  cacheConsultations += 1;
  const hit = await readEarlyBuildCacheUncounted(root, options);
  if (hit !== null) cacheHits += 1;
  writeEarlyCacheCounterFile(root);
  return hit;
}

/* ── publish ─────────────────────────────────────────────────────────────── */

export async function publishEarlyBuildCache(
  root: string | null,
  options: EarlyBuildCacheOptions,
  result: EarlyBuildCachePublish,
): Promise<void> {
  // `stable: false` means an input was observed to change while the frontend
  // ran. The build is fine; no single filesystem state describes it, so it
  // must never become an entry.
  if (root === null || !result.frontend.stable) return;
  const destination = entryDir(root, options);
  const parent = dirname(destination);
  const stage = join(parent, `.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`);
  try {
    await mkdir(stage, { recursive: true });
    const sources: { name: string; path: string }[] = [
      { name: "program.tu", path: result.cPath },
      ...(result.cPathHeader === undefined ? [] : [{ name: "program.header", path: result.cPathHeader }]),
      ...result.cPathParts.map((path, i) => ({ name: `program.part${i + 1}`, path })),
      ...(result.irPath === undefined ? [] : [{ name: "program.ir.json", path: result.irPath }]),
    ];
    const artifacts: CachedArtifact[] = [];
    for (const source of sources) {
      const target = join(stage, source.name);
      await copyFile(source.path, target);
      await chmod(target, 0o600).catch(() => undefined);
      artifacts.push({
        name: source.name,
        rel: relative(resolve(options.outDir), resolve(source.path)).replaceAll("\\", "/"),
        digest: digestBytes(await readFile(target)),
      });
    }
    // Re-validate AFTER copying: an input that changed while we were staging
    // would otherwise be published as a description of a build it does not
    // describe.
    if (!frontendInputsStillMatch(result.frontend, outputExclusions(options, result))) return;
    const unsigned: Omit<EarlyBuildStamp, "integrity"> = {
      version: 1,
      key: cacheKey(options),
      frontend: result.frontend,
      artifacts,
      meta: result.meta,
    };
    const stamp: EarlyBuildStamp = { ...unsigned, integrity: stampIntegrity(unsigned) };
    await writeFile(join(stage, "stamp.json"), `${JSON.stringify(stamp)}\n`);
    await mkdir(destination, { recursive: true });
    const install = async (name: string): Promise<void> => {
      const from = join(stage, name);
      const to = join(destination, name);
      await rename(from, to).catch(async () => {
        // Windows will not replace through rename. A racing reader sees
        // either the old file or a miss; the STAMP lands last, so no mixed
        // artifact set can ever validate as a hit.
        await rm(to, { force: true });
        await rename(from, to);
      });
    };
    for (const artifact of artifacts) await install(artifact.name);
    await install("stamp.json");
  } catch {
    // Cache trouble is never a build failure.
  } finally {
    await rm(stage, { recursive: true, force: true }).catch(() => undefined);
  }
}

/* ── verify mode ─────────────────────────────────────────────────────────── */

/** What a verification compares: the metadata a build produced, the bytes of
 * every artifact it emitted keyed by the artifact's role name, and the
 * per-module lowering fragments it stored.
 *
 * Fragments are compared FIELD BY FIELD rather than whole. A whole-record
 * comparison is caught by any coarse check and proves nothing about
 * granularity, while the thing this mode exists to catch is one stale field
 * inside an otherwise-correct fragment -- a witness list that lost an entry,
 * a mint whose ordinal moved. The planted-mutant test mutates every field
 * individually, including every field of the witness, and requires each one
 * to be named in the output. */
export interface CacheVerificationSubject {
  meta: EarlyBuildMetadata;
  artifacts: Map<string, Uint8Array>;
  /** Keyed by module. Absent on a subject from a build that stored none. */
  fragments?: Map<string, LoweringFragment>;
}

/** Is verify mode on? SCRIPTC_CACHE_VERIFY is in CACHE_ONLY_ENV, so asking
 * this question does not change the answer -- see the note there. */
export function cacheVerifyEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env["SCRIPTC_CACHE_VERIFY"] === "1";
}

/** Every way a cached hit can disagree with the build that was run anyway.
 *
 * The metadata half walks the UNION of both objects' own keys rather than a
 * list of fields to check. A list is written from what its author remembered,
 * and a field added to EarlyBuildMetadata tomorrow would be compared by
 * nobody -- which is the precise shape of bug this mode exists to catch, so
 * it must not be the shape of the mode itself.
 *
 * Returns one human-readable line per divergence; empty means the cached
 * artifact is exactly what building again produces. */
export function cacheVerificationDivergences(
  cached: CacheVerificationSubject,
  fresh: CacheVerificationSubject,
): string[] {
  const out: string[] = [];

  const names = [...new Set([...cached.artifacts.keys(), ...fresh.artifacts.keys()])].sort();
  for (const name of names) {
    const a = cached.artifacts.get(name);
    const b = fresh.artifacts.get(name);
    if (a === undefined) out.push(`artifact ${name}: absent from the cached entry, emitted by the build`);
    else if (b === undefined) out.push(`artifact ${name}: present in the cached entry, not emitted by the build`);
    else if (a.length !== b.length || !a.every((byte, i) => byte === b[i]))
      out.push(`artifact ${name}: cached ${digestBytes(a).slice(0, 12)} != built ${digestBytes(b).slice(0, 12)}`);
  }

  const cachedMeta = cached.meta as unknown as Record<string, unknown>;
  const freshMeta = fresh.meta as unknown as Record<string, unknown>;
  for (const field of [...new Set([...Object.keys(cachedMeta), ...Object.keys(freshMeta)])].sort()) {
    const a = JSON.stringify(cachedMeta[field]) ?? "undefined";
    const b = JSON.stringify(freshMeta[field]) ?? "undefined";
    if (a !== b) out.push(`meta.${field}: cached ${a} != built ${b}`);
  }

  out.push(...fragmentDivergences(cached.fragments, fresh.fragments));
  return out;
}

/** The fragment half, PER FIELD and one level into the witness.
 *
 * Per field rather than per fragment because a whole-record comparison is
 * caught by any coarse check and says nothing about granularity, while the
 * failure worth catching is one stale field inside an otherwise-correct
 * fragment. Into the witness because the witness is where a field gets
 * ADDED: a new one that nothing compares is precisely the bug this mode
 * exists to prevent, so the walk takes the union of both sides' own keys at
 * both levels rather than a list somebody remembered to update. */
function fragmentDivergences(
  cached: ReadonlyMap<string, LoweringFragment> | undefined,
  fresh: ReadonlyMap<string, LoweringFragment> | undefined,
): string[] {
  const out: string[] = [];
  const a = cached ?? new Map<string, LoweringFragment>();
  const b = fresh ?? new Map<string, LoweringFragment>();
  for (const module of [...new Set([...a.keys(), ...b.keys()])].sort()) {
    const x = a.get(module);
    const y = b.get(module);
    if (x === undefined) { out.push(`fragment ${module}: absent from the cached entry, produced by the build`); continue; }
    if (y === undefined) { out.push(`fragment ${module}: present in the cached entry, not produced by the build`); continue; }
    const xr = x as unknown as Record<string, unknown>;
    const yr = y as unknown as Record<string, unknown>;
    for (const field of [...new Set([...Object.keys(xr), ...Object.keys(yr)])].sort()) {
      if (field === "witness") continue; // walked below, one field at a time
      const l = JSON.stringify(xr[field]) ?? "undefined";
      const r = JSON.stringify(yr[field]) ?? "undefined";
      if (l !== r) out.push(`fragment ${module}.${field}: cached ${abbreviate(l)} != built ${abbreviate(r)}`);
    }
    const xw = (xr["witness"] ?? {}) as Record<string, unknown>;
    const yw = (yr["witness"] ?? {}) as Record<string, unknown>;
    for (const field of [...new Set([...Object.keys(xw), ...Object.keys(yw)])].sort()) {
      const l = JSON.stringify(xw[field]) ?? "undefined";
      const r = JSON.stringify(yw[field]) ?? "undefined";
      if (l !== r) out.push(`fragment ${module}.witness.${field}: cached ${abbreviate(l)} != built ${abbreviate(r)}`);
    }
  }
  return out;
}

/** A divergence line has to be readable in a log; a fragment field can be a
 * whole function list. The FIELD NAME is the load-bearing part -- it is what
 * the planted-mutant test asserts on -- so truncating the value is safe and
 * truncating the name would not be. */
function abbreviate(value: string): string {
  return value.length <= 120 ? value : `${value.slice(0, 120)}... (${value.length} chars)`;
}
