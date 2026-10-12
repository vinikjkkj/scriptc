/* --provenance-sources reaching a package that publishes NO PROVENANCE
 * ATTESTATION AT ALL.
 *
 * This is not a gap in the compiler. Of mysql2@3.24.5's installed
 * dependencies, `iconv-lite`, `long` and `generate-function` each answer HTTP
 * 404 on /-/npm/v1/attestations/<pkg>@<version> while mysql2 itself and four
 * siblings return an SLSA predicate (re-verified live 2026-10-12). With no
 * attested tree to fetch there is nothing for the mapper to walk, so the
 * mapping is never reached and each one refuses as `the '<pkg>' module is not
 * supported yet`. It is a property of how those packages are PUBLISHED.
 *
 * SCRIPTC_PROVENANCE_UNATTESTED is the decision to compile such a package's
 * INSTALLED TARBALL as if it were its source. The whole rest of the provenance
 * pipeline exists in order NOT to do that, so what this file covers is not
 * "does the mapping work" -- it is the four ways the arm could LIE:
 *
 *   1. it could fire without being asked            (the default case)
 *   2. it could claim a compile that did not happen (the unmappable case)
 *   3. it could treat an attestation it merely FAILED TO USE as an absent one
 *                                                   (the non-404 cases)
 *   4. it could admit a package whose attestation EXISTS but whose attested
 *      source could not be followed -- the exact door the design closes
 *
 * The 205 suites that existed before this file had ZERO power over any of
 * them: nothing in the tree passes --provenance-sources outside these fixture
 * tests, and nothing anywhere set the variable.
 *
 * The registry is stubbed, never called. Every provenance test in this tree is
 * offline behind a fixture manifest; this arm's admitting condition is an HTTP
 * STATUS, so a stub is the only way to state a status as a test input. The
 * stub is also the point: with no stub and no network the probe returns false
 * and the arm declines -- UNAVAILABLE IS NOT ABSENT -- which is itself one of
 * the tests below.
 */
import { execFile } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, test } from "vitest";
import { analyze, compile, resolveProvenanceSources, setProvenanceSources } from "@scriptc/compiler";

const execFileAsync = promisify(execFile);
const repoRoot = join(import.meta.dirname, "../..");
const fixtureDir = join(repoRoot, "tests/fixtures/provenance");
const entry = join(fixtureDir, "cases/unattested/main.ts");
const bareEntry = join(fixtureDir, "cases/unattested/bare.ts");
const flavor = process.env["SCRIPTC_SAN"] === "1" ? "san" : "plain";
const outDir = join(repoRoot, "node_modules/.cache/scriptc-tests/provenance-unattested", flavor);

const EXPECTED = "limit=7\ntag=unattested-ok\n";

/* A well-formed npm attestation set: an SLSA predicate naming a repo and a
 * commit. Used only to say "this package DOES publish one" -- what the
 * attested path then does with it is the second half of that test. */
function attestationBody(repo: string, commit: string): unknown {
  const statement = {
    predicate: {
      buildDefinition: { resolvedDependencies: [{ uri: repo, digest: { gitCommit: commit } }] },
    },
  };
  return {
    attestations: [
      {
        predicateType: "https://slsa.dev/provenance/v1",
        bundle: {
          dsseEnvelope: {
            payload: Buffer.from(JSON.stringify(statement), "utf8").toString("base64"),
          },
        },
      },
    ],
  };
}

/** Every URL the stub was asked for, so a test that asserts on a REFUSAL can
 * prove the probe actually ran rather than that nothing happened. */
let calls: string[] = [];

/** Replace global fetch for one test. `attStatus` is the status an
 * attestations URL answers with; anything else is a codeload source fetch,
 * answered with `sourceStatus`. */
function stubFetch(
  attStatus: number,
  opts: { body?: unknown; sourceStatus?: number; throwOnAttestation?: boolean } = {},
): void {
  calls = [];
  (globalThis as unknown as { fetch: unknown }).fetch = async (input: unknown): Promise<unknown> => {
    const url = String(input);
    calls.push(url);
    if (url.includes("/-/npm/v1/attestations/")) {
      if (opts.throwOnAttestation === true) throw new Error("stub: the network is down");
      return {
        status: attStatus,
        ok: attStatus >= 200 && attStatus < 300,
        json: async () => opts.body ?? {},
      };
    }
    const s = opts.sourceStatus ?? 500;
    return { status: s, ok: s >= 200 && s < 300, arrayBuffer: async () => new ArrayBuffer(0) };
  };
}

