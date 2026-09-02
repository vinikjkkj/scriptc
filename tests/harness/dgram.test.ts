/* The dgram/dns differential — the server.test.ts harness verbatim over
 * tests/fixtures/dgram: fixtures run under Node AND compiled, three legs
 * compared byte-exactly (the fixture's stdout, its exit code, and the
 * per-case driver's stdout when one exists). Most cases are driver-less
 * SELF-CONTAINED loopback conversations (two sockets in one process —
 * bind 127.0.0.1:0, ephemeral ports never printed); udp-driver-echo
 * follows the PORT protocol with a real cross-process peer. dns-lookup
 * resolves only 'localhost' (hosts file) and a reserved .invalid name —
 * both lanes call the same getaddrinfo on the same machine, so no
 * external DNS dependency. SCRIPTC_SAN=1 rebuilds with ASan + the RC audit:
 * dgram handle hygiene runs over every case. */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, globSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { compile } from "@scriptc/compiler";
import { exeName } from "./exe.js";

const repoRoot = join(import.meta.dirname, "../..");
const fixturesRoot = join(repoRoot, "tests/fixtures/dgram");
const cacheDir = join(repoRoot, "node_modules/.cache/scriptc-tests");
const sanitize = process.env["SCRIPTC_SAN"] === "1";

interface ProgramRun {
  stdout: Buffer;
  exitCode: number;
  /** The driver's stdout, "" for driver-less cases. */
  driverStdout: string;
}

/** Runs one lane: spawn the fixture, follow the PORT protocol when the
 * case has a driver, and collect all three compared legs. */
function runLane(cmd: string, args: string[], driver: string | null): Promise<ProgramRun> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = [];
    let errText = "";
    let driverStarted = false;
    let driverStdout = "";
    let driverDone: Promise<void> = Promise.resolve();
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`dgram program timed out\nstderr so far:\n${errText}`));
    }, 60_000);
    child.stdout.on("data", (c: Buffer) => out.push(c));
    child.stderr.on("data", (c: Buffer) => {
      errText += c.toString("utf8");
      if (driver !== null && !driverStarted) {
        const m = /^PORT (\d+)$/m.exec(errText);
        if (m) {
          driverStarted = true;
          driverDone = new Promise<void>((res, rej) => {
            const d = spawn("node", [driver, m[1]!], { stdio: ["ignore", "pipe", "inherit"] });
            d.stdout.on("data", (c: Buffer) => (driverStdout += c.toString("utf8")));
            d.on("close", (code) => {
              if (code === 0) res();
              else rej(new Error(`driver exited ${code}`));
            });
          });
        }
      }
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (signal) {
        reject(new Error(`dgram program died to ${signal}\nstderr:\n${errText}`));
        return;
      }
      if (driver !== null && !driverStarted) {
        reject(new Error(`dgram program exited without a PORT line\nstderr:\n${errText}`));
        return;
      }
      driverDone.then(
        () => resolve({ stdout: Buffer.concat(out), exitCode: code ?? 0, driverStdout }),
        reject,
      );
    });
  });
}

/** The LLVM lane's REFUSALS, pinned by case name and by the construct the
 * backend names. Every other case must build on BOTH backends and answer
 * Node byte for byte on both.
 *
 * This list is the tier boundary, written down. It was ALL NINE cases
 * until node:dgram's sixteen missing lib functions were emitted, at which
 * point every `libCall:dgram.*` refusal disappeared and only node:dns's
 * one function was left — so a case leaving this list is progress and a
 * case JOINING it is a regression, and the assertions below are written
 * to fail in both directions rather than to skip quietly. */
const LLVM_REFUSALS: Record<string, string> = {
  "dns-lookup": "libCall:dns.lookup",
  "udp-state-errors": "libCall:dns.lookup",
};

interface Built {
  /** The C binary: the reference lane, always present. */
  c: string;
  /** The LLVM binary, or null when the tier refuses this case. */
  llvm: string | null;
  /** The construct the LLVM backend named, when it refused. */
  llvmRefusal: string | null;
}

