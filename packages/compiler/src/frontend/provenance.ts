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
import { readdirSync, readFileSync, statSync } from "node:fs";
import { cp, mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { builtinModules } from "node:module";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";
import ts from "typescript5";
import { resolveExports } from "./npm.js";
import { resolveBareModule, resolveRelativeModule } from "./resolve.js";
import { isRelativeSpecifier, tsgoPath } from "./shared.js";
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
      /* isRelativeSpecifier, not a hand-rolled prefix pair: the BARE DOT
       * FORMS `.` and `..` are relative specifiers too (shared.ts has said
       * so all along, and npm.ts's require probe carries the same scar),
       * and spelled as prefixes only they fell through to the bare branch
       * below and were enqueued as PACKAGE NAMES. They are not packages,
       * nothing installs them, and each one still claimed one of the
       * sixteen provenance slots on the way to failing:
       *
       *   note: .: not installed under the entry's node_modules
       *   note: ..@1.0.0: no provenance attestation published
       *
       * — two slots of sixteen, on mongodb's own tree, spent on specifiers
       * that name a directory. */
      if (isRelativeSpecifier(spec)) {
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
    try {
      await execFileAsync("tar", [
        ...(win ? ["--force-local"] : []),
        "-xzf", tarPath(tarball),
        "-C", tarPath(extractDir),
        "--strip-components=1",
      ]);
    } catch (e) {
      // GNU tar on Windows cannot create a symlink without the developer
      // privilege, and a repo that ships one exits 2 having extracted
      // every OTHER member. mysql2 is one (`.cursorrules`,
      // `.windsurfrules` and `AGENTS.md` all link to `CLAUDE.md`), and
      // failing the fetch there islands the package for a reason that has
      // nothing to do with provenance: the tree is complete apart from
      // links, and no link is a compilable source file.
      //
      // Accept the tree exactly when EVERY reported failure is a symlink
      // creation and something was extracted; any other tar error — a
      // truncated archive, a disk-full, a bad path — still throws, so the
      // package still falls back to the island with its real reason.
      const stderr = String((e as { stderr?: unknown }).stderr ?? "");
      const reported = stderr
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.startsWith("tar: ") && !l.startsWith("tar: Exiting with failure status"));
      const onlyLinks = reported.length > 0 && reported.every((l) => l.includes("Cannot create symlink to"));
      if (!onlyLinks || readdirSync(extractDir).length === 0) throw e;
    }
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
  /* The AUTHORED-JAVASCRIPT candidates, probed only after every TypeScript
   * candidate above has missed — see authoredJsEntry. Kept in a second list
   * rather than interleaved so a package with a build step maps to exactly
   * the file it maps to today, whatever else sits beside it. */
  const authored: string[] = [];
  for (const stem of stems) {
    const base = stem.replace(/\.d\.(ts|mts|cts)$/, ".$1").replace(/\.(js|mjs|cjs)$/, "");
    if (/\.(ts|tsx|mts|cts)$/.test(base)) candidates.push(base);
    else {
      candidates.push(`${base}.ts`, `${base}.mts`, `${base}.cts`, `${base}.tsx`);
      candidates.push(join(base, "index.ts"));
      authored.push(`${base}.d.ts`, `${base}.d.mts`, `${base}.d.cts`, join(base, "index.d.ts"));
    }
  }
  if (subpath === ".") {
    candidates.push("src/index.ts", "src/index.mts", "index.ts", "src/index.tsx");
    authored.push("index.d.ts", "src/index.d.ts");
  }
  for (const c of candidates) {
    const abs = join(pkgDir, c);
    if (isFile(abs)) return abs;
  }
  for (const c of authored) {
    const abs = join(pkgDir, c);
    if (authoredJsEntry(abs)) return abs;
  }
  return null;
}

/** True when `dts` is the declaration half of an AUTHORED-JavaScript entry:
 * the `.d.ts` exists AND an implementation file sits beside it under the same
 * stem.
 *
 * Why the twin is REQUIRED, and why this is not simply "accept the .js".
 * A package with no build step publishes the file it authored — mysql2's
 * `promise.js`, @vinikjkkj/wa-wam's `index.js` — so the published target IS
 * the attested source and there is no `.ts` twin for the walk above to find.
 * Every such entry missed, and the whole package fell to the island with a
 * `no source mapping` note, however faithfully its source had been fetched.
 *
 * Mapping to the `.js` directly would work for the values and LOSE the types:
 * the hand-written `.d.ts` beside it stops being consulted, and a consumer
 * importing one type token off the package sends the whole tree back to the
 * island (measured on @vinikjkkj/wa-wam under --npm-static, whose
 * `type WaWamChannel` did exactly that). Mapping to the `.d.ts` and letting
 * the EXISTING declaration-twin machinery supply the body is the shape that
 * hands the compiler both halves: provenanceDeclSiblings puts the `.js` into
 * the program and declTwinOf (program.ts) puts it into module order ahead of
 * its declaration — the same path zapo-js's own `spec/proto/index.js` already
 * takes.
 *
 * A `.d.ts` with no twin is deliberately NOT accepted. It would map the
 * package to a body-less surface on which every exported VALUE refuses, which
 * is a worse answer than the island it replaced, not a better one. Such a
 * package keeps its named `no source mapping` note. */
