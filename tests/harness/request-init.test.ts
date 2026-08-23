/* `RequestInit` held as a VALUE, and the record that could not compile
 * without one — against Node v25.9.0, on both backends.
 *
 * WHY THIS FILE EXISTS. zapo's `WaFetchVersionOptions` carries
 * `readonly fetch?: typeof fetch`, and that member refused through two
 * names inside the ambient signature: `RequestInit` and `Request`. The
 * refusal landed on the DECLARATION, so `fetchSourceText`'s body was never
 * lowered at all — the compiler reported one diagnostic for a function
 * whose forty statements it had not looked at. Two earlier blocks refused
 * to map the two types alone, and they were right: the record would have
 * compiled and the hidden statements would have surfaced as new refusals.
 * This file is the other half of that trade — it proves the body those
 * types unlock is CORRECT, not merely lowered.
 *
 * WHY THE CASES ARE THE CASES. A refusal is loud. The ways a request
 * assembled through a VALUE can be silently wrong are not, and each one
 * is a cell here, compared against Node rather than against a
 * hand-written expectation:
 *
 *   an option DROPPED because the init was a value, not a literal
 *       every option written through a value and read back off /echo,
 *       which reports the method, the body and the headers the server SAW
 *   an init CONSUMED by the first request it is used in
 *       the same init sent twice; a captured init called twice
 *   the value form and the literal form describing DIFFERENT requests
 *       both spellings of one request, string-compared to each other
 *   an INJECTED fetch not called, the real network used instead
 *       the whole point of the `fetch` option: a stub that rewrites the
 *       URL, with a call counter, so a silently-real fetch would answer
 *       the wrong path AND leave the counter at zero
 *   a signal that rides an init VALUE and never aborts
 *       an already-aborted signal, and one aborted mid-flight against a
 *       five-second route
 *   `f === fetch` answering false because the value was ADAPTED
 *       identity of the ambient global, of an alias, and of the field a
 *       record stores it in
 *
 * The port is SUBSTITUTED into the fixture source before compiling: a
 * static build has no runtime string it could assemble a URL literal
 * from, and the compared program must be byte-identical in both lanes.
 * Node runs the same generated file.
 *
 * BOTH BACKENDS, because the LLVM lane keeps its own bookkeeping and has
 * shipped wrong while the C twin was green. Every lib entry this feature
 * added (fetch.initNew*, goInit, goInitOpt, goUnion, goUnionInit,
 * goValue) has a hand-written row on each side.
 *
 * THE SELF-TEST. The differential above only proves what COMPILES answers
 * right; the boundary block below proves the fences are still fences. A
 * widening that swallowed the member reads, the Request constructor or an
 * unhonoured init option would leave every differential cell green — the
 * boundary rows are the only thing that would fail.
 */
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { compile } from "@scriptc/compiler";
import { exeName } from "./exe.js";

const repoRoot = join(import.meta.dirname, "../..");
const fixtureDir = join(repoRoot, "tests/fixtures/request-init");
/** The origin process is fetch-static's: one http leg is all this file
 * needs, and a second copy of that server would be a second thing to keep
 * in step with Node's framing. */
const originScript = join(repoRoot, "tests/fixtures/fetch-static/origin.mjs");
const sanitize = process.env["SCRIPTC_SAN"] === "1";

function startOrigin(): Promise<{ proc: ReturnType<typeof spawn>; http: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [originScript], { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error(`request-init origin never reported PORTS\nstderr:\n${err}`));
    }, 30_000);
    proc.stderr?.on("data", (c: Buffer) => {
      err += c.toString("utf8");
      const m = /PORTS (\d+) (\d+) (\d+)/.exec(err);
      if (m) {
        clearTimeout(timer);
        resolve({ proc, http: `http://127.0.0.1:${m[1]}` });
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
      reject(new Error(`request-init fixture timed out\nstderr:\n${err}`));
    }, 180_000);
    child.stdout.on("data", (c: Buffer) => (out += c.toString("utf8")));
    child.stderr.on("data", (c: Buffer) => (err += c.toString("utf8")));
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (signal) {
        reject(new Error(`request-init fixture died to ${signal}\nstdout:\n${out}\nstderr:\n${err}`));
        return;
      }
      resolve({ stdout: out, stderr: err, exitCode: code ?? 0 });
    });
  });
}

let origin: { proc: ReturnType<typeof spawn>; http: string } | null = null;
let workDir = "";
/** Node's answers — the ONLY expectation in the differential below. */
let nodeRun: Run | null = null;

function tsconfig(): string {
  return JSON.stringify({
    compilerOptions: {
      strict: true,
      module: "nodenext",
      moduleResolution: "nodenext",
      target: "es2022",
      lib: ["es2023", "dom"],
    },
    include: ["*.ts"],
  });
}

