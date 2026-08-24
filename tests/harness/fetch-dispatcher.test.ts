/* undici's `dispatcher` on a fetch init — honoured, against Node v25.9.0,
 * on both backends.
 *
 * WHY THIS FILE EXISTS. `RequestInit.dispatcher` was the last refusal zapo
 * carried out of its fetch surface: `wa-version-fetcher.ts:133` writes a
 * proxy dispatcher onto an init, and the compiler answered SC2020 there.
 * Dropping the key instead would have been a proxy silently bypassed —
 * measured, not assumed: Node really does call a plain object's
 * `dispatch(opts, handler)` and never touches the origin.
 *
 * WHY THE CASES ARE THE CASES. A refusal is loud; a proxy quietly ignored
 * is not, and it is the failure this whole slice exists to prevent. So
 * every delegated request in the fixture goes to a path the ORIGIN answers
 * 400 on: a build that dialled instead of delegating answers 400 rather
 * than answering nothing, and the cell fails. The direct cell goes to /ok,
 * so a build that delegated when it should not is caught from the other
 * side.
 *
 * THE ONE FAILURE THIS FEATURE MUST NEVER HAVE, and it has already
 * happened once in this repository on the WebSocket side of the same
 * option: a fence that tests TRUTHINESS. Measured on v25.9.0, `dispatcher:
 * undefined` dials DIRECT while `null`, `0`, `false`, `''` and `NaN` every
 * one of them REJECT out of undici's own `assert(dispatcher)`. A
 * truthiness test would dial direct on all five. Nothing on this path
 * tests truthiness: the shape is proved by TYPE, a non-nullable record
 * with a callable `dispatch`, and every other spelling keeps its refusal.
 * The oracle rows below pin those six answers so the refusals stay
 * justified rather than merely convenient.
 *
 * TWO DELIBERATE DIVERGENCES, both asserted here from the ORACLE's side
 * rather than reproduced:
 *
 *   a request BODY through a dispatcher is refused. `opts.body` is an
 *   async generator in Node and this runtime has no dyn value of that
 *   shape; handing a dispatcher a byte array instead makes `for await`
 *   yield one NUMBER per byte, so the request goes out as decimal digits
 *   with nobody told. The refusal is loud, at the call, and names it.
 *
 *   `onError` AFTER the head errors the body here; the oracle leaves the
 *   body promise unsettled forever (measured: `.text()` had not settled
 *   after six seconds). A hang is not an answer, and this runtime's own
 *   DIALLED path already rejects a mid-body death with TypeError
 *   "terminated", so a delegated one answers the same.
 *
 * BOTH BACKENDS, because the LLVM lane keeps its own bookkeeping and has
 * shipped wrong while the C twin was green — the ws dispatcher's own
 * fence emitted on one lane and not the other, and dialled DIRECT.
 */
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { compile } from "@scriptc/compiler";
import { exeName } from "./exe.js";

const repoRoot = join(import.meta.dirname, "../..");
const fixtureDir = join(repoRoot, "tests/fixtures/fetch-dispatcher");
/** The origin process is fetch-static's: the delegated cells never reach
 * it, and the two that must NOT be delegated need a real one. */
const originScript = join(repoRoot, "tests/fixtures/fetch-static/origin.mjs");
const sanitize = process.env["SCRIPTC_SAN"] === "1";

interface Run {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function startOrigin(): Promise<{ proc: ReturnType<typeof spawn>; http: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [originScript], { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error(`fetch-dispatcher origin never reported PORTS\nstderr:\n${err}`));
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

/** Every run in this file carries a timeout: a dispatcher that answers
 * nothing is one of the cases, and a hang must be reported as a hang
 * rather than as a suite that never finishes. */
function run(cmd: string, args: string[], cwd: string, ms = 180_000): Promise<Run> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`fetch-dispatcher fixture timed out\nstdout:\n${out}\nstderr:\n${err}`));
    }, ms);
    child.stdout.on("data", (c: Buffer) => (out += c.toString("utf8")));
    child.stderr.on("data", (c: Buffer) => (err += c.toString("utf8")));
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (signal) {
        reject(new Error(`fetch-dispatcher fixture died to ${signal}\nstdout:\n${out}\nstderr:\n${err}`));
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

function stage(name: string, src: string): string {
  const dir = join(workDir, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "main.ts"), src, "utf8");
  writeFileSync(join(dir, "tsconfig.json"), tsconfig());
  return dir;
}

