import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, test } from "vitest";
import { DYN_ENTRY_KEYLEN_OFF, DYN_ENTRY_SIZE, DYN_ENTRY_VALUE_OFF } from "../src/backend/llvm/dyn.js";

/* The LLVM backend reads a dyn object member (ScrDynEntry) with hardcoded byte offsets, and only the C struct knows the real ones. The header
 * pins the struct with a _Static_assert; this test parses that assertion and compares it with the constants the backend uses, so a struct
 * change the backend does not follow fails here and not as a wrong read. Positive control: the parse must find the assertion at all. */
const header = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "..", "runtime", "src", "scr_runtime.h"),
  "utf8",
);

describe("ScrDynEntry layout is one fact in two languages", () => {
  const m = /_Static_assert\(sizeof\(ScrDynEntry\) == (\d+) && offsetof\(ScrDynEntry, key_len\) == (\d+) && offsetof\(ScrDynEntry, value\) == (\d+),/.exec(header);

  test("the header's assertion line is present (the parse below is not vacuous)", () => {
    expect(m, "no _Static_assert(sizeof(ScrDynEntry) == ...) in scr_runtime.h").not.toBeNull();
  });

  test("the backend's constants equal the header's asserted layout", () => {
    expect(Number(m![1])).toBe(DYN_ENTRY_SIZE);
    expect(Number(m![2])).toBe(DYN_ENTRY_KEYLEN_OFF);
    expect(Number(m![3])).toBe(DYN_ENTRY_VALUE_OFF);
  });
});
