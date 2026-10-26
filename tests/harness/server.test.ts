/* The LISTENING-process differential: net/http server fixtures run under
 * Node AND compiled, and a shared per-case CLIENT DRIVER (a Node script,
 * identical for both lanes) talks to whichever lane is up. Nothing about
 * a listening program can be compared from stdout alone — the driver IS
 * the workload — so the contract has three legs, each byte-exact between
 * lanes: the SERVER program's stdout, the SERVER's exit code, and the
 * DRIVER's stdout.
 *
 * The port protocol: a fixture that listens binds port 0 and reports the
 * real port on STDERR as `PORT <n>` (stderr is never compared, so
 * ephemeral ports stay out of every compared stream); the harness waits
 * for that line, runs `node driver.mjs <port>`, and the fixture is
 * expected to shut itself down when the driver's conversation ends
 * (close the server, let the loop drain). Driver-less fixtures (pure
 * client programs: connect-refused shapes) skip the protocol and run
 * like corpus programs; refused-connection fixtures probe their own
 * ephemeral port (bind 0, close, connect) since a static build has no
 * string→number conversion for an argv port.
 *
 * SCRIPTC_SAN=1 rebuilds with ASan + the RC audit: socket/server handle
 * hygiene runs over every case. This file is the template the TLS and
 * http2 lanes inherit (the design note atop scr_net.c has the story). */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, existsSync, globSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, test } from "vitest";
import { compile } from "@scriptc/compiler";
import { shardSelect, shardSuffix } from "./shard.js";
import { defineEmptyShardTest } from "./shard-guard.js";
import { exeName } from "./exe.js";
import { oracleNote } from "./captured-run.js";
import { holdScratch } from "./scratch-lease.mjs";

const repoRoot = join(import.meta.dirname, "../..");
const fixturesRoot = join(repoRoot, "tests/fixtures/server");
const cacheDir = join(repoRoot, "node_modules/.cache/scriptc-tests");
/* Stdout is a FILE for every leg (see captured-run.ts: a Windows pipe can
 * lose a dying child's last writes). Returns the open fd and its path. */
function stdoutFile(): { fd: number; path: string; dir: string } {
  mkdirSync(cacheDir, { recursive: true });
  const dir = mkdtempSync(join(cacheDir, "server-stdout-"));
  const path = join(dir, "stdout");
  return { fd: openSync(path, "w"), path, dir };
}

const sanitize = process.env["SCRIPTC_SAN"] === "1";
const driverTrace = pathToFileURL(join(import.meta.dirname, "server-driver-trace.mjs")).href;

interface ProgramRun {
  stdout: Buffer;
  stderr: string;
  exitCode: number;
  /** The driver's stdout, "" for driver-less cases. */
  driverStdout: string;
}

/** Runs one lane: spawn the server program, follow the PORT protocol when
 * the case has a driver, and collect all three compared legs. */
function runLane(cmd: string, args: string[], driver: string | null): Promise<ProgramRun> {
  return new Promise((resolve, reject) => {
    const sout = stdoutFile();
    const child = spawn(cmd, args, { stdio: ["ignore", sout.fd, "pipe"] });
    closeSync(sout.fd);
    let errText = "";
    let driverStdout = "";
    let driverStarted = false;
    let driverDone: Promise<void> = Promise.resolve();
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`server program timed out\nstderr so far:\n${errText}`));
    }, 60_000);
    child.stderr.on("data", (c: Buffer) => {
      errText += c.toString("utf8");
      if (driver !== null && !driverStarted) {
        const m = /^PORT (\d+)$/m.exec(errText);
        if (m) {
          driverStarted = true;
          driverDone = new Promise<void>((res, rej) => {
            // The preload writes every socket event to stderr synchronously,
            // so the last line before a fast-fail survives (see its header).
            const dout = stdoutFile();
            // Stderr is a FILE too: a Windows pipe write is asynchronous and
            // is lost when the driver dies on a fast-fail (F8), so a runtime
            // assertion or V8 FATAL line would never reach the harness.
            const derrPath = join(dout.dir, "stderr");
            const derrFd = openSync(derrPath, "w");
            const d = spawn("node", ["--import", driverTrace, driver, m[1]!], { stdio: ["ignore", dout.fd, derrFd] });
            closeSync(dout.fd);
            closeSync(derrFd);
            // Bounded: a driver that stops making progress (its server closed
            // while it still waits on a socket) used to hang this promise
            // until vitest's 120 s test limit, with no driver output at all.
            const driverTimer = setTimeout(() => {
              d.kill("SIGKILL");
            }, 60_000);
            d.on("close", (code, sig) => {
              clearTimeout(driverTimer);
              driverStdout = readFileSync(dout.path, "utf8");
              const driverErr = readFileSync(derrPath, "utf8");
              process.stderr.write(driverErr);
              rmSync(dout.dir, { recursive: true, force: true });
              if (code === 0) res();
              else {
                // A driver that died leaves the server waiting for a peer
                // that is gone: fail NOW with the driver's own exit status
                // and stderr, not 60 s later as a bare "server program
                // timed out" that hides which side died.
                const why = new Error(
                  `driver exited ${code ?? sig}\ndriver stdout so far:\n${driverStdout}\ndriver stderr:\n${driverErr}\nserver stderr so far:\n${errText}`,
                );
                clearTimeout(timer);
                child.kill("SIGKILL");
                rej(why);
                reject(why);
              }
            });
          });
        }
      }
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      const out = readFileSync(sout.path);
      rmSync(sout.dir, { recursive: true, force: true });
      if (signal) {
        reject(new Error(`server program died to ${signal}\nstderr:\n${errText}`));
        return;
      }
      if (driver !== null && !driverStarted) {
        reject(new Error(`server program exited without a PORT line\nstderr:\n${errText}`));
        return;
      }
      driverDone.then(
        () => resolve({ stdout: out, stderr: errText, exitCode: code ?? 0, driverStdout }),
        reject,
      );
    });
  });
}