async function buildOn(entry: string, backend: "c" | "llvm"): Promise<
  { ok: true; binary: string } | { ok: false; diags: string }
> {
  const hash = createHash("sha256");
  hash.update(entry).update(readFileSync(entry));
  const key = hash.update(sanitize ? "san" : "plain").update(backend).digest("hex").slice(0, 16);
  const outDir = join(cacheDir, `dgram-${key}`);
  mkdirSync(outDir, { recursive: true });
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

/* The C lane stays the REFERENCE — a diff between it and Node is network
 * behavior, which is what the original pin was protecting. The LLVM lane
 * is an ADDITIONAL comparison against the same Node output, not a
 * replacement for it, so a backend-lane bug and a socket bug stay
 * distinguishable: a C-vs-Node diff is the first, C==Node!=LLVM is the
 * second. Without this lane the sixteen dgram rows the LLVM emitter now
 * carries had no test at all — every fixture here silently demoted. */
async function build(entry: string): Promise<Built> {
  const c = await buildOn(entry, "c");
  if (!c.ok) throw new Error("dgram fixture failed to compile (C):\n" + c.diags);
  const llvm = await buildOn(entry, "llvm");
  if (llvm.ok) return { c: c.binary, llvm: llvm.binary, llvmRefusal: null };
  const m = /\(([^)]*)\)/.exec(llvm.diags);
  return { c: c.binary, llvm: null, llvmRefusal: m ? m[1]! : llvm.diags };
}

/* POSIX spelling first: globSync answers backslashes on win32, where
 * `split("/").at(-2)` is `undefined` and every case reports under that one
 * name. No-op elsewhere. */
const cases = globSync(join(fixturesRoot, "cases/*/main.ts"))
  .map((entry) => entry.split("\\").join("/"))
  .sort()
  .map((entry) => ({
    name: entry.split("/").at(-2)!,
    entry,
    driver: existsSync(join(entry, "../driver.mjs")) ? join(entry, "../driver.mjs") : null,
  }));

describe(`dgram differential (${cases.length} programs${sanitize ? ", sanitized" : ""})`, () => {
  test.for(cases.map((c) => [c.name, c] as const))("%s", async ([, c]) => {
    const built = await build(c.entry);
    // The tier boundary is asserted in BOTH directions: a case that used
    // to refuse and now compiles must be taken off LLVM_REFUSALS, and a
    // case that compiled and now refuses fails here rather than skipping.
    expect(built.llvmRefusal).toBe(LLVM_REFUSALS[c.name] ?? null);
    // Sequential, not parallel: both lanes bind ephemeral ports and drive
    // real sockets — parallelism buys little and interleaves kernel state.
    const nodeRes = await runLane("node", [c.entry], c.driver);
    const nativeRes = await runLane(built.c, [], c.driver);
    expect(nativeRes.stdout.toString("utf8")).toBe(nodeRes.stdout.toString("utf8"));
    if (!nodeRes.stdout.equals(nativeRes.stdout)) {
      expect.unreachable("stdout differed at byte level but not after utf8 decode");
    }
    expect(nativeRes.exitCode).toBe(nodeRes.exitCode);
    expect(nativeRes.driverStdout).toBe(nodeRes.driverStdout);
    if (built.llvm === null) return;
    const llvmRes = await runLane(built.llvm, [], c.driver);
    expect(llvmRes.stdout.toString("utf8")).toBe(nodeRes.stdout.toString("utf8"));
    if (!nodeRes.stdout.equals(llvmRes.stdout)) {
      expect.unreachable("LLVM stdout differed at byte level but not after utf8 decode");
    }
    expect(llvmRes.exitCode).toBe(nodeRes.exitCode);
    expect(llvmRes.driverStdout).toBe(nodeRes.driverStdout);
  }, 240_000);
});