function authoredJsEntry(dts: string): boolean {
  /* OFF BY DEFAULT. The wrong answer it was gated on is FIXED; the gate
   * stays until the lane is adopted deliberately rather than as a side
   * effect of this file.
   *
   * What it was gated on. Mapping @vinikjkkj/wa-wam made the 28,725-line
   * twin lower and removed every one of the 13 wa-wam refusals at
   * @zapo-js/wam's entry (18 blocker sites over 7 messages -> 5 over 5) --
   * and produced a binary that printed
   *
   *     protocol=0        (node prints protocol=5)
   *
   * then died 0xC0000005 dereferencing a table that was never built. The
   * twin's module-init function was emitted and never called.
   *
   * Where it actually was. NOT in the redirect that lower-modules.ts
   * carries for exactly this case, and not in the
   * `dep.isDeclarationFile && declTwinSourceOf(dep) !== null` guard that
   * fronts it. The edge never reached either: orderedImportsOf resolved the
   * bare specifier through resolveProjectImportSf7, which answered null for
   * ANY declaration-file resolution, so the header saw dep=null and emitted
   * no init call at all. SCRIPTC_TWININIT_WHY printing nothing was the
   * ABSENCE of an edge, not a redirect declining one -- the two look
   * identical from a probe that only fires once the edge exists.
   *
   * Both halves are fixed (program.ts resolveProjectImportSf7; the
   * three-valued binding kind in lower-modules.ts), and the minimal probe
   * now prints protocol=5 and exits 0, byte-exact against node v25.9.0 on
   * both backends. Opt in with SCRIPTC_PROVENANCE_AUTHORED_JS=1. */
  if (process.env["SCRIPTC_PROVENANCE_AUTHORED_JS"] === undefined) return false;
  if (!isFile(dts)) return false;
  const stem = dts.replace(/\.d\.(ts|mts|cts)$/, "");
  return isFile(`${stem}.js`) || isFile(`${stem}.mjs`) || isFile(`${stem}.cjs`);
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
  // WHERE each field was DECLARED. tsc resolves a relative "baseUrl"
  // against the directory of the config file that spells it, not against
  // the project being built — and an inherited config commonly sits a
  // level up and spells ".." to mean the repo root. Resolving it against
  // the package directory instead moves every target by the depth of the
  // package: `packages/fake-server` + ".." is `packages`, so
  // `packages/src/...` — a directory that does not exist, in a table that
  // still looks plausible. (TS >= 4.1: with no baseUrl anywhere, targets
  // are relative to the config that declares "paths".)
  let baseUrlDir: string | undefined;
  let pathsDir: string | undefined;
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
      if (baseUrl === undefined && typeof o["baseUrl"] === "string") {
        baseUrl = o["baseUrl"];
        baseUrlDir = dirname(abs);
      }
      if (paths === undefined && o["paths"] !== null && typeof o["paths"] === "object") {
        paths = o["paths"] as Record<string, unknown>;
        pathsDir = dirname(abs);
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
  const base =
    baseUrl !== undefined ? join(baseUrlDir ?? pkgDir, baseUrl) : (pathsDir ?? pkgDir);
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

/** One package whose attested source tree has been LOCATED. The tree is
 * fetched once, but its `entries` map is not final when it is first
 * built — see `expand` and the fixed point below. */
interface MappedTree {
  installed: InstalledPackage;
  dir: string;
  repo: string;
  commit: string;
  aliases: Record<string, string[]> | undefined;
  /** specifier → mapped source file. Grows across rounds. */
  entries: Record<string, string>;
  /** Driver-resolved externals of everything in `entries`. Grows likewise. */
  external: Record<string, string>;
  /** Specifiers whose mapping has been ATTEMPTED — mapped or noted. The
   * pending set is `specifiersByPackage.get(name)` minus this. */
  considered: Set<string>;
  /** Set once the tree maps its first entry (the point at which it
   * becomes a ProvenancePackageSource and claims its import order). */
  announced: boolean;
  sourceVersion?: string;
}

/** Bound on the specifier-discovery fixed point. Each round attempts at
 * least one previously-unattempted specifier, and the specifier set is
 * finite, so this is insurance against a pathological graph rather than
 * the termination argument. Reaching it is noted, never silent. */
const MAX_ROUNDS = 32;

/** Resolves provenance sources for everything the entry's module graph
 * imports, to a FIXED POINT: a mapped tree's own source imports feed back
 * in, both as new packages and as new SUBPATHS of packages already
 * mapped. Never throws for a package failure — those become notes and the
 * package keeps its island path. */
export async function resolveProvenanceSources(entryPath: string): Promise<ProvenanceSources> {
  const entry = resolve(entryPath);
  const manifest = readManifest();
  const notes: string[] = [];
  /** Packages whose provenance could not be DETERMINED on this run because
   * something threw on the way to it -- a failed attestation fetch, a failed
   * source fetch, an unreadable manifest dir. Distinct from a package that
   * was resolved and deliberately not mapped (no attestation published, no
   * source mapping): those are answers, this is the absence of one. The
   * island diagnostics read it so they can stop advising --dynamic for what
   * is really a network failure. */
  const unfetched = new Set<string>();
  /** package name → located tree (or null after a noted failure). */
  const processed = new Map<string, MappedTree | null>();
  /** Names in the order their tree mapped its first entry. */
  const mappedOrder: string[] = [];

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

  /** Maps every specifier of `name` not yet attempted, then walks what
   * the newly mapped source files import. Returns the package names that
   * walk saw for the FIRST time; new specifiers of packages already
   * located stay in `specifiersByPackage` for the next round.
   *
   * This is why a located package is re-entered at all. `entries` used to
   * be built once, from the specifiers known at that instant, and a
   * subpath first imported by ANOTHER package's source arrives strictly
   * later — so the same specifier resolved or refused depending on which
   * file the compiler was pointed at. */
  const expand = async (name: string, tree: MappedTree): Promise<string[]> => {
    const known = specifiersByPackage.get(name);
    const pending = known === undefined ? [] : [...known].filter((s) => !tree.considered.has(s));
    if (pending.length === 0) return [];
    const added: string[] = [];
    for (const spec of pending) {
      tree.considered.add(spec);
      const parts = spec.split("/");
      const nameLen = spec.startsWith("@") ? 2 : 1;
      const subpath = parts.length === nameLen ? "." : `./${parts.slice(nameLen).join("/")}`;
      const target = publishedTargetOf(tree.installed.pkgJson, subpath);
      const source = target === null ? null : mapEntryToSource(tree.dir, target, subpath);
      if (source === null) {
        notes.push(
          `${name}@${tree.installed.version}: no source mapping for '${spec}' (published target: ${target ?? "unexported"}); island path used`,
        );
        continue;
      }
      if (tree.entries[spec] === source) continue;
      tree.entries[spec] = source;
      added.push(source);
    }
    if (added.length === 0) return [];
    if (!tree.announced) {
      tree.announced = true;
      mappedOrder.push(name);
      const srcPkg = readJson(join(tree.dir, "package.json"));
      const sourceVersion = typeof srcPkg?.["version"] === "string" ? srcPkg["version"] : undefined;
      if (sourceVersion !== undefined && sourceVersion !== tree.installed.version) {
        tree.sourceVersion = sourceVersion;
        notes.push(
          `${name}: source tree's package.json says ${sourceVersion}, installed is ${tree.installed.version} (release tooling that bumps at publish) — the behavior differential is the check`,
        );
      }
    }
    // Only the newly mapped roots are walked — the earlier ones' bare
    // imports are already in `external` and in specifiersByPackage. The
    // tree's remaining bare imports resolve against the DRIVER's installed
    // tree: the checkout in the source cache has no node_modules, so
    // nothing resolves from where these files sit.
    const treeBare = bareImportsOf(added, tree.aliases);
    for (const spec of treeBare) {
      if (Object.hasOwn(tree.external, spec)) continue;
      const r = resolveBareModule(entry, spec);
      if (r !== null) tree.external[spec] = tsgoPath(r.typesFile);
    }
    // The mapped source's own bare imports try the pipeline too (versions
    // resolve from the DRIVER's tree — a prototype heuristic; production
    // wants the package's lockfile).
    return enqueue(treeBare);
  };

  /** `expand`, with the pipeline's never-throw contract around it. */
  const expandSafely = async (name: string, tree: MappedTree): Promise<string[]> => {
    try {
      return await expand(name, tree);
    } catch (e) {
      notes.push(
        `${name}@${tree.installed.version}: ${e instanceof Error ? e.message : String(e)}; island path used`,
      );
      return [];
    }
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
    } catch (e) {
      unfetched.add(name);
      notes.push(`${name}@${installed.version}: ${e instanceof Error ? e.message : String(e)}; island path used`);
      return;
    }
    const tree: MappedTree = {
      installed,
      dir,
      repo,
      commit,
      aliases: sourceAliasesOf(dir),
      entries: {},
      external: {},
      considered: new Set(),
      announced: false,
    };
    processed.set(name, tree);
    for (const n of await expandSafely(name, tree)) await mapOne(n);
  };

  for (const name of enqueue(bareImportsOf([entry]))) {
    await mapOne(name);
  }

  // The fixed point. A located package's specifier set keeps growing as
  // OTHER trees are walked, and every one of those specifiers has to be
  // mapped or refused by name — otherwise a subpath is invisible forever
  // purely because of the order the graph was discovered in.
  let rounds = 0;
  for (;;) {
    let grew = false;
    for (const [name, tree] of [...processed]) {
      if (tree === null) continue;
      const known = specifiersByPackage.get(name);
      if (known === undefined) continue;
      let pending = false;
      for (const spec of known) {
        if (!tree.considered.has(spec)) {
          pending = true;
          break;
        }
      }
      if (!pending) continue;
      grew = true;
      for (const n of await expandSafely(name, tree)) await mapOne(n);
    }
    if (!grew) break;
    if (++rounds >= MAX_ROUNDS) {
      notes.push(
        `specifier discovery stopped after ${MAX_ROUNDS} rounds; subpaths found later keep the island path`,
      );
      break;
    }
  }

  const packages: ProvenancePackageSource[] = [];
  for (const name of mappedOrder) {
    const tree = processed.get(name);
    if (tree === null || tree === undefined) continue;
    packages.push({
      name: tree.installed.name,
      version: tree.installed.version,
      ...(tree.sourceVersion !== undefined ? { sourceVersion: tree.sourceVersion } : {}),
      repo: tree.repo,
      commit: tree.commit,
      dir: tree.dir,
      // Where these files SIT when Node runs the program. Node's own
      // require resolution is asked from here, not from the cache
      // checkout, which has no node_modules of its own.
      installedDir: tsgoPath(tree.installed.dir),
      entries: tree.entries,
      ...(tree.aliases !== undefined ? { aliases: tree.aliases } : {}),
      ...(Object.keys(tree.external).length > 0 ? { external: tree.external } : {}),
    });
  }
  /* An alias key that TWO mapped packages spell differently has exactly one
   * answer, because tsconfig "paths" is one flat table per program and
   * cannot be scoped to the package that declared it. The registry resolves
   * such a key to the FIRST package mapped -- the one the driver's own
   * imports reached -- and every later package spelling it borrows that
   * answer.
   *
   * The borrow is not a refusal. Two checkouts of one monorepo export the
   * same names with the same signatures, so the program typechecks,
   * compiles, runs and prints the other commit's values. It cannot be made
   * per-file here, so it is at least made LOUD -- once, naming the shape,
   * rather than once per key.
   *
   * Keys that are also a package ENTRY are excluded: `provenancePaths()`
   * writes the entry table after the alias table and `resolveSpecifier`
   * consults entries first, so for those the alias never decides anything
   * and a note would be a false alarm. On zapo's bench that is the
   * difference between 41 notes and one. */
  const entrySpecifiers = new Set<string>();
  for (const pkg of packages) for (const spec of Object.keys(pkg.entries)) entrySpecifiers.add(spec);
  const firstTarget = new Map<string, { pkg: string; target: string }>();
  const collided = new Set<string>();
  const borrowers = new Set<string>();
  const winners = new Set<string>();
  for (const pkg of packages) {
    for (const [key, targets] of Object.entries(pkg.aliases ?? {})) {
      const target = targets[0];
      if (target === undefined || entrySpecifiers.has(key)) continue;
      const seen = firstTarget.get(key);
      if (seen === undefined) {
        firstTarget.set(key, { pkg: pkg.name, target });
        continue;
      }
      if (seen.target === target) continue;
      collided.add(key);
      borrowers.add(pkg.name);
      winners.add(seen.pkg);
    }
  }
  if (collided.size > 0) {
    const examples = [...collided].slice(0, 5).map((k) => `'${k}'`).join(", ");
    // The winner is per KEY, so it is only named when there is one of them.
    // Naming the first key's winner for a set with several would be the same
    // class of quiet inaccuracy this note exists to end.
    const who = winners.size === 1 ? `${[...winners][0]}'s` : "the first-mapped package's";
    notes.push(
      `${collided.size} alias key(s) are spelled by more than one mapped package with different ` +
        `targets (${examples}${collided.size > 5 ? ", …" : ""}); tsconfig "paths" is one table per ` +
        `program, so ${who} answer is used for all of them and ${[...borrowers].join(", ")} ` +
        `compile against ${who} checkout for those specifiers`,
    );
  }

  return { packages, notes, unfetched: [...unfetched] };
}
