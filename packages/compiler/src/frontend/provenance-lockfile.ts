/* The LOCKFILE-VERIFIED TARBALL arm of `--provenance-sources`.
 *
 * A package that publishes no provenance attestation has no attested source
 * tree to map. What a project's lockfile DOES record for every locked package
 * is the SRI digest of the published TARBALL (`integrity`, sha512-...). That
 * is a weaker claim than an attestation -- it says "these are the bytes the
 * installer locked", not "these bytes were built from that commit" -- but it
 * is a real, checkable claim, and for a package with no build step the
 * tarball's files ARE the source.
 *
 * This module is the mechanism and nothing else: it names no package and
 * decides nothing about which packages are eligible. The caller (provenance.ts)
 * invokes it for exactly the packages the registry reports as having no
 * attestation, and everything here refuses by REASON rather than falling back:
 *
 *   - no lockfile, or no entry for name@version, or an entry with no
 *     integrity (git/file/link dependencies) -> {ok:false, reason}
 *   - the bytes cannot be obtained (offline with no cache) -> {ok:false}
 *   - the bytes do not hash to the locked digest -> {ok:false}
 *
 * The files compiled are the ones extracted FROM the verified tarball, never
 * the node_modules tree they were installed into: that tree may have been
 * edited after install, and the lockfile says nothing about it. */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, relative, sep } from "node:path";

/** What a lockfile records for one locked package. */
export interface LockedPackage {
  /** SRI string exactly as written (`sha512-...`, possibly several). */
  integrity: string;
  /** The lockfile it came from (absolute). */
  lockfile: string;
  /** An explicit tarball URL the lockfile records, when it records one. */
  tarball?: string;
}

export type LockLookup =
  | { found: true; locked: LockedPackage }
  | { found: false; reason: string };

/* ── pnpm-lock.yaml ──────────────────────────────────────────────────────
 * Not a YAML parser: the `packages:` section has one fixed shape across
 * lockfileVersion 5/6/9 -- a 2-space-indented key per package, then an
 * indented `resolution: {integrity: ..., tarball: ...}` flow map (or the
 * block spelling of the same two fields). Nothing else in the file is read. */

function unquote(s: string): string {
  const t = s.trim();
  if (t.length >= 2 && (t[0] === "'" || t[0] === '"') && t[t.length - 1] === t[0]) return t.slice(1, -1);
  return t;
}

/** Does a `packages:` key name exactly name@version? Keys are
 * `name@1.2.3` (v9), `/name@1.2.3` and `/name@1.2.3(peer@1)` (v6), or
 * `/name/1.2.3` and `/name/1.2.3_peer` (v5). */
function pnpmKeyMatches(rawKey: string, name: string, version: string): boolean {
  let key = unquote(rawKey);
  if (key.startsWith("/")) key = key.slice(1);
  const paren = key.indexOf("(");
  const bare = paren === -1 ? key : key.slice(0, paren);
  if (bare === `${name}@${version}`) return true;
  if (bare === `${name}/${version}`) return true;
  return bare.startsWith(`${name}/${version}_`);
}

const SRI_RE = /integrity:\s*['"]?((?:sha(?:256|384|512)-[A-Za-z0-9+/]+=*)(?:\s+sha(?:256|384|512)-[A-Za-z0-9+/]+=*)*)/;
const TARBALL_RE = /tarball:\s*['"]?([^'",}\s]+)/;

export function lookupPnpmLock(text: string, name: string, version: string): LockedPackage | "no-integrity" | null {
  const lines = text.split(/\r?\n/);
  let i = lines.findIndex((l) => l.trimEnd() === "packages:");
  if (i === -1) return null;
  for (i++; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.length > 0 && !line.startsWith(" ") && !line.startsWith("#")) break; // next top-level section
    const m = /^ {2}(\S.*?):\s*(\{\})?\s*$/.exec(line);
    if (m === null || line.startsWith("   ")) continue;
    if (!pnpmKeyMatches(m[1]!, name, version)) continue;
    // The entry's body: every following line indented deeper than the key.
    const body: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j]!;
      if (l.trim() === "") continue;
      if (!l.startsWith("   ")) break;
      body.push(l);
    }
    const resolution = body.join("\n");
    const sri = SRI_RE.exec(resolution);
    if (sri === null) return "no-integrity";
    const tb = TARBALL_RE.exec(resolution);
    return { integrity: sri[1]!, lockfile: "", ...(tb !== null ? { tarball: tb[1]! } : {}) };
  }
  return null;
}

