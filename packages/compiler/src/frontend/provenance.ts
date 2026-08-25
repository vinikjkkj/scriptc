/* `--provenance-sources` — the provenance-assisted static compilation
 * pipeline (EXPERIMENTAL prototype; the registry doc in
 * provenance-registry.ts states the thesis).
 *
 * For every bare npm specifier the entry's module graph imports, this
 * asks the npm registry for the package's PROVENANCE ATTESTATION
 * (GET registry.npmjs.org/-/npm/v1/attestations/<pkg>@<version> — the
 * SLSA predicate names the exact {repository, commit} the published dist
 * was built from), fetches that source tree once (content-addressed cache
 * under ~/.cache/scriptc/provenance/<gitCommit>), locates the package
 * directory inside it (monorepos publish from subdirectories), and maps
 * the published entry to its TypeScript source (dist/lib/build targets
 * rewritten to their src twins). Mapped packages compile as ordinary
 * program modules — real types, real statements, the static frontier —
 * and everything that cannot be mapped FALLS BACK to the island path
 * with a note; a fallback is never a build failure.
 *
 * PRODUCTION GAPS, deliberately unbuilt in the prototype: no sigstore
 * bundle verification (the attestation is trusted as served), no
 * dist-tarball ↔ source build reproduction (the behavior differential is
 * the honest check today), source-entry mapping is heuristic (exports
 * targets rewritten dist→src), and transitive dependency versions
 * resolve from the DRIVER's installed tree rather than the package's own
 * lockfile.
 *
 * Offline/test hook: SCRIPTC_PROVENANCE_MANIFEST=<path.json> pre-seeds
 * {"packages": {"<name>": {"dir": "<source pkg dir>", "commit"?, "repo"?}}}
 * — those packages skip the network entirely (harness fixtures ride
 * this); unlisted packages still take the live pipeline. */

