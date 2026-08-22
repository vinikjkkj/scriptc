/* What a FAILED speculative mapping is allowed to leave behind: nothing.
 *
 * Two sites in mapType descend speculatively and retract on failure — the
 * generic-member walk in mapRecordTypeInner and the constraint erasure in
 * mapTypeInner's generic-signature rule. Both call `mark()` before and
 * `rollback()` after, and the retraction used to be incomplete in five
 * distinct ways. Each one is a test here, and each one FAILED on main
 * `fd2d121e`, where the retraction was a truncation:
 *
 *   IDREUSE      the id arrays were truncated, so the next unrelated shape
 *                was handed a discarded one's id. mapType's memo is a
 *                WeakMap — it cannot be enumerated, therefore cannot be
 *                purged — so every answer cached during the descent still
 *                named those ids and silently meant something else. On main
 *                that killed the compiler outright; the five-line program is
 *                in tests/harness/spec-rollback.test.ts.
 *   GRANTED      the overflow-grant set was never touched by the rollback,
 *                so a later shape inheriting a discarded id inherited the
 *                verdict SC6001 reads.
 *   POISON       poisoning a placeholder OLDER than the attempt stood: the
 *                rollback un-poisoned only the ids it was dropping, which
 *                are exactly the ones a later mapping cannot reach anyway.
 *   LITSERASED   the same, for the permanent per-arm literal erasure.
 *   FINALIZE     a placeholder older than the attempt could be completed by
 *                it, and finalizeRecursive is first-writer-wins — the owning
 *                frame's later, authoritative call became a silent no-op.
 *
 * These are registry-level on purpose. The end-to-end programs cover what a
 * reader can see; this file states the invariant itself, so a future change
 * to either registry cannot re-open one of the five without saying so.
 */
import { describe, expect, test } from "vitest";
import {
  ShapeRegistry,
  UnionRegistry,
  overflowShapeKey,
  overflowShapeKeys,
} from "../src/frontend/types.js";
import type { IrType } from "../src/ir/nodes.js";

const STR: IrType = { kind: "string" };
const NUM: IrType = { kind: "f64" };
const BOOL: IrType = { kind: "bool" };

/** A stand-in for a ts.Type: both registries key recIds by IDENTITY only. */
function tsTypeStandIn(): never {
  return {} as never;
}