/** Stages one source in its own directory under workDir. */
function stage(name: string, src: string): string {
  const dir = join(workDir, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "main.ts"), src, "utf8");
  writeFileSync(join(dir, "tsconfig.json"), tsconfig());
  return dir;
}

async function refusalCodes(name: string, src: string): Promise<string[]> {
  const dir = stage(name, src);
  const built = await compile(join(dir, "main.ts"), {
    outPath: join(dir, exeName("program")),
    outDir: dir,
    backend: "c",
  });
  if (built.ok) return [];
  return (built.diagnostics ?? []).map((d) => d.code);
}

/* ZAPO'S OWN LANE. The temp directory above has no node_modules, so it
 * compiles against the SHIPPED FALLBACK declarations — and the fallback's
 * `fetch` is `(input: string | URL, init?: RequestInit)`, with a
 * four-member RequestInit and no `Request` at all. That is a real lane and
 * the differential above deliberately runs in it; but two of the boundary
 * rows below are about surface the fallback never declares, and there they
 * would be asserting tsc's "Cannot find name" rather than this compiler's
 * fence. Those rows stage into the vendored @types/node fixture, the lane
 * zapo compiles in — node-types-divergence.test.ts's pattern, and the same
 * reason that fixture exists. */
const nodeLaneDir = join(repoRoot, "tests/fixtures/node-types/.requestinit");

function stageNodeLane(name: string, src: string): string {
  const dir = join(nodeLaneDir, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "main.ts"), src, "utf8");
  return dir;
}

async function nodeLaneBuild(
  dir: string,
): Promise<{ ok: boolean; diags: { code: string; message: string; hint?: string }[] }> {
  const built = await compile(join(dir, "main.ts"), {
    outPath: join(dir, exeName("program")),
    outDir: dir,
    backend: "c",
  });
  return {
    ok: built.ok,
    diags: (built.diagnostics ?? []).map((d) => ({ code: d.code, message: d.message, hint: d.hint })),
  };
}


beforeAll(async () => {
  origin = await startOrigin();
  // NOT under node_modules: Node refuses to strip types from a file
  // inside one, so the Node lane would exit 1 with an EMPTY stdout and
  // the whole comparison would then be against nothing.
  workDir = mkdtempSync(join(tmpdir(), "scriptc-request-init-"));
  const src = readFileSync(join(fixtureDir, "client.tmpl.ts"), "utf8").replaceAll(
    "__HTTP__",
    origin.http,
  );
  mkdirSync(join(workDir, "diff"), { recursive: true });
  writeFileSync(join(workDir, "diff", "main.ts"), src, "utf8");
  writeFileSync(join(workDir, "diff", "tsconfig.json"), tsconfig());
  nodeRun = await run(process.execPath, [join(workDir, "diff", "main.ts")], join(workDir, "diff"));
}, 600_000);

afterAll(() => {
  origin?.proc.kill();
});

