/* The @roamhq/wrtc differential, against a COMMITTED Node oracle.
 *
 * scriptc implements @roamhq/wrtc natively by package name (the addon's core
 * is a native .node, so the built-in is allowed). Its C tier and its LLVM tier
 * each lower the same 28 libCalls, and until this file nothing in CI compiled
 * a wrtc program on either backend. The LLVM lowering landed with lab probes
 * only, so a regression in either emitter's wrtc path would pass CI unseen.
 *
 * Every probe under tests/fixtures/wrtc/probes/ is compiled on --backend c and
 * --backend llvm, run, and compared byte for byte (stdout, stderr, exit code)
 * with its expectation in tests/fixtures/wrtc/expected.json. That file holds
 * the output of node v24.15.0 running the same probe source with
 * @roamhq/wrtc 0.10.0 installed. The addon is NOT needed in CI: the compiled
 * binaries link the runtime's own transport (packages/runtime/src/scr_wrtc*.c),
 * not the npm package. Regenerate expected.json only from a Node run that
 * shows the same stdout across repeated runs (see its "oracle" header).
 *
 * Determinism is the reason a probe is or is not in the fixture: a probe that
 * prints an ICE/timing-dependent value is excluded there, with its reason
 * recorded in the header, rather than made to pass.
 *
 * SCRIPTC_SAN=1 rebuilds with ASan + the RC audit (the "san" flavor). */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { compile } from "@scriptc/compiler";
import { exeName } from "./exe.js";
import { holdScratch } from "./scratch-lease.mjs";

const repoRoot = join(import.meta.dirname, "../..");
const probesDir = join(repoRoot, "tests/fixtures/wrtc/probes");
const cacheDir = join(repoRoot, "node_modules/.cache/scriptc-tests");
const sanitize = process.env["SCRIPTC_SAN"] === "1";

interface Expectation {
  exitCode: number;
  stdout: string;
  stderr: string;
}

const fixture = JSON.parse(
  readFileSync(join(repoRoot, "tests/fixtures/wrtc/expected.json"), "utf8"),
) as { oracle: Record<string, string>; probes: Record<string, Expectation> };

const probeNames = Object.keys(fixture.probes).sort();
const backends = ["c", "llvm"] as const;

interface Run {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function runBinary(binary: string): Promise<Run> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, [], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`wrtc probe timed out\nstderr so far:\n${stderr}`));
    }, 60_000);
    child.stdout.on("data", (c: Buffer) => (stdout += c.toString("utf8")));
    child.stderr.on("data", (c: Buffer) => (stderr += c.toString("utf8")));
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (signal) reject(new Error(`wrtc probe died to ${signal}\nstderr:\n${stderr}`));
      else resolve({ stdout, stderr, exitCode: code ?? 0 });
    });
  });
}

async function buildOn(
  entry: string,
  backend: "c" | "llvm",
): Promise<{ ok: true; binary: string } | { ok: false; diags: string }> {
  const hash = createHash("sha256");
  hash.update(entry).update(readFileSync(entry));
  const key = hash.update(sanitize ? "san" : "plain").update(backend).digest("hex").slice(0, 16);
  // holdScratch publishes the lease that lets the sweep reclaim this run's
  // own finished scratch mid-run; the build and the run stay inside one test.
  const outDir = holdScratch(cacheDir, `wrtc-${key}`);
  const result = await compile(entry, {
    outPath: join(outDir, exeName("program")),
    outDir,
    sanitize,
    backend,
  });
  if (!result.ok) {
    return { ok: false, diags: result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n") };
  }
  return { ok: true, binary: result.binaryPath };
}

describe(`wrtc differential (${probeNames.length} probes x ${backends.length} backends${sanitize ? ", sanitized" : ""})`, () => {
  test("every probe in the directory has a committed oracle expectation", () => {
    const onDisk = readdirSync(probesDir)
      .filter((f) => f.endsWith(".ts"))
      .map((f) => f.slice(0, -".ts".length))
      .sort();
    expect(onDisk).toEqual(probeNames);
  });

  test.for(probeNames.flatMap((n) => backends.map((b) => [n, b] as const)))(
    "%s on --backend %s matches the Node oracle",
    async ([name, backend]) => {
      const built = await buildOn(join(probesDir, `${name}.ts`), backend);
      if (!built.ok) throw new Error(`wrtc probe ${name} failed to compile on ${backend}:\n${built.diags}`);
      const run = await runBinary(built.binary);
      const expected = fixture.probes[name]!;
      expect(run.stdout).toBe(expected.stdout);
      expect(run.stderr).toBe(expected.stderr);
      expect(run.exitCode).toBe(expected.exitCode);
    },
    300_000,
  );
});
