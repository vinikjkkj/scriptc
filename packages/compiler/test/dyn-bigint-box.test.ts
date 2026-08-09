/* The bigint dyn box's bookkeeping — the facts with no compile error
 * behind them.
 *
 * SCR_DYN_BIG is the fourth checked-dynamic kind added in a row, and it
 * is the first PRIMITIVE among them. The three before it (HANDLE-shaped
 * OBJINST, ARRBUF, and the promise) are reference values that answer
 * almost nothing, so the arms they needed were fences. A bigint ANSWERS:
 * typeof, truthiness, ===, String(), inspect and structuredClone all have
 * a right answer, and in two of those the reference stance is not merely
 * incomplete but WRONG —
 *
 *   • truthiness is value-dependent (0n is falsy) where every reference
 *     kind is unconditionally true, and where the switch's own default is
 *     unconditionally FALSE;
 *   • === compares by VALUE where every reference kind compares pointers,
 *     and where the switch's default compares pointers too.
 *
 * Both of those defaults ANSWER rather than fence, which is the whole
 * reason this file exists: a missing arm in one of them is not a gap that
 * shows up as a refusal, it is a wrong boolean. The first test below is
 * therefore a TOTALITY check over the four answering tables rather than a
 * spot check for one kind — it is meant to fail for the NEXT kind too.
 *
 * The second fact is the link line. scr_json.c is always linked;
 * scr_bigint.c is gated on `opts.bigint`. That gating is why a
 * hello-world does not pay for 766 lines of digits, and it means the
 * always-linked core may not NAME a gated symbol. This is not a
 * hypothetical: the first version of this change called the gated
 * `scr_dyn_from_big` from the always-linked structuredClone arm, and
 * every bigint-free binary failed to link on it — the same failure
 * `scr_big_low_u64` produced one change earlier, found the same way, by a
 * hello-world rather than by the corpus.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { BIGINT, canConvertToDyn, canDynCheckTo, isJsonSafeType } from "../src/ir/nodes.js";

const repoRoot = join(import.meta.dirname, "../../..");
const runtimeSrc = (name: string): string =>
  readFileSync(join(repoRoot, "packages/runtime/src", name), "utf8");

/** C source with its comments removed. Every scan below is about what the
 * COMPILER sees, and this file's own prose names the very symbols it
 * forbids — the first run failed on the sentence explaining the rule. */
const stripComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, " ");

/** The ScrDynKind members, in declaration order — the same parse the
 * class-box suite uses to pin the LLVM lane's numbering. */
function dynKinds(): string[] {
  const header = runtimeSrc("scr_runtime.h");
  const body = /typedef enum \{([\s\S]*?)\} ScrDynKind;/.exec(header)?.[1];
  expect(body, "ScrDynKind not found in scr_runtime.h").toBeDefined();
  const stripped = body!.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...stripped.matchAll(/\bSCR_DYN_\w+\b/g)].map((m) => m[0]);
}

/** The text of one C function body, brace-matched from its signature.
 * The DEFINITION, not a forward declaration: scr_dyn_kind_name has both,
 * and taking the first occurrence brace-matched the NEXT function's body
 * instead — a scan that silently measured the wrong function. */
function fnBody(rawSrc: string, signature: string): string {
  const src = stripComments(rawSrc);
  let at = -1;
  for (let p = src.indexOf(signature); p >= 0; p = src.indexOf(signature, p + 1)) {
    if (src.slice(p + signature.length).trimStart().startsWith("{")) { at = p; break; }
  }
  expect(at, `${signature} has no definition`).toBeGreaterThanOrEqual(0);
  let i = src.indexOf("{", at);
  let depth = 0;
  const start = i;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`unterminated ${signature}`);
}

/* The four always-linked tables whose DEFAULT answers rather than
 * fences, each with the kinds that default DELIBERATELY covers. An
 * exemption is a claim ("the default is right for this kind"), so it is
 * spelled out here rather than inferred — the DV_BIG_SET_METHODS
 * arrangement, which exists to keep "handled elsewhere" distinguishable
 * from "forgotten". */