describe("a RequestInit value, against Node", () => {
  test("Node's own answers are the baseline, and they are complete", () => {
    expect(nodeRun, "the Node lane did not run").not.toBeNull();
    expect(nodeRun!.exitCode, `Node lane failed:\n${nodeRun!.stdout}\n${nodeRun!.stderr}`).toBe(0);
    // The last line the fixture prints. Without this the whole file could
    // pass on two lanes that BOTH stopped after case one.
    expect(nodeRun!.stdout.trimEnd().split("\n").at(-1)).toBe("END done");
    // A floor on the matrix: a fixture edited down to nothing must fail
    // here rather than report a green three-cell comparison.
    expect(nodeRun!.stdout.trimEnd().split("\n").length).toBeGreaterThanOrEqual(24);
    // And the injected-fetch cell must show the stub was REALLY called — a
    // `0` there would mean the differential compared two programs that
    // both used the real network.
    expect(nodeRun!.stdout).toMatch(/\nrecord-injected 1 /);
  });

  for (const backend of ["c", "llvm"] as const) {
    test(
      `${backend}: every cell matches Node`,
      async () => {
        const outDir = join(workDir, `diff-${backend}`);
        mkdirSync(outDir, { recursive: true });
        const built = await compile(join(workDir, "diff", "main.ts"), {
          outPath: join(outDir, exeName("program")),
          outDir,
          backend,
          sanitize,
        });
        expect(
          built.ok,
          "the RequestInit fixture must COMPILE — a refusal here is the row this file exists to keep closed:\n" +
            (built.diagnostics ?? []).map((d) => `${d.code}: ${d.message}`).join("\n"),
        ).toBe(true);
        const native = await run(built.binaryPath!, [], outDir);
        // Cell by cell before the whole-stream compare, so a failure names
        // the case rather than dumping the whole output.
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

describe("the boundary a RequestInit value stops at", () => {
  test(
    "no member of a RequestInit value reads back",
    async () => {
      // NOT an omission. The value holds the FOLDED request head — header
      // names already lowercased and flattened into the wire list, a
      // string body already utf8-encoded — so `init.headers` would answer
      // a string array where the program wrote a record. A read that
      // answers something other than what was written is the failure this
      // whole slice is built to avoid.
      const codes = await refusalCodes(
        "read-member",
        "const i: RequestInit = { method: 'GET' }\nconsole.log(String(i.method))\n",
      );
      expect(codes.length, "a RequestInit member read must refuse").toBeGreaterThan(0);
      expect(codes).toContain("SC2020");
    },
    900_000,
  );

  test(
    "the undici dispatcher written through an assertion refuses BY NAME",
    async () => {
      // zapo's own line, and the one refusal left in that file. MEASURED
      // against Node v25.9.0 rather than assumed: `fetch(url, {
      // dispatcher })` calls a plain object's `dispatch(opts, handler)`
      // and waits for the handler's callbacks, so the key is honoured
      // there and dropping it here would be a proxy silently ignored.
      const dir = stage(
        "dispatcher-write",
        "declare const d: { dispatch: (a: unknown, b: unknown) => unknown } | undefined\n" +
          "const i: RequestInit = { method: 'GET' }\n" +
          "if (d) { ;(i as { dispatcher?: unknown }).dispatcher = d }\n" +
          "console.log('x')\n",
      );
      const built = await compile(join(dir, "main.ts"), {
        outPath: join(dir, exeName("program")),
        outDir: dir,
        backend: "c",
      });
      expect(built.ok, "the dispatcher write must refuse").toBe(false);
      const diags = built.diagnostics ?? [];
      // The CODE alone is not the assertion. It used to answer SC1090
      // "assignment to non-variables", which named neither the value nor
      // the cause — and that message is why the row was filed under the
      // assignment-target family for three blocks running.
      expect(
        diags.some((d) => d.code === "SC2020" && d.message.includes("'RequestInit.dispatcher'")),
        `the refusal must NAME the member: ${diags.map((d) => `${d.code} ${d.message}`).join(" | ")}`,
      ).toBe(true);
      // And it must not send the reader to NODE_USE_ENV_PROXY: the island
      // fetch reads that variable, this one has no proxy path at all.
      expect(diags.map((d) => String(d.hint ?? "")).join(" ")).not.toContain("NODE_USE_ENV_PROXY");
    },
    900_000,
  );

  test(
    "constructing a Request still refuses — the type has no values",
    async () => {
      // `Request` maps as a TYPE so the ambient signature's input union
      // can, and NOTHING constructs one. If this row ever compiles, the
      // uninhabitable arm in scr_fetch_start_union stopped being
      // uninhabitable and its rejected-promise branch becomes reachable.
      const ctor = await nodeLaneBuild(
        stageNodeLane(
          "new-request",
          "const r = new Request('http://127.0.0.1:1/')\nconsole.log(String(r))\n",
        ),
      );
      expect(ctor.ok, "new Request must refuse").toBe(false);
      expect(ctor.diags.map((d) => d.code)).toContain("SC2020");
      const value = await nodeLaneBuild(
        stageNodeLane("request-value", "declare const q: Request\nconsole.log(String(q))\n"),
      );
      expect(value.ok, "a Request VALUE must refuse").toBe(false);
      expect(value.diags.map((d) => d.code)).toContain("SC2020");
    },
    900_000,
  );

  test(
    "an init option this runtime cannot honour refuses in the VALUE form too",
    async () => {
      // The literal at a call site already fenced these by name. The value
      // form walks the SAME keys through the same code, and this row is
      // what proves it rather than assuming it: a second walk that quietly
      // dropped `redirect: 'manual'` would pass every differential cell
      // above, because every one of them follows redirects.
      const built = await nodeLaneBuild(
        stageNodeLane(
          "unhonoured-option",
          "const i: RequestInit = { method: 'GET', redirect: 'manual' }\nvoid i\n",
        ),
      );
      expect(built.ok, "an unlowered init option must refuse in a value").toBe(false);
      expect(
        built.diags.some((d) => d.code === "SC2020" && d.message.includes("'redirect'")),
        `the refusal must NAME the option: ${built.diags.map((d) => `${d.code} ${d.message}`).join(" | ")}`,
      ).toBe(true);
    },
    900_000,
  );

  test(
    "a RequestInit value has no JSON surface and no string form",
    async () => {
      // Node stringifies a plain init object to its own keys; this value is
      // not that object. Answering `{}` or the folded form would both be
      // wrong, so both spellings refuse.
      const json = await refusalCodes(
        "init-json",
        "const i: RequestInit = { method: 'GET' }\nconsole.log(JSON.stringify(i))\n",
      );
      expect(json.length, "JSON.stringify of a RequestInit must refuse").toBeGreaterThan(0);
      const str = await refusalCodes(
        "init-string",
        "const i: RequestInit = { method: 'GET' }\nconsole.log(String(i))\n",
      );
      expect(str.length, "String() of a RequestInit must refuse").toBeGreaterThan(0);
    },
    900_000,
  );
});