describe("a failed speculative mapping leaves no trace", () => {
  test("a retracted shape's id is never handed to another shape", () => {
    const shapes = new ShapeRegistry();
    shapes.intern([{ name: "a", type: STR }]);
    const mark = shapes.mark();
    const speculative = shapes.intern([{ name: "b", type: STR }]);
    shapes.rollback(mark);
    const later = shapes.intern([{ name: "zzz", type: NUM }]);
    expect(later).not.toBe(speculative);
    // ...and the retracted shape still IS what it was, because the memo can
    // still be naming it and cannot be told otherwise.
    expect(shapes.get(speculative)?.fields.map((f) => f.name)).toEqual(["b"]);
  });

  test("a retracted union's id is never handed to another union", () => {
    const unions = new UnionRegistry();
    unions.intern([STR, NUM]);
    const mark = unions.mark();
    const speculative = unions.intern([STR, BOOL]);
    unions.rollback(mark);
    const later = unions.intern([NUM, BOOL]);
    expect(later).not.toBe(speculative);
    expect(unions.get(speculative)?.arms.length).toBe(2);
  });

  test("the recIds BINDING does go, so a later mapping walks the type again", () => {
    const shapes = new ShapeRegistry();
    const t = tsTypeStandIn();
    const mark = shapes.mark();
    const placeholder = shapes.recursiveRef(t);
    expect(shapes.recursivePending(t)).toBe(true);
    shapes.rollback(mark);
    // The abandoned placeholder is unreachable BY TYPE — which is the whole
    // reason the rollback exists — while the id itself stays spent.
    expect(shapes.recursivePending(t)).toBe(false);
    expect(shapes.recursiveShapeFor(t)).toBeUndefined();
    expect(shapes.isPending(placeholder)).toBe(true);
  });

  test("the same, for a union placeholder", () => {
    const unions = new UnionRegistry();
    const t = tsTypeStandIn();
    const mark = unions.mark();
    const placeholder = unions.recursiveRef(t);
    unions.rollback(mark);
    expect(unions.recursivePending(t)).toBe(false);
    expect(unions.recursiveUnionFor(t)).toBeUndefined();
    expect(unions.isPending(placeholder)).toBe(true);
  });

  test("the overflow GRANT does not outlive the attempt that earned it", () => {
    const shapes = new ShapeRegistry();
    const fields = [{ name: "g1", type: STR }];
    const key = overflowShapeKey(fields);
    const had = overflowShapeKeys.has(key);
    overflowShapeKeys.add(key);
    try {
      const mark = shapes.mark();
      const speculative = shapes.intern(fields);
      expect(shapes.grantedOverflow(speculative)).toBe(true);
      shapes.rollback(mark);
      const later = shapes.intern([{ name: "plain", type: NUM }]);
      expect(shapes.grantedOverflow(later)).toBe(false);
    } finally {
      if (!had) overflowShapeKeys.delete(key);
    }
  });

  test("a POISON the attempt stamped on an older placeholder is retracted", () => {
    const unions = new UnionRegistry();
    const t = tsTypeStandIn();
    const older = unions.recursiveRef(t);
    const mark = unions.mark();
    unions.intern([STR, NUM]);
    unions.poisonPendingPlaceholder(t);
    expect(unions.isPoisoned(older)).toBe(true);
    unions.rollback(mark);
    expect(unions.isPoisoned(older)).toBe(false);
    // ...and it is a pending placeholder again, reachable by its own type:
    // the frame that owns it is still on the stack.
    expect(unions.recursivePending(t)).toBe(true);
  });

  test("a FINALIZATION the attempt performed on an older placeholder is retracted", () => {
    const unions = new UnionRegistry();
    const t = tsTypeStandIn();
    const older = unions.recursiveRef(t);
    const mark = unions.mark();
    unions.finalizeRecursive(t, [STR, NUM]);
    expect(unions.isPending(older)).toBe(false);
    unions.rollback(mark);
    expect(unions.isPending(older)).toBe(true);
    expect(unions.get(older)?.arms).toEqual([]);
  });

  test("the same, for a record placeholder", () => {
    const shapes = new ShapeRegistry();
    const t = tsTypeStandIn();
    const older = shapes.recursiveRef(t);
    const mark = shapes.mark();
    shapes.finalizeRecursive(t, [{ name: "spec", type: STR }]);
    expect(shapes.isPending(older)).toBe(false);
    shapes.rollback(mark);
    expect(shapes.isPending(older)).toBe(true);
    expect(shapes.get(older)?.fields).toEqual([]);
  });

  test("a COMMITTED attempt keeps everything, including nested ones", () => {
    const shapes = new ShapeRegistry();
    const outer = shapes.mark();
    const a = shapes.intern([{ name: "a", type: STR }]);
    const inner = shapes.mark();
    const b = shapes.intern([{ name: "b", type: NUM }]);
    shapes.commit();
    shapes.commit();
    expect(outer).toBe(0);
    expect(inner).toBe(1);
    expect(shapes.get(a)?.fields.map((f) => f.name)).toEqual(["a"]);
    expect(shapes.get(b)?.fields.map((f) => f.name)).toEqual(["b"]);
  });

  test("an INNER attempt's retraction does not disturb the outer one's work", () => {
    const unions = new UnionRegistry();
    const t = tsTypeStandIn();
    const older = unions.recursiveRef(t);
    unions.mark();
    const kept = unions.intern([STR, NUM]);
    const inner = unions.mark();
    unions.poisonPendingPlaceholder(t);
    unions.rollback(inner);
    expect(unions.isPoisoned(older)).toBe(false);
    expect(unions.get(kept)?.arms.length).toBe(2);
    unions.commit();
    expect(unions.get(kept)?.arms.length).toBe(2);
    expect(unions.isPoisoned(older)).toBe(false);
  });

  test("an OUTER retraction undoes what a committed INNER attempt did to older state", () => {
    const unions = new UnionRegistry();
    const t = tsTypeStandIn();
    const older = unions.recursiveRef(t);
    const outer = unions.mark();
    unions.mark();
    unions.poisonPendingPlaceholder(t);
    unions.commit();
    expect(unions.isPoisoned(older)).toBe(true);
    unions.rollback(outer);
    expect(unions.isPoisoned(older)).toBe(false);
    expect(unions.recursivePending(t)).toBe(true);
  });
});
