/* THE FOUR DEFECT-GRADE KEYED READS, RUN — and the trap the fix can spring.
 *
 * `estado-abort13` §3.1 sorts zapo's thirteen `ABORT.real` call sites and
 * finds four of them defects TODAY: two `CONSOLE_WRITERS[level](…)` and two
 * `AB_PROP_CONFIGS[name].defaultValue`. At both consumers Node throws a
 * CATCHABLE TypeError, the program's own `catch` sees it, and the process
 * finishes at exit 0 — while the compiled program aborted, walking straight
 * past that `catch`. Two of the four execute on every paired zapo run.
 *
 * The hazard in closing them is the mirror of the hazard in opening them:
 * making an abort catchable is exactly the change that can let a program
 * continue past a state it should not survive, and reaching for the DYN
 * rung (whose `scr_dyn_call` already emits Node's "is not a function" text)
 * is exactly the change that can sever aliasing on the HIT path. So this
 * file does not merely check the two messages. It checks, against Node
 * v25.9.0 and on BOTH backends:
 *
 *   order   JS evaluates the ARGUMENT LIST before it checks the callee is
 *           callable, so a side-effecting argument runs even though the
 *           call throws. (EvaluateCall: ArgumentListEvaluation, then
 *           IsCallable.)
 *   alias   the HIT path still hands the callee THE VERY OBJECT the caller
 *           holds. A dyn-widened callee deep-copies it and this prints 0.
 *   class   the caught value is a real TypeError at both consumers.
 *   after   the program CONTINUES with the state Node continues with —
 *           the loop count, the mutated context, a later table read.
 *   guard   the already-working guarded spelling does not move.
 *
 * Both lanes, because the C lane interns a helper per (shape, result type)
 * and the LLVM lane inlines the chain: two emissions of one contract.
 */
import { execFile } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, test } from "vitest";
import { compile } from "@scriptc/compiler";
import { exeName } from "./exe.js";

const execFileAsync = promisify(execFile);

const PROGRAM = [
  `type LogLevel = 'trace' | 'debug' | 'info';`,
  `interface Ctx { seen: number }`,
  `const CONSOLE_WRITERS: Record<LogLevel, (message: string, context: Ctx) => void> = {`,
  `  trace: (m: string, c: Ctx) => { c.seen = c.seen + 1; console.log('trace ' + m); },`,
  `  debug: (m: string, c: Ctx) => { c.seen = c.seen + 2; console.log('debug ' + m); },`,
  `  info: (m: string, c: Ctx) => { c.seen = c.seen + 3; console.log('info ' + m); },`,
  `};`,
  `interface Cfg { dflt: string; rank: number }`,
  `const CONFIGS: Record<'alpha' | 'beta', Cfg> = {`,
  `  alpha: { dflt: 'A', rank: 1 },`,
  `  beta: { dflt: 'B', rank: 2 },`,
  `};`,
  `let effects = '';`,
  `function noisy(tag: string, c: Ctx): Ctx { effects = effects + tag; return c; }`,
  `const mode = process.argv[2] ?? 'order';`,
  `const bad = process.argv[3] ?? 'zzz';`,
  `if (mode === 'order') {`,
  `  const ctx: Ctx = { seen: 0 };`,
  `  try {`,
  `    CONSOLE_WRITERS[bad as LogLevel]('m', noisy('ARG', ctx));`,
  `    console.log('no-throw');`,
  `  } catch (e) {`,
  `    console.log('caught ' + (e as Error).message);`,
  `  }`,
  `  console.log('effects=' + effects);`,
  `} else if (mode === 'alias') {`,
  `  const ctx: Ctx = { seen: 0 };`,
  `  CONSOLE_WRITERS['info' as LogLevel]('m', ctx);`,
  `  CONSOLE_WRITERS['trace' as LogLevel]('m', ctx);`,
  `  console.log('seen=' + String(ctx.seen));`,
  `} else if (mode === 'class') {`,
  `  let kind = 'none';`,
  `  let msg = 'none';`,
  `  try {`,
  `    CONSOLE_WRITERS[bad as LogLevel]('m', { seen: 0 });`,
  `  } catch (e) {`,
  `    kind = e instanceof TypeError ? 'TypeError' : e instanceof Error ? 'Error' : 'other';`,
  `    msg = (e as Error).message;`,
  `  }`,
  `  let kind2 = 'none';`,
  `  let msg2 = 'none';`,
  `  try {`,
  `    console.log('unreached ' + CONFIGS[bad as 'alpha'].dflt);`,
  `  } catch (e) {`,
  `    kind2 = e instanceof TypeError ? 'TypeError' : e instanceof Error ? 'Error' : 'other';`,
  `    msg2 = (e as Error).message;`,
  `  }`,
  `  console.log('kind=' + kind + ' kind2=' + kind2);`,
  `  console.log('msg=' + msg);`,
  `  console.log('msg2=' + msg2);`,
  `} else if (mode === 'after') {`,
  `  const ctx: Ctx = { seen: 7 };`,
  `  let n = 0;`,
  `  for (const lvl of ['info', bad, 'debug']) {`,
  `    try {`,
  `      CONSOLE_WRITERS[lvl as LogLevel]('m', ctx);`,
  `      n = n + 1;`,
  `    } catch {`,
  `      n = n + 100;`,
  `    }`,
  `  }`,
  `  console.log('n=' + String(n) + ' seen=' + String(ctx.seen));`,
  `  console.log('rank=' + String(CONFIGS['beta' as 'alpha' | 'beta'].rank));`,
  `} else {`,
  `  const w = CONSOLE_WRITERS[bad as LogLevel] as ((m: string, c: Ctx) => void) | undefined;`,
  `  console.log('guard=' + String(w === undefined));`,
  `}`,
  `console.log('end');`,
  ``,
].join("\n");

