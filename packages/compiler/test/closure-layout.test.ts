import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, test } from "vitest";
import { CLOSURE_C_STRUCT, CLOSURE_LLVM_TYPE, CLOSURE_STATIC_META, closureStaticCInit, closureStaticLlvmInit } from "../src/backend/closure-layout.js";

/* The emitters write the interned closure literal in C and in LLVM IR, and only ScrClosure in scr_runtime.h knows the real layout. The
 * header pins it with a _Static_assert and an `SCR_CLO_META_STATIC` define; this test parses both and compares them with what the
 * emitters spell, so a struct change the backends do not follow fails here and not as a write past an object. Positive control: each
 * parse must find its anchor, and a deliberately wrong spelling must NOT match. */
const header = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "..", "runtime", "src", "scr_runtime.h"),
  "utf8",
);

describe("ScrClosure layout is one fact in three languages", () => {
  const m = /_Static_assert\(sizeof\(ScrClosure\) == (\d+) && offsetof\(ScrClosure, fn\) == (\d+) && offsetof\(ScrClosure, meta\) == (\d+) && offsetof\(ScrClosure, caps\) == (\d+),/.exec(header);
  const st = /#define SCR_CLO_META_STATIC \(\(size_t\)(\d+)\)/.exec(header);

  test("the header's anchors are present (the parses below are not vacuous)", () => {
    expect(m, "no _Static_assert(sizeof(ScrClosure) == ...) in scr_runtime.h").not.toBeNull();
    expect(st, "no SCR_CLO_META_STATIC in scr_runtime.h").not.toBeNull();
  });

  test("the C struct the emitters declare has the asserted field offsets", () => {
    const fields = /\{ ([^}]*) \}/.exec(CLOSURE_C_STRUCT)![1]!.split(";").map((f) => f.trim()).filter(Boolean);
    expect(fields.length).toBe(3);
    expect(fields.map((f) => f.split(" ").pop()!.replace("*", ""))).toEqual(["rc", "fn", "meta"]);
    // three 8-byte fields: fn at 8, meta at 16, the captures at 24 (the header says the same)
    expect([Number(m![2]), Number(m![3]), Number(m![4]), Number(m![1])]).toEqual([8, 16, 24, 24]);
  });

  test("the LLVM type has three 8-byte elements and the static initialisers carry the header's meta", () => {
    expect(CLOSURE_LLVM_TYPE).toBe("{ i64, ptr, i64 }");
    expect(CLOSURE_STATIC_META).toBe(Number(st![1]));
    expect(closureStaticCInit("&f")).toBe(`{ SIZE_MAX, (void *)&f, ${st![1]} }`);
    expect(closureStaticLlvmInit("@f")).toBe(`{ i64 -1, ptr @f, i64 ${st![1]} }`);
    // negative control: the pre-repack five-word spelling must not be what the emitters produce
    expect(closureStaticCInit("&f")).not.toContain("NULL");
  });
});