async function buildAndRun(name: string): Promise<string> {
  mkdirSync(outDir, { recursive: true });
  /* Windows cannot CreateProcess an extension-less file. */
  const outPath = join(outDir, process.platform === "win32" ? `${name}.exe` : name);
  /* Pinned to the C lane for the reason the sibling provenance suites pin it:
   * the comparison is about provenance, never about which backend it drew. */
  const result = await compile(entry, { outPath, outDir, dynamic: false, backend: "c" });
  if (!result.ok) {
    throw new Error(result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"));
  }
  const { stdout } = await execFileAsync(outPath, [], { encoding: "utf8" });
  return stdout;
}

/* SAVED, not deleted: all three variables and global fetch are process-global
 * and this file shares a worker with the rest of the suite. */
const REAL_FETCH = globalThis.fetch;
const PRIOR = {
  manifest: process.env["SCRIPTC_PROVENANCE_MANIFEST"],
  authored: process.env["SCRIPTC_PROVENANCE_AUTHORED_JS"],
  unattested: process.env["SCRIPTC_PROVENANCE_UNATTESTED"],
};
const restore = (k: string, v: string | undefined): void => {
  if (v === undefined) delete process.env[k];
  else process.env[k] = v;
};

afterEach(() => {
  setProvenanceSources(null);
  globalThis.fetch = REAL_FETCH;
  restore("SCRIPTC_PROVENANCE_MANIFEST", PRIOR.manifest);
  restore("SCRIPTC_PROVENANCE_AUTHORED_JS", PRIOR.authored);
  restore("SCRIPTC_PROVENANCE_UNATTESTED", PRIOR.unattested);
});

/** The arm reads a package's own tarball, so the authored-JavaScript mapping
 * has to admit it too: the two gates are independent and both are opt-in. */
function arm(unattested: string | undefined): void {
  delete process.env["SCRIPTC_PROVENANCE_MANIFEST"];
  process.env["SCRIPTC_PROVENANCE_AUTHORED_JS"] = "unattlocal,unattbare";
  if (unattested === undefined) delete process.env["SCRIPTC_PROVENANCE_UNATTESTED"];
  else process.env["SCRIPTC_PROVENANCE_UNATTESTED"] = unattested;
}

describe("provenance: a package that publishes no attestation", () => {
  test("DEFAULT: with the variable unset a 404 package keeps today's refusal", async () => {
    arm(undefined);
    stubFetch(404);
    const sources = await resolveProvenanceSources(entry);
    expect(sources.packages).toHaveLength(0);
    expect(sources.notes.join("\n")).toContain("no provenance attestation published");
    /* Nothing about the arm appears anywhere in the output. */
    expect(sources.notes.join("\n")).not.toContain("UNATTESTED");
    expect(sources.notes.join("\n")).not.toContain("local://");
    setProvenanceSources(sources);
    /* And the program still refuses the package, exactly as it does today:
     * SC2013, the flagless build's answer to a value that would need the
     * embedded dynamic engine. Asserted as a non-empty blocker set naming the
     * package, not as a count -- the point is that the default did not move. */
    const { coverage } = analyze(entry);
    expect(coverage.diagnostics.length).toBeGreaterThan(0);
    expect(coverage.diagnostics.map((d) => d.code)).toContain("SC2013");
  });

  test("NAMED and absent: the tarball maps, and it says local:// and unattested", async () => {
    arm("unattlocal");
    stubFetch(404);
    const sources = await resolveProvenanceSources(entry);
    expect(sources.packages).toHaveLength(1);
    const pkg = sources.packages[0]!;
    expect(pkg.name).toBe("unattlocal");
    expect(pkg.version).toBe("1.4.2");
    /* The two fields the build's one line per mapped package is built from. A
     * reader of that line must not be able to mistake it for an attestation,
     * and these are the only two places it could. */
    expect(pkg.repo.startsWith("local://")).toBe(true);
    expect(pkg.repo).toContain("node_modules/unattlocal");
    expect(pkg.commit).toBe("unattested");
    /* The mapped entry is the package's own installed file, not a checkout. */
    expect(pkg.entries["unattlocal"]!.split("\\").join("/")).toMatch(
      /node_modules\/unattlocal\/index\.d\.ts$/,
    );
    const notes = sources.notes.join("\n");
    expect(notes).toContain("UNATTESTED");
    expect(notes).toContain("INSTALLED TARBALL");
    /* It is not a FETCH failure and must not be reported as one. */
    expect(sources.unfetched ?? []).not.toContain("unattlocal");
    setProvenanceSources(sources);
    expect(analyze(entry).coverage.diagnostics).toStrictEqual([]);
  });

  test("the mapped body really is in the binary, not a body-less edge", async () => {
    arm("unattlocal");
    stubFetch(404);
    setProvenanceSources(await resolveProvenanceSources(entry));
    /* The load-bearing assertion of this file. A declaration can map while its
     * implementation never joins the program, and that shape does not refuse
     * -- it prints a wrong number. Both values below live only in the
     * tarball's index.js, so the binary agreeing with it is the only evidence
     * that the bytes this arm admitted were actually compiled. */
    expect(await buildAndRun("unattested-local")).toBe(EXPECTED);
  });

  test("named but UNMAPPABLE: the refusal stands and no compile is claimed", async () => {
    arm("unattbare");
    stubFetch(404);
    const sources = await resolveProvenanceSources(bareEntry);
    expect(sources.packages).toHaveLength(0);
    const notes = sources.notes.join("\n");
    expect(notes).toContain("nothing in the installed tarball maps to a source entry");
    expect(notes).toContain("NO unattested source was compiled");
    /* Being named bought a TRY. It must not have bought the sentence that says
     * a tarball was compiled. */
    expect(notes).not.toContain("compiles as its own source");
  });

  test("ATTESTED: a package that HAS an attestation is never admitted here", async () => {
    arm("unattlocal");
    /* The registry answers 200 with a real SLSA predicate, and the attested
     * source then fails to fetch. That is a failure to USE an attestation --
     * the shape a tampered or unverifiable one would also take -- and it has
     * to keep the refusal. If this arm admitted it, every honest check the
     * attested path makes could be bypassed by breaking it. */
    stubFetch(200, {
      body: attestationBody("git+https://github.com/example/unattlocal", "5".repeat(40)),
      sourceStatus: 500,
    });
    const sources = await resolveProvenanceSources(entry);
    expect(sources.packages).toHaveLength(0);
    const notes = sources.notes.join("\n");
    expect(notes).toContain("source fetch failed (HTTP 500 for https://codeload.github.com/");
    expect(notes).toContain("the registry does not answer 404 for its attestation");
    expect(notes).not.toContain("UNATTESTED --");
    expect(notes).not.toContain("local://");
    /* And the probe really ran: two attestation GETs, the pipeline's and the
     * arm's. A test that asserts a refusal must prove it was not vacuous. */
    expect(calls.filter((u) => u.includes("/-/npm/v1/attestations/"))).toHaveLength(2);
  });

  test("UNAVAILABLE is not ABSENT: a throwing probe declines", async () => {
    arm("unattlocal");
    stubFetch(0, { throwOnAttestation: true });
    const sources = await resolveProvenanceSources(entry);
    expect(sources.packages).toHaveLength(0);
    const notes = sources.notes.join("\n");
    expect(notes).toContain("the registry does not answer 404 for its attestation");
    expect(notes).not.toContain("UNATTESTED --");
  });

  test("a 500 is not a 404 either", async () => {
    arm("unattlocal");
    stubFetch(500);
    const sources = await resolveProvenanceSources(entry);
    expect(sources.packages).toHaveLength(0);
    expect(sources.notes.join("\n")).toContain(
      "the registry does not answer 404 for its attestation",
    );
    expect(sources.notes.join("\n")).not.toContain("UNATTESTED --");
  });

  test("a package the variable does not name is not admitted by one that is", async () => {
    /* unattbare is 404 and unmapped; naming only unattlocal must leave it
     * exactly as the attested path left it. The arm does not widen itself. */
    arm("unattlocal");
    stubFetch(404);
    const sources = await resolveProvenanceSources(bareEntry);
    expect(sources.packages).toHaveLength(0);
    expect(sources.notes.join("\n")).not.toContain("SCRIPTC_PROVENANCE_UNATTESTED names it");
  });
});