interface Run { code: number; stdout: string; stderr: string }

async function run(cmd: string, args: string[]): Promise<Run> {
  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, { timeout: 60_000 });
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

const dir = mkdtempSync(join(tmpdir(), "scriptc-rkgcatch-"));
const src = join(dir, "main.ts");
writeFileSync(src, PROGRAM, "utf8");

const built = new Map<string, Promise<string>>();
function binary(backend: "c" | "llvm"): Promise<string> {
  let p = built.get(backend);
  if (p === undefined) {
    p = (async () => {
      const res = await compile(src, {
        outPath: join(dir, exeName(`program-${backend}`)),
        outDir: join(dir, backend),
        backend,
      });
      if (!res.ok) throw new Error(`${backend}: ${res.diagnostics[0]?.message ?? "did not compile"}`);
      return res.binaryPath!;
    })();
    built.set(backend, p);
  }
  return p;
}

/** One mode, scored against the oracle in the SAME run — the compiled
 * program never asserts against a transcribed expectation. The expected
 * text is asserted too, so a Node that started answering something else
 * would fail the cell rather than move the bar. */
async function cell(backend: "c" | "llvm", mode: string, expected: string): Promise<void> {
  const bin = await binary(backend);
  const node = await run(process.execPath, [src, mode, "zzz"]);
  expect(node.code, `node ${mode}`).toBe(0);
  expect(node.stdout, `node ${mode}`).toBe(expected);
  const exe = await run(bin, [mode, "zzz"]);
  expect(exe.stdout, `${backend} ${mode}`).toBe(node.stdout);
  expect(exe.code, `${backend} ${mode} exit`).toBe(node.code);
}

describe.each(["c", "llvm"] as const)("the catchable keyed-read rungs on the %s backend", (backend) => {
  test("a missing CALLED key throws Node's own text, catchably, past nothing", async () => {
    await cell(
      backend,
      "order",
      // The argument's effect is recorded even though the call throws: JS
      // evaluates the argument list BEFORE it checks the callee is callable.
      "caught CONSOLE_WRITERS[bad] is not a function\neffects=ARG\nend\n",
    );
  }, 600_000);

  test("the HIT path still hands the callee the caller's own object", async () => {
    // 3 + 1 = 4. A dyn-widened callee deep-copies the context and prints 0.
    await cell(backend, "alias", "info m\ntrace m\nseen=4\nend\n");
  }, 600_000);

  test("both consumers throw a real TypeError with Node's own message", async () => {
    await cell(
      backend,
      "class",
      "kind=TypeError kind2=TypeError\n" +
        "msg=CONSOLE_WRITERS[bad] is not a function\n" +
        "msg2=Cannot read properties of undefined (reading 'dflt')\n" +
        "end\n",
    );
  }, 600_000);

  test("the program continues after its own catch with the state Node has", async () => {
    // Two hits (+3, +2 on a `seen` that started at 7) and one miss.
    await cell(backend, "after", "info m\ndebug m\nn=102 seen=12\nrank=2\nend\n");
  }, 600_000);

  test("the guarded spelling, which already worked, does not move", async () => {
    await cell(backend, "guard", "guard=true\nend\n");
  }, 600_000);
});
