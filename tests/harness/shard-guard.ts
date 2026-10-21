/* A shard that legitimately receives ZERO cases must pass, and a suite whose
 * discovery broke (also zero cases) must still FAIL.
 *
 * Selection is by name hash, so a small suite can leave a shard with nothing.
 * vitest then reports "No test found in suite <file>" and counts the file as
 * failed, which keeps that CI job red for a reason that is not a defect. A
 * blanket passWithNoTests would also pass the broken-glob case, so instead
 * each empty selection registers ONE explicit test:
 *  - universe empty: a test that throws (discovery found nothing; whatever
 *    the shard, that is a defect, never a legitimate empty);
 *  - universe non-empty: a labelled test that PROVES the emptiness is
 *    legitimate by recomputing the selection of every shard 1..count and
 *    asserting the shards partition the scope exactly (each case in exactly
 *    one shard, none of them this one). The test title carries S and i/n.
 * A non-empty selection registers nothing, so every other shard is
 * unchanged. */
import { expect, test } from "vitest";
import { parseShardSpec, type ShardSpec } from "./shard.js";

export interface EmptyShardOpts<T> {
  /** Suite noun for titles, e.g. "server programs". */
  what: string;
  /** Everything discovery found, before any shard/part selection. */
  universe: readonly T[];
  /** What the shard axis partitions: `universe`, or for a part-split suite
   * the slice of it belonging to this part (default: universe). */
  scope?: readonly T[];
  keyOf: (item: T) => string;
  /** The selection for an arbitrary shard spec (the suite's own selector). */
  selectFor: (spec: ShardSpec | undefined) => T[];
}

export function defineEmptyShardTest<T>(o: EmptyShardOpts<T>): void {
  const spec = parseShardSpec();
  if (o.selectFor(spec).length > 0) return;
  const S = o.universe.length;
  if (S === 0) {
    test(`discovery found 0 ${o.what}: FAILING (an empty suite is never a legitimate empty shard)`, () => {
      throw new Error(`0 ${o.what} discovered: the glob or fixture directory is broken`);
    });
    return;
  }
  const scope = o.scope ?? o.universe;
  const where = spec === undefined ? "unsharded" : `${spec.index}/${spec.count}`;
  test(`shard ${where} selects 0 of ${S} ${o.what} (legitimate: the shards partition all ${scope.length} in scope)`, () => {
    const count = spec?.count ?? 1;
    const seen = new Map<string, number>();
    let sum = 0;
    for (let index = 1; index <= count; index++) {
      for (const item of o.selectFor(count === 1 ? undefined : { index, count })) {
        const k = o.keyOf(item);
        seen.set(k, (seen.get(k) ?? 0) + 1);
        sum++;
      }
    }
    expect(sum, "sum of programs selected across all shards").toBe(scope.length);
    expect([...seen.values()].filter((n) => n !== 1), "cases owned by more than one shard").toEqual([]);
    expect(new Set(scope.map(o.keyOf)).size, "scope keys are unique").toBe(scope.length);
    console.log(`0 programs selected: legitimate (suite size ${S}, shard ${where}, scope ${scope.length}, sum over shards ${sum})`);
    // Legitimate only when the suite is non-empty AND this shard owns none.
    expect(o.selectFor(spec)).toEqual([]);
  });
}
