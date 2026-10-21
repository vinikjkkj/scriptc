/* --provenance-sources reaching a package that publishes NO PROVENANCE
 * ATTESTATION, verified by the project's LOCKFILE INTEGRITY DIGEST.
 *
 * Of mysql2@3.24.5's dependencies, `iconv-lite`, `long` and `generate-function`
 * answer HTTP 404 on /-/npm/v1/attestations/<pkg>@<version>. With no attested
 * tree there is nothing to walk, so each used to refuse. The lockfile records
 * the SRI digest of every locked tarball; the arm under test obtains the
 * tarball, checks it against that digest, and compiles the files FROM THE
 * VERIFIED TARBALL (never the node_modules copy).
 *
 * What this file covers is not "does the mapping work" -- it is the ways the
 * arm could LIE:
 *
 *   1. compile bytes nobody verified               (mismatch, no digest, no entry)
 *   2. compile the node_modules copy, not the bytes that were verified
 *                                                  (the tampered-install test)
 *   3. acquire the right to compile when the registry merely FAILED to answer
 *      or answered 200                             (non-404 cases)
 *   4. claim a compile that did not happen         (the unmappable case)
 *
 * The registry is stubbed, never called: this arm's admitting condition is an
 * HTTP STATUS, and the bytes are served by URL from memory. Every project is a
 * fresh temp directory with its own lockfile and its own provenance cache, so
 * nothing leaks between tests, and a cache from an earlier test cannot hide a
 * verification.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, test } from "vitest";
import {
  analyze,
  compile,
  ProvenanceRefusalError,
  resolveProvenanceSources,
  setProvenanceSources,
} from "@scriptc/compiler";
import { extractVerifiedTarball, lookupNpmLock, lookupPnpmLock, parseSri } from "../../packages/compiler/src/frontend/provenance-lockfile.js";

const execFileAsync = promisify(execFile);
const repoRoot = join(import.meta.dirname, "../..");
const fixtureDir = join(repoRoot, "tests/fixtures/provenance");
const flavor = process.env["SCRIPTC_SAN"] === "1" ? "san" : "plain";
const outDir = join(repoRoot, "node_modules/.cache/scriptc-tests/provenance-unattested", flavor);

const EXPECTED = "limit=7\ntag=unattested-ok\n";

const sha512 = (b: Uint8Array): string => `sha512-${createHash("sha512").update(b).digest("base64")}`;


/* A minimal tar WRITER, so no test shells out to `tar` (GNU and Windows bsdtar
 * disagree about flags; the extractor under test does not use it either). */
interface TarEntry {
  name: string;
  data?: Buffer | string;
  type?: string; // '0' file, '5' dir, '2' symlink, '1' hardlink
  /** how a name longer than 100 bytes is carried */
  longName?: "gnu" | "pax";
}
function tarHeader(name: string, size: number, type: string): Buffer {
  const h = Buffer.alloc(512);
  h.write(name.slice(0, 100), 0, "utf8");
  h.write("0000644\0", 100);
  h.write("0000000\0", 108);
  h.write("0000000\0", 116);
  h.write(size.toString(8).padStart(11, "0") + "\0", 124);
  h.write("00000000000\0", 136);
  h.write("        ", 148);
  h.write(type, 156);
  h.write("ustar\0" + "00", 257);
  let sum = 0;
  for (const b of h) sum += b;
  h.write(sum.toString(8).padStart(6, "0") + "\0 ", 148);
  return h;
}
function pad(b: Buffer): Buffer {
  return Buffer.concat([b, Buffer.alloc((512 - (b.length % 512)) % 512)]);
}
function makeTgz(entries: readonly TarEntry[]): Buffer {
  const parts: Buffer[] = [];
  for (const e of entries) {
    const data = Buffer.from(e.data ?? "");
    const type = e.type ?? "0";
    if (Buffer.byteLength(e.name) > 100 && e.longName === "pax") {
      const rec = ` path=${e.name}\n`;
      let len = rec.length + 1;
      while (String(len).length + rec.length !== len) len = String(len).length + rec.length;
      const px = Buffer.from(`${len}${rec}`);
      parts.push(tarHeader("PaxHeader", px.length, "x"), pad(px));
    } else if (Buffer.byteLength(e.name) > 100) {
      const ln = Buffer.from(e.name + "\0");
      parts.push(tarHeader("././@LongLink", ln.length, "L"), pad(ln));
    }
    parts.push(tarHeader(e.name, type === "0" ? data.length : 0, type), pad(type === "0" ? data : Buffer.alloc(0)));
  }
  parts.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(parts));
}
function listTree(dir: string, base = ""): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    const r = base === "" ? n : `${base}/${n}`;
    return statSync(p).isDirectory() ? listTree(p, r) : [r];
  }).sort();
}

