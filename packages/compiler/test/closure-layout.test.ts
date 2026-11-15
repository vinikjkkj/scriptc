import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  CLOSURE_C_STRUCT,
  CLOSURE_DYN_FUNC_KIND,
  CLOSURE_LLVM_TYPE,
  CLOSURE_STATIC_W,
  closureStaticCInit,
  closureStaticLlvmInit,
} from "../src/backend/closure-layout.js";

/* The emitters write the interned closure literal in C and in LLVM IR, and only ScrClosure in scr_runtime.h knows the real layout. The
 * header pins it with a _Static_assert, an `SCR_CLO_W_STATIC` define and a kind-code assert; this test parses them and compares them with
 * what the emitters spell, so a struct change the backends do not follow fails here and not as a write past an object. Positive control:
 * each parse must find its anchor, and a deliberately wrong spelling must NOT match. */
const header = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "..", "runtime", "src", "scr_runtime.h"),
  "utf8",
);

describe("ScrClosure layout is one fact in three languages", () => {
  const m =
    /_Static_assert\(sizeof\(ScrClosure\) == (\d+) && offsetof\(ScrClosure, kind\) == (\d+) && offsetof\(ScrClosure, isdyn\) == (\d+) && offsetof\(ScrClosure, ncaps8\) == (\d+) &&\s+offsetof\(ScrClosure, fn\) == (\d+) && offsetof\(ScrClosure, w\) == (\d+) && offsetof\(ScrClosure, caps\) == (\d+),/.exec(
      header,
    );
  const st = /#define SCR_CLO_W_STATIC \(\(uintptr_t\)(\d+)\)/.exec(header);
  const kind = /_Static_assert\(SCR_DYN_FUNC == (\d+),/.exec(header);

  test("the header's anchors are present (the parses below are not vacuous)", () => {
    expect(m, "no _Static_assert(sizeof(ScrClosure) == ...) in scr_runtime.h").not.toBeNull();
    expect(st, "no SCR_CLO_W_STATIC in scr_runtime.h").not.toBeNull();
    expect(kind, "no SCR_DYN_FUNC kind assert in scr_runtime.h").not.toBeNull();
  });

  test("the C struct the emitters declare has the asserted field offsets", () => {
    const fields = /\{ ([^}]*) \}/.exec(CLOSURE_C_STRUCT)![1]!.split(";").map((f) => f.trim()).filter(Boolean);
    expect(fields.map((f) => f.split(" ").pop()!.replace("*", "").replace("[2]", ""))).toEqual([
      "rc",
      "kind",
      "isdyn",
      "ncaps8",
      "pad",
      "fn",
      "w",
    ]);
    // rc 0, kind 8, isdyn 12, ncaps8 13, two pad bytes, fn 16, w 24, the captures at 32 (the header says the same)
    expect(m!.slice(1).map(Number)).toEqual([32, 8, 12, 13, 16, 24, 32]);
  });

  test("the LLVM type has the same elements and the static initialisers carry the header's constants", () => {
    expect(CLOSURE_LLVM_TYPE).toBe("{ i64, i32, i8, i8, i8, i8, ptr, i64 }");
    expect(CLOSURE_STATIC_W).toBe(Number(st![1]));
    expect(CLOSURE_DYN_FUNC_KIND).toBe(Number(kind![1]));
    expect(closureStaticCInit("&f")).toBe(`{ SIZE_MAX, (uint32_t)SCR_DYN_FUNC, 1, 0, {0, 0}, (void *)&f, ${st![1]} }`);
    expect(closureStaticLlvmInit("@f")).toBe(
      `{ i64 -1, i32 ${kind![1]}, i8 1, i8 0, i8 0, i8 0, ptr @f, i64 ${st![1]} }`,
    );
    // negative control: the pre-unification three-word spelling must not be what the emitters produce
    expect(closureStaticCInit("&f")).not.toBe(`{ SIZE_MAX, (void *)&f, 1 }`);
  });
});
