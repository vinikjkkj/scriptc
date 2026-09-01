/* The provenance-sources registry — the flag-gated state `--provenance-
 * sources` compiles against (EXPERIMENTAL prototype).
 *
 * The thesis: an npm package published with provenance attests the exact
 * {repository, commit} its dist was built from, so the compiler can fetch
 * that SOURCE and hand it to the static frontend as ordinary program
 * modules — real TypeScript with real types — instead of island-embedding
 * the published JavaScript. provenance.ts fills this registry before the
 * program loads; the pipeline consults it at three chokepoints:
 *
 *   - resolve.ts resolveProjectImport: a registered bare specifier answers
 *     its mapped source entry (preflight's user-module edges, the module
 *     order, and the CJS link check all ride that one resolver);
 *   - program.ts resolveNpmImport: a registered specifier is NOT an npm
 *     import (no island embed, no .d.ts type surface);
 *   - program.ts loadProgram: the registered entries become tsconfig
 *     "paths" so tsgo's own resolution agrees with ours.
 *
 * Empty registry (the default — the flag off) = every chokepoint answers
 * exactly as before; nothing in the production npm/island path changes. */
import { setProvenanceUnfetched } from "../diagnostics/diagnostic.js";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { tsgoPath } from "./shared.js";

export interface ProvenancePackageSource {
  /** Package name ("cookie"). */
  name: string;
  /** The INSTALLED published version the attestation was fetched for. */
  version: string;
  /** The version field of the source tree's package.json, when it
   * disagrees with `version` (release tooling that bumps at publish —
   * babel's shape). Informational; the differential is the real check. */
  sourceVersion?: string;
  /** The attested source repository (https URL). */
  repo: string;
  /** The attested gitCommit digest — the content address of the cached
   * source tree. */
  commit: string;
  /** Absolute path of the package's directory inside the cached source
   * tree (== the tree root except in monorepos). */
  dir: string;
  /** Absolute path of the package as INSTALLED in the driver's tree —
   * where these files SIT when Node runs the program, as opposed to `dir`,
   * where the compiler reads them from. Node's own resolution has to be
   * asked from here (provenanceInstalledCounterpart). Optional because a
   * registry built by a caller that has no installed tree has none. */
  installedDir?: string;
  /** specifier → absolute mapped source file ("cookie" → …/src/index.ts). */
  entries: Record<string, string>;
  /** The source tree's OWN tsconfig "paths", baseUrl-resolved to absolute
   * targets ("@client/*" → ["…/src/client/*"]). A package built with path
   * aliases imports its internals through them, and those specifiers are
   * bare-looking — without this they read as uninstalled npm packages and
   * the whole tree falls back. Absent for packages with no alias table. */
  aliases?: Record<string, string[]>;
  /** Bare specifiers the source tree imports that stay ordinary npm
   * packages, mapped to their types file AS RESOLVED IN THE DRIVER'S
   * installed tree. The source tree is a bare git checkout in the
   * content-addressed cache with no node_modules of its own, so nothing
   * resolves from where those files sit; the prototype's stated contract
   * is that these versions come from the driver's tree. Feeds the
   * tsconfig "paths" tsgo resolves with (provenancePaths). */
  external?: Record<string, string>;
}

export interface ProvenanceSources {
  /** Successfully source-mapped packages, driver-import order. */
  packages: ProvenancePackageSource[];
  /** Everything that fell back to the island path (or is informational):
   * no attestation, unfetchable source, unmappable entry, version skew.
   * Fallbacks are never build failures — the coverage report carries
   * these so the build output stays honest. */
  notes: string[];
  /** Packages whose attested source could not be FETCHED on this run. A
   * transport failure, not a decision -- see setProvenanceUnfetched. */
  unfetched?: string[];
}

/** One tsconfig path-alias pattern, pre-split around its single '*'
 * (tsc allows at most one). A key with no '*' is an exact alias: `suffix`
 * is null and `prefix` is the whole key. */
interface AliasPattern {
  prefix: string;
  suffix: string | null;
  targets: string[];
}

interface RegistryState {
  bySpecifier: Map<string, string>;
  /** Longest-prefix-first, so the tsc "most specific pattern wins" rule is
   * a linear scan. */
  aliases: AliasPattern[];
  aliasPaths: Record<string, string[]>;
  externalPaths: Record<string, string[]>;
  packageDirs: string[];
  sources: ProvenanceSources;
}

let state: RegistryState | null = null;

/** Installs the resolved provenance sources for the current compile.
 * Passing null (or an empty set) clears the registry. */
