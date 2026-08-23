/* The STATIC fetch differential — the same feature fetch.test.ts covers
 * for the --dynamic island, in a build with no engine in it at all.
 *
 * fetch.test.ts and this file are deliberately separate, and the reason is
 * the one the whole slice turns on: the two lanes are two different
 * implementations behind one spelling. The island's fetch is JS glue over
 * scr_fetch.c and delivers ENGINE values; the static one is
 * scr_fetch_static.c delivering an ScrResponse handle. A single suite
 * would have had to weaken every assertion to whichever lane was looser.
 *
 * WHY THE CASES ARE THE CASES. A refusal is loud; a wrong answer from an
 * HTTP client is silent, and there is a short list of ways this feature
 * could have been silently wrong. Every one of them is a case here, and
 * every one is compared against Node v25.9.0 rather than against a
 * hand-written expectation:
 *
 *   a truncated body read as complete    /big, 70000 bytes with a
 *                                        content-length; length, head AND
 *                                        tail are compared
 *   a chunked body mis-decoded           /chunked, five writes with a real
 *                                        gap between them
 *   a compressed body delivered raw      /gzip and /deflate
 *   a non-2xx swallowed                  /404, /500 — both must RESOLVE,
 *                                        with .ok false and their bodies
 *   a redirect followed that Node would  301/302/303 rewrite to GET and
 *   not follow, or not followed when     drop the body; 307 preserves
 *   Node would                           both; a relative Location; a
 *                                        cross-origin hop that drops
 *                                        authorization and keeps an
 *                                        ordinary header; a 3xx with NO
 *                                        Location delivering its own body;
 *                                        a redirect LOOP that must reject
 *   headers case-folded wrongly          three spellings of one name, a
 *                                        repeated name joined, an absent
 *                                        name answering null
 *   a timeout that resolves rather       an abort mid-flight and an
 *   than rejects                         already-aborted signal
 *   a TLS failure that returns           a self-signed https origin — it
 *   something instead of throwing        must REJECT, never answer a
 *                                        Response
 *
 * plus json() and its SyntaxError, a second body read (Node throws
 * SYNCHRONOUSLY there, and so must this), a refused connection, an
 * unresolvable name, and an unparsable URL.
 *
 * The port is SUBSTITUTED into the fixture source rather than passed in
 * argv: a static build has no runtime string it could assemble a URL
 * literal from, and the compared program must be byte-identical in both
 * lanes. Node runs the same generated file.
 *
 * BOTH BACKENDS run, because the LLVM lane keeps its own may-throw
 * bookkeeping and has shipped wrong while the C twin was right — the
 * second-body-read case took an access violation there while the C lane
 * was already green (the commit that added resp.* to MAY_THROW_LIB_FNS).
 */
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { compile } from "@scriptc/compiler";
import { exeName } from "./exe.js";

const repoRoot = join(import.meta.dirname, "../..");
const fixtureDir = join(repoRoot, "tests/fixtures/fetch-static");
const sanitize = process.env["SCRIPTC_SAN"] === "1";

interface Origins {
  proc: ReturnType<typeof spawn>;
  http: string;
  https: string;
  alt: string;
}

/** Starts the fixture origin process and waits for its PORTS line. The
 * https leg needs `openssl` to mint a self-signed cert; without one the
 * origin reports port 0 and the TLS case degrades to a connect failure —
 * still a rejection, still compared against Node's, but no longer a
 * CERTIFICATE rejection. Stated rather than hidden: on a host with no
 * openssl this file proves less than its comment above claims. */
function startOrigins(): Promise<Origins> {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [join(fixtureDir, "origin.mjs")], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let err = "";
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error(`fetch origin never reported PORTS\nstderr:\n${err}`));
    }, 30_000);
    proc.stderr?.on("data", (c: Buffer) => {
      err += c.toString("utf8");
      const m = /PORTS (\d+) (\d+) (\d+)/.exec(err);
      if (m) {
        clearTimeout(timer);
        resolve({
          proc,
          http: `http://127.0.0.1:${m[1]}`,
          https: `https://127.0.0.1:${m[2]}`,
          alt: `http://127.0.0.1:${m[3]}`,
        });
      }
    });
    proc.on("error", reject);
  });
}

