/* THE LAYOUT PROFILE IS WRITTEN WHEN THE PROGRAM ENDS WITH process.exit().
 *
 * `scriptc build --layout-profile` records which functions run and writes the log from a destructor (scr_layout_prof.c). An explicit
 * process.exit() leaves through _Exit (scr_lib.c scr_process_exit_now), which runs no destructor, so a program that ends that way -- the
 * zapo REST app's /shutdown route does -- produced NO profile and the whole profile-guided layout chain stopped at "no profile written".
 * The exit path now calls the profiler's dump first (a weak hook: absent, and a no-op, in every build that is not instrumented).
 *
 *   natural end     -- the profile is written (the control: this always worked);
 *   process.exit(0) -- the profile is written, starts with the v1 header and lists at least one entered function;
 *   exitCode set    -- the profile is written and the status is kept (the other _Exit, in scr_exitcode_at_exit);
 *   plain build     -- no profile and no profiler symbol in the binary (the hook costs nothing outside --layout-profile). */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, test } from "vitest";
import { compile } from "@scriptc/compiler";
import { exeName } from "./exe.js";

const repoRoot = join(import.meta.dirname, "../..");
const cacheDir = join(repoRoot, "node_modules/.cache/scriptc-tests/layout-profile-exit");
const linux = process.platform === "linux";

async function build(name: string, layoutProfile: boolean): Promise<string> {
  mkdirSync(cacheDir, { recursive: true });
  const tag = `${name}${layoutProfile ? "-prof" : "-plain"}`;
  const r = await compile(join(repoRoot, "tests/fixtures/layout-profile", `${name}.ts`), {
    outPath: join(cacheDir, exeName(tag)),
    outDir: cacheDir,
    ...(layoutProfile ? { layoutProfile: true } : {}),
  });
  if (!r.ok) throw new Error(r.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"));
  return r.binaryPath;
}

function run(bin: string, out: string): string {
  rmSync(out, { force: true });
  return execFileSync(bin, [], { encoding: "utf8", env: { ...process.env, SCR_LAYOUT_PROFILE_OUT: out } });
}

describe.skipIf(!linux)("the layout profile at program end", () => {
  let natural = "";
  let explicit = "";
  let plain = "";
  let withCode = "";
  beforeAll(async () => {
    natural = await build("exit-natural", true);
    explicit = await build("exit-explicit", true);
    plain = await build("exit-explicit", false);
    withCode = await build("exit-code", true);
  }, 600_000);

  test("control: a program that ends naturally writes the profile", () => {
    const out = join(cacheDir, "natural.profile");
    expect(run(natural, out)).toBe("work 45\n");
    expect(readFileSync(out, "utf8").startsWith("# scr-layout-profile 1 ")).toBe(true);
  });

  test("a program that ends with process.exit(0) writes the profile too", () => {
    const out = join(cacheDir, "explicit.profile");
    expect(run(explicit, out)).toBe("work 45\n");
    expect(existsSync(out)).toBe(true);
    const text = readFileSync(out, "utf8");
    expect(text.startsWith("# scr-layout-profile 1 ")).toBe(true);
    expect(text.split("\n").filter((l) => /^\d+ [0-9a-f]+$/.test(l)).length).toBeGreaterThanOrEqual(5);
  });

  test("a program that sets process.exitCode and ends naturally writes the profile and keeps its status", () => {
    const out = join(cacheDir, "code.profile");
    rmSync(out, { force: true });
    const r = spawnSync(withCode, [], { encoding: "utf8", env: { ...process.env, SCR_LAYOUT_PROFILE_OUT: out } });
    expect(r.stdout).toBe("work 45\n");
    expect(r.status).toBe(3);
    expect(readFileSync(out, "utf8").startsWith("# scr-layout-profile 1 ")).toBe(true);
  });

  test("a plain build writes no profile", () => {
    const out = join(cacheDir, "plain.profile");
    expect(run(plain, out)).toBe("work 45\n");
    expect(existsSync(out)).toBe(false);
  });
});