export function setProvenanceSources(sources: ProvenanceSources | null): void {
  // Hand the fetch failures to the diagnostics layer before anything else:
  // the island refusals they change are emitted during lowering, long after
  // this, and a package that never fetched must not be told to try
  // --dynamic.
  setProvenanceUnfetched(sources?.unfetched ?? []);
  if (sources === null || sources.packages.length === 0) {
    state =
      sources === null
        ? null
        : { bySpecifier: new Map(), aliases: [], aliasPaths: {}, externalPaths: {}, packageDirs: [], sources };
    return;
  }
  const bySpecifier = new Map<string, string>();
  const packageDirs: string[] = [];
  const aliases: AliasPattern[] = [];
  const aliasPaths: Record<string, string[]> = {};
  const externalPaths: Record<string, string[]> = {};
  for (const pkg of sources.packages) {
    for (const [spec, file] of Object.entries(pkg.external ?? {})) externalPaths[spec] = [file];
    // Slash-spelled and slash-terminated: the prefix compares in
    // isProvenanceSourceFile/provenancePackageOfFile run against TypeScript
    // file names, which are slash-spelled on every host.
    packageDirs.push(provenanceDirPrefix(pkg.dir));
    for (const [spec, file] of Object.entries(pkg.entries)) {
      bySpecifier.set(spec, file);
    }
    for (const [key, targets] of Object.entries(pkg.aliases ?? {})) {
      if (targets.length === 0) continue;
      const star = key.indexOf("*");
      aliases.push(
        star < 0
          ? { prefix: key, suffix: null, targets }
          : { prefix: key.slice(0, star), suffix: key.slice(star + 1), targets },
      );
      // ACCUMULATE, never replace. Two mapped packages routinely spell the
      // same alias key — a monorepo's `@protocol/*` is in the shared config
      // that every package in it extends — and they are checkouts of
      // DIFFERENT commits. Assigning here let the last package mapped
      // silently rewrite every earlier package's table, so a file in
      // zapo-js@1.6.2 (commit 250f9af5) resolved `@protocol/constants`
      // into @zapo-js/store-sqlite's commit ff43c244 and dragged that
      // other checkout's whole client tree into the program: 862 refusal
      // sites, none of them naming an alias.
      //
      // tsgo tries a key's targets in order, and `aliases` above is
      // consulted first-match-wins over a stable sort, so appending makes
      // the two resolvers agree: the package mapped FIRST — the one the
      // driver's own imports reached — answers, and the others become
      // fallbacks instead of overrides. What this does NOT do is scope an
      // alias to the package that declared it; tsconfig "paths" is one
      // flat table per program and cannot express that.
      aliasPaths[key] = [...(aliasPaths[key] ?? []), ...targets];
    }
  }
  // tsc's rule: among matching patterns the longest literal prefix wins.
  aliases.sort((a, b) => b.prefix.length - a.prefix.length);
  state = { bySpecifier, aliases, aliasPaths, externalPaths, packageDirs, sources };
}

/** The candidate absolute targets an alias pattern maps `specifier` to,
 * substituted, in declaration order — or an empty array when nothing
 * matches. File resolution (extension/index probing) is the caller's:
 * only it knows which extensions its world admits. */
export function provenanceAliasTargets(specifier: string): string[] {
  if (state === null) return [];
  for (const a of state.aliases) {
    if (a.suffix === null) {
      if (specifier === a.prefix) return a.targets;
      continue;
    }
    if (
      specifier.length >= a.prefix.length + a.suffix.length &&
      specifier.startsWith(a.prefix) &&
      specifier.endsWith(a.suffix)
    ) {
      const wildcard = specifier.slice(a.prefix.length, specifier.length - a.suffix.length);
      return a.targets.map((t) => t.split("*").join(wildcard));
    }
  }
  return [];
}

/** The active sources (for reports), or null when the flag is off. */
/** The `.js` implementations sitting beside a `.d.ts` inside a provenance
 * package — the bodies whose declarations resolution picks instead. Added as
 * program roots so the checker has them; declTwinOf (program.ts) then puts
 * each one into module order ahead of its declaration. */
export function provenanceDeclSiblings(): string[] {
  if (state === null) return [];
  const out: string[] = [];
  const walk = (dir: string, depth: number): void => {
    if (depth > 3) return;
    let ents: string[] = [];
    try { ents = readdirSync(dir); } catch { return; }
    for (const e of ents) {
      const full = join(dir, e);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) { if (e !== "node_modules") walk(full, depth + 1); continue; }
      if (!e.endsWith(".d.ts")) continue;
      const impl = full.slice(0, -5) + ".js";
      try { if (statSync(impl).isFile()) out.push(impl); } catch { /* none */ }
    }
  };
  for (const d of state.packageDirs) walk(join(d, "spec"), 0);
  /* The AUTHORED-JavaScript entries. mapEntryToSource (provenance.ts) maps a
   * package with no build step to the `.d.ts` beside the file it publishes,
   * and only accepts that mapping when the implementation twin exists — so
   * every `.d.ts` entry here has one, and it is the body of the package's own
   * entry point rather than of some file three directories down. The walk
   * above cannot reach these: it descends `spec/`, and these sit at the
   * package root. */
  for (const entry of state.bySpecifier.values()) {
    if (!entry.endsWith(".d.ts")) continue;
    const stem = entry.slice(0, -".d.ts".length);
    for (const ext of [".js", ".mjs", ".cjs"]) {
      const impl = `${stem}${ext}`;
      try {
        if (statSync(impl).isFile()) {
          if (!out.includes(impl)) out.push(impl);
          break;
        }
      } catch { /* none */ }
    }
  }
  return out;
}