interface Run {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function run(cmd: string, args: string[], cwd: string): Promise<Run> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`fetch fixture timed out\nstderr:\n${err}`));
    }, 180_000);
    child.stdout.on("data", (c: Buffer) => (out += c.toString("utf8")));
    child.stderr.on("data", (c: Buffer) => (err += c.toString("utf8")));
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (signal) {
        reject(new Error(`fetch fixture died to ${signal}\nstdout:\n${out}\nstderr:\n${err}`));
        return;
      }
      resolve({ stdout: out, stderr: err, exitCode: code ?? 0 });
    });
  });
}

let origins: Origins | null = null;
let workDir = "";
/** Node's answers — the ONLY expectation in this file. */
let nodeRun: Run | null = null;
let nodeErr = "";

beforeAll(async () => {
  origins = await startOrigins();
  // NOT under node_modules: Node refuses to strip types from a file
  // inside one, so the Node lane would exit 1 with an EMPTY stdout and
  // the whole comparison would then be against nothing.
  workDir = mkdtempSync(join(tmpdir(), "scriptc-fetch-static-"));
  const src = readFileSync(join(fixtureDir, "client.tmpl.ts"), "utf8")
    .replaceAll("__HTTP__", origins.http)
    .replaceAll("__HTTPS__", origins.https)
    .replaceAll("__ALT__", origins.alt);
  writeFileSync(join(workDir, "main.ts"), src, "utf8");
  // The fixture reads DOM globals (fetch/Response/Headers/AbortController)
  // and no node types, so it type-checks against the same lib set in both
  // lanes with no @types/node in sight.
  writeFileSync(
    join(workDir, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        module: "nodenext",
        moduleResolution: "nodenext",
        target: "es2022",
        lib: ["es2023", "dom"],
      },
      include: ["*.ts"],
    }),
  );
  nodeRun = await run(process.execPath, [join(workDir, "main.ts")], workDir);
  nodeErr = nodeRun.stderr;
}, 600_000);

afterAll(() => {
  origins?.proc.kill();
});

describe("the static fetch, against Node", () => {
  test("Node's own answers are the baseline, and they are complete", () => {
    expect(nodeRun, "the Node lane did not run").not.toBeNull();
    expect(nodeRun!.exitCode, `Node lane failed:\n${nodeRun!.stdout}\n${nodeErr}`).toBe(0);
    // The last line the fixture prints. Without this the whole file could
    // pass on two lanes that BOTH stopped after case one.
    expect(nodeRun!.stdout.trimEnd().split("\n").at(-1)).toBe("END done");
    // A floor on the matrix: a fixture edited down to nothing must fail
    // here rather than report a green 3-cell comparison.
    expect(nodeRun!.stdout.trimEnd().split("\n").length).toBeGreaterThanOrEqual(60);
  });

  for (const backend of ["c", "llvm"] as const) {
    test(
      `${backend}: every cell matches Node`,
      async () => {
        const outDir = join(workDir, backend);
        mkdirSync(outDir, { recursive: true });
        const built = await compile(join(workDir, "main.ts"), {
          outPath: join(outDir, exeName("program")),
          outDir,
          backend,
          sanitize,
        });
        expect(
          built.ok,
          "the static fetch fixture must COMPILE — a refusal here is the row this file exists to keep closed:\n" +
            (built.diagnostics ?? []).map((d) => `${d.code}: ${d.message}`).join("\n"),
        ).toBe(true);
        const native = await run(built.binaryPath!, [], outDir);
        // Cell by cell before the whole-stream compare, so a failure names
        // the case rather than dumping sixty lines of context.
        const nodeLines = nodeRun!.stdout.split("\n");
        const nativeLines = native.stdout.split("\n");
        const keyOf = (l: string): string => l.split(" ")[0] ?? "";
        for (const line of nodeLines) {
          const key = keyOf(line);
          if (key === "") continue;
          const mine = nativeLines.find((l) => keyOf(l) === key);
          expect(mine, `${backend}: '${key}' never ran (Node answered: ${line})`).toBeDefined();
          expect(mine, `${backend}: '${key}' differs from Node`).toBe(line);
        }
        expect(native.stdout).toBe(nodeRun!.stdout);
        expect(native.exitCode).toBe(nodeRun!.exitCode);
      },
      900_000,
    );
  }
});
