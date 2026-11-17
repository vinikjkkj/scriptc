/* --layout-order: the order file parser and the two reorderings (the C emitter's function chunks, the LLVM text). Pure functions; the
 * end-to-end proof (symbol order in the linked binary, output == Node) is in the corpus run recorded with the change. */
import { describe, expect, it } from "vitest";
import {
  bestRank,
  cDefinedNames,
  extractCFunctionChunks,
  hotFirst,
  hotLiteralNames,
  literalRefs,
  markUsedDefinitions,
  parseLayoutOrder,
  reorderLlvmText,
  stableByRank,
} from "../src/backend/layout-order.js";

describe("parseLayoutOrder", () => {
  it("ranks symbols by line, first mention wins, comments and blanks ignored, GNU spelling accepted", () => {
    const o = parseLayoutOrder("# tier 1\nsc_b\n\nsc_a\n*(.text.sc_c)\nsc_b\n  sc_d  \n");
    expect([...o.rank.entries()]).toEqual([["sc_b", 0], ["sc_a", 1], ["sc_c", 2], ["sc_d", 3]]);
  });
  it("bestRank is the best member's rank, Infinity when none is named", () => {
    const o = parseLayoutOrder("x\ny\nz\n");
    expect(bestRank(o, ["z", "y"])).toBe(1);
    expect(bestRank(o, ["nope"])).toBe(Infinity);
  });
});

describe("stableByRank", () => {
  it("ranked first in rank order, the rest last in their original order", () => {
    const items = ["a", "b", "c", "d", "e"];
    const rank: Record<string, number> = { d: 0, b: 1 };
    expect(stableByRank(items, (s) => rank[s] ?? Infinity)).toEqual(["d", "b", "a", "c", "e"]);
  });
});

describe("C function chunks", () => {
  const lines = [
    "typedef struct {",
    "  int x;",
    "} T;",
    "static int sc_a(int v) { /* /p/t.ts:3 */",
    "  return v;",
    "}",
    "",
    "static const char *tbl[] = {",
    "  \"x\",",
    "};",
    "static void sc_b(void) {",
    "  sc_a(1);",
    "}",
  ];
  it("finds definitions by their column-0 header and skips struct bodies and initialisers", () => {
    expect(cDefinedNames(lines)).toEqual(["sc_a", "sc_b"]);
    const { chunks, rest } = extractCFunctionChunks(lines);
    expect(chunks.map((c) => c.length)).toEqual([3, 3]);
    expect(rest).toEqual(["typedef struct {", "  int x;", "} T;", "", "static const char *tbl[] = {", "  \"x\",", "};"]);
  });
  it("reads the name of a header that is already marked used (an emitted TU read back)", () => {
    expect(cDefinedNames(["static __attribute__((used)) int sc_a(int v) { /* /p/t.ts:3 */", "}"])).toEqual(["sc_a"]);
  });
  it("marks only the NAMED internal definitions used and touches nothing else", () => {
    const o = parseLayoutOrder("sc_b\n");
    const out = markUsedDefinitions(["static void sc_b(void) {", "  static int n = 0;", "}", "static void sc_c(void) {", "}", "int main(void) {", "}"], o);
    expect(out).toEqual(["static __attribute__((used)) void sc_b(void) {", "  static int n = 0;", "}", "static void sc_c(void) {", "}", "int main(void) {", "}"]);
  });
});

describe("reorderLlvmText", () => {
  const ll = [
    "target triple = \"x\"",
    "declare void @ext()",
    "define internal void @cold1() #0 {",
    "  ret void",
    "}",
    "@g = internal global i32 0",
    "define internal void @steady() #0 { ; a comment",
    "  ret void",
    "}",
    "define i32 @main() #0 {",
    "  ret i32 0",
    "}",
    "attributes #0 = { nounwind }",
  ].join("\n");
  it("writes the ranked functions first in rank order where the first define stood, every other line in place", () => {
    const out = reorderLlvmText(ll, parseLayoutOrder("steady\nmain\n"));
    expect(out.split("\n").filter((l) => l.startsWith("define")).map((l) => /@(\w+)/.exec(l)![1])).toEqual(["steady", "main", "cold1"]);
    expect(out.split("\n").slice(0, 2)).toEqual(["target triple = \"x\"", "declare void @ext()"]);
    // all lines survive
    expect(out.split("\n").sort()).toEqual(ll.split("\n").sort());
  });
  it("returns the same text when nothing is named (or the named symbols are absent)", () => {
    expect(reorderLlvmText(ll, parseLayoutOrder("nothere\n"))).toBe(ll);
    expect(reorderLlvmText(ll, parseLayoutOrder(""))).toBe(ll);
  });
});