async function refusal(
  name: string,
  src: string,
): Promise<{ ok: boolean; diags: { code: string; message: string; hint?: string }[] }> {
  const dir = stage(name, src);
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

/** A dispatcher declaration in zapo's own spelling. */
const DISPATCHER_DECL =
  "interface D { dispatch(...args: readonly unknown[]): unknown }\n" +
  "const d: D = { dispatch: (): unknown => true }\n";

function writeThrough(valueType: string, arg: string): string {
  return (
    DISPATCHER_DECL +
    `async function f(x: ${valueType}): Promise<void> {\n` +
    "  const i: RequestInit = {}\n" +
    "  ;(i as { dispatcher?: unknown }).dispatcher = x\n" +
    "  await fetch('http://127.0.0.1:65000/', i)\n" +
    "}\n" +
    `void f(${arg})\n`
  );
}

beforeAll(async () => {
  origin = await startOrigin();
  // NOT under node_modules: Node refuses to strip types from a file inside
  // one, so the Node lane would exit 1 with an EMPTY stdout and the whole
  // comparison would then be against nothing.
  workDir = mkdtempSync(join(tmpdir(), "scriptc-fetch-dispatcher-"));
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

describe("a fetch dispatcher, against Node", () => {
  test("Node's own answers are the baseline, and they are complete", () => {
    expect(nodeRun, "the Node lane did not run").not.toBeNull();
    expect(nodeRun!.exitCode, `Node lane failed:\n${nodeRun!.stdout}\n${nodeRun!.stderr}`).toBe(0);
    const lines = nodeRun!.stdout.trimEnd().split("\n");
    // The last line the fixture prints. Without this the whole file could
    // pass on two lanes that BOTH stopped after case one.
    expect(lines.at(-1)).toBe("END done");
    // A floor on the matrix: a fixture edited down to nothing must fail
    // here rather than report a green three-cell comparison.
    expect(lines.length).toBeGreaterThanOrEqual(20);
    // The proof that the delegated cells were really delegated: every one
    // of them asks for a path the origin answers 400 on, and none of them
    // answers 400. A build that dialled would.
    expect(nodeRun!.stdout, "a delegated cell reached the ORIGIN").not.toMatch(/status=400/);
    // …and the direct cell really did reach it.
    expect(nodeRun!.stdout).toMatch(/\ndirect status=200 body=hello world\n/);
    // The handler is the ten members undici builds, in undici's order.
    // Byte for byte the same ten the WebSocket path is handed — which is
    // the map this feature was asked to establish before it was built.
    expect(nodeRun!.stdout).toMatch(
      /\nhandler body,abort,onConnect,onResponseStarted,onHeaders,onData,onComplete,onError,onRequestUpgrade,onUpgrade\n/,
    );
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
          "the dispatcher fixture must COMPILE — a refusal here is the row this file exists to keep closed:\n" +
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

/* ── the oracle rows the refusals rest on ─────────────────────────────
 * Each of these MEASURES Node rather than quoting it, because the whole
 * design decision — prove the shape by type, refuse everything else —
 * is only correct if Node's six answers are what they are said to be.
 */
describe("what Node does with a dispatcher that is not a dispatcher", () => {
  test("undefined dials DIRECT and every other falsy value REJECTS", async () => {
    const src =
      "const BASE = '__HTTP__'\n" +
      "async function probe(label, init) {\n" +
      "  try { const r = await fetch(BASE + '/ok', init); console.log(label + ' OK ' + r.status) }\n" +
      "  catch (e) { console.log(label + ' THREW ' + e.constructor.name) }\n" +
      "}\n" +
      "await probe('undefined', { dispatcher: undefined })\n" +
      "await probe('null', { dispatcher: null })\n" +
      "await probe('zero', { dispatcher: 0 })\n" +
      "await probe('false', { dispatcher: false })\n" +
      "await probe('empty', { dispatcher: '' })\n" +
      "await probe('nan', { dispatcher: NaN })\n" +
      "await probe('nodispatch', { dispatcher: {} })\n";
    const dir = join(workDir, "oracle-falsy");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "probe.mjs"), src.replaceAll("__HTTP__", origin!.http), "utf8");
    const r = await run(process.execPath, [join(dir, "probe.mjs")], dir, 60_000);
    expect(r.exitCode, r.stderr).toBe(0);
    // THE trap, pinned: only `undefined` is an absent dispatcher. A fence
    // that tested truthiness would dial direct on all six lines below it.
    expect(r.stdout).toMatch(/^undefined OK 200$/m);
    for (const falsy of ["null", "zero", "false", "empty", "nan"]) {
      expect(r.stdout, `${falsy} must NOT dial direct in the oracle`).toMatch(
        new RegExp(`^${falsy} THREW `, "m"),
      );
      expect(r.stdout).not.toMatch(new RegExp(`^${falsy} OK`, "m"));
    }
    // …and a truthy value with no `dispatch` is a rejection too, not a
    // direct dial: refusing an unproved shape is Node's answer as well.
    expect(r.stdout).toMatch(/^nodispatch THREW TypeError$/m);
  }, 120_000);
});

describe("the boundary: what still refuses, and why", () => {
  test("a shape that does not PROVE a callable dispatch keeps the refusal", async () => {
    for (const [name, type, arg] of [
      ["unknown", "unknown", "d"],
      ["object", "object", "d"],
      // The two Node REJECTS on (§ the oracle row above). Refusing is the
      // only answer that cannot be mistaken for either of Node's two.
      ["optional", "D | undefined", "d"],
      ["nullable", "D | null", "d"],
    ] as const) {
      const r = await refusal(`refuse-${name}`, writeThrough(type, arg));
      expect(r.ok, `${name} must not compile`).toBe(false);
      expect(r.diags.map((x) => x.code), name).toContain("SC2020");
      const d = r.diags.find((x) => x.code === "SC2020")!;
      expect(d.message).toContain("RequestInit.dispatcher");
      expect(d.hint, `${name}'s hint must say what the proof wanted`).toMatch(/dispatch\(/);
      // The hint used to point at NODE_USE_ENV_PROXY, which this lane does
      // not read. It must not come back.
      expect(d.hint).not.toMatch(/NODE_USE_ENV_PROXY/);
    }
  }, 600_000);

  test("a dispatch whose parameters are narrower than unknown keeps the refusal", async () => {
    const src =
      "interface E { dispatch(o: { path: string }, h: unknown): boolean }\n" +
      "const e: E = { dispatch: (): boolean => true }\n" +
      "async function f(x: E): Promise<void> {\n" +
      "  const i: RequestInit = {}\n" +
      "  ;(i as { dispatcher?: unknown }).dispatcher = x\n" +
      "  await fetch('http://127.0.0.1:65000/', i)\n" +
      "}\nvoid f(e)\n";
    const r = await refusal("refuse-typed-params", src);
    // `opts` and the handler are dyn objects the RUNTIME builds. A program
    // that declared a record parameter would be handed a value of a shape
    // it never had — a wrong answer, not a missing feature.
    expect(r.ok).toBe(false);
    expect(r.diags.map((x) => x.code)).toContain("SC2020");
  }, 600_000);

  test("a record with no dispatch at all keeps the refusal", async () => {
    const src =
      "interface N { addRequest(): void }\n" +
      "const n: N = { addRequest: (): void => {} }\n" +
      "async function f(x: N): Promise<void> {\n" +
      "  const i: RequestInit = {}\n" +
      "  ;(i as { dispatcher?: unknown }).dispatcher = x\n" +
      "  await fetch('http://127.0.0.1:65000/', i)\n" +
      "}\nvoid f(n)\n";
    const r = await refusal("refuse-no-dispatch", src);
    expect(r.ok).toBe(false);
    expect(r.diags.map((x) => x.code)).toContain("SC2020");
  }, 600_000);

  test("every OTHER RequestInit member still refuses, read and written", async () => {
    const written = await refusal(
      "refuse-method-write",
      DISPATCHER_DECL +
        "async function f(): Promise<void> {\n" +
        "  const i: RequestInit = { method: 'GET' }\n" +
        "  ;(i as { method?: unknown }).method = 'POST'\n" +
        "  await fetch('http://127.0.0.1:65000/', i)\n" +
        "}\nvoid f()\n",
    );
    expect(written.ok).toBe(false);
    const m = written.diags.find((x) => x.message.includes("RequestInit.method"));
    expect(m, "the write must still name the member").toBeDefined();
    // A dispatcher that reads BACK is a different claim from one that is
    // written: the init holds the closure, not a value the program can
    // observe, so the read stays a refusal.
    const read = await refusal(
      "refuse-dispatcher-read",
      DISPATCHER_DECL +
        "async function f(): Promise<void> {\n" +
        "  const i: RequestInit = {}\n" +
        "  ;(i as { dispatcher?: unknown }).dispatcher = d\n" +
        "  console.log(String((i as { dispatcher?: unknown }).dispatcher))\n" +
        "  await fetch('http://127.0.0.1:65000/', i)\n" +
        "}\nvoid f()\n",
    );
    expect(read.ok, "reading the dispatcher back must not compile").toBe(false);
  }, 600_000);

  test("a BODY through a dispatcher is refused loudly, at the call", async () => {
    // The divergence stated in this file's header. It is a RUNTIME
    // rejection rather than a compile refusal because the init can be
    // built anywhere; what matters is that it is loud and that the
    // dispatcher is never reached with a body it would misread.
    const src =
      DISPATCHER_DECL.replace(
        "const d: D = { dispatch: (): unknown => true }",
        "const d: D = { dispatch: (): unknown => { console.log('DISPATCH REACHED'); return true } }",
      ) +
      "async function f(): Promise<void> {\n" +
      "  const i: RequestInit = { method: 'POST', body: 'hello' }\n" +
      "  ;(i as { dispatcher?: unknown }).dispatcher = d\n" +
      "  try { const r = await fetch('http://127.0.0.1:65000/', i); console.log('RESOLVED ' + r.status) }\n" +
      "  catch (e: unknown) { console.log('REJECTED ' + (e instanceof Error ? e.message : String(e))) }\n" +
      "}\nvoid f()\n";
    const dir = stage("body-refusal", src);
    const built = await compile(join(dir, "main.ts"), {
      outPath: join(dir, exeName("program")),
      outDir: dir,
      backend: "c",
    });
    expect(built.ok, (built.diagnostics ?? []).map((x) => x.code).join(",")).toBe(true);
    const r = await run(built.binaryPath!, [], dir, 60_000);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/^REJECTED fetch with both a body and a dispatcher/m);
    expect(r.stdout, "the dispatcher must never be reached").not.toMatch(/DISPATCH REACHED/);
  }, 600_000);
});

/* ── the two divergences, measured from the ORACLE's side ─────────
 * Neither is reproduced. Each row measures what Node does and asserts that
 * this build does the LOUD thing instead, so the divergence cannot drift
 * into an accident: if Node's behaviour ever changes, the oracle half of
 * the row fails first.
 */
describe("onError after the head", () => {
  test("the oracle HANGS and this build errors the body instead", async () => {
    // NODE, measured here rather than quoted: a dispatcher that calls
    // onData and then onError AFTER onHeaders leaves the body promise
    // unsettled. `.text()` had not settled after six seconds in the probe
    // that motivated this row; the timer below is what turns that into a
    // reported fact instead of a suite that never finishes.
    const src =
      "const BASE = '__HTTP__'\n" +
      "const d = { dispatch(o, h) {\n" +
      "  setTimeout(() => {\n" +
      "    h.onConnect(() => {})\n" +
      "    h.onHeaders(200, [Buffer.from('content-type'), Buffer.from('text/plain')], () => {}, 'OK')\n" +
      "    h.onData(Buffer.from('AB'))\n" +
      "    h.onError(new Error('MIDBODY'))\n" +
      "  }, 5)\n" +
      "  return true\n" +
      "} }\n" +
      "const res = await fetch(BASE + '/never-a-route', { dispatcher: d })\n" +
      "console.log('head ' + res.status)\n" +
      "try {\n" +
      "  const t = await Promise.race([res.text(), new Promise((_, rj) => setTimeout(() => rj(new Error('HANG')), 3000))])\n" +
      "  console.log('body TEXT ' + JSON.stringify(t))\n" +
      "} catch (e) { console.log('body ' + (e.message === 'HANG' ? 'HANG' : 'ERR ' + e.constructor.name + ':' + e.message)) }\n" +
      "process.exit(0)\n";
    const dir = join(workDir, "oracle-midbody");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "probe.mjs"), src.replaceAll("__HTTP__", origin!.http), "utf8");
    const oracle = await run(process.execPath, [join(dir, "probe.mjs")], dir, 60_000);
    expect(oracle.exitCode, oracle.stderr).toBe(0);
    // The head resolves — which is why this cannot be folded into the
    // byte-identical differential: the two lanes agree on the head and
    // disagree, deliberately, on the body.
    expect(oracle.stdout).toMatch(/^head 200$/m);
    expect(
      oracle.stdout,
      "the oracle no longer hangs on a mid-body onError — if it now ERRORS, this " +
        "build should stop diverging and match it instead",
    ).toMatch(/^body HANG$/m);

    // THIS BUILD: the body errors, with the shape its own DIALLED path
    // already gives a mid-body death. A hang is not an answer, and a
    // response that never settles is the one outcome a program cannot
    // recover from.
    const mine =
      "interface Handler {\n" +
      "  onConnect(abort: unknown): unknown\n" +
      "  onHeaders(status: number, headers: readonly unknown[], resume: unknown, statusText: unknown): unknown\n" +
      "  onData(chunk: unknown): unknown\n" +
      "  onError(err: unknown): unknown\n" +
      "}\n" +
      "interface D { dispatch(...args: readonly unknown[]): unknown }\n" +
      "const BASE = '__HTTP__'\n" +
      "async function main(): Promise<void> {\n" +
      "  const d: D = { dispatch: (...a: readonly unknown[]): unknown => {\n" +
      "    const h = a[1] as unknown as Handler\n" +
      "    h.onConnect((): void => {})\n" +
      "    h.onHeaders(200, ['content-type', 'text/plain'], null, 'OK')\n" +
      "    h.onData('AB')\n" +
      "    h.onError(new Error('MIDBODY'))\n" +
      "    return true\n" +
      "  } }\n" +
      "  const i: RequestInit = {}\n" +
      "  ;(i as { dispatcher?: unknown }).dispatcher = d\n" +
      "  const res = await fetch(BASE + '/never-a-route', i)\n" +
      "  console.log('head ' + String(res.status))\n" +
      "  try { console.log('body TEXT ' + (await res.text())) }\n" +
      "  catch (e: unknown) { console.log('body ERR ' + (e instanceof Error ? e.name + ':' + e.message : String(e))) }\n" +
      "}\n" +
      "void main()\n";
    const mdir = stage("midbody", mine.replaceAll("__HTTP__", origin!.http));
    const built = await compile(join(mdir, "main.ts"), {
      outPath: join(mdir, exeName("program")),
      outDir: mdir,
      backend: "c",
    });
    expect(built.ok, (built.diagnostics ?? []).map((x) => x.code).join(",")).toBe(true);
    // The timeout IS the assertion's other half: if this build ever starts
    // hanging like the oracle, the run is killed and reported as a hang
    // rather than passing quietly.
    const r = await run(built.binaryPath!, [], mdir, 60_000);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/^head 200$/m);
    expect(r.stdout, "the body must settle, and it must settle as an ERROR").toMatch(
      /^body ERR TypeError:terminated$/m,
    );
  }, 900_000);
});

/* ── the collector ────────────────────────────────────────────────────
 * A dispatcher holds a program object alive across turns and the handler
 * this runtime hands it holds the transfer, so an untraced edge here
 * leaves a ring nothing can free. The audit SILENCES ITSELF — it returns
 * before auditing when a fiber never resumed — so the control below is
 * what makes a clean stderr mean anything.
 */
describe("the reference-count audit", () => {
  const RC_SRC =
    "interface Handler {\n" +
    "  onConnect(abort: unknown): unknown\n" +
    "  onHeaders(status: number, headers: readonly unknown[], resume: unknown, statusText: unknown): unknown\n" +
    "  onData(chunk: unknown): unknown\n" +
    "  onComplete(trailers: unknown): unknown\n" +
    "  onError(err: unknown): unknown\n" +
    "}\n" +
    "interface D { dispatch(...args: readonly unknown[]): unknown }\n" +
    "const BASE = '__HTTP__'\n" +
    "async function main(): Promise<void> {\n" +
    "  {\n" +
    "    const d: D = { dispatch: (...a: readonly unknown[]): unknown => {\n" +
    "      const h = a[1] as unknown as Handler\n" +
    "      h.onConnect((): void => {}); h.onHeaders(200, ['content-type', 'text/plain'], null, 'OK')\n" +
    "      h.onData('ONE'); h.onComplete(null); return true } }\n" +
    "    const i: RequestInit = { headers: { 'x-a': '1' } }\n" +
    "    ;(i as { dispatcher?: unknown }).dispatcher = d\n" +
    "    console.log('a ' + (await (await fetch(BASE + '/a', i)).text()))\n" +
    "  }\n" +
    "  {\n" +
    "    let n = 0\n" +
    "    const d: D = { dispatch: (...a: readonly unknown[]): unknown => {\n" +
    "      const h = a[1] as unknown as Handler\n" +
    "      n += 1; h.onConnect((): void => {})\n" +
    "      if (n === 1) { h.onHeaders(302, ['location', '/next'], null, 'Found'); h.onComplete(null) }\n" +
    "      else { h.onHeaders(200, [], null, 'OK'); h.onData('TWO'); h.onComplete(null) }\n" +
    "      return true } }\n" +
    "    const i: RequestInit = {}\n" +
    "    ;(i as { dispatcher?: unknown }).dispatcher = d\n" +
    "    console.log('b ' + String(n) + ' ' + (await (await fetch(BASE + '/b', i)).text()))\n" +
    "  }\n" +
    "  {\n" +
    "    const d: D = { dispatch: (...a: readonly unknown[]): unknown => {\n" +
    "      const h = a[1] as unknown as Handler\n" +
    "      h.onConnect((): void => {}); h.onError(new Error('down')); return true } }\n" +
    "    const i: RequestInit = {}\n" +
    "    ;(i as { dispatcher?: unknown }).dispatcher = d\n" +
    "    try { await fetch(BASE + '/c', i); console.log('c RESOLVED') }\n" +
    "    catch (e: unknown) { console.log('c ' + (e instanceof Error ? e.name : String(e))) }\n" +
    "  }\n" +
    "  {\n" +
    "    const d: D = { dispatch: (): unknown => { throw new Error('boom') } }\n" +
    "    const i: RequestInit = {}\n" +
    "    ;(i as { dispatcher?: unknown }).dispatcher = d\n" +
    "    try { await fetch(BASE + '/d', i); console.log('d RESOLVED') }\n" +
    "    catch (e: unknown) { console.log('d ' + (e instanceof Error ? e.name : String(e))) }\n" +
    "  }\n" +
    "  {\n" +
    "    const d: D = { dispatch: (...a: readonly unknown[]): unknown => { void a; return true } }\n" +
    "    const c = new AbortController()\n" +
    "    const i: RequestInit = { signal: c.signal }\n" +
    "    ;(i as { dispatcher?: unknown }).dispatcher = d\n" +
    "    setTimeout(() => { c.abort() }, 60)\n" +
    "    try { await fetch(BASE + '/e', i); console.log('e RESOLVED') }\n" +
    "    catch (e: unknown) { console.log('e ' + (e instanceof Error ? e.name : String(e))) }\n" +
    "  }\n" +
    "  {\n" +
    "    let held: Handler | null = null\n" +
    "    const d: D = { dispatch: (...a: readonly unknown[]): unknown => { held = a[1] as unknown as Handler; return true } }\n" +
    "    const i: RequestInit = {}\n" +
    "    ;(i as { dispatcher?: unknown }).dispatcher = d\n" +
    "    const p = fetch(BASE + '/f', i)\n" +
    "    await new Promise<void>((r) => { setTimeout(() => { r() }, 30) })\n" +
    "    const h = held as Handler | null\n" +
    "    if (h !== null) { h.onConnect((): void => {}); h.onHeaders(200, [], null, 'OK'); h.onData('LATE'); h.onComplete(null) }\n" +
    "    held = null\n" +
    "    console.log('f ' + (await (await p).text()))\n" +
    "  }\n" +
    "  console.log('END done')\n" +
    "}\nvoid main()\n";

  /** A fiber that never resumes, built the SAME way. The audit returns
   * before auditing when one exists, so this is what proves a clean
   * stderr above is a measurement and not a skip. */
  const CONTROL_SRC =
    "async function never(): Promise<void> {\n" +
    "  await new Promise<void>((): void => {})\n" +
    "  console.log('unreachable')\n" +
    "}\nvoid never()\nconsole.log('control done')\n";

  test("a delegated fetch leaves nothing behind, and the audit really ran", async () => {
    const prev = process.env["SCRIPTC_RC_AUDIT"];
    process.env["SCRIPTC_RC_AUDIT"] = "1";
    try {
      const dir = stage("rc-audit", RC_SRC.replaceAll("__HTTP__", origin!.http));
      const built = await compile(join(dir, "main.ts"), {
        outPath: join(dir, exeName("program")),
        outDir: dir,
        backend: "c",
      });
      expect(built.ok, (built.diagnostics ?? []).map((x) => x.code).join(",")).toBe(true);
      // The audit's own string must be IN the binary. `SCTRAP lines(0)` on
      // an untraced binary is a did-not-run, and so is an empty stderr on
      // a binary with no audit compiled into it.
      expect(
        readFileSync(built.binaryPath!).includes("scriptc RC audit"),
        "the audit was not compiled in — a clean stderr would prove nothing",
      ).toBe(true);
      const r = await run(built.binaryPath!, [], dir, 120_000);
      expect(r.stdout.trimEnd().split("\n").at(-1)).toBe("END done");
      expect(r.stderr.trim(), "a delegated fetch left objects live at exit").toBe("");
      expect(r.exitCode).toBe(0);

      const cdir = stage("rc-control", CONTROL_SRC);
      const cbuilt = await compile(join(cdir, "main.ts"), {
        outPath: join(cdir, exeName("program")),
        outDir: cdir,
        backend: "c",
      });
      expect(cbuilt.ok).toBe(true);
      const cr = await run(cbuilt.binaryPath!, [], cdir, 60_000);
      expect(
        cr.stderr,
        "the abandoned-fiber control did not report a skip — the audit above may not have run either",
      ).toMatch(/RC audit skipped: 1 fiber\(s\) never resumed/);

      // THE ABANDONED DISPATCHER, and it needs its own program because the
      // fixture above cannot carry it: a fetch whose promise is never
      // settled leaves a fiber suspended, and the audit RETURNS before
      // auditing when one exists. So the promise is DROPPED instead --
      // nothing awaits it, no fiber is left, and the audit runs.
      //
      // This row exists because the leak was real. A dispatcher that
      // returns without answering releases the handler INSIDE its own
      // call, and the "nobody can answer" test could not see that: the
      // transfer stayed in the registry and this program exited 99 with
      // 7 heap strings, 1 array, 1 box and 2 closures live.
      const adir = stage(
        "rc-abandoned",
        "interface D { dispatch(...args: readonly unknown[]): unknown }\n" +
          "async function main(): Promise<void> {\n" +
          "  const d: D = { dispatch: (...a: readonly unknown[]): unknown => { void a; return true } }\n" +
          "  const i: RequestInit = {}\n" +
          "  ;(i as { dispatcher?: unknown }).dispatcher = d\n" +
          "  void fetch('http://127.0.0.1:65001/x', i)\n" +
          "  await new Promise<void>((r) => { setTimeout(() => { r() }, 200) })\n" +
          "  console.log('dropped')\n" +
          "}\n" +
          "void main()\n",
      );
      const abuilt = await compile(join(adir, "main.ts"), {
        outPath: join(adir, exeName("program")),
        outDir: adir,
        backend: "c",
      });
      expect(abuilt.ok, (abuilt.diagnostics ?? []).map((x) => x.code).join(",")).toBe(true);
      const ar = await run(abuilt.binaryPath!, [], adir, 60_000);
      expect(ar.stdout.trim()).toBe("dropped");
      expect(
        ar.stderr.trim(),
        "an abandoned dispatcher left the transfer in the registry",
      ).toBe("");
      expect(ar.exitCode).toBe(0);
    } finally {
      if (prev === undefined) delete process.env["SCRIPTC_RC_AUDIT"];
      else process.env["SCRIPTC_RC_AUDIT"] = prev;
    }
  }, 900_000);
});
