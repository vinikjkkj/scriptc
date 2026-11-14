import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, test } from "vitest";
import { DYN_FN_CLO_OFF, DYN_FN_DESC_OFF } from "../src/backend/llvm/dyn.js";

/* The LLVM backend reads a SCR_DYN_FUNC box with hardcoded byte offsets (the closure, and the record that holds the thunk), and only the C
 * struct knows the real ones. The header pins them with a _Static_assert; this test parses that assertion and compares it with the constants
 * the backend uses, so a struct change the backend does not follow fails here and not as a wrong read. Positive control: the parse must find the
 * assertion at all. */
const header = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "..", "runtime", "src", "scr_runtime.h"),
  "utf8",
);

describe("the SCR_DYN_FUNC box layout is one fact in two languages", () => {
  const m = /_Static_assert\(offsetof\(ScrDyn, v\.fn\.clo\) == (\d+) && offsetof\(ScrDyn, v\.fn\.desc\) == (\d+) && offsetof\(ScrFnDesc, thunk\) == (\d+) && sizeof\(\(\(ScrDyn \*\)0\)->v\.fn\) == (\d+),/.exec(header);

  test("the header's assertion line is present (the parse below is not vacuous)", () => {
    expect(m, "no _Static_assert(offsetof(ScrDyn, v.fn.clo) == ...) in scr_runtime.h").not.toBeNull();
  });

  test("the backend's constants equal the header's asserted layout, and the thunk is the record's first member", () => {
    expect(Number(m![1])).toBe(DYN_FN_CLO_OFF);
    expect(Number(m![2])).toBe(DYN_FN_DESC_OFF);
    expect(Number(m![3])).toBe(0);
    expect(Number(m![4])).toBe(16);
  });
});