export function provenanceSources(): ProvenanceSources | null {
  return state?.sources ?? null;
}

/** The mapped source entry for a bare specifier, or null. */
export function provenanceEntryFor(specifier: string): string | null {
  return state?.bySpecifier.get(specifier) ?? null;
}

/** True when any provenance package is registered. */
export function provenanceActive(): boolean {
  return state !== null && state.bySpecifier.size > 0;
}

/** True when `specifier` is a registered package entry or matches one of
 * the alias patterns — i.e. it names provenance source, not an npm
 * package the driver would have to have installed. */
export function isProvenanceSpecifier(specifier: string): boolean {
  if (state === null) return false;
  return state.bySpecifier.has(specifier) || provenanceAliasTargets(specifier).length > 0;
}

/* Both predicates below are a PREFIX COMPARE between two path spellings,
 * and on Windows the two sides do not agree by default: the resolver
 * answers host paths (`G:\…\greeter`, from node:path's join) while every
 * caller holds a TypeScript file name, which is always slash-spelled
 * (`G:/…/greeter/src/index.ts`). `startsWith` then answered false for
 * EVERY file, and the registry silently reported that a registered
 * package owns nothing — the @__PURE__ dead-const elision never fired and
 * per-file attribution came back empty, on Windows only.
 *
 * Normalising at this boundary, on both sides, is the fix: the callers
 * cannot each be trusted to remember (resolve.ts already spelled its own
 * tsgoPath at the call site; lower-stmts.ts passed sf.fileName raw).
 * `packageDirs` is stored slash-spelled — see setProvenanceSources.
 *
 * provenanceDirPrefix is that normalisation as ONE definition: the
 * registry builds packageDirs with it and the coverage report buckets
 * statsByFile with it, so "how a package dir is compared" cannot drift
 * into two answers (it already had — report.ts carried its own copy of
 * the `endsWith("/") ? … : …` line and the same Windows blind spot). */
export function provenanceDirPrefix(dir: string): string {
  const d = tsgoPath(dir);
  return d.endsWith("/") ? d : `${d}/`;
}

/** True when `fileName` lives inside a registered package's source tree —
 * the gate for the third-party-source policies (the pure-annotated
 * dead-const elision, the per-file statement attribution). */
export function isProvenanceSourceFile(fileName: string): boolean {
  if (state === null) return false;
  const f = tsgoPath(fileName);
  for (const dir of state.packageDirs) {
    if (f.startsWith(dir)) return true;
  }
  return false;
}

/** The registered package owning `fileName`, or null. */
export function provenancePackageOfFile(fileName: string): ProvenancePackageSource | null {
  if (state === null) return null;
  const f = tsgoPath(fileName);
  for (let i = 0; i < state.packageDirs.length; i++) {
    if (f.startsWith(state.packageDirs[i]!)) return state.sources.packages[i]!;
  }
  return null;
}

/** Where Node's OWN resolver has to be asked from for a provenance-mapped
 * source file: the same relative path inside the package as INSTALLED in
 * the driver's tree.
 *
 * This file's own contract (ProvenancePackageSource.external) already says
 * it: the source tree is a bare git checkout in the content-addressed
 * cache with no node_modules of its own, so NOTHING resolves from where
 * these files sit, and the driver's installed tree is what the versions
 * come from. A resolution asked from the cache path does not answer
 * "nothing" though — it climbs out of the cache and answers with whatever
 * node_modules happens to sit above the user's HOME directory, a set that
 * has nothing to do with the program and differs per build host.
 *
 * The relative path need not exist under `installedDir`; a published dist
 * rarely mirrors its source layout. Only the DIRECTORY CHAIN above the
 * file is ever read, and a level that does not exist contributes nothing —
 * exactly as it would for a file Node loaded from there.
 *
 * Null when `fileName` is not inside a registered package's source tree,
 * or when the package was recorded without its installed location: the
 * caller then keeps the path it was handed. */
export function provenanceInstalledCounterpart(fileName: string): string | null {
  if (state === null) return null;
  const f = tsgoPath(fileName);
  for (let i = 0; i < state.packageDirs.length; i++) {
    const prefix = state.packageDirs[i]!;
    if (!f.startsWith(prefix)) continue;
    const installed = state.sources.packages[i]!.installedDir;
    if (installed === undefined || installed === "") return null;
    return `${provenanceDirPrefix(installed)}${f.slice(prefix.length)}`;
  }
  return null;
}

/** tsconfig "paths" for the registered entries — loadProgram feeds these
 * to tsgo so the checker resolves registered bare specifiers to the same
 * source files the preflight resolver answers. */
export function provenancePaths(): Record<string, string[]> | null {
  if (state === null || state.bySpecifier.size === 0) return null;
  // Driver-resolved externals first, then the source trees' own alias
  // patterns, so a package ENTRY spelling always wins over an alias that
  // happens to cover it, and an alias wins over an external of the same
  // name (the tree's own code is what the alias was written for).
  const paths: Record<string, string[]> = { ...state.externalPaths, ...state.aliasPaths };
  for (const [spec, file] of state.bySpecifier) paths[spec] = [file];
  return paths;
}
