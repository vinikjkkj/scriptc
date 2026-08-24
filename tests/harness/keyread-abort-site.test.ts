/* THE KEYED-READ ABORT (ABORT.real), RUN — and the claim it refutes.
 *
 * A keyed read whose result width cannot spell `undefined` has nowhere to
 * put a missing key, so the emitted code aborts the process instead of
 * corrupting a typed slot. On zapo that family is 9 emitted helpers at 13
 * CALL SITES, and 11 of the 13 sit on a shape with NO index signature.
 *
 * Those 11 have been carried for several blocks as "the key is proven":
 * TypeScript will not typecheck `r[k]` on a signature-free object type
 * unless it proved `k` is one of the declared keys, so — the argument ran
 * — the miss cannot happen. The argument is half right and the half it
 * gets wrong is the half that matters, which is why this file RUNS the
 * two ways the proof is defeated instead of asserting it holds:
 *
 *   cast   `x as Level` on a string the checker knows nothing about. The
 *          oldest hole in TypeScript, and the one every lookup table in
 *          zapo is one call away from.
 *   cross  a value off `JSON.parse` asserted into a typed record. scriptc
 *          VALIDATES that crossing — and it has no literal-union type, so
 *          it validates `level` as `string`. A wire value of "zzz" passes
 *          the dyn boundary and reaches the read.
 *
 * Node answers `undefined` in both and keeps going. The compiled program
 * aborts. That divergence is not new and this file does not fix it — a
 * `number` slot has no `undefined` to hold, and widening it is a rung at
 * the DESTINATION, not here. What this file pins is that the abort, when
 * it happens, SAYS WHERE: `(SC9003 at <file>:<line>:<col>)`, plus the
 * sentence naming the keys the shape declared. Before that it printed the
 * key and nothing else — no code, no file, no line, the same diagnostic
 * shape `scr_dyn_new_func`'s NULL `sig` had.
 *
 * Both lanes, because the C lane interns a helper per (shape, result
 * type) and the LLVM lane inlines the chain and calls one shared
 * `@sc_bad_key`: two entirely different emissions of one contract, and
 * the only way to know they still agree is to run both.
 *
 * The byte scan on the shipping binary is the other half of the running
 * cell, for the reason the trap-trace rule in this repo exists: a message
 * the linker dropped is not a message, and a run that does not print it
 * cannot tell you which.
 */
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, test } from "vitest";
import { compile } from "@scriptc/compiler";
import { exeName } from "./exe.js";

const execFileAsync = promisify(execFile);

/* One program, four modes, chosen at RUN time so a single build covers
 * every cell. `bad` arrives as argv rather than as a literal so the `as`
 * is a widening cast the checker accepts. */
const PROGRAM = [
  `type Level = 'trace' | 'debug' | 'info';`,
  `type Attrs = { [k: string]: string };`,
  `const RANK: Readonly<Record<Level, number>> = { trace: 10, debug: 20, info: 30 };`,
  `interface Cfg { readonly level: Level }`,
  `function rank(l: Level): number {`,
  `  return RANK[l];`,
  `}`,
  `function attr(a: Attrs, k: string): string {`,
  `  return a[k];`,
  `}`,
  `const mode = process.argv[2] ?? 'ok';`,
  `const bad = process.argv[3] ?? 'zzz';`,
  `const bag: Attrs = { to: 'x' };`,
  `if (mode === 'ok') {`,
  `  console.log('rank=' + String(rank('debug')));`,
  `  console.log('attr=' + attr(bag, 'to'));`,
  `} else if (mode === 'cast') {`,
  `  console.log('rank=' + String(rank(bad as Level)));`,
  `} else if (mode === 'cross') {`,
  `  const raw: unknown = JSON.parse('{"level":"' + bad + '"}');`,
  `  const cfg = raw as Cfg;`,
  // STDERR, not stdout, and the reason is a measurement lesson rather
  // than a style choice: a C stdout writing to a pipe is block-buffered,
  // and an abort takes the process down without flushing it. The first
  // run of this file asserted the line on stdout, saw nothing, and would
  // have read as "the dyn boundary refused the value" — the exact
  // opposite of what happened. stderr is unbuffered.
  `  console.error('crossed=' + cfg.level);`,
  `  console.log('rank=' + String(rank(cfg.level)));`,
  `} else {`,
  `  console.log('attr=' + attr(bag, 'nope'));`,
  `}`,
  `console.log('end');`,
  ``,
].join("\n");

