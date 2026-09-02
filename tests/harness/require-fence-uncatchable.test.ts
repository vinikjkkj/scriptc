/* THE REFUSAL THAT MUST REACH THE USER — `require(<run-time specifier>)`.
 *
 * A deferred fence is a THROW, and a throw is CATCHABLE. That is the whole
 * value of `--best-effort` for a path a program never takes. It is a hazard
 * for a path the program TAKES inside a `try`, and protobufjs's `inquire()`
 * is exactly that shape — it ships in zapo's `spec/proto/index.js` bundle:
 *
 *     function inquire(m) {
 *       try {
 *         if (typeof require !== 'function') return null;
 *         var mod = require(m);
 *         return mod && (mod.length || Object.keys(mod).length) ? mod : null;
 *       } catch (e) { }
 *       return null;
 *     }
 *
 * MEASURED AT main `acba2b2d`, both backends, no `--best-effort` (this
 * construct emits its fence unconditionally): `inquire('buffer')`,
 * `inquire('node:path')` and `inquire('typescript')` each answered **null**
 * where Node hands back a module, at **exit 0, with no diagnostic anywhere**.
 * The throw was eaten by the program's own catch. The fence was not the
 * safeguard; the deadness of that call in that one bundle was — any other
 * consumer of the same construct got null and never knew.
 *
 * There is nothing to lower instead. The value would have to be a module
 * NAMESPACE OBJECT and the module graph would have to be dynamic; a compiled
 * program's graph is fixed at build time. So the job is not to answer the
 * construct, it is to make its refusal REACH THE USER — which is what
 * `fence.fatal` does (ir/nodes.ts): the same message with the same `[SCxxxx
 * at file:line]` stamp, printed as the "Uncaught Error: ..." line an uncaught
 * throw would have printed, then `_Exit(1)` without touching the exception
 * cell.
 *
 * THE OTHER HALF OF THIS FILE IS THE REGRESSION GUARD, and it is the reason
 * the change is scoped to one construct. Making refusals non-catchable is
 * exactly the change that turns a working program into a crash. The
 * `require` VERDICT has two answers, and only one of them is the fence:
 * every specifier the build can prove nothing resolves still gets Node's own
 * CATCHABLE `MODULE_NOT_FOUND`, and Node's argument errors still arrive as
 * catchable `TypeError`s. So the optional-dependency idiom — the reason
 * `inquire` exists — keeps working byte-for-byte. Those cells are asserted
 * against Node v25.9.0 in the same run, on both backends, and they are what
 * would fail if a later change widened `fatal` past this construct.
 */
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, test } from "vitest";
import { compile } from "@scriptc/compiler";
import { exeName } from "./exe.js";

const execFileAsync = promisify(execFile);

/* CommonJS on purpose: the ambient `require` this is about exists only in a
 * CJS source. The specifier always arrives through a parameter, so it is a
 * genuine run-time value and never a string-literal type the checker can
 * fold — `comptimeSpecifierOf` would answer that one at build time. */
