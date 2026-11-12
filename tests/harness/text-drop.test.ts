/* THE FIRST IDLE SEAM AFTER STARTUP DROPS THE PROGRAM'S OWN EXECUTABLE TEXT ONCE -- AND SAYS SO.
 *
 * scr_async.c's sleep seam calls MADV_DONTNEED on the executable's r-xp mappings once, after SCR_TEXT_DROP_AFTER_MS
 * of loop time (Linux/glibc only). The pages stay in the page cache and fault back in on use: this lowers the
 * process's resident set, not system memory. The measured effect (redis bench: peak RSS 116.7 -> 104.8 MiB) is in the
 * commit; what is pinned HERE is the mechanism, deterministically:
 *
 *   knob on  -- exactly one `[textdrop] drop #1` line (a 600 ms program never reaches the 2 s repeat interval), with a residency after the drop no larger than before;
 *   SCR_TEXT_DROP=0 -- prints nothing at all (the negative control: a drop that found nothing still prints);
 *   a short program that exits before the delay pays nothing: no line even with the stat knob on;
 *   stdout is identical in every arm.
 */
import { execFile } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { beforeAll, describe, expect, test } from "vitest";
import { compile } from "@scriptc/compiler";
import { exeName } from "./exe.js";

const execFileAsync = promisify(execFile);
const repoRoot = join(import.meta.dirname, "../..");
const cacheDir = join(repoRoot, "node_modules/.cache/scriptc-tests");
const sanitize = process.env["SCRIPTC_SAN"] === "1";
const linux = process.platform === "linux";

async function build(name: string): Promise<string> {
  const dir = join(cacheDir, `text-drop-${sanitize ? "san" : "plain"}`);
  mkdirSync(dir, { recursive: true });
  const result = await compile(join(repoRoot, "tests/fixtures/text-drop", `${name}.ts`), {
    outPath: join(dir, exeName(name)),
    outDir: dir,
    sanitize,
  });
  if (!result.ok) throw new Error(result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"));
  return result.binaryPath;
}

async function run(bin: string, env: Record<string, string>): Promise<{ stdout: string; lines: string[] }> {
  const { stdout, stderr } = await execFileAsync(bin, [], {
    encoding: "utf8",
    timeout: 60_000,
    env: { ...process.env, ...env },
  });
  return { stdout: stdout.replace(/\r\n/g, "\n"), lines: stderr.split("\n").filter((l) => l.startsWith("[textdrop]")) };
}

describe.skipIf(!linux)("the text drop fires once at the first idle seam, behind a knob", () => {
  let idle = "";
  let short = "";
  beforeAll(async () => {
    idle = await build("idle");
    short = await build("short");
  }, 300_000);

  test("on: exactly one line, residency does not grow", async () => {
    const r = await run(idle, { SCR_TEXT_DROP_STAT: "1" });
    expect(r.stdout).toBe("done 6\n");
    expect(r.lines).toHaveLength(1);
    const m = /drop #1 mappings=(\d+) exeTextKiB (\d+)->(\d+)/.exec(r.lines[0]!);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeGreaterThanOrEqual(1);
    expect(Number(m![3])).toBeLessThanOrEqual(Number(m![2]));
  });

  test("SCR_TEXT_DROP=0 prints nothing (the negative control)", async () => {
    const r = await run(idle, { SCR_TEXT_DROP: "0", SCR_TEXT_DROP_STAT: "1" });
    expect(r.stdout).toBe("done 6\n");
    expect(r.lines).toHaveLength(0);
  });

  test("a short program pays nothing", async () => {
    const r = await run(short, { SCR_TEXT_DROP_STAT: "1" });
    expect(r.stdout).toBe("short\n");
    expect(r.lines).toHaveLength(0);
  });
});
