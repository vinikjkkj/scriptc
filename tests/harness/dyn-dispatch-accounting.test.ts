/* The fence set and the runtime dispatch, reconciled.
 *
 * A dyn-receiver method call is decided in TWO places. The compiler's
 * DYN_PROTO_METHOD_NAMES says "a dyn-representable prototype declares this
 * name, so a stored-member read could mis-answer a real method" and
 * refuses; DYN_DISPATCH_METHODS carves out the names that instead go to
 * scr_dyn_invoke, which answers by the receiver's RUNTIME kind. Nothing in
 * either language checks that the two agree with what the runtime can
 * actually do.
 *
 * Both failure directions have already happened on this tree, and neither
 * looked like what it was:
 *
 *   * the runtime IMPLEMENTS a name the compiler fences on. Six of zapo's
 *     traps were `Long.prototype.sub` refused because String.prototype has
 *     an Annex B `sub`; three more were `splice`, `hasOwnProperty` and the
 *     range form of `toString`. In every case the capability existed and
 *     only the routing did not, so the diagnostic said "not supported yet"
 *     about something that was supported.
 *   * the compiler ROUTES an array name the ARR arm refuses loudly. That
 *     turns a compile-time fence into a runtime throw — later, in
 *     production, for a program that would have been told at build time.
 *
 * So: every name the dispatch answers must be routed (or classified here,
 * with a reason), and no routed name may sit in the ARR arm's
 * unimplemented list.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { DYN_DISPATCH_METHODS } from "../../packages/compiler/src/frontend/lowering/lower-calls.js";

const repoRoot = join(import.meta.dirname, "../..");
const invokeSrc = readFileSync(join(repoRoot, "packages/runtime/src/scr_dyn_invoke.c"), "utf8");
const jsonSrc = readFileSync(join(repoRoot, "packages/runtime/src/scr_json.c"), "utf8");
const lowerSrc = readFileSync(
  join(repoRoot, "packages/compiler/src/frontend/lowering/lower-calls.ts"),
  "utf8",
);

/** Every method NAME scr_dyn_invoke.c tests for by literal — the arms'
 * implementations, and the handful of loud refusals classified below. The
 * `dyn_arr_proto_unimpl` / `scr_dyn_bytes_proto_name` tables are `names[]`
 * arrays tested through a variable, so they do not appear here: those are
 * the names the runtime knows about but does NOT implement. */
const dispatchNames = (() => {
  const out = new Set<string>();
  for (const m of invokeSrc.matchAll(/dyn_name_is\(method, "([A-Za-z]+)"\)/g)) out.add(m[1]!);
  return out;
})();

/** The ARR arm's real-but-unimplemented Array.prototype names. */
const arrUnimpl = (() => {
  const block = /static bool dyn_arr_proto_unimpl\(const char \*m\) \{([\s\S]*?)\n\}/.exec(invokeSrc);
  if (!block) throw new Error("dyn_arr_proto_unimpl not found — this suite has gone blind");
  return new Set([...block[1]!.matchAll(/"([A-Za-z]+)"/g)].map((m) => m[1]!));
})();

/** Names the dispatch MENTIONS but the compiler deliberately does not
 * route, each with the reason. A new entry here is a decision, not a
 * formality: the alternative is that the name is reachable only through a
 * spelling nobody writes. */
const NOT_ROUTED: ReadonlyMap<string, string> = new Map([
  // Its own lowering claims the call before the dispatch set is consulted
  // (the 0/1-argument form is `dyn.toString`, the 2/3-argument Buffer
  // window `dyn.toStringRange`), so routing the NAME would take it away
  // from the encoding-aware path.
  ["toString", "claimed by the dedicated dyn.toString / dyn.toStringRange lowerings"],
  ["flatMap", "claimed by lowerDynArrayFlatMapCall before the dispatch set"],
  // Mentioned ONLY by the static-copy guard and listed in
  // dyn_arr_proto_unimpl: the compile-time fence is the better answer and
  // this is what keeps it.
  ["fill", "no implementation — the ARR arm's unimplemented list keeps the compile-time fence"],
  ["copyWithin", "no implementation — same"],
  // Function.prototype.bind over a dyn callee has no representation yet;
  // the FUNC arm names it only to refuse loudly if it is ever reached
  // through `f.bind.call(...)`.
  ["bind", "no implementation — the FUNC arm refuses loudly, the frontend fences"],
  // The DYN_STRING_ONLY_METHODS family. lower-calls.ts consults that set
  // (~5518) BEFORE the dispatch set (~5627) and returns unconditionally, so
  // the DOTTED spelling `<dyn>.trim()` never reaches DYN_DISPATCH_METHODS:
  // it takes a checked string receiver and the dedicated string lowering,
  // which answers a static string instead of a boxed dyn. The runtime arms
  // are not dead — the ELEMENT spelling `d[k](...)` reaches them, which is
  // what they exist for (npm-static's 4151) — so routing the name would be
  // a regression, not a fix: it would take the dotted form away from the
  // better lowering. Same structure as toString and flatMap above.
  ...(["charAt", "charCodeAt", "endsWith", "padEnd", "padStart", "repeat",
    "startsWith", "substring", "trim", "trimEnd", "trimStart"] as const).map(
    (n) => [n, "claimed by DYN_STRING_ONLY_METHODS before the dispatch set; the element spelling reaches the runtime arm"] as const,
  ),
]);

