import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { ccCompile, testBin } from "./cc.js";
import { expect, test } from "vitest";

const execFileAsync = promisify(execFile);
const testDir = import.meta.dirname;
const srcDir = join(testDir, "../src");

/* ONE binary, three arms chosen by env. The arms differ only in how the
 * table resolves a collision, so a difference between them cannot be a
 * difference in the code under test — which is the whole reason the ways
 * and admission knobs are read at runtime rather than compiled in.
 *
 * The table is built at 64 entries (-DSCR_STR_INTERN_BITS=6) so the 4,000
 * cold strings the survival test streams are a full table sixty times over.
 * At the shipping 65,536 the same test would prove nothing: nothing would
 * ever collide, and "the hot entry survived" would be true for the wrong
 * reason. */
const DEFINES = ["-DSCR_RC_AUDIT", "-DSCR_STR_INTERN_BITS=6"];

let built: Promise<string> | undefined;
function build(): Promise<string> {
  return (built ??= (async () => {
    const buildDir = join(testDir, "build");
    await mkdir(buildDir, { recursive: true });
    const bin = testBin(buildDir, "test_intern");
    await ccCompile([
      "-std=c11", "-O1", "-Wall", "-Wextra",
      "-fsanitize=address", ...DEFINES,
      "-o", bin,
      join(testDir, "test_intern.c"),
      join(srcDir, "scr_string.c"),
      join(srcDir, "scr_number.c"),
      join(srcDir, "scr_array.c"),
      join(srcDir, "scr_bytes.c"),
      join(srcDir, "scr_error.c"),
      join(srcDir, "scr_exception.c"),
      join(srcDir, "scr_object.c"),
      join(srcDir, "scr_cycle.c"),
      ...(process.platform === "linux" ? ["-D_GNU_SOURCE", "-lm"] : []),
    ]);
    return bin;
  })());
}

async function run(env: Record<string, string>): Promise<string> {
  const bin = await build();
  const { stderr } = await execFileAsync(bin, [], {
    env: { ...process.env, ...env },
  });
  return stderr;
}

/**
 * `hotAdmitted=<a>/<n> hotSurvived=<s>/<n>` off the arm's report line.
 *
 * SURVIVAL IS SCORED AGAINST ADMITTED, never against the population: a
 * 64-entry table in 16 sets can legitimately refuse a hot content whose set
 * is already full of hot contents, and counting a correct refusal as a loss
 * would pin this test to one hash forever. `admitted` also carries its own
 * floor — an arm that admitted nothing would satisfy `survived == admitted`
 * vacuously, which is the same "0/0 cases passed" shape cc.ts's
 * expectCasesPassed exists to refuse.
 */
function score(stderr: string): { admitted: number; kept: number; total: number } {
  const m = /hotAdmitted=(\d+)\/(\d+) hotSurvived=(\d+)\/(\d+)/.exec(stderr);
  if (m === null) {
    throw new Error(`no hotAdmitted/hotSurvived line in:\n${stderr}`);
  }
  return { admitted: Number(m[1]), kept: Number(m[3]), total: Number(m[2]) };
}

test("content interning: the four invariants, under the shipping settings", async () => {
  const stderr = await run({});
  expect(stderr.trim().split("\n").at(-1)).toBe("all intern tests passed");
  const { admitted, kept, total } = score(stderr);
  // I4. Every ADMITTED entry survives a cold stream sixty times the table's
  // size — the cold traffic moves nothing the program is still holding.
  expect(admitted).toBeGreaterThanOrEqual(total - 1);
  expect(kept).toBe(admitted);
});

test("content interning: OFF is a different program, not the same one", async () => {
  // Without this arm every assertion in the ON arm could be passing on a
  // table that was never reached: `mk` returning one pointer twice would
  // look identical to a hit. Here the same builds MUST return two.
  const stderr = await run({ SCR_STRING_INTERN: "0" });
  expect(stderr.trim().split("\n").at(-1)).toBe("all intern tests passed");
  expect(stderr).toContain("intern OFF");
});

test("the direct-mapped control loses hot entries the shipping table keeps", async () => {
  // THE POSITIVE CONTROL. `WAYS=1 ADMIT=0` is the table this one replaced:
  // direct-mapped, evicting unconditionally. On the identical workload it
  // must drop entries the program is still holding — that is the thrash the
  // rewrite exists to remove, and on the real messaging bench it was worth a
  // 156.68-181.20 MiB spread across six runs of one arm.
  //
  // If this arm ever reports a full house, the survival test has stopped
  // colliding and the shipping arm's green is meaningless.
  const control = score(await run({
    SCR_STRING_INTERN_WAYS: "1",
    SCR_STRING_INTERN_ADMIT: "0",
  }));
  expect(control.admitted).toBeGreaterThan(0);
  expect(control.kept).toBeLessThan(control.admitted);

  // The two halves of the change, separately, so a later edit that drops one
  // of them shows up here rather than in a bench number six hours later.
  // Neither is asserted to be the whole fix: with min-rc eviction, ways alone
  // already keeps a held entry as long as its set has one spare way, and
  // admission alone keeps every held entry even direct-mapped. What the pair
  // buys over admission alone is the case admission has to refuse.
  const waysOnly = score(await run({ SCR_STRING_INTERN_ADMIT: "0" }));
  const admitOnly = score(await run({ SCR_STRING_INTERN_WAYS: "1" }));
  expect(waysOnly.kept).toBeGreaterThan(control.kept);
  expect(admitOnly.kept).toBe(admitOnly.admitted);
});
