/* The guard on the corpus split.
 *
 * The two corpus differentials are declared once per PART (see
 * scripts/gen-corpus-parts.mjs), and the parts partition the corpus by a
 * hash: every program belongs to exactly one part, so the set of entry
 * files IS the corpus. That makes a missing entry file the one failure
 * mode that costs correctness rather than time — delete
 * `corpus/differential-05.test.ts` and an eighth of the corpus stops being
 * compared against Node, with a green gate and a smaller test count nobody
 * reads. Renaming one, or letting two declare the same index, does the
 * same thing.
 *
 * So this asserts the set on disk, not the behaviour: for each suite the
 * indices declared by the entry files must be exactly 1..N for one N, and
 * every file must declare the same N. The partition property itself (union
 * of the N parts = every program exactly once) is pinned in shard.test.ts.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const dir = join(import.meta.dirname, "corpus");

describe("corpus part entry files", () => {
  for (const stem of ["differential", "llvm-differential", "coverage-corpus"]) {
    test(`${stem}: the parts on disk are exactly 1..N`, () => {
      const files = readdirSync(dir)
        .filter((f) => new RegExp(`^${stem}-\\d+\\.test\\.ts$`).test(f))
        .sort();
      expect(files.length, `no ${stem} part files at all`).toBeGreaterThan(0);
      const calls = files.map((f) => {
        const src = readFileSync(join(dir, f), "utf8");
        const m = /(?:Suite|Sweep)\((\d+),\s*(\d+)\)/.exec(src);
        expect(m, `${f} does not declare its part`).not.toBeNull();
        return { file: f, part: Number(m![1]), parts: Number(m![2]) };
      });
      const counts = new Set(calls.map((c) => c.parts));
      expect([...counts], `${stem}: entry files disagree about the part count`).toEqual([files.length]);
      expect(
        calls.map((c) => c.part).sort((a, b) => a - b),
        `${stem}: the declared parts are not exactly 1..${files.length}`,
      ).toEqual(Array.from({ length: files.length }, (_, i) => i + 1));
    });
  }
});