describe("the dyn method dispatch and the fence set", () => {
  test("the extraction still finds something", () => {
    // A regex that stopped matching would make every check below vacuous.
    expect(dispatchNames.size).toBeGreaterThanOrEqual(20);
    expect(arrUnimpl.size).toBeGreaterThanOrEqual(10);
    expect(DYN_DISPATCH_METHODS.size).toBeGreaterThanOrEqual(50);
  });

  test("every name the runtime dispatch ANSWERS is routed by the compiler", () => {
    // Collected and asserted ONCE rather than asserted per name: a hard
    // expect inside the loop reports only the alphabetically first
    // offender, which is how eleven unrouted names sat behind 'charAt'
    // reading as a single row. The whole set or nothing.
    const unrouted = [...dispatchNames]
      .sort()
      .filter((name) => !DYN_DISPATCH_METHODS.has(name) && !NOT_ROUTED.has(name));
    expect(
      unrouted,
      `scr_dyn_invoke.c handles these but no compiler path routes them: add each to ` +
        `DYN_DISPATCH_METHODS, or record in NOT_ROUTED why the implementation is ` +
        `unreachable through '<dyn>.<name>(...)'`,
    ).toEqual([]);
  });

  test("the NOT_ROUTED classifications are all still real", () => {
    // A name that got routed later must LEAVE this list, or the next
    // reader is told a decision was made that no longer holds.
    for (const [name, why] of NOT_ROUTED) {
      expect(dispatchNames.has(name), `NOT_ROUTED lists '${name}' (${why}) but the dispatch no longer mentions it`).toBe(true);
      expect(DYN_DISPATCH_METHODS.has(name), `'${name}' is routed now — drop it from NOT_ROUTED`).toBe(false);
    }
  });

  test("no ROUTED name sits in the ARR arm's unimplemented list", () => {
    // A routed name the ARR arm refuses loudly throws at RUNTIME where the
    // frontend could have fenced at build time. This is the check that
    // fails if `splice` is routed and left in dyn_arr_proto_unimpl.
    for (const name of arrUnimpl) {
      expect(
        DYN_DISPATCH_METHODS.has(name),
        `'${name}' is both routed and listed as unimplemented for ARR receivers — ` +
          `implement it in the ARR arm, or take it out of DYN_DISPATCH_METHODS`,
      ).toBe(false);
    }
  });

  test("splice and hasOwnProperty are routed AND implemented", () => {
    // Two of the three names this suite was written for, spelled out so
    // the pair of general rules above cannot be satisfied vacuously. (The
    // third, toString's range form, is not a routed NAME — it has its own
    // lowering, and the describe below is its bookkeeping.)
    expect(DYN_DISPATCH_METHODS.has("splice")).toBe(true);
    expect(DYN_DISPATCH_METHODS.has("hasOwnProperty")).toBe(true);
    expect(arrUnimpl.has("splice")).toBe(false);
    expect(dispatchNames.has("splice")).toBe(true);
    expect(dispatchNames.has("hasOwnProperty")).toBe(true);
  });

  test("hasOwnProperty asks the SAME body Object.hasOwn does", () => {
    // Two spellings of one question. protobufjs writes both, and a second
    // implementation is how they would start disagreeing about strings,
    // typed arrays and non-enumerable members.
    const body = /static ScrDyn \*dyn_object_proto_method\([\s\S]*?\n\}/.exec(invokeSrc);
    expect(body, "dyn_object_proto_method not found").not.toBeNull();
    expect(body![0]).toContain("scr_dyn_has_own");
    expect(jsonSrc).toContain("bool scr_dyn_has_own(");
  });

  test("the kinds with no member table REFUSE rather than answer false", () => {
    // A boxed class instance carries a pointer and a descriptor and no
    // member list at all, so hasOwn cannot be answered — and every other
    // property question on it (read, write, JSON.stringify) already takes
    // the loud ladder. `false` would be the one answer that looked like a
    // result, and an instance field IS own in Node. This is not something
    // a byte-exact corpus program can hold (a refusal is not Node's
    // answer), so it is pinned here.
    const body = /bool scr_dyn_has_own\(const ScrDyn \*v, const ScrStr \*key\) \{[\s\S]*?\n\}/.exec(jsonSrc);
    expect(body, "scr_dyn_has_own not found").not.toBeNull();
    expect(body![0]).toContain("SCR_DYN_OBJINST");
    expect(body![0]).toContain("scr_dyn_objinst_fence");
    // …and the indexable kinds it CAN answer are all there. STR and BYTES
    // answered false for their index keys until this block, which made
    // `Object.hasOwn("abc", "1")` false where Node says true.
    expect(body![0]).toContain("SCR_DYN_STR");
    expect(body![0]).toContain("SCR_DYN_BYTES");
    expect(body![0]).toContain("dyn_canonical_index");
  });

  test("the canonical-index rule is written ONCE", () => {
    // `in` and Object.hasOwn each carried their own copy, with different
    // overflow guards — the same fact, two answers for a long enough key.
    expect(jsonSrc).toContain("static bool dyn_canonical_index(");
    const uses = [...jsonSrc.matchAll(/dyn_canonical_index\(/g)].length;
    expect(uses, "the shared index rule has lost its callers").toBeGreaterThanOrEqual(4);
  });

  test("Object.prototype's methods are reached AFTER the receiver's own lookup", () => {
    // The ordering IS the prototype chain: tested first, Object.prototype
    // would beat an own member, and `{ hasOwnProperty: fn }.hasOwnProperty()`
    // would stop calling fn. The OBJ arm must therefore consult presence
    // and the null-prototype flag before falling through.
    const objArm = /if \(recv->kind == SCR_DYN_OBJ\) \{[\s\S]*?\n  \}/.exec(invokeSrc);
    expect(objArm, "the OBJ arm was not found").not.toBeNull();
    expect(objArm![0]).toContain("scr_dyn_obj_key_present");
    expect(objArm![0]).toContain("null_proto");
    expect(objArm![0]).toContain("dyn_object_proto_method");
  });

  test("the by-name fence residue is a set nobody has to guess at", () => {
    // DYN_PROTO_METHOD_NAMES minus the dispatch set minus the dedicated
    // lowerings is what still refuses ON THE NAME. It is allowed to be
    // non-empty — every member is a real method with no dyn implementation
    // — but it must not contain a name the runtime answers, which is the
    // first test above read from the other end.
    const setBody = /const DYN_PROTO_METHOD_NAMES = new Set<string>\(\[([\s\S]*?)\n\]\);/.exec(lowerSrc);
    expect(setBody, "DYN_PROTO_METHOD_NAMES not found").not.toBeNull();
    const fenced = [...setBody![1]!.matchAll(/"([A-Za-z]+)"/g)].map((m) => m[1]!);
    expect(fenced.length).toBeGreaterThanOrEqual(40);
    const residue = fenced.filter((n) => !DYN_DISPATCH_METHODS.has(n) && !NOT_ROUTED.has(n));
    for (const name of residue) {
      expect(
        dispatchNames.has(name),
        `'${name}' fences on the name alone, yet scr_dyn_invoke.c answers it`,
      ).toBe(false);
    }
  });
});

describe("the toString range form's bookkeeping", () => {
  test("dyn.toStringRange reaches the runtime from both backends", () => {
    const c = readFileSync(
      join(repoRoot, "packages/compiler/src/backend/emission/emit-exprs.ts"),
      "utf8",
    );
    const llvm = readFileSync(
      join(repoRoot, "packages/compiler/src/backend/llvm/emitter.ts"),
      "utf8",
    );
    const validate = readFileSync(join(repoRoot, "packages/compiler/src/ir/validate.ts"), "utf8");
    const nodes = readFileSync(join(repoRoot, "packages/compiler/src/ir/nodes.ts"), "utf8");
    expect(c).toContain("scr_dyn_to_string_range");
    expect(llvm).toContain(`"dyn.toStringRange": "scr_dyn_to_string_range"`);
    expect(validate).toContain(`"dyn.toStringRange"`);
    // It throws (nullish receivers, the null-prototype dictionary, the
    // number receiver's radix RangeError), so it must be a may-throw seed
    // or the emitter will not open an unwind edge around it.
    const seeds = /export const MAY_THROW_LIB_FNS[^=]*=\s*new Set\(\[([\s\S]*?)\r?\n\]\);/.exec(nodes);
    expect(seeds, "MAY_THROW_LIB_FNS not found — this check has gone blind").not.toBeNull();
    expect(seeds![1]!).toContain(`"dyn.toStringRange"`);
    expect(readFileSync(join(repoRoot, "packages/runtime/src/scr_json.c"), "utf8"))
      .toContain("ScrStr *scr_dyn_to_string_range(");
  });

  test("Buffer-ness has ONE source at the boundary", () => {
    // ScrBytes.flavor is the fact; ScrDyn.buffer is the re-ask. While the
    // boundary constructors did not derive the second from the first, the
    // same value printed as a Buffer (inspect reads the payload) and
    // stringified as a Uint8Array (toString reads the node).
    const json = readFileSync(join(repoRoot, "packages/runtime/src/scr_json.c"), "utf8");
    const ref = /ScrDyn \*scr_dyn_new_bytes_ref\(ScrBytes \*b\) \{[\s\S]*?\n\}/.exec(json);
    const copy = /ScrDyn \*scr_dyn_new_bytes_copy\(const ScrBytes \*b\) \{[\s\S]*?\n\}/.exec(json);
    expect(ref?.[0], "scr_dyn_new_bytes_ref not found").toBeDefined();
    expect(copy?.[0], "scr_dyn_new_bytes_copy not found").toBeDefined();
    expect(ref![0]).toContain("dyn_bytes_is_buffer");
    expect(copy![0]).toContain("dyn_bytes_is_buffer");
  });
});