import { execFile } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { cp, mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { builtinModules } from "node:module";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";
import ts from "typescript5";
import { resolveExports } from "./npm.js";
import { resolveBareModule, resolveRelativeModule } from "./resolve.js";
import { tsgoPath } from "./shared.js";
import type { ProvenancePackageSource, ProvenanceSources } from "./provenance-registry.js";

const execFileAsync = promisify(execFile);

const NODE_BUILTINS = new Set(builtinModules);

/** Hard cap on packages one compile will source-map (prototype guard). */
const MAX_PACKAGES = 16;

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function readJson(path: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function packageNameOf(specifier: string): string {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]!;
}

/* ── the bare-import prescan ─────────────────────────────────────────────
 * The provenance pipeline runs BEFORE the program loads (tsgo needs the
 * "paths" mapping at creation), so the bare specifiers come from a light
 * parse walk of the entry's RELATIVE import closure — the same specifier
 * collection shapes npm.ts scans embedded modules with, over the same
 * sanctioned typescript5 island. */

function moduleSpecifiersLite(source: string, fileName: string): { spec: string; typeOnly: boolean }[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  const out: { spec: string; typeOnly: boolean }[] = [];
  const visit = (n: ts.Node): void => {
    if (
      (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) &&
      n.moduleSpecifier !== undefined &&
      ts.isStringLiteral(n.moduleSpecifier)
    ) {
      const typeOnly = ts.isImportDeclaration(n)
        ? (n.importClause?.isTypeOnly ?? false)
        : n.isTypeOnly;
      out.push({ spec: n.moduleSpecifier.text, typeOnly });
    } else if (ts.isCallExpression(n)) {
      const arg = n.arguments[0];
      if (
        arg !== undefined &&
        ts.isStringLiteralLike(arg) &&
        (n.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(n.expression) && n.expression.text === "require" && n.arguments.length === 1))
      ) {
        out.push({ spec: arg.text, typeOnly: false });
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/** The TypeScript file an alias target pattern points at, probing the
 * extensions and the directory index — the source-tree twin of
 * mapEntryToSource's candidate walk. Null when nothing exists there. */
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

/** Every bare (non-relative, non-builtin, non-"#") specifier the relative
 * closure of `roots` imports, in first-encounter order — the ones a VALUE
 * import reaches first, then the ones only ever reached by `import type`.
 *
 * `aliases` (a source tree's own tsconfig paths, absolute) keeps the walk
 * INSIDE the tree: a matching specifier resolves to its source file and
 * joins the closure instead of being reported as a package the driver
 * never installed. */
function bareImportsOf(
  roots: readonly string[],
  aliases?: Record<string, string[]>,
): string[] {
  const aliasEntries = Object.entries(aliases ?? {}).sort(
    (a, b) => b[0].replace(/\*.*$/, "").length - a[0].replace(/\*.*$/, "").length,
  );
  const viaAlias = (spec: string): string | null => {
    for (const [key, targets] of aliasEntries) {
      const star = key.indexOf("*");
      let subbed: string[];
      if (star < 0) {
        if (spec !== key) continue;
        subbed = targets;
      } else {
        const prefix = key.slice(0, star);
        const suffix = key.slice(star + 1);
        if (spec.length < prefix.length + suffix.length) continue;
        if (!spec.startsWith(prefix) || !spec.endsWith(suffix)) continue;
        const wildcard = spec.slice(prefix.length, spec.length - suffix.length);
        subbed = targets.map((t) => t.split("*").join(wildcard));
      }
      for (const t of subbed) {
        const file = resolveAliasTarget(t);
        if (file !== null) return file;
      }
    }
    return null;
  };
  return bareImportsWalk(roots, viaAlias);
}

/* A TYPE-ONLY edge is still an edge for this walk.
 *
 * `import type { Logger } from 'zapo-js'` registers no specifier if the
 * prescan drops it, so the flag cannot reach the package at all and its
 * types stay island types — and an island type is not inert. A class
 * field typed from an island package leaves the class with no compiled
 * declaration, and then every call of every generic method on that class
 * refuses (SC1090) somewhere else entirely. The refusals land nowhere
 * near the import that caused them.
 *
 * The cost is that a package imported only for its types now takes the
 * attestation round-trip. MAX_PACKAGES is the hard cap that bounds it,
 * and the ordering below is the guard on the cap: a value import is what
 * a static build cannot proceed without, so value specifiers claim their
 * slots before type-only ones. */
function bareImportsWalk(
  roots: readonly string[],
  viaAlias: (spec: string) => string | null,
): string[] {
  const seenFiles = new Set<string>();
  const value: string[] = [];
  const typeOnlyBare: string[] = [];
  const valueSeen = new Set<string>();
  const typeSeen = new Set<string>();
  const queue = [...roots];
  while (queue.length > 0) {
    const file = resolve(queue.shift()!);
    if (seenFiles.has(file)) continue;
    seenFiles.add(file);
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const { spec, typeOnly } of moduleSpecifiersLite(text, file)) {
      if (spec.startsWith("./") || spec.startsWith("../")) {
        const dep = resolveRelativeModule(file, spec);
        if (dep !== null && !dep.endsWith(".json") && !dep.endsWith(".d.ts")) queue.push(dep);
        continue;
      }
      if (spec.startsWith("#") || spec.startsWith("node:")) continue;
      if (NODE_BUILTINS.has(packageNameOf(spec))) continue;
      const aliased = viaAlias(spec);
      if (aliased !== null) {
        queue.push(aliased);
        continue;
      }
      if (typeOnly) {
        if (!typeSeen.has(spec)) {
          typeSeen.add(spec);
          typeOnlyBare.push(spec);
        }
      } else if (!valueSeen.has(spec)) {
        valueSeen.add(spec);
        value.push(spec);
      }
    }
  }
  return [...value, ...typeOnlyBare.filter((spec) => !valueSeen.has(spec))];
}

/* ── installed-package lookup (name/version/published entry) ──────────── */

interface InstalledPackage {
  dir: string;
  name: string;
  version: string;
  pkgJson: Record<string, unknown>;
}

/** node_modules/<name> walking up from `fromDir`, realpath-free (the
 * published package.json is all this needs). */
function findInstalled(fromDir: string, name: string): InstalledPackage | null {
  for (let dir = fromDir; ; ) {
    const candidate = join(dir, "node_modules", name);
    const pkgJson = readJson(join(candidate, "package.json"));
    if (pkgJson !== null && typeof pkgJson["version"] === "string") {
      return {
        dir: candidate,
        name: typeof pkgJson["name"] === "string" ? pkgJson["name"] : name,
        version: pkgJson["version"],
        pkgJson,
      };
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/* ── attestation → {repo, commit} ──────────────────────────────────────── */

interface Attested {
  repo: string;
  commit: string;
}

/** GET the npm attestation set and extract the SLSA provenance
 * predicate's resolved source dependency. Throws with a one-line reason
 * on every failure shape (no attestation, network, malformed). */
async function fetchAttestation(name: string, version: string): Promise<Attested> {
  const url = `https://registry.npmjs.org/-/npm/v1/attestations/${encodeURIComponent(`${name}@${version}`).replace(/%40/g, "@").replace(/%2F/gi, "/")}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (res.status === 404) throw new Error("no provenance attestation published");
  if (!res.ok) throw new Error(`attestation fetch failed (HTTP ${res.status})`);
  const body = (await res.json()) as { attestations?: { predicateType?: string; bundle?: { dsseEnvelope?: { payload?: string } } }[] };
  for (const att of body.attestations ?? []) {
    if (!att.predicateType?.startsWith("https://slsa.dev/provenance")) continue;
    const payload = att.bundle?.dsseEnvelope?.payload;
    if (payload === undefined) continue;
    const stmt = JSON.parse(Buffer.from(payload, "base64").toString("utf8")) as {
      predicate?: { buildDefinition?: { resolvedDependencies?: { uri?: string; digest?: { gitCommit?: string } }[] } };
    };
    for (const dep of stmt.predicate?.buildDefinition?.resolvedDependencies ?? []) {
      const commit = dep.digest?.gitCommit;
      if (typeof commit === "string" && commit !== "" && typeof dep.uri === "string") {
        return { repo: dep.uri, commit };
      }
    }
  }
  throw new Error("attestation set carries no SLSA provenance predicate");
}

/* ── source fetch (content-addressed by the attested commit) ──────────── */

function cacheRoot(): string {
  return process.env["SCRIPTC_PROVENANCE_CACHE"] ?? join(homedir(), ".cache", "scriptc", "provenance");
}

/** The cached source tree for an attested commit, fetching it once from
 * codeload (github repos only in the prototype). Returns the tree root. */
async function fetchSourceTree(repo: string, commit: string): Promise<string> {
  const dest = join(cacheRoot(), commit);
  if (isDirectory(dest)) return dest;
  const m = /github\.com\/([^/]+)\/([^/@#]+)/.exec(repo);
  if (m === null) throw new Error(`source repository is not a github URL (${repo})`);
  const url = `https://codeload.github.com/${m[1]}/${m[2]}/tar.gz/${commit}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`source fetch failed (HTTP ${res.status} for ${url})`);
  const bytes = Buffer.from(await res.arrayBuffer());
  await mkdir(cacheRoot(), { recursive: true });
  const tmp = await mkdtemp(join(tmpdir(), "scriptc-provenance-"));
  try {
    const tarball = join(tmp, "src.tgz");
    await writeFile(tarball, bytes);
    const extractDir = join(tmp, "tree");
    await mkdir(extractDir);
    // On Windows both halves of the path spelling matter to GNU tar: the
    // drive-letter colon parses as a remote host:path ("Cannot connect to
    // G: resolve failed") without --force-local, and backslashes come out
    // mangled through its argument handling, so the paths go in
    // slash-normalized. bsdtar (macOS) rejects unknown options, so the
    // flag only rides on the platform whose tar needs it.
    const win = process.platform === "win32";
    const tarPath = (p: string): string => (win ? p.replaceAll("\\", "/") : p);
    await execFileAsync("tar", [
      ...(win ? ["--force-local"] : []),
      "-xzf", tarPath(tarball),
      "-C", tarPath(extractDir),
      "--strip-components=1",
    ]);
    try {
      await rename(extractDir, dest);
    } catch {
      // A parallel compile won the rename — its tree is the same content.
      if (!isDirectory(dest)) {
        // Or the publish crossed a filesystem boundary (EXDEV): TMPDIR and
        // the provenance cache need not share a volume — they do not when
        // either is redirected, which on Windows is the norm (a G: scratch
        // dir against the profile's C: cache). Copy instead; the temp tree
        // is removed by the finally below either way. Still atomic enough
        // for the racing-compiles story: a loser's copy lands on the
        // winner's identical content.
        await cp(extractDir, dest, { recursive: true, force: true });
        if (!isDirectory(dest)) throw new Error("source cache publish failed");
      }
    }
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
  return dest;
}

/* ── package dir + source-entry mapping ────────────────────────────────── */

/** The directory inside `tree` whose package.json names `name`: the root,
 * then the conventional monorepo layouts, then a bounded scan. */
function locatePackageDir(tree: string, name: string): string | null {
  const nameOf = (dir: string): string | null => {
    const pkg = readJson(join(dir, "package.json"));
    return pkg !== null && typeof pkg["name"] === "string" ? pkg["name"] : null;
  };
  if (nameOf(tree) === name) return tree;
  const bare = name.startsWith("@") ? name.split("/")[1]! : name;
  const candidates = [
    join(tree, "packages", bare),
    join(tree, "packages", name),
    join(tree, "packages", name.replace("@", "").replace("/", "-")),
    join(tree, "packages", `babel-${bare}`),
  ];
  for (const c of candidates) {
    if (nameOf(c) === name) return c;
  }
  // Bounded breadth-first scan (depth ≤ 3, node_modules/.git skipped).
  const queue: { dir: string; depth: number }[] = [{ dir: tree, depth: 0 }];
  while (queue.length > 0) {
    const { dir, depth } = queue.shift()!;
    if (depth > 0 && nameOf(dir) === name) return dir;
    if (depth >= 3) continue;
    let entries: string[];
    try {
      entries = ts.sys.getDirectories(dir);
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e === "node_modules" || e.startsWith(".")) continue;
      queue.push({ dir: join(dir, e), depth: depth + 1 });
    }
  }
  return null;
}

/** The published dist target for `subpath` — "exports" with the import
 * condition, else module/main/types fields (root subpath only). */
function publishedTargetOf(pkgJson: Record<string, unknown>, subpath: string): string | null {
  if (pkgJson["exports"] !== undefined) {
    return resolveExports(pkgJson["exports"], subpath, "import");
  }
  if (subpath !== ".") return subpath;
  for (const field of ["module", "main", "types"]) {
    const v = pkgJson[field];
    if (typeof v === "string" && v !== "") return v;
  }
  return "index.js";
}

/** The leading build-output segment of a published target. */
const BUILD_DIR_RE = /^(dist|lib|build|out|output|dist-node|dist-src)\//;

/** A MODULE-FLAVOR segment, which a package that publishes more than one
 * flavor puts underneath its build directory.
 *
 * zapo-js's "exports" is the shape: `require` → ./dist/util/index.js,
 * `import` → ./dist/esm/util/index.js, one source twin at
 * src/util/index.ts behind both. Stripping only the build segment leaves
 * src/esm/util/index.js, which exists in no source tree, so EVERY
 * subpath of such a package misses at once and the whole package falls
 * to the island — the root entry surviving only on the src/index.ts
 * fallback below. */
const FLAVOR_DIR_RE =
  /^(esm|esm5|esm2015|es|es5|es6|es2015|es2017|es2020|esnext|module|mjs|cjs|commonjs|umd|node|browser)\//;

/** dist target → source file, heuristically: the built path's leading
 * dist/lib/build segment rewrites to src (or drops), a module-flavor
 * segment under it drops too, extensions rewrite to their TypeScript
 * twins, and the root entry falls back to the conventional src/index.ts
 * homes. First existing candidate wins — the flavor-stripped stems are
 * appended, so a target that maps today keeps mapping to the same file.
 *
 * Nothing here invents a file: every candidate is probed with isFile and
 * a subpath whose source twin is absent still maps to null, which the
 * caller turns into a named island-fallback note. */
function mapEntryToSource(pkgDir: string, target: string, subpath: string): string | null {
  const rel = target.replace(/^\.\//, "");
  const stems = new Set<string>([rel]);
  /* The build-relative tails to look for under src/ and at the root, in
   * candidate order: the plain strip first (today's behavior), then the
   * flavor-stripped one. */
  const tails: string[] = [];
  if (BUILD_DIR_RE.test(rel)) {
    tails.push(rel.replace(BUILD_DIR_RE, ""));
  } else {
    tails.push(rel);
  }
  if (FLAVOR_DIR_RE.test(tails[0]!)) tails.push(tails[0]!.replace(FLAVOR_DIR_RE, ""));
  for (const tail of tails) {
    stems.add(`src/${tail}`);
    stems.add(tail);
  }
  const candidates: string[] = [];
  for (const stem of stems) {
    const base = stem.replace(/\.d\.(ts|mts|cts)$/, ".$1").replace(/\.(js|mjs|cjs)$/, "");
    if (/\.(ts|tsx|mts|cts)$/.test(base)) candidates.push(base);
    else {
      candidates.push(`${base}.ts`, `${base}.mts`, `${base}.cts`, `${base}.tsx`);
      candidates.push(join(base, "index.ts"));
    }
  }
  if (subpath === ".") {
    candidates.push("src/index.ts", "src/index.mts", "index.ts", "src/index.tsx");
  }
  for (const c of candidates) {
    const abs = join(pkgDir, c);
    if (isFile(abs)) return abs;
  }
  return null;
}

/** The tsconfig files a source tree's alias table may live in, in the
 * order a build would consult them. The root tsconfig.json is the norm;
 * the build-flavored siblings are the fallback for trees whose root
 * config only "references" projects. */
const TSCONFIG_NAMES = ["tsconfig.json", "tsconfig.build.json", "tsconfig.base.json"];

/** A source tree's OWN path aliases, baseUrl-resolved to absolute targets.
 *
 * A package built with tsconfig "paths" imports its internals through
 * BARE-LOOKING specifiers ("@client", "@protocol/constants"): nothing in
 * the specifier says "internal", so without the table they read as
 * uninstalled npm packages and the whole tree falls back to the island.
 * Reading the table here is what the package's own build does.
 *
 * Only the "extends" chain's compilerOptions.paths/baseUrl are consulted
 * (JSONC comments tolerated), and targets stay RELATIVE-to-baseUrl
 * patterns resolved against the package dir — no file probing here, so a
 * pattern that resolves to nothing simply never matches later. */
function sourceAliasesOf(pkgDir: string): Record<string, string[]> | undefined {
  const seen = new Set<string>();
  let baseUrl: string | undefined;
  let paths: Record<string, unknown> | undefined;
  const load = (file: string): void => {
    const abs = resolve(file);
    if (seen.has(abs) || !isFile(abs)) return;
    seen.add(abs);
    const json = readJson(abs);
    if (json === null) return;
    const opts = json["compilerOptions"];
    if (opts !== null && typeof opts === "object") {
      const o = opts as Record<string, unknown>;
      // The NEAREST config in the chain wins for each field (a child's
      // value overrides what it extends), so only fill what is unset.
      if (baseUrl === undefined && typeof o["baseUrl"] === "string") baseUrl = o["baseUrl"];
      if (paths === undefined && o["paths"] !== null && typeof o["paths"] === "object") {
        paths = o["paths"] as Record<string, unknown>;
      }
    }
    const ext = json["extends"];
    for (const e of typeof ext === "string" ? [ext] : Array.isArray(ext) ? ext : []) {
      // Only RELATIVE extends targets: a package-name extends would want
      // the source tree's own node_modules, which is not installed here.
      if (typeof e === "string" && (e.startsWith("./") || e.startsWith("../"))) {
        load(join(dirname(abs), e.endsWith(".json") ? e : `${e}.json`));
      }
    }
  };
  for (const name of TSCONFIG_NAMES) {
    load(join(pkgDir, name));
    if (paths !== undefined) break;
  }
  if (paths === undefined) return undefined;
  const base = join(pkgDir, baseUrl ?? ".");
  const out: Record<string, string[]> = {};
  for (const [key, raw] of Object.entries(paths)) {
    if (!Array.isArray(raw)) continue;
    const targets = raw.filter((t): t is string => typeof t === "string").map((t) => join(base, t));
    if (targets.length > 0) out[key] = targets;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/* ── the pipeline ─────────────────────────────────────────────────────── */

interface ManifestEntry {
  dir: string;
  commit?: string;
  repo?: string;
}

function readManifest(): Map<string, ManifestEntry> {
  const path = process.env["SCRIPTC_PROVENANCE_MANIFEST"];
  const out = new Map<string, ManifestEntry>();
  if (path === undefined || path === "") return out;
  const manifest = readJson(resolve(path));
  const packages = manifest?.["packages"];
  if (packages === null || typeof packages !== "object") return out;
  for (const [name, raw] of Object.entries(packages as Record<string, unknown>)) {
    if (raw === null || typeof raw !== "object") continue;
    const e = raw as { dir?: unknown; commit?: unknown; repo?: unknown };
    if (typeof e.dir !== "string") continue;
    const dir = isAbsolute(e.dir) ? e.dir : resolve(dirname(resolve(path)), e.dir);
    out.set(name, {
      dir,
      ...(typeof e.commit === "string" ? { commit: e.commit } : {}),
      ...(typeof e.repo === "string" ? { repo: e.repo } : {}),
    });
  }
  return out;
}

/** Resolves provenance sources for everything the entry's module graph
 * imports (one transitive round per newly-mapped tree: source imports of
 * OTHER packages try the pipeline too). Never throws for a package
 * failure — those become notes and the package keeps its island path. */
export async function resolveProvenanceSources(entryPath: string): Promise<ProvenanceSources> {
  const entry = resolve(entryPath);
  const manifest = readManifest();
  const packages: ProvenancePackageSource[] = [];
  const notes: string[] = [];
  /** package name → mapped package (or null after a noted failure). */
  const processed = new Map<string, ProvenancePackageSource | null>();

  /** All specifiers seen so far, grouped by package name. */
  const specifiersByPackage = new Map<string, Set<string>>();
  const enqueue = (specs: readonly string[]): string[] => {
    const newNames: string[] = [];
    for (const spec of specs) {
      const name = packageNameOf(spec);
      let set = specifiersByPackage.get(name);
      if (set === undefined) {
        specifiersByPackage.set(name, (set = new Set()));
        newNames.push(name);
      }
      set.add(spec);
    }
    return newNames;
  };

  const mapOne = async (name: string): Promise<void> => {
    if (processed.has(name)) return;
    if (processed.size >= MAX_PACKAGES) {
      processed.set(name, null);
      notes.push(`${name}: skipped — provenance package limit (${MAX_PACKAGES}) reached; island path used`);
      return;
    }
    processed.set(name, null); // claimed; overwritten on success
    const installed = findInstalled(dirname(entry), name);
    if (installed === null) {
      notes.push(`${name}: not installed under the entry's node_modules; island path used`);
      return;
    }
    let dir: string;
    let repo: string;
    let commit: string;
    const seeded = manifest.get(name);
    try {
      if (seeded !== undefined) {
        dir = seeded.dir;
        repo = seeded.repo ?? "(manifest)";
        commit = seeded.commit ?? "(manifest)";
        if (!isDirectory(dir)) throw new Error(`manifest dir does not exist (${dir})`);
      } else {
        const attested = await fetchAttestation(installed.name, installed.version);
        repo = attested.repo;
        commit = attested.commit;
        const tree = await fetchSourceTree(repo, commit);
        const located = locatePackageDir(tree, installed.name);
        if (located === null) {
          throw new Error(`package directory not found inside the attested source tree (${tree})`);
        }
        dir = located;
      }
      const entries: Record<string, string> = {};
      for (const spec of specifiersByPackage.get(name) ?? []) {
        const parts = spec.split("/");
        const nameLen = spec.startsWith("@") ? 2 : 1;
        const subpath = parts.length === nameLen ? "." : `./${parts.slice(nameLen).join("/")}`;
        const target = publishedTargetOf(installed.pkgJson, subpath);
        const source = target === null ? null : mapEntryToSource(dir, target, subpath);
        if (source === null) {
          notes.push(
            `${name}@${installed.version}: no source mapping for '${spec}' (published target: ${target ?? "unexported"}); island path used`,
          );
          continue;
        }
        entries[spec] = source;
      }
      if (Object.keys(entries).length === 0) return;
      const srcPkg = readJson(join(dir, "package.json"));
      const sourceVersion = typeof srcPkg?.["version"] === "string" ? srcPkg["version"] : undefined;
      const aliases = sourceAliasesOf(dir);
      // The tree's remaining bare imports resolve against the DRIVER's
      // installed tree: the checkout in the source cache has no
      // node_modules, so nothing resolves from where these files sit.
      const treeBare = bareImportsOf(Object.values(entries), aliases);
      const external: Record<string, string> = {};
      for (const spec of treeBare) {
        const r = resolveBareModule(entry, spec);
        if (r !== null) external[spec] = tsgoPath(r.typesFile);
      }
      const pkg: ProvenancePackageSource = {
        name: installed.name,
        version: installed.version,
        ...(sourceVersion !== undefined && sourceVersion !== installed.version ? { sourceVersion } : {}),
        repo,
        commit,
        dir,
        // Where these files SIT when Node runs the program. Node's own
        // require resolution is asked from here, not from the cache
        // checkout, which has no node_modules of its own.
        installedDir: tsgoPath(installed.dir),
        entries,
        ...(aliases !== undefined ? { aliases } : {}),
        ...(Object.keys(external).length > 0 ? { external } : {}),
      };
      if (pkg.sourceVersion !== undefined) {
        notes.push(
          `${name}: source tree's package.json says ${pkg.sourceVersion}, installed is ${installed.version} (release tooling that bumps at publish) — the behavior differential is the check`,
        );
      }
      packages.push(pkg);
      processed.set(name, pkg);
      // One transitive round: the mapped source's own bare imports try
      // the pipeline too (versions resolve from the DRIVER's tree — a
      // prototype heuristic; production wants the package's lockfile).
      const inner = enqueue(treeBare);
      for (const n of inner) await mapOne(n);
    } catch (e) {
      notes.push(`${name}@${installed.version}: ${e instanceof Error ? e.message : String(e)}; island path used`);
    }
  };

  for (const name of enqueue(bareImportsOf([entry]))) {
    await mapOne(name);
  }
  return { packages, notes };
}
