/* THE MICROTASK-TURN CONTRACT, pinned as numbers on both lanes.
 *
 * `await` is not just "resumes with the right value": it resumes after a
 * specific NUMBER of microtask turns, and a program that prints the right
 * lines one turn early has already diverged from Node. This file pins that
 * number for every async construct the compiler lowers, measured against Node
 * v25.9.0 with a ruler rather than read off the spec, and runs the same
 * program under Node here so the pins cannot drift away from the oracle while
 * still agreeing with themselves.
 *
 * WHY IT EXISTS, which is the part worth reading before touching async.
 *
 * The differential corpus cannot carry this contract. Measured 2026-10-05 with
 * SCR_TICK_POISON (scr_async.c), which adds exactly one microtask turn to
 * every already-settled await: over the 313 corpus programs that touch a
 * promise or a timer, 10 change their bytes and 276 do not. The rule behind
 * that:
 *
 *     A uniform one-turn shift is only observable where TWO independent job
 *     chains interleave, and almost no corpus program has two.
 *
 * `1428-settled-await-order.ts` -- the program the comment on scr_await_yield
 * names as the pin for the settled-await hop -- passes POISONED, because it
 * has one chain and a shifted chain prints the same lines in the same order.
 * So do 1021-async-ordering, 1029-async-eager-chains, 1430-promise-race,
 * 1438-promise-all, 1561-promise-then, 2310-process-next-tick and
 * 2623-ee-job-queue. The ten that do see it:
 *
 *     518-promise-void-union-callbacks    519-promise-union-await-values
 *     2210-dyn-promise-crossing           2282-queue-microtask
 *     2320-await-unit                     5932-async-generators-ordering
 *     5960-for-await-over-a-stream-pays-the-iterators-turns
 *     5962-a-parked-for-await-wakes-on-a-tick-not-on-the-push
 *     7470-promiselike-is-a-promise-slot  7791-awaiting-a-promise-that-may-be-absent
 *
 * THREE ROWS WHERE THIS RUNTIME DIVERGES FROM NODE BY ONE TURN. They are
 * pinned here with the scriptc number and the Node number beside it,
 * deliberately and as they are today -- see each row comment. They are NOT
 * bugs this file is waiting to have fixed; changing them is separate work with
 * its own differential, because moving observable order and changing the async
 * representation in one diff makes it impossible to say which change moved
 * what.
 *
 * TWO CLOCKS. The fixture explains them; the short version is that a clock
 * built out of the construct under test cannot see that construct move, so
 * rows 1-15 are measured with a clock immune to the settled-await path and
 * rows 16-18 re-measure three of them with a clock that rides it.
 *
 * THE SELF-TEST. The last assertion per backend sets SCR_TICK_POISON and
 * requires the table to MOVE. A net that cannot report "nothing changed" is
 * not trustworthy when it reports it, and this one says so out loud.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, test } from "vitest";
import { compile } from "@scriptc/compiler";
import { exeName } from "./exe.js";

const execFileAsync = promisify(execFile);
const repoRoot = join(import.meta.dirname, "../..");
const cacheDir = join(repoRoot, "node_modules/.cache/scriptc-tests");
const sanitize = process.env["SCRIPTC_SAN"] === "1";

/* Node v25.9.0. */
const NODE_EXPECTED = [
  "1  await null",
  "1  await new Promise(r => r(v))",
  "1  await asyncWithNoAwait()",
  // Node resolves the outer promise WITH a promise: NewPromiseResolveThenableJob
  // plus the inner reaction, two jobs. scriptc lowers `return p` as
  // `return await p` (lowerer.ts asyncReturnFlatten), one job. SEMANTICS.md 358
  // numbers the Promise.try face of this; it is the whole construct.
  "3  await (async () => { return p })()",
  "2  await (async () => { return await p })()",
  "2  await (async () => { return await asyncWithNoAwait() })()",
  "2  await p.then(f)",
  "1  await Promise.resolve(v)",
  // Node subscribes to every entry with .then, so an ALREADY-SETTLED entry
  // still delivers through a reaction job and the result settles a turn later.
  // scr_promise_all settles the result inline at construction (scr_async.c).
  "2  await Promise.all([settled, settled])",
  "3  for await over a 1-yield async generator",
  "5  for await over a 2-yield async generator",
  "7  for await over a 3-yield async generator",
  // Same shape as Promise.all: scr_promise_race_add settles inline when the
  // entry is already settled (scr_async.c). SEMANTICS.md records it, unnumbered.
  "2  await Promise.race([settled, settled])",
  "2  await a pending promise resolved by queueMicrotask",
  "1  await a pending promise resolved by process.nextTick",
  "1  clockB: await null",
  "1  clockB: await new Promise(r => r(v))",
  "1  clockB: await asyncWithNoAwait()",
  "",
].join("\n");

