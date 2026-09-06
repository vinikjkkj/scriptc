import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { ccCompile, expectCasesPassed, exeSuffix } from "./cc.js";
import { beforeAll, test } from "vitest";

const execFileAsync = promisify(execFile);
const testDir = import.meta.dirname;
const bin = join(testDir, "build", "test_weak" + exeSuffix);

// ASan + the RC audit, because the properties under test ARE lifetime
// properties: that the table never retains its key, that an entry is
// spliced inside the key's own free path, and that a recycled address does
// not inherit the dead key's value. A leak or a double-free in any of that
// is exactly what ASan and the audit are for.
beforeAll(async () => {
  await mkdir(join(testDir, "build"), { recursive: true });
  await ccCompile([
    "-std=c11", "-O1", "-Wall", "-Wextra",
    "-fsanitize=address", "-DSCR_RC_AUDIT",
    "-o", bin,
    join(testDir, "test_weak.c"),
    join(testDir, "../src/scr_weak.c"),
    join(testDir, "../src/scr_bytes.c"),
    join(testDir, "../src/scr_string.c"),
    join(testDir, "../src/scr_number.c"),
    join(testDir, "../src/scr_cycle.c"),
    join(testDir, "../src/scr_map.c"),
    join(testDir, "../src/scr_union.c"),
    join(testDir, "../src/scr_array.c"),
    join(testDir, "../src/scr_closure.c"),
    join(testDir, "../src/scr_object.c"),
    join(testDir, "../src/scr_error.c"),
    join(testDir, "../src/scr_exception.c"),
    ...(process.platform === "linux" ? ["-D_GNU_SOURCE", "-lm"] : []),
  ]);
});

test("weakmap runtime: identity keys, no key retain, death splices, no address-reuse resurrection", async () => {
  const { stderr } = await execFileAsync(bin, []);
  expectCasesPassed(stderr);
});