/* ── package-lock.json / npm-shrinkwrap.json ───────────────────────────── */

interface NpmLockEntry {
  version?: unknown;
  integrity?: unknown;
  resolved?: unknown;
  dependencies?: Record<string, NpmLockEntry>;
}

function npmEntryResult(e: NpmLockEntry): LockedPackage | "no-integrity" {
  if (typeof e.integrity !== "string" || e.integrity === "") return "no-integrity";
  return {
    integrity: e.integrity,
    lockfile: "",
    ...(typeof e.resolved === "string" && /^https?:/.test(e.resolved) ? { tarball: e.resolved } : {}),
  };
}

export function lookupNpmLock(
  json: unknown,
  name: string,
  version: string,
  /** The installed directory relative to the lockfile's directory,
   * slash-spelled (`node_modules/a/node_modules/b`), when it has one. */
  relInstalled: string | null,
): LockedPackage | "no-integrity" | null {
  if (json === null || typeof json !== "object") return null;
  const root = json as { packages?: Record<string, NpmLockEntry>; dependencies?: Record<string, NpmLockEntry> };
  if (root.packages !== undefined && typeof root.packages === "object") {
    const direct = relInstalled === null ? undefined : root.packages[relInstalled];
    if (direct !== undefined && direct.version === version) return npmEntryResult(direct);
    for (const [key, e] of Object.entries(root.packages)) {
      if (key !== `node_modules/${name}` && !key.endsWith(`/node_modules/${name}`)) continue;
      if (e.version === version) return npmEntryResult(e);
    }
  }
  const walk = (deps: Record<string, NpmLockEntry> | undefined): LockedPackage | "no-integrity" | null => {
    if (deps === undefined) return null;
    for (const [n, e] of Object.entries(deps)) {
      if (n === name && e.version === version) return npmEntryResult(e);
      const inner = walk(e.dependencies);
      if (inner !== null) return inner;
    }
    return null;
  };
  return walk(root.dependencies);
}

/** The lockfile entry for name@version, searching `fromDir` and every
 * directory above it (the lockfile of a workspace sits at the root). The
 * nearest lockfile that NAMES the package decides. */