/** Every URL the stub was asked for. */
let calls: string[] = [];
/** url -> bytes served. */
let served = new Map<string, Buffer>();

function stubFetch(attStatus: number, opts: { throwOnTarball?: boolean; throwOnAttestation?: boolean; body?: unknown } = {}): void {
  calls = [];
  (globalThis as unknown as { fetch: unknown }).fetch = async (input: unknown): Promise<unknown> => {
    const url = String(input);
    calls.push(url);
    if (url.includes("/-/npm/v1/attestations/")) {
      if (opts.throwOnAttestation === true) throw new Error("stub: the network is down");
      return { status: attStatus, ok: attStatus >= 200 && attStatus < 300, json: async () => opts.body ?? {} };
    }
    if (opts.throwOnTarball === true) throw new Error("stub: the network is down");
    const bytes = served.get(url);
    if (bytes === undefined) return { status: 404, ok: false, arrayBuffer: async () => new ArrayBuffer(0) };
    return {
      status: 200,
      ok: true,
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    };
  };
}

function attestationBody(repo: string, commit: string): unknown {
  const statement = { predicate: { buildDefinition: { resolvedDependencies: [{ uri: repo, digest: { gitCommit: commit } }] } } };
  return {
    attestations: [
      {
        predicateType: "https://slsa.dev/provenance/v1",
        bundle: { dsseEnvelope: { payload: Buffer.from(JSON.stringify(statement), "utf8").toString("base64") } },
      },
    ],
  };
}

const REAL_FETCH = globalThis.fetch;
const PRIOR = {
  manifest: process.env["SCRIPTC_PROVENANCE_MANIFEST"],
  cache: process.env["SCRIPTC_PROVENANCE_CACHE"],
  npmCache: process.env["npm_config_cache"],
};
const restore = (k: string, v: string | undefined): void => {
  if (v === undefined) delete process.env[k];
  else process.env[k] = v;
};
afterEach(() => {
  setProvenanceSources(null);
  globalThis.fetch = REAL_FETCH;
  restore("SCRIPTC_PROVENANCE_MANIFEST", PRIOR.manifest);
  restore("SCRIPTC_PROVENANCE_CACHE", PRIOR.cache);
  restore("npm_config_cache", PRIOR.npmCache);
});

interface Project {
  dir: string;
  entry: string;
  /** package name -> SRI of the PRISTINE tarball made from the fixture. */
  integrity: Record<string, string>;
  cache: string;
}

type LockKind = "pnpm" | "npm" | "pnpm-no-integrity" | "pnpm-other-package" | "none" | "pnpm-wrong-digest";

/** A project: the entry copied from a fixture case, each named package
 * installed (copied from the fixture node_modules), a REAL tarball made from
 * the pristine package, served by URL, and a lockfile of the given kind. */