const PROGRAM = [
  `'use strict';`,
  `// protobufjs's inquire(), verbatim.`,
  `function inquire(m) {`,
  `  try {`,
  `    if (typeof require !== 'function') return null;`,
  `    var mod = require(m);`,
  `    return mod && (mod.length || Object.keys(mod).length) ? mod : null;`,
  `  } catch (e) { /* protobufjs swallows it */ }`,
  `  return null;`,
  `}`,
  `// The optional-dependency idiom, whose CODE is the property it reads.`,
  `function tryRequire(spec) {`,
  `  try { require(spec); return 'GOT'; }`,
  `  catch (e) { return String(e.code); }`,
  `}`,
  `var mode = 'MODE';`,
  `if (mode === 'builtin') {`,
  `  console.log('buffer=' + (inquire('buffer') === null ? 'NULL' : 'module'));`,
  `} else if (mode === 'prefixed') {`,
  `  console.log('node:path=' + (inquire('node:path') === null ? 'NULL' : 'module'));`,
  `} else if (mode === 'installed') {`,
  `  console.log('dep=' + (inquire('scriptc-fence-fixture') === null ? 'NULL' : 'module'));`,
  `} else if (mode === 'absent') {`,
  `  // Nothing installed resolves these: Node throws MODULE_NOT_FOUND at the`,
  `  // require site, CATCHABLY, and the compiled expression IS that throw.`,
  `  console.log('a=' + tryRequire('no-such-pkg-xyz'));`,
  `  console.log('b=' + tryRequire('@nope/nothing'));`,
  `  console.log('c=' + tryRequire('./nothing-here-xyz'));`,
  `  console.log('d=' + tryRequire('node:nosuchmod'));`,
  `} else if (mode === 'argerr') {`,
  `  // Node validates the id BEFORE it resolves anything.`,
  `  console.log('e=' + tryRequire(''));`,
  `  console.log('f=' + tryRequire(42));`,
  `} else if (mode === 'inquire-absent') {`,
  `  // inquire's OWN swallow, over a specifier nothing resolves: null on`,
  `  // both sides, and the program keeps running. This is the cell that`,
  `  // proves the swallow itself was not broken, only the fence it ate.`,
  `  console.log('x=' + String(inquire('no-such-pkg-xyz')));`,
  `  console.log('y=' + String(inquire('@nope/nothing')));`,
  `}`,
  `console.log('end');`,
  ``,
].join("\n");

interface Run { code: number; stdout: string; stderr: string }

async function run(cmd: string, args: string[]): Promise<Run> {
  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, { timeout: 120_000 });
    return { code: 0, stdout, stderr };
  } catch (e) {
    const err = e as { code?: number | string; stdout?: string; stderr?: string; killed?: boolean };
    if (err.killed === true) throw new Error(`${cmd} ${args.join(" ")} timed out`);
    return {
      code: typeof err.code === "number" ? err.code : 1,
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? "",
    };
  }
}

/* One source per mode, because the mode has to be a COMPILE-TIME constant:
 * a run-time `process.argv` switch would leave every arm in the graph and
 * the fatal arm would then be the only thing this file could observe. */
const dir = mkdtempSync(join(tmpdir(), "scriptc-reqfence-"));

/* A real installed package under the source's own node_modules: the build
 * cannot rule out the bare root `scriptc-fence-fixture`, so the run-time
 * verdict answers "something might resolve this" and the site's refusal is
 * what runs. Node resolves it and hands back the module. Written here rather
 * than borrowed from the repo's node_modules so the cell does not depend on
 * what happens to be installed beside the test. */
const nm = join(dir, "node_modules", "scriptc-fence-fixture");
mkdirSync(nm, { recursive: true });
writeFileSync(join(nm, "package.json"), JSON.stringify({ name: "scriptc-fence-fixture", version: "1.0.0", main: "index.js" }), "utf8");
writeFileSync(join(nm, "index.js"), "module.exports = { hello: 1 };\n", "utf8");

const built = new Map<string, Promise<string>>();
function binary(backend: "c" | "llvm", mode: string): Promise<string> {
  const key = `${backend}:${mode}`;
  let p = built.get(key);
  if (p === undefined) {
    p = (async () => {
      const src = join(dir, `${mode}.cjs`);
      writeFileSync(src, PROGRAM.replace("'MODE'", JSON.stringify(mode)), "utf8");
      const res = await compile(src, {
        outPath: join(dir, exeName(`${mode}-${backend}`)),
        outDir: join(dir, `${backend}-${mode}`),
        backend,
      });
      if (!res.ok) throw new Error(`${backend}/${mode}: ${res.diagnostics[0]?.message ?? "did not compile"}`);
      return res.binaryPath!;
    })();
    built.set(key, p);
  }
  return p;
}

function srcOf(mode: string): string {
  return join(dir, `${mode}.cjs`);
}

/** A cell that must MATCH Node byte-for-byte: same stdout, same exit code.
 * The expected text is asserted against Node too, so a Node that started
 * answering something else fails the cell rather than moving the bar. */
