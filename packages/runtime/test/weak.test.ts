import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { ccCompile, expectCasesPassed, exeSuffix } from "./cc.js";
import { beforeAll, test } from "vitest";

const execFileAsync = promisify(execFile);
const testDir = import.meta.dirname;
const bin = join(testDir, "build", "test_weak" + exeSuffix);
// The SECOND binary: same source, no RC audit. See the note by its test.
const parkBin = join(testDir, "build", "test_weak_park" + exeSuffix);

// scr_json.c is on the link line because a DYN key's identity lives there:
// scr_dyn_origin_peek reads the table that says which static object a
// static->dyn boundary copy was made from, and keying on the copy instead
// would be a cache that can never hit. It is always linked in a real
// binary (backend/cc.ts RUNTIME_SOURCES), so this is the same link set a
// compiled program has and not a convenience.
const UNITS = [
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
  join(testDir, "../src/scr_json.c"),
];

// ASan + the RC audit, because the properties under test ARE lifetime
// properties: that the table never retains its key, that an entry is
// spliced inside the key's own free path, and that a recycled address does
// not inherit the dead key's value. A leak or a double-free in any of that
// is exactly what ASan and the audit are for.
beforeAll(async () => {
  await mkdir(join(testDir, "build"), { recursive: true });
  const common = [
    "-std=c11", "-O1", "-Wall", "-Wextra", "-fsanitize=address",
    ...UNITS,
    ...(process.platform === "linux" ? ["-D_GNU_SOURCE", "-lm"] : []),
  ];
  await ccCompile(["-DSCR_RC_AUDIT", "-o", bin, ...common]);
  await ccCompile(["-o", parkBin, ...common]);
});

test("weakmap runtime: identity keys (bytes and untraced arrays), no key retain, death splices, no address-reuse resurrection", async () => {
  const { stderr } = await execFileAsync(bin, []);
  expectCasesPassed(stderr);
});

// THE FREELIST PARK, which the audit binary above cannot reach.
//
// A dyn ARRAY or OBJECT built in dyn-land is its own weak key (there is no
// second representation behind it), and scr_dyn_release PARKS such a node
// on a per-shape freelist instead of freeing it -- scr_dyn_alloc hands the
// same address straight back out, up to SCR_DYN_FREE_MAX deep. That route
// never reaches scr_cyc_free, so the hook scr_cyc_free carries cannot see
// it, and an entry surviving the park would be read by the NEXT node at
// that address: a wrong answer, not a leak.
//
// SCR_RC_AUDIT compiles the freelist out (so ASan sees real frees and the
// live count stays a strict balance), which means the audit binary exercises
// exactly the route this hook does NOT exist for. Hence a second build.
// Same source, same sanitizer, one define fewer, and the park cases are the
// ones behind `#ifndef SCR_RC_AUDIT` in test_weak.c.
test("weakmap runtime: a dyn key PARKED on the freelist is spliced, and the address comes back clean", async () => {
  const { stderr } = await execFileAsync(parkBin, []);
  expectCasesPassed(stderr);
});