async function makeProject(
  caseFile: string,
  pkgs: readonly string[],
  lock: LockKind,
  opts: {
    installed?: Record<string, Record<string, string>>;
    /** Install pnpm-style: each package under node_modules/.pnpm/<n>@<v>/node_modules/<n>,
     * siblings of each other, and ONLY `top` linked into node_modules. */
    pnpmTop?: readonly string[];
  } = {},
): Promise<Project> {
  mkdirSync(tmpdir(), { recursive: true });
  const dir = mkdtempSync(join(tmpdir(), "scr-unatt-"));
  const entry = join(dir, "main.ts");
  writeFileSync(entry, readFileSync(join(fixtureDir, "cases", caseFile), "utf8"));
  const cache = join(dir, "prov-cache");
  mkdirSync(cache);
  process.env["SCRIPTC_PROVENANCE_CACHE"] = cache;
  process.env["npm_config_cache"] = join(dir, "npm-cache");
  served = new Map();
  const integrity: Record<string, string> = {};
  const versions: Record<string, string> = {};
  for (const name of pkgs) {
    const src = join(fixtureDir, "node_modules", name);
    const entries: TarEntry[] = [];
    const walk = (d: string, rel: string): void => {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        const r = `${rel}/${n}`;
        if (statSync(p).isDirectory()) walk(p, r);
        else entries.push({ name: r, data: readFileSync(p) });
      }
    };
    walk(src, "package");
    const bytes = makeTgz(entries);
    integrity[name] = sha512(bytes);
    versions[name] = (JSON.parse(readFileSync(join(src, "package.json"), "utf8")) as { version: string }).version;
    served.set(`https://registry.npmjs.org/${name}/-/${name}-${versions[name]}.tgz`, bytes);
    const installedDir =
      opts.pnpmTop === undefined
        ? join(dir, "node_modules", name)
        : join(dir, "node_modules", ".pnpm", `${name}@${versions[name]}`, "node_modules", name);
    cpSync(src, installedDir, { recursive: true });
    if (opts.pnpmTop?.includes(name) === true) {
      /* A junction needs no privilege on Windows, where a symlink does. */
      symlinkSync(installedDir, join(dir, "node_modules", name), "junction");
    }
    for (const [file, text] of Object.entries(opts.installed?.[name] ?? {})) writeFileSync(join(installedDir, file), text);
  }
  if (opts.pnpmTop !== undefined) {
    /* pnpm links each package's dependencies beside it in its own virtual
     * store directory; model that for every pair so any host sees the rest. */
    for (const host of pkgs) {
      for (const dep of pkgs) {
        if (dep === host) continue;
        const target = join(dir, "node_modules", ".pnpm", `${dep}@${versions[dep]}`, "node_modules", dep);
        symlinkSync(target, join(dir, "node_modules", ".pnpm", `${host}@${versions[host]}`, "node_modules", dep), "junction");
      }
    }
  }
  const digestOf = (n: string): string => (lock === "pnpm-wrong-digest" ? sha512(Buffer.from("not the tarball")) : integrity[n]!);
  if (lock === "pnpm" || lock === "pnpm-wrong-digest" || lock === "pnpm-no-integrity" || lock === "pnpm-other-package") {
    const entries = pkgs
      .map((n) => {
        const key = lock === "pnpm-other-package" ? `some-other-package@1.0.0` : `${n}@${versions[n]}`;
        const res = lock === "pnpm-no-integrity" ? `{tarball: https://example.invalid/${n}.tgz}` : `{integrity: ${digestOf(n)}}`;
        return `  ${key}:\n    resolution: ${res}\n`;
      })
      .join("\n");
    writeFileSync(join(dir, "pnpm-lock.yaml"), `lockfileVersion: '9.0'\n\npackages:\n\n${entries}\nsnapshots:\n\n  x@1: {}\n`);
  } else if (lock === "npm") {
    const packages: Record<string, unknown> = { "": { name: "p", version: "1.0.0" } };
    for (const n of pkgs) packages[`node_modules/${n}`] = { version: versions[n], integrity: integrity[n] };
    writeFileSync(join(dir, "package-lock.json"), JSON.stringify({ lockfileVersion: 3, packages }));
  }
  return { dir, entry, integrity, cache };
}

async function refusalOf(p: Promise<unknown>): Promise<ProvenanceRefusalError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ProvenanceRefusalError) return e;
    throw e;
  }
  throw new Error("expected a ProvenanceRefusalError, but resolution succeeded");
}

async function buildAndRun(entry: string, name: string): Promise<string> {
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, process.platform === "win32" ? `${name}.exe` : name);
  /* Pinned to the C lane for the reason the sibling provenance suites pin it. */
  const result = await compile(entry, { outPath, outDir, dynamic: false, backend: "c" });
  if (!result.ok) throw new Error(result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"));
  const { stdout } = await execFileAsync(outPath, [], { encoding: "utf8" });
  return stdout;
}

/** These tests resolve through a fixture project, never a manifest. */
const noManifest = (): void => {
  delete process.env["SCRIPTC_PROVENANCE_MANIFEST"];
};