async function match(backend: "c" | "llvm", mode: string, expected: string): Promise<void> {
  const bin = await binary(backend, mode);
  const node = await run(process.execPath, [srcOf(mode)]);
  expect(node.code, `node ${mode}`).toBe(0);
  expect(node.stdout.replace(/\r\n/g, "\n"), `node ${mode}`).toBe(expected);
  const exe = await run(bin, []);
  expect(exe.stdout.replace(/\r\n/g, "\n"), `${backend} ${mode}`).toBe(expected);
  expect(exe.code, `${backend} ${mode} exit`).toBe(0);
}

/** A cell where the compiled program CANNOT answer and must say so. Node
 * answers `module`; the binary must not answer at all — it names the
 * construct, stamps the code and the site, and leaves with a non-zero exit.
 * Silence on stdout is asserted as hard as the message: a refusal that lets
 * a plausible value out first is the defect this file exists for. */
async function refuses(backend: "c" | "llvm", mode: string, nodeSays: string): Promise<void> {
  const bin = await binary(backend, mode);
  const node = await run(process.execPath, [srcOf(mode)]);
  expect(node.code, `node ${mode}`).toBe(0);
  expect(node.stdout.replace(/\r\n/g, "\n"), `node ${mode}`).toBe(nodeSays);

  const exe = await run(bin, []);
  expect(exe.code, `${backend} ${mode} must not exit 0`).not.toBe(0);
  // Not "NULL", not "module", not "end": nothing at all. The refusal
  // happens where the value would have been produced.
  expect(exe.stdout, `${backend} ${mode} stdout`).toBe("");
  const err = exe.stderr.replace(/\r\n/g, "\n");
  expect(err, `${backend} ${mode} names the construct`).toContain(
    "'require() with a run-time specifier'",
  );
  // The code and the SITE, in the shape every other tagged refusal carries.
  expect(err, `${backend} ${mode} carries the tagged site`).toMatch(
    /\[SC\d{4} at [^\]]*\.cjs:\d+\]/,
  );
  // And it is the uncaught-error shape, not a bare line: a user who sees
  // this cannot tell it from an uncaught throw, which is the point.
  expect(err, `${backend} ${mode} is the uncaught shape`).toContain("Uncaught Error: ");
}

describe.each(["c", "llvm"] as const)("the run-time-specifier require refusal on the %s backend", (backend) => {
  test("a builtin the program asks for by run-time name refuses instead of answering null", async () => {
    await refuses(backend, "builtin", "buffer=module\nend\n");
  }, 600_000);

  test("a 'node:'-prefixed builtin refuses too — the prefix does not make it answerable", async () => {
    await refuses(backend, "prefixed", "node:path=module\nend\n");
  }, 600_000);

  test("an INSTALLED package the build cannot rule out refuses", async () => {
    await refuses(backend, "installed", "dep=module\nend\n");
  }, 600_000);

  test("a specifier NOTHING resolves keeps Node's own catchable MODULE_NOT_FOUND", async () => {
    // The regression guard. If `fatal` ever widened past this construct's
    // fence arm, every one of these four would become a crash instead.
    await match(
      backend,
      "absent",
      // node v25.9.0 answers ERR_UNKNOWN_BUILTIN_MODULE for a "node:"-prefixed
      // name that is not a builtin, not MODULE_NOT_FOUND. Asserted against node
      // in this same run, so the cell fails rather than drifting if that moves.
      "a=MODULE_NOT_FOUND\nb=MODULE_NOT_FOUND\nc=MODULE_NOT_FOUND\nd=ERR_UNKNOWN_BUILTIN_MODULE\nend\n",
    );
  }, 600_000);

  test("Node's argument errors still arrive catchably, before any resolution", async () => {
    await match(backend, "argerr", "e=ERR_INVALID_ARG_VALUE\nf=ERR_INVALID_ARG_TYPE\nend\n");
  }, 600_000);

  test("inquire's own swallow still works where Node also answers null", async () => {
    await match(backend, "inquire-absent", "x=null\ny=null\nend\n");
  }, 600_000);
});