const ANSWERING_TABLES: { fn: string; why: string; exempt: string[] }[] = [
  {
    fn: "bool scr_dyn_truthy(const ScrDyn *d)",
    why: "the default answers FALSE, so a missing kind reads falsy in every condition",
    // ToBoolean(undefined) and ToBoolean(null) really are false.
    exempt: ["SCR_DYN_UNDEF", "SCR_DYN_NULL"],
  },
  {
    fn: "static const char *scr_dyn_typeof_native(const ScrDyn *d)",
    why: 'the default answers "undefined", so a missing kind reports the wrong typeof',
    // An island value's typeof is the ENGINE's; the two callers route it
    // before consulting this table (documented at the table itself).
    exempt: ["SCR_DYN_JSVAL"],
  },
  {
    fn: "bool scr_dyn_strict_eq(const ScrDyn *a, const ScrDyn *b)",
    why: "the default compares POINTERS, so a missing value kind answers false for equal values",
    // Arrays, objects and typed arrays ARE compared by node identity —
    // the default is their correct answer, not an omission.
    exempt: ["SCR_DYN_ARR", "SCR_DYN_OBJ", "SCR_DYN_BYTES"],
  },
  {
    fn: "static const char *scr_dyn_kind_name(const ScrDyn *d)",
    why: 'the tail answers "unknown", so a missing kind is unnamed in every check failure',
    exempt: [],
  },
];

describe("the always-linked tables that ANSWER for every dyn kind", () => {
  test("every ScrDynKind is named, or explicitly exempt, in each of them", () => {
    const kinds = dynKinds();
    // A regex that stopped matching would make the whole file vacuous.
    expect(kinds.length).toBeGreaterThanOrEqual(15);
    expect(kinds).toContain("SCR_DYN_BIG");
    const json = runtimeSrc("scr_json.c");
    for (const { fn, why, exempt } of ANSWERING_TABLES) {
      const body = fnBody(json, fn);
      // WORD-boundary, not substring: SCR_DYN_ARRBUF contains SCR_DYN_ARR,
      // so an includes() test reported ARR as handled by the ArrayBuffer
      // arm. The first version of this file did exactly that.
      const names = new Set([...body.matchAll(/\bSCR_DYN_\w+\b/g)].map((m) => m[0]));
      for (const k of kinds) {
        if (exempt.includes(k)) {
          // An exemption that stopped being needed is also a drift: the
          // kind is now handled, so the claim below is stale.
          expect(names.has(k), `${fn}: ${k} is exempt but IS named — update the exemption`)
            .toBe(false);
          continue;
        }
        expect(names.has(k), `${fn}: no arm for ${k} — ${why}`).toBe(true);
      }
    }
  });

  test("the exemptions name real kinds", () => {
    const kinds = new Set(dynKinds());
    for (const { fn, exempt } of ANSWERING_TABLES) {
      for (const k of exempt) expect(kinds.has(k), `${fn}: ${k} is not a ScrDynKind`).toBe(true);
    }
  });
});

