/* Bookkeeping that has no compile error to protect it.
 *
 * A DataView intrinsic is written down SIX times: the IR name union
 * (nodes.ts), the may-throw seed set, the frontend's getter/setter tables,
 * the C backend's symbolic ScrDataViewGet tag, the LLVM backend's NUMERIC
 * tag, and the runtime enum both tags name. TypeScript's exhaustiveness
 * check covers the two backend switches and nothing else: the tag maps are
 * `Record<string, …>`, so a forgotten entry is `undefined` interpolated
 * straight into emitted C, and the two backends' tags agree only by the
 * order somebody typed them in.
 *
 * That is exactly the shape that produced this suite: adding
 * setBigUint64/setBigInt64 touched all six, and the pair deliberately has
 * NO tag (both spellings store the same eight bytes, so one runtime entry
 * with no kind serves them). "Handled elsewhere" and "forgotten" look
 * identical to a Record lookup — DV_BIG_SET_METHODS is what tells them
 * apart, and this suite is what makes the distinction load-bearing.
 *
 * The Annex B String.prototype wrappers get the same treatment: the
 * compiler claims thirteen names for the runtime's receiver-kind dispatch,
 * and if the runtime table ever stopped listing one, the compiler would
 * route it to a "is not a function" throw on a real string instead of
 * fencing — a wrong ANSWER, not a refusal.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { BYTES_INTRINSIC_METHODS, DV_BIG_SET_METHODS, MAY_THROW_BYTES_METHODS } from "../../packages/compiler/src/ir/nodes.js";
import { DV_GET_KIND_C, DV_SET_KIND_C } from "../../packages/compiler/src/backend/emission/emit-types.js";
import { DV_GET_KIND, DV_SET_KIND } from "../../packages/compiler/src/backend/llvm/emitter.js";
import { DYN_DISPATCH_METHODS, STRING_HTML_METHODS } from "../../packages/compiler/src/frontend/lowering/lower-calls.js";

const repoRoot = join(import.meta.dirname, "../..");
const runtimeSrc = (name: string): string =>
  readFileSync(join(repoRoot, "packages/runtime/src", name), "utf8");

const dvGetters = BYTES_INTRINSIC_METHODS.filter((m) => m.startsWith("dvGet"));
const dvSetters = BYTES_INTRINSIC_METHODS.filter((m) => m.startsWith("dvSet"));

describe("DataView intrinsic tables", () => {
  test("there ARE getters and setters to account for", () => {
    // A regex that stopped matching would make every check below vacuous.
    expect(dvGetters.length).toBeGreaterThanOrEqual(10);
    expect(dvSetters.length).toBeGreaterThanOrEqual(10);
  });

  test("every dvGet* carries a tag in BOTH backends", () => {
    for (const m of dvGetters) {
      expect(DV_GET_KIND_C[m], `${m} missing from the C tag map`).toBeDefined();
      expect(DV_GET_KIND[m], `${m} missing from the LLVM tag map`).toBeDefined();
    }
  });

  test("every dvSet* either carries a tag in both backends or is a BIG setter", () => {
    for (const m of dvSetters) {
      if (DV_BIG_SET_METHODS.has(m)) {
        // The BIG pair is tag-FREE on purpose. A tag appearing here means
        // somebody gave them a kind, which the runtime entry ignores.
        expect(DV_SET_KIND_C[m], `${m} is a BIG setter and must carry no C tag`).toBeUndefined();
        expect(DV_SET_KIND[m], `${m} is a BIG setter and must carry no LLVM tag`).toBeUndefined();
        continue;
      }
      expect(DV_SET_KIND_C[m], `${m} missing from the C tag map`).toBeDefined();
      expect(DV_SET_KIND[m], `${m} missing from the LLVM tag map`).toBeDefined();
    }
  });

  test("the two backends' tags name the SAME runtime enum member", () => {
    // ScrDataViewGet is a bare enum, so its DECLARATION ORDER is the
    // numbering the LLVM tier hardcodes. Parse it and check both maps
    // against it rather than against each other.
    const header = runtimeSrc("scr_runtime.h");
    const decl = /typedef enum ScrDataViewGet \{([\s\S]*?)\} ScrDataViewGet;/.exec(header);
    expect(decl, "ScrDataViewGet not found in scr_runtime.h").not.toBeNull();
    const order = decl![1]!
      .split(",")
      .map((s) => s.replace(/\/\*[\s\S]*?\*\//g, "").trim())
      .filter((s) => s.startsWith("SCR_DV_"));
    expect(order.length).toBeGreaterThanOrEqual(10);
    for (const [maps, methods] of [
      [[DV_GET_KIND_C, DV_GET_KIND] as const, dvGetters],
      [[DV_SET_KIND_C, DV_SET_KIND] as const, dvSetters],
    ] as const) {
      const [symbolic, numeric] = maps;
      for (const m of methods) {
        const tag = symbolic[m];
        if (tag === undefined) continue; // the BIG pair, checked above
        const at = order.indexOf(tag);
        expect(at, `${tag} is not a ScrDataViewGet member`).toBeGreaterThanOrEqual(0);
        expect(numeric[m], `${m}: LLVM tag disagrees with ${tag}'s enum position`).toBe(at);
      }
    }
  });

  test("every DataView intrinsic is a may-throw seed", () => {
    // All of them bounds-check the offset and raise Node's constant
    // RangeError; a missing seed means the emitted call site USES the
    // zero it returns (the bug that hid the BigInt family's four).
    for (const m of [...dvGetters, ...dvSetters]) {
      expect(MAY_THROW_BYTES_METHODS.has(m), `${m} missing from MAY_THROW_BYTES_METHODS`).toBe(true);
    }
  });

  test("the BIG setters reach a runtime entry that exists", () => {
    const bigint = runtimeSrc("scr_bigint.c");
    expect(bigint).toContain("void scr_dataview_set_big(");
    // It lives in the BIGINT unit, not scr_bytes.c: cc.ts links
    // scr_bigint.c only when the module uses bigint, and a program that
    // reaches this entry necessarily does. Defining it in the always-linked
    // unit made every bigint-free LLVM link fail on scr_big_low_u64.
    expect(runtimeSrc("scr_bytes.c")).not.toContain("void scr_dataview_set_big(");
  });
});

describe("the Annex B String.prototype wrappers", () => {
  test("each name is claimed by the dispatch and listed as a prototype name", () => {
    expect(STRING_HTML_METHODS.length).toBe(13);
    for (const m of STRING_HTML_METHODS) {
      expect(DYN_DISPATCH_METHODS.has(m), `${m} is not dyn-claimed`).toBe(true);
    }
  });

  test("the runtime answers every name the compiler routes to it", () => {
    // A name the compiler claims but the runtime's table omits does not
    // fence — it falls through to Node's "is not a function", which on a
    // real string is a WRONG ANSWER rather than a refusal.
    const invoke = runtimeSrc("scr_dyn_invoke.c");
    const table = /static const ScrHtmlWrap SCR_STR_HTML\[\] = \{([\s\S]*?)\n\};/.exec(invoke);
    expect(table, "SCR_STR_HTML not found in scr_dyn_invoke.c").not.toBeNull();
    const named = new Set(
      [...table![1]!.matchAll(/\{\s*"([a-z0-9]+)"\s*,/g)].map((m) => m[1]!),
    );
    expect([...named].sort()).toEqual([...STRING_HTML_METHODS].sort());
  });
});