describe("provenance: a package that publishes no attestation, verified by the lockfile", () => {
  test("MATCH: the tarball verifies, maps from the VERIFIED bytes, and says npm-tarball://", async () => {
    noManifest();
    const p = await makeProject("unattested/main.ts", ["unattlocal"], "pnpm");
    stubFetch(404);
    const sources = await resolveProvenanceSources(p.entry);
    expect(sources.packages).toHaveLength(1);
    const pkg = sources.packages[0]!;
    expect(pkg.name).toBe("unattlocal");
    expect(pkg.version).toBe("1.4.2");
    expect(pkg.repo).toBe("npm-tarball://unattlocal@1.4.2");
    /* The commit IS the verified digest, in hex, and the tree is addressed by it. */
    const sri = parseSri(p.integrity["unattlocal"]!)!;
    expect(pkg.commit).toBe(`sha512-${sri.hex}`);
    /* The compiled files sit in the scriptc cache, NOT under node_modules. */
    const entryPath = pkg.entries["unattlocal"]!.split("\\").join("/");
    expect(entryPath).toContain(`/prov-cache/npm-trees/sha512-${sri.hex}/index.d.ts`);
    expect(entryPath).not.toContain("/node_modules/");
    const notes = sources.notes.join("\n");
    expect(notes).toContain("unattlocal@1.4.2: UNATTESTED");
    expect(notes).toContain("pnpm-lock.yaml");
    expect(notes).toContain("not from node_modules");
    expect(calls.some((u) => u === "https://registry.npmjs.org/unattlocal/-/unattlocal-1.4.2.tgz")).toBe(true);
    expect(sources.unfetched ?? []).not.toContain("unattlocal");
    setProvenanceSources(sources);
    expect(analyze(p.entry).coverage.diagnostics).toStrictEqual([]);
  });

  test("the binary runs the VERIFIED bytes, not a tampered node_modules copy", async () => {
    noManifest();
    /* The installed copy was edited after install. The lockfile digest is of
     * the ORIGINAL tarball. The binary must print the tarball's values. */
    const tampered = {
      "index.js": "'use strict'\nconst WIRE_LIMIT = 99\nconst TAG = 'tampered-install'\nmodule.exports = { WIRE_LIMIT, TAG }\n",
    };
    const p = await makeProject("unattested/main.ts", ["unattlocal"], "pnpm", { installed: { unattlocal: tampered } });
    /* Positive control: the tamper really landed in node_modules. */
    expect(readFileSync(join(p.dir, "node_modules/unattlocal/index.js"), "utf8")).toContain("tampered-install");
    stubFetch(404);
    setProvenanceSources(await resolveProvenanceSources(p.entry));
    const out = await buildAndRun(p.entry, "unattested-verified");
    expect(out).toBe(EXPECTED);
    expect(out).not.toContain("tampered-install");
  });

  test("package-lock.json is a lockfile too", async () => {
    noManifest();
    const p = await makeProject("unattested/main.ts", ["unattlocal"], "npm");
    stubFetch(404);
    const sources = await resolveProvenanceSources(p.entry);
    expect(sources.packages.map((x) => x.name)).toEqual(["unattlocal"]);
    expect(sources.notes.join("\n")).toContain("package-lock.json");
  });

  test("a warm cache needs no network: the tarball is read from the scriptc cache and re-verified", async () => {
    noManifest();
    const p = await makeProject("unattested/main.ts", ["unattlocal"], "pnpm");
    stubFetch(404);
    await resolveProvenanceSources(p.entry);
    /* Second run, tarball URL now unreachable: the cached bytes serve it. */
    stubFetch(404, { throwOnTarball: true });
    served = new Map();
    const sources = await resolveProvenanceSources(p.entry);
    expect(sources.packages.map((x) => x.name)).toEqual(["unattlocal"]);
    expect(calls.filter((u) => u.endsWith(".tgz"))).toHaveLength(0);
  });

  test("MISMATCH: bytes that do not hash to the locked digest are refused at build time", async () => {
    noManifest();
    const p = await makeProject("unattested/main.ts", ["unattlocal"], "pnpm-wrong-digest");
    stubFetch(404);
    const err = await refusalOf(resolveProvenanceSources(p.entry));
    expect(err.refusals).toHaveLength(1);
    expect(err.refusals[0]!.package).toBe("unattlocal");
    expect(err.refusals[0]!.version).toBe("1.4.2");
    expect(err.refusals[0]!.reason).toContain("INTEGRITY MISMATCH");
    expect(err.message).toContain("provenance: refused unattlocal@1.4.2");
    /* The refused bytes must not have been cached or extracted. */
    expect(() => readFileSync(join(p.cache, "npm-trees"))).toThrow();
  });

  test("MISMATCH in the CACHE is refused too, not papered over by a refetch", async () => {
    noManifest();
    const p = await makeProject("unattested/main.ts", ["unattlocal"], "pnpm");
    const sri = parseSri(p.integrity["unattlocal"]!)!;
    mkdirSync(join(p.cache, "npm-tarballs"), { recursive: true });
    writeFileSync(join(p.cache, "npm-tarballs", `sha512-${sri.hex}.tgz`), "corrupted");
    stubFetch(404);
    const err = await refusalOf(resolveProvenanceSources(p.entry));
    expect(err.refusals[0]!.reason).toContain("INTEGRITY MISMATCH");
    expect(calls.filter((u) => u.endsWith(".tgz"))).toHaveLength(0);
  });

  test("verified but UNMAPPABLE: the refusal is put back and no compile is claimed", async () => {
    noManifest();
    const p = await makeProject("unattested/distonly.ts", ["distjs"], "pnpm");
    stubFetch(404);
    const sources = await resolveProvenanceSources(p.entry);
    expect(sources.packages).toHaveLength(0);
    const notes = sources.notes.join("\n");
    expect(notes).toContain("nothing in it maps to a source entry");
    expect(notes).toContain("NO unattested source was compiled");
    expect(notes).not.toContain("UNATTESTED --");
    /* The tarball WAS fetched and verified: this is not a refusal of the build. */
    expect(calls.some((u) => u.endsWith("distjs-1.1.0.tgz"))).toBe(true);
  });

  test("NO ENTRY for the package in the lockfile: refused, naming the package", async () => {
    noManifest();
    const p = await makeProject("unattested/main.ts", ["unattlocal"], "pnpm-other-package");
    stubFetch(404);
    const err = await refusalOf(resolveProvenanceSources(p.entry));
    expect(err.refusals[0]!.package).toBe("unattlocal");
    expect(err.refusals[0]!.reason).toContain("no entry for unattlocal@1.4.2");
    expect(calls.filter((u) => u.endsWith(".tgz"))).toHaveLength(0);
  });

  test("NO INTEGRITY digest (a tarball-URL dependency): refused", async () => {
    noManifest();
    const p = await makeProject("unattested/main.ts", ["unattlocal"], "pnpm-no-integrity");
    stubFetch(404);
    const err = await refusalOf(resolveProvenanceSources(p.entry));
    expect(err.refusals[0]!.reason).toContain("no integrity digest");
    expect(calls.filter((u) => u.endsWith(".tgz"))).toHaveLength(0);
  });

  test("NO LOCKFILE at or above the entry: refused", async () => {
    noManifest();
    const p = await makeProject("unattested/main.ts", ["unattlocal"], "none");
    stubFetch(404);
    const err = await refusalOf(resolveProvenanceSources(p.entry));
    /* The temp dir has no lockfile, but a directory ABOVE it might (a repo
     * checkout). Either wording is the same refusal; the package is named. */
    expect(err.refusals[0]!.package).toBe("unattlocal");
    expect(err.refusals[0]!.reason).toMatch(/no pnpm-lock\.yaml|no entry for unattlocal@1\.4\.2/);
  });

  test("OFFLINE with no cache: refused, not silently islanded", async () => {
    noManifest();
    const p = await makeProject("unattested/main.ts", ["unattlocal"], "pnpm");
    stubFetch(404, { throwOnTarball: true });
    const err = await refusalOf(resolveProvenanceSources(p.entry));
    expect(err.refusals[0]!.reason).toContain("could not be fetched");
    expect(err.refusals[0]!.reason).toContain("cannot be verified");
  });

  test("ATTESTED (HTTP 200) is never routed to the tarball arm", async () => {
    noManifest();
    const p = await makeProject("unattested/main.ts", ["unattlocal"], "pnpm");
    stubFetch(200, { body: attestationBody("git+https://github.com/example/unattlocal", "5".repeat(40)) });
    const sources = await resolveProvenanceSources(p.entry);
    expect(sources.packages).toHaveLength(0);
    const notes = sources.notes.join("\n");
    expect(notes).toContain("island path used");
    expect(notes).not.toContain("UNATTESTED");
    expect(calls.filter((u) => u.endsWith(".tgz"))).toHaveLength(0);
  });

  test("UNAVAILABLE is not ABSENT: a throwing attestation probe islands, it does not refuse or verify", async () => {
    noManifest();
    const p = await makeProject("unattested/main.ts", ["unattlocal"], "pnpm");
    stubFetch(0, { throwOnAttestation: true });
    const sources = await resolveProvenanceSources(p.entry);
    expect(sources.packages).toHaveLength(0);
    expect(sources.notes.join("\n")).toContain("island path used");
    expect(calls.filter((u) => u.endsWith(".tgz"))).toHaveLength(0);
  });

  test("a 500 from the attestation endpoint is not a 404", async () => {
    noManifest();
    const p = await makeProject("unattested/main.ts", ["unattlocal"], "pnpm");
    stubFetch(500);
    const sources = await resolveProvenanceSources(p.entry);
    expect(sources.packages).toHaveLength(0);
    expect(calls.filter((u) => u.endsWith(".tgz"))).toHaveLength(0);
  });
});

