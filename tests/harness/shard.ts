/* Within-file partitioning for the corpus-driven harnesses.
 *
 * vitest's --shard is FILE-granular, and this suite's wall time is dominated
 * by a few monster files (differential.test.ts iterates the whole corpus
 * sequentially in one worker), so a naive file shard leaves one shard nearly
 * as slow as the whole suite. CI therefore sets SCRIPTC_TEST_SHARD="i/n"
 * alongside --shard=i/n, and every harness that globs a big case list runs
 * it through shardSelect below: small files distribute by file, monster
 * files split by case.
 *
 * The assignment hashes each case's stable NAME — never its list index — so
 * a program keeps its shard when the corpus grows around it (compile caches
 * stay warm across corpus additions) and, since the hash maps every key to
 * exactly one shard in [1..n], the union of the n shards runs every case
 * exactly once by construction (shard.test.ts pins the property). Unset =
 * everything: local runs are unchanged.
 */
import { createHash } from "node:crypto";

export interface ShardSpec {
  /** 1-based shard index. */
  index: number;
  count: number;
}

/** Parse a shard spec of the form "i/n" (1 <= i <= n). Undefined when the
 * variable is unset or empty; malformed values throw — a typo silently
 * running everything (or nothing) would defeat the matrix. */
export function parseShardSpec(
  raw: string | undefined = process.env["SCRIPTC_TEST_SHARD"],
): ShardSpec | undefined {
  if (raw === undefined || raw === "") return undefined;
  const m = /^([1-9]\d*)\/([1-9]\d*)$/.exec(raw);
  if (!m) throw new Error(`SCRIPTC_TEST_SHARD must look like "2/3", got "${raw}"`);
  const index = Number(m[1]);
  const count = Number(m[2]);
  if (index > count) throw new Error(`SCRIPTC_TEST_SHARD index out of range: "${raw}"`);
  return { index, count };
}

/** The shard (1-based) a key belongs to among `count` shards: the first four
 * bytes of sha1(key) mod count — stable across runs, platforms, and corpus
 * growth. Total on its domain, so exactly one shard owns any key. */
export function shardOf(key: string, count: number): number {
  return (createHash("sha1").update(key).digest().readUInt32BE(0) % count) + 1;
}

/** The subset of `items` this shard owns. No spec (the local default) or a
 * single shard returns the whole list unchanged. */
export function shardSelect<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
  spec: ShardSpec | undefined = parseShardSpec(),
): T[] {
  if (spec === undefined || spec.count === 1) return [...items];
  return items.filter((item) => shardOf(keyOf(item), spec.count) === spec.index);
}

/** Suffix for describe titles so shard membership is visible in CI logs:
 * ", shard 2/3" under a spec, "" otherwise. */
export function shardSuffix(spec: ShardSpec | undefined = parseShardSpec()): string {
  return spec === undefined ? "" : `, shard ${spec.index}/${spec.count}`;
}

/** The part (1-based) a key belongs to among `parts` in-RUN slices.
 *
 * SALTED APART from shardOf on purpose. The CI shard hashes the same key,
 * and a second modulus of the SAME hash is not independent of the first
 * (h%12 decides h%3), so under `--shard=1/3` eight of twelve parts would
 * come back EMPTY while the suite still reported success. Total on its
 * domain like shardOf, so the union of the parts runs every case exactly
 * once — shard.test.ts pins the property for both. */
export function partOf(key: string, parts: number): number {
  return (
    (createHash("sha1").update("corpus-part\0").update(key).digest().readUInt32BE(0) % parts) + 1
  );
}

/** One part of one CI shard of `items`.
 *
 * vitest's pool is file-granular and isolates a process per file, so a
 * suite that walks the whole corpus inside ONE file is serial however many
 * workers the pool has — and the two corpus suites hold most of the gate's
 * tests. They are therefore declared as `parts` sibling entry files, each
 * passing its own index here. `parts <= 1` is the historical single-file
 * behavior, unchanged. */
export function corpusSlice<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
  part: number,
  parts: number,
  spec: ShardSpec | undefined = parseShardSpec(),
): T[] {
  const selected = shardSelect(items, keyOf, spec);
  if (parts <= 1) return selected;
  return selected.filter((item) => partOf(keyOf(item), parts) === part);
}

/** Suffix for describe titles so PART membership is visible beside the CI
 * shard's: ", part 2/8" under a split, "" for the whole corpus. */
export function partSuffix(part: number, parts: number): string {
  return parts > 1 ? `, part ${part}/${parts}` : "";
}