async function build(entry: string): Promise<string> {
  const hash = createHash("sha256");
  hash.update(entry).update(readFileSync(entry));
  const key = hash.update(sanitize ? "san" : "plain").digest("hex").slice(0, 16);
  // holdScratch, not mkdirSync: the LEASE it publishes is what lets the sweep
  // reclaim this run's own finished scratch mid-run. Released by the
  // per-test hook -- safe here because this directory is created, built
  // into and read inside one helper call, within one test.
  const outDir = holdScratch(cacheDir, `server-${key}`);
  const result = await compile(entry, {
    outPath: join(outDir, exeName("program")),
    outDir,
    sanitize,
    // Pinned: the listening-process differential was written against the
    // C lane; keeping lane identity fixed keeps a three-leg diff meaning
    // "server behavior changed", never "the default backend moved".
    backend: "c",
  });
  if (!result.ok) {
    throw new Error(
      "server fixture failed to compile:\n" +
        result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"),
    );
  }
  return result.binaryPath;
}

// main.ts cases are the TS lane; main.js cases pin the JS-entry lane's
// server surface (the ambient receiver, the dyn-binding handle) — both
// lanes run the identical three-leg comparison. SCRIPTC_TEST_SHARD (CI's
// matrix) keeps only this shard's slice, keyed by case name.
/* POSIX spelling before the name is cut out of the path: globSync answers
 * backslashes on win32, where `split("/").at(-2)` is `undefined` — and the
 * name is the SHARD KEY, so every case would hash to one shard and CI's
 * other two would silently run none of them. No-op elsewhere. */
const allCases = [...globSync(join(fixturesRoot, "cases/*/main.ts")), ...globSync(join(fixturesRoot, "cases/*/main.js"))]
    .map((entry) => entry.split("\\").join("/"))
    .sort()
    .map((entry) => ({
      name: entry.split("/").at(-2)!,
      entry,
      driver: existsSync(join(entry, "../driver.mjs")) ? join(entry, "../driver.mjs") : null,
    }));
const cases = shardSelect(allCases, (c) => c.name);

describe(`server differential (${cases.length} programs${sanitize ? ", sanitized" : ""}${shardSuffix()})`, () => {
  defineEmptyShardTest({
    what: "server programs",
    universe: allCases,
    keyOf: (c) => c.name,
    selectFor: (spec) => shardSelect(allCases, (c) => c.name, spec),
  });
  test.for(cases.map((c) => [c.name, c] as const))("%s", async ([, c]) => {
    const binary = await build(c.entry);
    // Sequential, not parallel: both lanes bind ephemeral ports and drive
    // real sockets — parallelism buys little and interleaves kernel state.
    const nodeRes = await runLane("node", [c.entry], c.driver);
    const nativeRes = await runLane(binary, [], c.driver);
    expect(nativeRes.stdout.toString("utf8"), oracleNote(nodeRes.exitCode, nodeRes.stderr)).toBe(nodeRes.stdout.toString("utf8"));
    if (!nodeRes.stdout.equals(nativeRes.stdout)) {
      expect.unreachable("stdout differed at byte level but not after utf8 decode");
    }
    expect(nativeRes.exitCode).toBe(nodeRes.exitCode);
    expect(nativeRes.driverStdout).toBe(nodeRes.driverStdout);
  }, 120_000);
});