export function lockedIntegrityOf(
  fromDir: string,
  name: string,
  version: string,
  installedDir: string,
): LockLookup {
  const seen: string[] = [];
  let noIntegrityIn: string | null = null;
  for (let dir = fromDir; ; ) {
    for (const file of ["pnpm-lock.yaml", "package-lock.json", "npm-shrinkwrap.json"]) {
      const path = join(dir, file);
      if (!existsSync(path)) continue;
      seen.push(path);
      let text: string;
      try {
        text = readFileSync(path, "utf8");
      } catch {
        continue;
      }
      let hit: LockedPackage | "no-integrity" | null = null;
      if (file === "pnpm-lock.yaml") {
        hit = lookupPnpmLock(text, name, version);
      } else {
        let json: unknown = null;
        try {
          json = JSON.parse(text);
        } catch {
          continue;
        }
        const rel = relative(dir, installedDir).split(sep).join("/");
        hit = lookupNpmLock(json, name, version, rel.startsWith("..") ? null : rel);
      }
      if (hit === "no-integrity") {
        noIntegrityIn = path;
        continue;
      }
      if (hit !== null) return { found: true, locked: { ...hit, lockfile: path } };
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  if (noIntegrityIn !== null) {
    return {
      found: false,
      reason: `${noIntegrityIn} locks ${name}@${version} with no integrity digest (a git, file or link dependency has none), so its bytes cannot be verified`,
    };
  }
  return {
    found: false,
    reason:
      seen.length === 0
        ? `no pnpm-lock.yaml, package-lock.json or npm-shrinkwrap.json was found at or above ${fromDir}, so there is no integrity digest to verify ${name}@${version} against`
        : `no entry for ${name}@${version} in ${seen.join(", ")}, so there is no integrity digest to verify it against`,
  };
}

/* ── SRI ───────────────────────────────────────────────────────────────── */

const STRENGTH = ["sha512", "sha384", "sha256"] as const;
type Algo = (typeof STRENGTH)[number];

export interface Sri {
  algo: Algo;
  /** base64 digest as written. */
  b64: string;
  /** lowercase hex of the same digest, the content address used on disk. */
  hex: string;
}

/** The strongest acceptable digest in an SRI string, or null when it holds
 * only weak ones (sha1) or is malformed. A weak digest is not accepted. */
export function parseSri(integrity: string): Sri | null {
  const parts = integrity.trim().split(/\s+/);
  for (const algo of STRENGTH) {
    for (const p of parts) {
      if (!p.startsWith(`${algo}-`)) continue;
      const b64 = p.slice(algo.length + 1);
      if (!/^[A-Za-z0-9+/]+=*$/.test(b64)) continue;
      return { algo, b64, hex: Buffer.from(b64, "base64").toString("hex") };
    }
  }
  return null;
}

export function sriMatches(bytes: Uint8Array, sri: Sri): boolean {
  return createHash(sri.algo).update(bytes).digest("base64") === sri.b64;
}

/* ── the bytes ─────────────────────────────────────────────────────────── */

export type TarballResult =
  | { ok: true; bytes: Buffer; source: string }
  | { ok: false; reason: string };

function registryTarballUrl(name: string, version: string): string {
  const bare = name.startsWith("@") ? name.split("/")[1]! : name;
  return `https://registry.npmjs.org/${name}/-/${bare}-${version}.tgz`;
}

function npmCacacheRoot(): string {
  return process.env["npm_config_cache"] !== undefined && process.env["npm_config_cache"] !== ""
    ? join(process.env["npm_config_cache"], "_cacache")
    : join(homedir(), ".npm", "_cacache");
}

/** Obtain the tarball bytes for a locked package and VERIFY them against
 * the lockfile digest. Sources, first one that has bytes decides:
 *   1. this tool's content-addressed tarball cache (`cacheDir`)
 *   2. the npm cache (cacache is content-addressed by this same digest)
 *   3. the registry (or the lockfile's recorded tarball URL)
 * A source that has bytes which do not verify is a REFUSAL, never a reason to
 * try the next source: that would let a corrupted cache be papered over. */
export async function obtainVerifiedTarball(
  name: string,
  version: string,
  locked: LockedPackage,
  cacheDir: string,
): Promise<TarballResult> {
  const sri = parseSri(locked.integrity);
  if (sri === null) {
    return {
      ok: false,
      reason: `${locked.lockfile} records integrity "${locked.integrity}" for ${name}@${version}, which carries no sha256/sha384/sha512 digest (sha1 is not accepted), so its bytes cannot be verified`,
    };
  }
  const check = (bytes: Buffer, source: string): TarballResult =>
    sriMatches(bytes, sri)
      ? { ok: true, bytes, source }
      : {
          ok: false,
          reason: `INTEGRITY MISMATCH: the bytes from ${source} do not hash to the ${sri.algo} digest ${locked.lockfile} records for ${name}@${version}; they are not the bytes that were locked`,
        };
  const addressed = join(cacheDir, `${sri.algo}-${sri.hex}.tgz`);
  if (existsSync(addressed)) return check(await readFile(addressed), `the scriptc tarball cache (${addressed})`);
  const cacache = join(npmCacacheRoot(), "content-v2", sri.algo, sri.hex.slice(0, 2), sri.hex.slice(2, 4), sri.hex.slice(4));
  if (existsSync(cacache)) {
    const r = check(await readFile(cacache), `the npm cache (${cacache})`);
    if (r.ok) await persist(addressed, r.bytes);
    return r;
  }
  const url = locked.tarball ?? registryTarballUrl(name, version);
  let bytes: Buffer;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
    if (!res.ok) {
      return { ok: false, reason: `the tarball could not be fetched (HTTP ${res.status} for ${url}) and neither the scriptc cache nor the npm cache holds it, so ${name}@${version} cannot be verified` };
    }
    bytes = Buffer.from(await res.arrayBuffer());
  } catch (e) {
    return {
      ok: false,
      reason: `the tarball could not be fetched (${e instanceof Error ? e.message : String(e)} for ${url}) and neither the scriptc cache nor the npm cache holds it, so ${name}@${version} cannot be verified`,
    };
  }
  const r = check(bytes, url);
  if (r.ok) await persist(addressed, r.bytes);
  return r;
}

async function persist(path: string, bytes: Buffer): Promise<void> {
  try {
    await mkdir(dirname(path), { recursive: true });
    const tmp = `${path}.${process.pid}.tmp`;
    await writeFile(tmp, bytes);
    await rename(tmp, path);
  } catch {
    /* A cache that cannot be written is not a verification failure. */
  }
}