/** The 1-based line and column of a substring of PROGRAM — the coordinate
 * the emitted site must carry, computed from the text rather than copied,
 * so a shifted program cannot quietly stop testing anything. */
function lineCol(needle: string): string {
  const at = PROGRAM.indexOf(needle);
  if (at < 0) throw new Error(`the fixture no longer contains ${needle}`);
  const before = PROGRAM.slice(0, at);
  return `${before.split("\n").length}:${at - before.lastIndexOf("\n")}`;
}

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

const dir = mkdtempSync(join(tmpdir(), "scriptc-rkgsite-run-"));
const src = join(dir, "main.ts");
writeFileSync(src, PROGRAM, "utf8");
const srcSite = src.replace(/\\/g, "/");

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

describe.each(["c", "llvm"] as const)("SC9003 on the %s backend", (backend) => {
  test("a key the table HAS matches Node byte for byte", async () => {
    const bin = await binary(backend);
    const node = await run(process.execPath, [src, "ok", "zzz"]);
    const exe = await run(bin, ["ok", "zzz"]);
    expect(node.code).toBe(0);
    expect(exe.code).toBe(0);
    expect(exe.stdout).toBe(node.stdout);
    expect(exe.stdout).toBe("rank=20\nattr=x\nend\n");
  }, 600_000);

  test("an `as` cast REACHES the abort, and the abort names the read", async () => {
    const bin = await binary(backend);
    // Node's answer, stated rather than assumed: `undefined`, exit 0.
    const node = await run(process.execPath, [src, "cast", "zzz"]);
    expect(node.code).toBe(0);
    expect(node.stdout).toBe("rank=undefined\nend\n");
    // scriptc's: an abort. The divergence is old; the NAME is the subject.
    const exe = await run(bin, ["cast", "zzz"]);
    expect(exe.code).not.toBe(0);
    expect(exe.stderr).toContain(`(SC9003 at ${srcSite}:${lineCol("RANK[l]")})`);
    expect(exe.stderr).toContain("the shape declares only {debug, info, trace} and has no index signature");
  }, 600_000);

  test("a JSON crossing reaches it too: the dyn boundary validates `string`, not the union", async () => {
    const bin = await binary(backend);
    const node = await run(process.execPath, [src, "cross", "zzz"]);
    expect(node.code).toBe(0);
    expect(node.stderr).toContain("crossed=zzz");
    expect(node.stdout).toBe("rank=undefined\nend\n");
    const exe = await run(bin, ["cross", "zzz"]);
    // The crossing itself does NOT refuse the value — that is the finding,
    // and the marker printed before the abort is how it is observed.
    expect(exe.stderr).toContain("crossed=zzz");
    expect(exe.code).not.toBe(0);
    expect(exe.stderr).toContain(`(SC9003 at ${srcSite}:${lineCol("RANK[l]")})`);
  }, 600_000);

  test("an index-signature miss names ITS read, with the other sentence", async () => {
    const bin = await binary(backend);
    const node = await run(process.execPath, [src, "miss", "zzz"]);
    expect(node.code).toBe(0);
    expect(node.stdout).toBe("attr=undefined\nend\n");
    const exe = await run(bin, ["miss", "zzz"]);
    expect(exe.code).not.toBe(0);
    expect(exe.stderr).toContain(`(SC9003 at ${srcSite}:${lineCol("a[k];")})`);
    expect(exe.stderr).toContain("the key is absent from the index signature");
    // and NOT the declared-keys sentence: the two classes are different
    // facts about the program and must not be answered with one sentence.
    expect(exe.stderr).not.toContain("has no index signature");
  }, 600_000);

  test("the site and the code are IN the shipping binary, not only in the TU", async () => {
    const bin = await binary(backend);
    const bytes = readFileSync(bin).toString("latin1");
    expect(bytes).toContain("(SC9003 at ");
    expect(bytes).toContain(`${srcSite}:${lineCol("RANK[l]")}`);
    expect(bytes).toContain("no undefined is representable");
  }, 600_000);
});