describe("provenance: an unattested package reached as a mapped package's dependency", () => {
  const depManifest = join(fixtureDir, "manifest-unattdep.json");

  test("a verified dependency two edges from the entry is mapped; a mismatched one refuses the build", async () => {
    process.env["SCRIPTC_PROVENANCE_MANIFEST"] = depManifest;
    const p = await makeProject("unattesteddep/main.ts", ["unattmid", "unattleaf"], "pnpm");
    process.env["SCRIPTC_PROVENANCE_MANIFEST"] = depManifest;
    /* Nothing in the entry or the manifest names the leaf: it arrives only
     * through the mapped host's own require(). */
    expect(readFileSync(p.entry, "utf8")).not.toContain("unattleaf");
    expect(readFileSync(depManifest, "utf8")).not.toContain("unattleaf");
    stubFetch(404);
    const sources = await resolveProvenanceSources(p.entry);
    const byName = new Map(sources.packages.map((x) => [x.name, x]));
    expect([...byName.keys()].sort()).toEqual(["unattleaf", "unattmid"]);
    expect(byName.get("unattleaf")!.repo).toBe("npm-tarball://unattleaf@0.3.4");
    expect(sources.notes.join("\n")).toContain("unattleaf@0.3.4: UNATTESTED");

    /* Inverted arm: same project, the leaf's lockfile digest is wrong. */
    const bad = await makeProject("unattesteddep/main.ts", ["unattmid", "unattleaf"], "pnpm");
    const lock = join(bad.dir, "pnpm-lock.yaml");
    writeFileSync(
      lock,
      readFileSync(lock, "utf8").replace(bad.integrity["unattleaf"]!, sha512(Buffer.from("something else"))),
    );
    process.env["SCRIPTC_PROVENANCE_MANIFEST"] = depManifest;
    stubFetch(404);
    const err = await refusalOf(resolveProvenanceSources(bad.entry));
    expect(err.refusals.map((r) => r.package)).toContain("unattleaf");
    expect(err.refusals[0]!.reason).toContain("INTEGRITY MISMATCH");
  });
});