describe("the bigint unit stays GATED", () => {
  /* cc.ts links scr_bigint.c only when moduleUsesBigInt; every other unit
   * in RUNTIME_SOURCES is unconditional. So the direction of reference
   * matters: gated -> always-linked is fine, always-linked -> gated is an
   * undefined symbol in every bigint-free binary. */
  const ALWAYS_LINKED = [
    "scr_json.c",
    "scr_bytes.c",
    "scr_string.c",
    "scr_array.c",
    "scr_object.c",
    "scr_lib.c",
    "scr_console.c",
    "scr_error.c",
    "scr_exception.c",
  ];

  test("no always-linked unit names a symbol scr_bigint.c defines", () => {
    // The definitions this file exports, taken from the file itself so
    // the list cannot go stale as it grows.
    const bigsrc = stripComments(runtimeSrc("scr_bigint.c"));
    const defined = new Set(
      [...bigsrc.matchAll(/^(?:[A-Za-z_][\w *]*?)\b(scr_(?:big|dyn)_\w+)\s*\(/gm)].map((m) => m[1]!),
    );
    // scr_dyn_from_big and scr_big_from_dyn are the two crossings; if the
    // parse stopped finding them the test would pass vacuously.
    expect(defined.has("scr_dyn_from_big"), "parse found no scr_dyn_from_big").toBe(true);
    expect(defined.has("scr_big_from_dyn"), "parse found no scr_big_from_dyn").toBe(true);
    for (const unit of ALWAYS_LINKED) {
      const src = stripComments(runtimeSrc(unit));
      for (const sym of defined) {
        expect(
          new RegExp(`\\b${sym}\\s*\\(`).test(src),
          `${unit} calls ${sym}, which lives in the GATED scr_bigint.c — ` +
            "every bigint-free binary would fail to link on it",
        ).toBe(false);
      }
    }
  });

  test("the always-linked core reaches a bigint only through the installed ops", () => {
    const json = stripComments(runtimeSrc("scr_json.c"));
    // The allocator takes the table; every other use goes through the
    // accessor. A direct scr_big_* call here is the bug above.
    expect(json).toContain("ScrDyn *scr_dyn_alloc_big(ScrBigInt *b, const ScrDynBigOps *ops)");
    expect(/\bscr_big_[a-z_]+\s*\(/.test(json.replace(/scr_big_from_dyn/g, "")))
      .toBe(false);
  });

  test("the ops table is TOTAL against its declaration", () => {
    // A struct initialiser with too few entries is legal C — the missing
    // tail is NULL, and the first call through it is a jump to zero.
    const header = runtimeSrc("scr_runtime.h");
    const decl = /typedef struct ScrDynBigOps \{([\s\S]*?)\} ScrDynBigOps;/.exec(header)?.[1];
    expect(decl, "ScrDynBigOps not found").toBeDefined();
    const fields = [...decl!.matchAll(/\(\*(\w+)\)/g)].map((m) => m[1]!);
    expect(fields).toEqual(["retain", "release", "truthy", "eq", "to_str"]);
    const init = /static const ScrDynBigOps scr_big_dyn_ops = \{([\s\S]*?)\};/.exec(
      runtimeSrc("scr_bigint.c"),
    )?.[1];
    expect(init, "scr_big_dyn_ops initialiser not found").toBeDefined();
    const entries = init!
      .split(",")
      .map((s) => s.replace(/\/\*[\s\S]*?\*\//g, "").trim())
      .filter((s) => s.length > 0);
    expect(entries.length, "one initialiser entry per ops field").toBe(fields.length);
    // Every entry is an EXISTING scr_big_* export rather than a bigint
    // behaviour written a second time — that is what keeps the dyn
    // answers and the static answers from drifting.
    for (const e of entries) expect(e).toMatch(/^scr_big_\w+$/);
  });
});

describe("bigint's two directions move in lockstep", () => {
  const noRecord = (): undefined => undefined;
  const noUnion = (): undefined => undefined;

  test("a bigint converts IN and checks back OUT", () => {
    // Admitting one without the other is what stranded the method
    // bundles: the value crosses and then cannot be recovered, so the
    // fence merely relocates to whatever asks for it back — which here
    // is BigInt.asIntN(32, e), the site the whole block exists for.
    expect(canConvertToDyn(BIGINT, noRecord, noUnion)).toBe(true);
    expect(canDynCheckTo(BIGINT, noRecord, noUnion)).toBe(true);
  });

  test("and is NOT json-safe, in either predicate", () => {
    // JSON.stringify(5n) throws in V8, so no emitted stringify walker may
    // claim a bigint. This is the one predicate bigint must stay out of,
    // and the two above are the ones it must be in.
    expect(isJsonSafeType(BIGINT, noRecord, noUnion)).toBe(false);
    expect(isJsonSafeType(BIGINT, noRecord, noUnion, true)).toBe(false);
  });
});