describe("data literals", () => {
  const lit = (n: number, text: string): string => `@sc_lit_${n} = internal global { i32, i32, i32, [${text.length + 1} x i8] } { i32 -1, i32 ${text.length}, i32 ${text.length}, [${text.length + 1} x i8] c"${text}\\00" }`;
  const ll = [
    "target triple = \"x\"",
    lit(0, "cold-a"),
    lit(1, "hot-a"),
    lit(2, "cold-b"),
    lit(3, "both"),
    lit(4, "in-table"),
    "@tbl = internal global [1 x ptr] [ptr @sc_lit_4]",
    "define internal void @cold() #0 {",
    "  call void @use(ptr @sc_lit_0, ptr @sc_lit_2, ptr @sc_lit_3)",
    "  ret void",
    "}",
    "define internal void @steady() #0 {",
    "  call void @use(ptr @sc_lit_1, ptr @sc_lit_3)",
    "  ret void",
    "}",
  ].join("\n");
  it("literalRefs lists the distinct names of a text", () => {
    expect([...literalRefs(["x sc_lit_1 y sc_lit_22", "sc_lit_1 again", "no_sc_lit_x"])]).toEqual(["sc_lit_1", "sc_lit_22"]);
  });
  it("hotFirst moves the cold ones after the rest, each group in its original order", () => {
    expect(hotFirst(["a", "b", "c", "d"], (x) => x, new Set(["a", "c"]))).toEqual(["b", "d", "a", "c"]);
    expect(hotFirst(["a", "b"], (x) => x, new Set())).toEqual(["a", "b"]);
  });
  it("the LLVM reorder keeps every literal in its slot group and moves only the cold-only ones last", () => {
    const out = reorderLlvmText(ll, parseLayoutOrder("steady\n")).split("\n");
    const defs = out.filter((l) => l.startsWith("@sc_lit_")).map((l) => /^@(sc_lit_\d+)/.exec(l)![1]);
    // sc_lit_0 and sc_lit_2 are mentioned only by the unranked function; sc_lit_3 is shared with a ranked one; sc_lit_4 is named by a data table
    expect(defs).toEqual(["sc_lit_1", "sc_lit_3", "sc_lit_4", "sc_lit_0", "sc_lit_2"]);
    // a literal definition is never dropped or duplicated
    expect(out.filter((l) => l.startsWith("@sc_lit_")).length).toBe(5);
    expect(out.slice().sort()).toEqual(ll.split("\n").slice().sort());
  });
  it("the hot name list holds every literal ranked or data text mentions, in rank order, and never a cold-only one", () => {
    const names = hotLiteralNames([ll], "llvm", parseLayoutOrder("steady\n"));
    expect(names).toEqual(["sc_lit_1", "sc_lit_3", "sc_lit_4"]);
    expect(hotLiteralNames([ll], "llvm", parseLayoutOrder("nothere\n"))).toEqual(["sc_lit_4"]);
  });
  it("the same list from C text: definitions and extern declarations are not references", () => {
    const c = [
      "extern SCR_STR_LIT(6) sc_lit_0;",
      "SCR_STR_LIT(6) sc_lit_0 =",
      "    { SCR_STR_IMMORTAL, 5, 5, \"cold!\" };",
      "static void sc_cold(void) { /* a.ts:1 */",
      "  use(&sc_lit_0);",
      "}",
      "static void sc_hot(void) { /* a.ts:2 */",
      "  use(&sc_lit_1);",
      "}",
    ];
    expect(hotLiteralNames([c.join("\n")], "c", parseLayoutOrder("sc_hot\n"))).toEqual(["sc_lit_1"]);
  });
});