describe("provenance: the lane's ceiling for a verified dependency", () => {
  test("the mapping lands, the VALUE still does not cross (refused at build time)", async () => {
    /* Pinned deliberately: reading a value off a mapped dependency of a mapped
     * authored-JS package is REFUSED at build time. That
     * ceiling belongs to the authored lane, not to this arm, and pinning it
     * stops "the blocker went away" being read as "the value arrived". */
    const depManifest = join(fixtureDir, "manifest-unattdep.json");
    const p = await makeProject("unattesteddep/main.ts", ["unattmid", "unattleaf"], "pnpm");
    process.env["SCRIPTC_PROVENANCE_MANIFEST"] = depManifest;
    stubFetch(404);
    setProvenanceSources(await resolveProvenanceSources(p.entry));
    const refusals = analyze(p.entry).coverage.diagnostics.map((d) => `${d.code}: ${d.message}`);
    expect(refusals.length).toBeGreaterThan(0);
    /* The host's require() of the leaf is a CommonJS default import of the
     * mapped dependency; the refusal names the binding ('leaf'). */
    expect(refusals.join("\n")).toMatch(/SC1013: the default import of a CommonJS module as a value \(esModuleInterop types 'leaf'/);
  });
});

describe("in-process tarball extraction (no tar child process)", () => {
  const tmp = (): string => mkdtempSync(join(tmpdir(), "scr-untar-"));

  test("extracts files and directories, strips the leading component, handles a GNU long name and a pax path", async () => {
    const long = "package/" + "d".repeat(60) + "/" + "f".repeat(60) + ".js";
    const long2 = "package/" + "p".repeat(70) + "/" + "q".repeat(70) + ".js";
    const dest = join(tmp(), "out");
    await extractVerifiedTarball(
      makeTgz([
        { name: "package/", type: "5" },
        { name: "package/package.json", data: "{}" },
        { name: "package/lib/", type: "5" },
        { name: "package/lib/a.js", data: "a" },
        { name: long, data: "gnu", longName: "gnu" },
        { name: long2, data: "pax", longName: "pax" },
      ]),
      dest,
    );
    expect(listTree(dest)).toEqual(
      ["lib/a.js", "package.json", long.slice("package/".length), long2.slice("package/".length)].sort(),
    );
    expect(readFileSync(join(dest, long.slice(8)), "utf8")).toBe("gnu");
    expect(readFileSync(join(dest, long2.slice(8)), "utf8")).toBe("pax");
  });

  test("a '..' entry is refused naming the entry, and nothing is written", async () => {
    const root = tmp();
    const dest = join(root, "out");
    await expect(
      extractVerifiedTarball(makeTgz([{ name: "package/ok.js", data: "x" }, { name: "package/../../evil.js", data: "x" }]), dest),
    ).rejects.toThrow(/tarball entry "package\/\.\.\/\.\.\/evil\.js" escapes/);
    expect(existsSync(dest)).toBe(false);
    expect(existsSync(join(root, "evil.js"))).toBe(false);
    /* Positive control: the same archive without the bad entry extracts. */
    await extractVerifiedTarball(makeTgz([{ name: "package/ok.js", data: "x" }]), dest);
    expect(listTree(dest)).toEqual(["ok.js"]);
  });

  test("absolute paths, symlinks and hard links are refused", async () => {
    const d = (): string => join(tmp(), "out");
    await expect(extractVerifiedTarball(makeTgz([{ name: "/etc/x", data: "x" }]), d())).rejects.toThrow(/absolute/);
    await expect(extractVerifiedTarball(makeTgz([{ name: "package/l", type: "2" }]), d())).rejects.toThrow(/symlink/);
    await expect(extractVerifiedTarball(makeTgz([{ name: "package/h", type: "1" }]), d())).rejects.toThrow(/hard link/);
  });

  test("a malicious entry in a lockfile-verified tarball REFUSES the build, naming the package and the entry", async () => {
    noManifest();
    const p = await makeProject("unattested/main.ts", ["unattlocal"], "pnpm");
    const evil = makeTgz([
      { name: "package/package.json", data: '{"name":"unattlocal","version":"1.4.2"}' },
      { name: "package/../escape.js", data: "x" },
    ]);
    /* The lockfile vouches for the evil bytes, so verification passes and the
     * extractor is the only thing standing in the way. */
    const url = "https://registry.npmjs.org/unattlocal/-/unattlocal-1.4.2.tgz";
    const lock = join(p.dir, "pnpm-lock.yaml");
    writeFileSync(lock, readFileSync(lock, "utf8").replace(p.integrity["unattlocal"]!, sha512(evil)));
    stubFetch(404);
    served.set(url, evil);
    const err = await refusalOf(resolveProvenanceSources(p.entry));
    expect(err.refusals[0]!.package).toBe("unattlocal");
    expect(err.refusals[0]!.reason).toContain('tarball entry "package/../escape.js" escapes');
  });
});

describe("provenance: transitive packages resolve from the REQUIRER, as Node does", () => {
  const depManifest = join(fixtureDir, "manifest-unattdep.json");

  test("under a pnpm layout a dependency that only the host's own node_modules can see is found and verified", async () => {
    process.env["SCRIPTC_PROVENANCE_MANIFEST"] = depManifest;
    /* unattmid is linked into node_modules; unattleaf is NOT. It sits beside
     * unattmid in the virtual store, which is where Node finds it. */
    const p = await makeProject("unattesteddep/main.ts", ["unattmid", "unattleaf"], "pnpm", { pnpmTop: ["unattmid"] });
    process.env["SCRIPTC_PROVENANCE_MANIFEST"] = depManifest;
    /* Positive control: from the entry's own node_modules the leaf is invisible. */
    expect(() => readFileSync(join(p.dir, "node_modules", "unattleaf", "package.json"))).toThrow();
    stubFetch(404);
    const sources = await resolveProvenanceSources(p.entry);
    expect(sources.packages.map((x) => x.name).sort()).toEqual(["unattleaf", "unattmid"]);
    expect(sources.notes.join("\n")).not.toContain("unattleaf: not installed");
  });
});

describe("lockfile readers", () => {
  const DIGEST = "sha512-AAAA";
  const pnpm = (key: string, body = `    resolution: {integrity: ${DIGEST}}\n`): string =>
    `lockfileVersion: '9.0'\n\nimporters:\n\n  .:\n    dependencies:\n      long:\n        version: 5.3.2\n\npackages:\n\n  ${key}:\n${body}\nsnapshots:\n\n  ${key}: {}\n`;

  test.each([
    ["v9 plain", "long@5.3.2"],
    ["v9 scoped quoted", "'@a/long@5.3.2'"],
    ["v6 slash+peer", "/long@5.3.2(peer@1.0.0)"],
    ["v5 slash version", "/long/5.3.2"],
    ["v5 peer suffix", "/long/5.3.2_peer@1"],
  ])("pnpm key style %s", (label, key) => {
    const name = label.includes("scoped") ? "@a/long" : "long";
    const hit = lookupPnpmLock(pnpm(key), name, "5.3.2");
    expect(hit).not.toBeNull();
    expect(hit).not.toBe("no-integrity");
    expect((hit as { integrity: string }).integrity).toBe(DIGEST);
  });

  test("pnpm: a different version, a different name and an importers-only mention all miss (negative controls)", () => {
    expect(lookupPnpmLock(pnpm("long@5.3.2"), "long", "5.3.3")).toBeNull();
    expect(lookupPnpmLock(pnpm("long@5.3.2"), "longer", "5.3.2")).toBeNull();
    expect(lookupPnpmLock(pnpm("other@1.0.0"), "long", "5.3.2")).toBeNull();
  });

  test("pnpm: an entry with no integrity says so, and a tarball URL is carried", () => {
    expect(lookupPnpmLock(pnpm("long@5.3.2", "    resolution: {tarball: https://x/y.tgz}\n"), "long", "5.3.2")).toBe("no-integrity");
    const hit = lookupPnpmLock(
      pnpm("long@5.3.2", `    resolution: {integrity: ${DIGEST}, tarball: https://x/y.tgz}\n`),
      "long",
      "5.3.2",
    ) as { tarball?: string };
    expect(hit.tarball).toBe("https://x/y.tgz");
  });

  test("npm: v3 packages, nested path, and v1 dependencies", () => {
    const v3 = { packages: { "node_modules/a/node_modules/long": { version: "5.3.2", integrity: DIGEST } } };
    expect((lookupNpmLock(v3, "long", "5.3.2", "node_modules/a/node_modules/long") as { integrity: string }).integrity).toBe(DIGEST);
    expect(lookupNpmLock(v3, "long", "5.3.3", "node_modules/a/node_modules/long")).toBeNull();
    const v1 = { dependencies: { a: { version: "1.0.0", dependencies: { long: { version: "5.3.2", integrity: DIGEST } } } } };
    expect((lookupNpmLock(v1, "long", "5.3.2", null) as { integrity: string }).integrity).toBe(DIGEST);
    expect(lookupNpmLock({ packages: { "node_modules/long": { version: "5.3.2" } } }, "long", "5.3.2", null)).toBe("no-integrity");
  });

  test("SRI: sha512 accepted, sha1 refused, strongest wins", () => {
    expect(parseSri("sha1-AAAA")).toBeNull();
    expect(parseSri("sha1-AAAA sha512-BBBB")!.algo).toBe("sha512");
    expect(parseSri("not an sri")).toBeNull();
  });
});
