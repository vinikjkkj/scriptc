/* The extractor proved BY IDENTITY against a known set.
 *
 * This is the acceptance condition for the collector, not a nicety. An
 * extractor that silently under-collects rebuilds the floor it exists to
 * replace, and nothing downstream could tell: the result would still look
 * exact. So the assertions compare SETS name by name -- never sizes. A count
 * of 4 against a different 4 is the error this file exists to exclude, and
 * it is the same error that produced 16 summed against 9 distinct earlier in
 * this work.
 *
 * The negatives are the half that matters. Each is a shape that would let a
 * loose matcher over-collect, or a tight one miss, while still producing a
 * plausible number.
 */
import { describe, expect, test } from "vitest";
import { extractCoroSymbols } from "./coro-symbol-collect.js";

const NL = String.fromCharCode(10);
const lines = (...a: string[]): string => a.join(NL) + NL;

describe("extractCoroSymbols", () => {
  test("a known set, matched name by name", () => {
    const c = lines(
      "static void sc_cr_never(ScrCoroBase *sc_b) {",
      "  switch (sc_b->state) { default: abort(); }",
      "}",
      "void sc_cr_fetchOnce(ScrCoroBase *sc_b) {",
      "  return;",
      "}",
      "static void sc_cr_a0(ScrCoroBase *b) {",
      "}",
    );
    /* The SET, written out. Not its size. */
    expect([...extractCoroSymbols(c)].sort()).toEqual(["a0", "fetchOnce", "never"]);
  });

  test("a forward DECLARATION defines nothing", () => {
    /* Same symbol, no brace. A file holding only this must contribute
     * nothing: it names a coroutine it does not define. */
    const c = lines("static void sc_cr_never(ScrCoroBase *sc_b);");
    expect([...extractCoroSymbols(c)]).toEqual([]);
  });

  test("declaration AND definition of one symbol yield one name", () => {
    const c = lines(
      "static void sc_cr_never(ScrCoroBase *sc_b);",
      "static void sc_cr_never(ScrCoroBase *sc_b) {",
      "}",
    );
    expect([...extractCoroSymbols(c)]).toEqual(["never"]);
  });

  test("a CALL is not a definition", () => {
    const c = lines(
      "static void driver(void) {",
      "  sc_cr_never(sc_b);",
      "  (*resume)(sc_b);",
      "}",
    );
    expect([...extractCoroSymbols(c)]).toEqual([]);
  });

  test("a near-miss signature is not collected", () => {
    /* Right prefix, wrong parameter type: not a state machine. A matcher
     * keyed on the name alone would take it. */
    const c = lines("static void sc_cr_nope(ScrPromise *p) {", "}");
    expect([...extractCoroSymbols(c)]).toEqual([]);
  });

  test("a name that merely CONTAINS the prefix is not collected", () => {
    const c = lines("static void my_sc_cr_helper(ScrCoroBase *b) {", "}");
    expect([...extractCoroSymbols(c)]).toEqual([]);
  });

  test("the empty file yields the empty set, not a throw", () => {
    expect([...extractCoroSymbols("")]).toEqual([]);
  });

  test("the matcher is not left stateful between calls", () => {
    /* A module-level regex with /g carries lastIndex. Two identical inputs
     * must give identical answers, or the SECOND file of every pair in a
     * real run is read from the wrong offset -- a silent under-collection
     * that looks like reclamation. */
    const c = lines("static void sc_cr_one(ScrCoroBase *b) {", "}");
    const first = [...extractCoroSymbols(c)];
    const second = [...extractCoroSymbols(c)];
    expect(second).toEqual(first);
    expect(second).toEqual(["one"]);
  });
});
