/* --layout-order: the order file parser and the two reorderings (the C emitter's function chunks, the LLVM text). Pure functions; the
 * end-to-end proof (symbol order in the linked binary, output == Node) is in the corpus run recorded with the change. */
import { describe, expect, it } from "vitest";
import {
  bestRank,
  cDefinedNames,
  extractCFunctionChunks,
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
