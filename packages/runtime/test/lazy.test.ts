import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { ccCompile, exeSuffix } from "./cc.js";
import { beforeAll, expect, test } from "vitest";

const execFileAsync = promisify(execFile);
const testDir = import.meta.dirname;
const bin = join(testDir, "build", "test_lazy" + exeSuffix);

// Built with ASan + the RC audit: a clean exit also proves the checked-dynamic tree's
// recursive ownership — including trees abandoned mid-parse by syntax
// errors — leaks nothing and frees nothing twice.
beforeAll(async () => {
  await mkdir(join(testDir, "build"), { recursive: true });
  await ccCompile([
    "-std=c11", "-O1", "-Wall", "-Wextra",
    "-fsanitize=address", "-DSCR_RC_AUDIT",
    "-I", join(testDir, "../src"),
    "-o", bin,
    join(testDir, "test_lazy.c"),
    join(testDir, "../src/scr_json.c"),
    join(testDir, "../src/scr_string.c"),
    join(testDir, "../src/scr_array.c"),
    join(testDir, "../src/scr_map.c"),
    join(testDir, "../src/scr_exception.c"),
    join(testDir, "../src/scr_error.c"),
    join(testDir, "../src/scr_number.c"),
    join(testDir, "../src/scr_console.c"),
    join(testDir, "../src/scr_closure.c"),
    join(testDir, "../src/scr_object.c"),
    join(testDir, "../src/scr_union.c"),
    join(testDir, "../src/scr_cycle.c"),
    join(testDir, "../src/scr_lib.c"),
    join(testDir, "../src/scr_bytes.c"),
    ...(process.platform === "linux" ? ["-D_GNU_SOURCE", "-lm"] : []),
  ]);
});

test("lazy members: install, force, listing, assignment, delete, guard", async () => {
  const { stdout } = await execFileAsync(bin);
  expect(stdout).toMatch(/^(\d+)\/\1 checks passed\n$/);
});