/* scriptc, both backends. Identical to Node except the three rows whose
 * comments above say why, each of which is ONE turn cheaper here. */
const NATIVE_EXPECTED = NODE_EXPECTED.replace(
  "3  await (async () => { return p })()",
  "2  await (async () => { return p })()",
)
  .replace("2  await Promise.all([settled, settled])", "1  await Promise.all([settled, settled])")
  .replace(
    "2  await Promise.race([settled, settled])",
    "1  await Promise.race([settled, settled])",
  );

async function run(cmd: string, args: string[], poison: boolean): Promise<string> {
  const env = { ...process.env } as Record<string, string>;
  if (poison) env["SCR_TICK_POISON"] = "1";
  else delete env["SCR_TICK_POISON"];
  const { stdout } = await execFileAsync(cmd, args, { encoding: "utf8", timeout: 120_000, env });
  return stdout.replace(/\r\n/g, "\n");
}

/** The turn count of one labelled row, for the per-row poison assertion. */
function rowOf(table: string, label: string): number {
  const line = table.split("\n").find((l) => l.endsWith(`  ${label}`));
  if (line === undefined) throw new Error(`no row '${label}' in:\n${table}`);
  return Number(line.slice(0, line.indexOf(" ")));
}

/* The program lives in tests/fixtures, NOT under node_modules/.cache: node
 * refuses to strip types from a .ts file inside node_modules, so an oracle run
 * from the build cache would fail before it printed a line. */
const src = join(repoRoot, "tests/fixtures/microtask-turns/turns.ts");

describe("async constructs: the microtask-turn count", () => {
  const key = createHash("sha256")
    .update(readFileSync(src))
    .update(sanitize ? "san" : "plain")
    .digest("hex")
    .slice(0, 16);
  const dir = join(cacheDir, `microtask-turns-${key}`);

  test("node is the oracle and agrees with the pinned counts", async () => {
    expect(await run("node", [src], false)).toBe(NODE_EXPECTED);
  });

  for (const backend of ["c", "llvm"] as const) {
    test(`${backend} backend`, async () => {
      const outDir = join(dir, backend);
      mkdirSync(outDir, { recursive: true });
      const result = await compile(src, {
        outPath: join(outDir, exeName("turns")),
        outDir,
        sanitize,
        backend,
      });
      if (!result.ok) {
        throw new Error(result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"));
      }
      const clean = await run(result.binaryPath, [], false);
      expect(clean).toBe(NATIVE_EXPECTED);

      /* The self-test: one extra turn on every already-settled await has to
       * MOVE this table. If it ever stops moving, the net is dead and the
       * clean assertion above means nothing. */
      const poisoned = await run(result.binaryPath, [], true);
      expect(poisoned).not.toBe(clean);
      expect(rowOf(poisoned, "await new Promise(r => r(v))")).toBe(
        rowOf(clean, "await new Promise(r => r(v))") + 1,
      );
    });
  }
});
