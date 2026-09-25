/* The partition function's contract: the union of the n shards is the whole
 * list with every item EXACTLY once (no drops, no duplicates), assignment
 * depends only on the item's key (list growth never moves an existing item),
 * and no spec means everything. differential/llvm-differential/npm/server
 * lean on these properties for CI sharding — see shard.ts. */
import { globSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { corpusSlice, parseShardSpec, partOf, shardOf, shardSelect, shardSuffix } from "./shard.js";

const corpusDir = join(import.meta.dirname, "../corpus");

// The default parameters read SCRIPTC_TEST_SHARD, and CI sets it job-wide —
// these tests must see a controlled environment, not the job's slice.
const ambient = process.env["SCRIPTC_TEST_SHARD"];
beforeAll(() => {
  delete process.env["SCRIPTC_TEST_SHARD"];
});
afterAll(() => {
  if (ambient !== undefined) process.env["SCRIPTC_TEST_SHARD"] = ambient;
});

describe("parseShardSpec", () => {
  test("unset and empty mean no sharding", () => {
    expect(parseShardSpec(undefined)).toBeUndefined();
    expect(parseShardSpec("")).toBeUndefined();
  });

  test("defaults to SCRIPTC_TEST_SHARD", () => {
    process.env["SCRIPTC_TEST_SHARD"] = "2/3";
    try {
      expect(parseShardSpec()).toEqual({ index: 2, count: 3 });
      expect(shardSuffix()).toBe(", shard 2/3");
    } finally {
      delete process.env["SCRIPTC_TEST_SHARD"];
    }
  });

  test("parses i/n", () => {
    expect(parseShardSpec("2/3")).toEqual({ index: 2, count: 3 });
    expect(parseShardSpec("1/1")).toEqual({ index: 1, count: 1 });
    expect(parseShardSpec("10/12")).toEqual({ index: 10, count: 12 });
  });

  test("rejects malformed and out-of-range specs loudly", () => {
    for (const bad of ["0/3", "4/3", "1/0", "1-3", "a/b", "1/3 ", "-1/3", "1/", "/3"]) {
      expect(() => parseShardSpec(bad), bad).toThrow();
    }
  });
});

describe("shardSelect", () => {
  const keys = Array.from({ length: 1000 }, (_, i) => `program-${i}.ts`);

  test("no spec returns everything unchanged", () => {
    expect(shardSelect(keys, (k) => k, undefined)).toEqual(keys);
    expect(shardSelect(keys, (k) => k, { index: 1, count: 1 })).toEqual(keys);
  });

  test.for([2, 3, 4, 7])("the union of %i shards is every item exactly once", (n) => {
    const union = Array.from({ length: n }, (_, i) =>
      shardSelect(keys, (k) => k, { index: i + 1, count: n }),
    ).flat();
    expect(union.length).toBe(keys.length); // disjoint: no item counted twice
    expect([...union].sort()).toEqual([...keys].sort()); // complete: none dropped
  });

  test("the real corpus partitions completely under 3 shards", () => {
    // The exact list differential.test.ts globs, keyed the same way.
    const files = ["ts", "js", "mjs", "cjs"]
      .flatMap((ext) => [
        ...globSync(join(corpusDir, `*.${ext}`)),
        ...globSync(join(corpusDir, `*/main.${ext}`)),
      ])
      .sort()
      .map((f) => f.slice(corpusDir.length + 1));
    expect(files.length).toBeGreaterThan(0);
    const union = Array.from({ length: 3 }, (_, i) =>
      shardSelect(files, (k) => k, { index: i + 1, count: 3 }),
    ).flat();
    expect(union.length).toBe(files.length);
    expect([...union].sort()).toEqual(files);
  });

  test("assignment is per-key: growing the list never moves an existing item", () => {
    const spec = { index: 2, count: 3 };
    const before = shardSelect(keys.slice(0, 400), (k) => k, spec);
    const after = shardSelect(keys, (k) => k, spec);
    expect(after.slice(0, before.length)).toEqual(before);
  });

  test("shardOf is deterministic and in range", () => {
    for (const k of keys.slice(0, 50)) {
      const s = shardOf(k, 3);
      expect(s).toBe(shardOf(k, 3));
      expect(s).toBeGreaterThanOrEqual(1);
      expect(s).toBeLessThanOrEqual(3);
    }
  });
});

describe("shardSuffix", () => {
  test("names the shard under a spec, empty otherwise", () => {
    expect(shardSuffix({ index: 2, count: 3 })).toBe(", shard 2/3");
    expect(shardSuffix(undefined)).toBe("");
  });
});

/* The in-RUN split (corpus-parts.test.ts guards the entry files that use
 * it). Two properties, and the second is the one that bites: the parts must
 * partition the list, AND they must keep partitioning it UNDER A CI SHARD.
 * partOf is salted apart from shardOf precisely because an unsalted second
 * modulus of the same hash is not independent of the first — h%8 decides
 * h%2 and h%4 — so under --shard=1/2 half the parts would come back empty
 * while every part still reported success. */
describe("corpusSlice", () => {
  const keys = Array.from({ length: 1000 }, (_, i) => `program-${i}.ts`);

  test("parts <= 1 is the historical whole list", () => {
    expect(corpusSlice(keys, (k) => k, 1, 1, undefined)).toEqual(keys);
  });

  test.for([2, 4, 8])("the union of %i parts is every item exactly once", (n) => {
    const union = Array.from({ length: n }, (_, i) =>
      corpusSlice(keys, (k) => k, i + 1, n, undefined),
    ).flat();
    expect(union.length).toBe(keys.length);
    expect([...union].sort()).toEqual([...keys].sort());
  });

  test.for([2, 3])("every part is non-empty under a %i-way CI shard", (shards) => {
    for (let s = 1; s <= shards; s++) {
      for (let p = 1; p <= 8; p++) {
        const got = corpusSlice(keys, (k) => k, p, 8, { index: s, count: shards });
        expect(got.length, `part ${p}/8 of shard ${s}/${shards} is empty`).toBeGreaterThan(0);
      }
    }
  });

  test("the shard x part grid covers every item exactly once", () => {
    const union: string[] = [];
    for (let s = 1; s <= 3; s++) {
      for (let p = 1; p <= 8; p++) {
        union.push(...corpusSlice(keys, (k) => k, p, 8, { index: s, count: 3 }));
      }
    }
    expect(union.length).toBe(keys.length);
    expect([...union].sort()).toEqual([...keys].sort());
  });

  test("partOf is deterministic, in range, and not shardOf", () => {
    let differs = 0;
    for (const k of keys.slice(0, 200)) {
      const p = partOf(k, 8);
      expect(p).toBe(partOf(k, 8));
      expect(p).toBeGreaterThanOrEqual(1);
      expect(p).toBeLessThanOrEqual(8);
      if (p !== shardOf(k, 8)) differs++;
    }
    expect(differs).toBeGreaterThan(100); // an unsalted copy would differ ~never
  });
});
