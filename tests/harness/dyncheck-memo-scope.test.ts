/* The SCOPE of canDynCheckTo's memos is load-bearing for a DIFFERENT file.
 *
 * Two caches sit on the dyn-check predicate, written by two blocks that never
 * shared a file:
 *
 *   ir/nodes.ts            `jsonSafeMemo` and `nestedMemo`, declared INSIDE
 *                          canDynCheckTo's body -- one per call
 *   lowering/lowerer.ts    `cdctMemo`, a Lowerer-lifetime cache of
 *                          canDynCheckTo's TRUE answers only
 *
 * Each is sound alone and each carries its own argument for why. This test
 * exists for the property NEITHER argument states, because neither file can
 * see it: the lowerer's cache is sound ONLY WHILE the nodes.ts memos stay
 * per-call.
 *
 * THE MECHANISM, because a fence whose reason is not written down is a fence
 * that gets removed. The lowerer detects an unsound answer by watching what
 * the predicate READS: it hands canDynCheckTo two accessor closures and sets
 * `pending` when the walk consults a shape or union no frame has finalized.
 * A pending placeholder has no fields and no arms, so it answers TRUE
 * vacuously and can become FALSE once filled -- the one registry transition
 * that can LOWER an answer. So the lowerer refuses to cache any answer whose
 * walk touched one.
 *
 * That detector fires only through those two closures. And nestedOk's
 * memo-hit path returns BEFORE it reaches `jsonSafe`, hence before either
 * closure. Today that is harmless: a hit exists only because an earlier MISS
 * in the SAME call computed it, and that miss went through the closures, so a
 * pending shape is seen at least once per call before the memo short-circuits
 * every later traversal of the same subtree.
 *
 * Widen either memo to module scope and that stops holding. A hit served from
 * a previous call reads no registry at all, `pending` stays false, and the
 * lowerer caches a TRUE derived from an unfinalized placeholder. The result
 * is a wrong dyn-check decision: emitted code, no diagnostic, and nothing in
 * either file looking wrong.
 *
 * Widening a per-call memo to module scope is the most natural perf change
 * imaginable. It reads as pure gain, it passes every other test here, and the
 * corpus cannot catch it because the divergence needs a shape finalized LATE.
 * This test is the only thing standing there. If you are here because it
 * failed: you have not broken nodes.ts, you have broken lowerer.ts from a
 * distance. Read `cdctMemo`'s comment before changing this.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts5 from "typescript";
import { describe, expect, test } from "vitest";

const repoRoot = join(import.meta.dirname, "../..");
const read = (p: string) => readFileSync(join(repoRoot, p), "utf8");

const NODES = "packages/compiler/src/ir/nodes.ts";
const LOWERER = "packages/compiler/src/frontend/lowering/lowerer.ts";

/** The nearest enclosing function-like ancestor of each named `const`, by
 * NAME, or null when the declaration sits at module scope.
 *
 * Parsed, not grepped. A brace-counting or regex version answers wrongly on a
 * comment or string holding an unbalanced brace, and nodes.ts is 12k lines of
 * prose-heavy comments, several containing code samples. */
function memoScopes(source: string, names: readonly string[]): Map<string, string | null> {
  const sf = ts5.createSourceFile("probe.ts", source, ts5.ScriptTarget.ESNext, true);
  const found = new Map<string, string | null>();
  const enclosing = (n: ts5.Node): string | null => {
    for (let p = n.parent; p !== undefined; p = p.parent) {
      if (ts5.isFunctionDeclaration(p)) return p.name?.text ?? "<anonymous function>";
      if (ts5.isMethodDeclaration(p)) return ts5.isIdentifier(p.name) ? p.name.text : "<computed method>";
      if (ts5.isFunctionExpression(p) || ts5.isArrowFunction(p)) return "<anonymous closure>";
      if (ts5.isSourceFile(p)) return null;
    }
    return null;
  };
  const visit = (n: ts5.Node): void => {
    if (ts5.isVariableDeclaration(n) && ts5.isIdentifier(n.name) && names.includes(n.name.text)) {
      found.set(n.name.text, enclosing(n));
    }
    ts5.forEachChild(n, visit);
  };
  visit(sf);
  return found;
}

const MEMOS = ["jsonSafeMemo", "nestedMemo"] as const;

describe("canDynCheckTo's memos are per-call, and the checker saying so works both ways", () => {
  /* SENSITIVITY. A positive control proves a matcher CAN fire; it does not
   * prove it fires only when it should. Both directions are here, and this is
   * the one that catches a checker which has quietly stopped looking. The
   * planted source is the exact edit a future perf change would make. */
  test("the checker REPORTS module scope when a memo is hoisted (planted violation)", () => {
    const planted = [
      "const nestedMemo = new Map<object, boolean>();",
      "export function canDynCheckTo(t: object): boolean {",
      "  const jsonSafeMemo = new Map<object, boolean>();",
      "  return jsonSafeMemo.size + nestedMemo.size > 0 && t !== null;",
      "}",
    ].join("\n");
    const scopes = memoScopes(planted, MEMOS);
    expect(scopes.get("nestedMemo")).toBeNull();
    expect(scopes.get("jsonSafeMemo")).toBe("canDynCheckTo");
  });

  /* SPECIFICITY. The same checker must stay SILENT on a correctly nested
   * tree, or a green result above means nothing. */
  test("the checker stays silent when both memos are nested (planted control)", () => {
    const ok = [
      "export function canDynCheckTo(t: object): boolean {",
      "  const jsonSafeMemo = new Map<object, boolean>();",
      "  const nestedMemo = new Map<object, boolean>();",
      "  return jsonSafeMemo.size + nestedMemo.size > 0 && t !== null;",
      "}",
    ].join("\n");
    const scopes = memoScopes(ok, MEMOS);
    expect(scopes.get("jsonSafeMemo")).toBe("canDynCheckTo");
    expect(scopes.get("nestedMemo")).toBe("canDynCheckTo");
    expect([...scopes.values()].filter((v) => v === null)).toEqual([]);
  });

  test("THE INVARIANT: both memos are declared inside canDynCheckTo's body", () => {
    const scopes = memoScopes(read(NODES), MEMOS);
    // Present at all: a renamed memo must not pass by vanishing.
    expect([...scopes.keys()].sort()).toEqual(["jsonSafeMemo", "nestedMemo"]);
    expect(scopes.get("jsonSafeMemo")).toBe("canDynCheckTo");
    expect(scopes.get("nestedMemo")).toBe("canDynCheckTo");
  });

  /* The other half of the same seam, asserted here because the defect needs
   * BOTH halves and no single file owns it. The lowerer's cache is sound
   * because it stores TRUE answers only, and only when the walk touched no
   * pending placeholder. Remove either guard and the memos above stop being
   * enough, however per-call they are. */
  test("the lowerer still caches only unpending TRUE answers", () => {
    const src = read(LOWERER);
    const sets = src.split("\n").filter((l) => l.includes("cdctMemo.set("));
    expect(sets).toHaveLength(1);
    expect(sets[0]).toMatch(/\bpending\b/);
    expect(sets[0]).toMatch(/\banswer\b/);
    // And the flag is raised from inside the registry accessors, the only
    // place the predicate's reads are observable at all.
    expect(src).toMatch(/isPending\(id\)\)\s*pending = true/);
  });
});
