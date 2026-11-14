/* The executable's .rela.dyn is released with the first text drop (Linux, glibc): runtime/src/scr_async.c scr_rela_release.
 *
 * The table is 1.4-1.6 MiB in the big bench binaries and nothing reads it after ld.so has relocated the program, so its pages are dropped with
 * MADV_DONTNEED (whole pages inside DT_RELA/DT_RELASZ only). This test builds a program with a table of several pages, lets it reach the idle seam
 * (an interval timer, so the loop sleeps more than once), and reads the one number the runtime prints under SCR_TEXT_DROP_STAT=1.
 * POSITIVE CONTROL: the released KiB is > 0 with the drop on. NEGATIVE CONTROL: SCR_TEXT_DROP=0 prints no drop line at all. Both runs print the same
 * program output, so releasing the table changes nothing the program can see. */
import { spawnSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { compile } from "@scriptc/compiler";
import { exeName } from "./exe.js";

const repoRoot = join(import.meta.dirname, "../..");
const cacheDir = join(repoRoot, "node_modules/.cache/scriptc-tests");
const glibc = process.platform === "linux" && typeof (process.report?.getReport() as { header?: { glibcVersionRuntime?: string } } | undefined)?.header?.glibcVersionRuntime === "string";

describe.skipIf(!glibc)("the executable's relocation table is released with the first text drop", () => {
  test("released KiB > 0 with the drop on, no drop line with SCR_TEXT_DROP=0, same output", async () => {
    const dir = join(cacheDir, "rela-release");
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    const base = await readFile(join(repoRoot, "tests/corpus/1301-errors-subclass.ts"), "utf8");
    const src = join(dir, "p.ts");
    // heavy enough to carry a multi-page relocation table, then an interval so the loop idles at least twice
    await writeFile(src, base + "\nlet ticks = 0;\nconst iv = setInterval(() => { if (++ticks >= 8) { clearInterval(iv); console.log(\"done-ticking\"); } }, 100);\n");
    const result = await compile(src, { outPath: join(dir, exeName("program")), outDir: dir, backend: "c" });
    if (!result.ok) throw new Error(result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"));
    const run = (env: Record<string, string>) => spawnSync(result.binaryPath, [], { encoding: "utf8", env: { ...process.env, ...env } });
    const on = run({ SCR_TEXT_DROP_STAT: "1" });
    const off = run({ SCR_TEXT_DROP: "0", SCR_TEXT_DROP_STAT: "1" });
    expect(on.status).toBe(0);
    const m = /\[textdrop\] drop #1 .* relaDynKiBReleased (\d+)/.exec(on.stderr);
    expect(m, `no relaDynKiBReleased in: ${on.stderr}`).not.toBeNull();
    expect(Number(m![1])).toBeGreaterThan(0);
    expect(off.stderr).not.toContain("[textdrop]");
    expect(on.stdout).toBe(off.stdout);
  }, 240_000);
});
