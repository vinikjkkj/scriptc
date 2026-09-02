/* Byte-compare the EMITTED C of the same corpus programs built from a base
 * worktree and from HEAD. The lowering sweep proves the diagnostics did not
 * move; this proves the CODE did not either, which is what a differential
 * verdict actually depends on.
 *
 *   node emit-compare.mjs [stride] [baseWorktree] [headWorktree]
 *
 * Both trees must be BUILT. Programs that refuse on either side are SKIPped:
 * the lowering sweep is what compares those, and it compares all of them.
 *
 * SELF-TEST FIRST. The first draft of this file reported "identical=0
 * DIFFERENT=0 skipped=33" — a wholly vacuous run — because `--keep-c` names
 * the TU after the SOURCE file rather than after `-o`, so both trees wrote
 * the same path and the second build overwrote the first. A sweep that
 * silently measures nothing looks exactly like a sweep that found nothing,
 * so before any real program is compared this plants two known answers and
 * ABORTS unless both land: two hashes of the SAME file must compare
 * identical, and two hashes of DIFFERENT files must compare different. */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, mkdirSync, rmSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { createHash } from "node:crypto";

const N = Number(process.argv[2] ?? 60);
const BASE = process.argv[3] ?? "../base";
const HEAD = process.argv[4] ?? ".";
const OUT = join(process.env["TMPDIR"] ?? process.env["TMP"] ?? ".", "keyorder-emitcmp");
rmSync(OUT, { recursive: true, force: true });
for (const tag of ["base", "head"]) mkdirSync(join(OUT, tag), { recursive: true });

const corpus = join(HEAD, "tests/corpus");

/** The emitted TU's sha256, or null when the program did not compile. The TU
 * is named after the SOURCE, so each tree gets its own directory. */
const emitHash = (root, f, tag) => {
  const dir = join(OUT, tag);
  const exe = join(dir, "out.exe");
  try {
    execFileSync(
      process.execPath,
      [join(root, "packages/cli/dist/main.js"), "build", join(corpus, f), "--backend", "c", "--keep-c", "-o", exe],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 600_000 },
    );
  } catch {
    return null;
  }
  const tu = join(dir, basename(f, extname(f)) + ".c");
  try {
    return createHash("sha256").update(readFileSync(tu)).digest("hex");
  } catch {
    return null;
  }
};

const all = readdirSync(corpus).filter((f) => /\.(ts|js|cjs|mjs)$/.test(f)).sort();

// ── the self-test ────────────────────────────────────────────────────────
const probeA = all.find((f) => /^001-/.test(f)) ?? all[0];
const probeB = all.find((f) => f !== probeA && /^1[0-9]{3}-/.test(f)) ?? all[1];
const sameA = emitHash(HEAD, probeA, "base");
const sameB = emitHash(HEAD, probeA, "head");
const diffB = emitHash(HEAD, probeB, "head");
if (sameA === null || sameB === null || diffB === null) {
  console.error(`SELF-TEST FAILED: a probe did not emit a TU (${probeA}=${sameA ? "ok" : "-"}, ${probeB}=${diffB ? "ok" : "-"})`);
  process.exit(2);
}
if (sameA !== sameB) {
  console.error("SELF-TEST FAILED: one program hashed two ways — the comparison is not stable");
  process.exit(2);
}
if (sameA === diffB) {
  console.error("SELF-TEST FAILED: two DIFFERENT programs hashed the same — the harness cannot see a difference");
  process.exit(2);
}
console.log(`self-test ok (${probeA} is stable and differs from ${probeB})`);

// ── the real sweep ───────────────────────────────────────────────────────
const pick = all.filter((_, i) => i % N === 0);
for (const f of all) if (/^(4880|3501|5390|5391|4970|7380|7381)/.test(f) && !pick.includes(f)) pick.push(f);

let same = 0;
let differ = 0;
let skipped = 0;
for (const f of pick) {
  const a = emitHash(BASE, f, "base");
  const b = emitHash(HEAD, f, "head");
  if (a === null || b === null) {
    skipped++;
    console.log(`SKIP  ${f} (base=${a ? "c" : "-"} head=${b ? "c" : "-"})`);
    continue;
  }
  if (a === b) {
    same++;
    continue;
  }
  differ++;
  console.log(`DIFF  ${f}`);
}
console.log(`\nemitted-C compare over ${pick.length} corpus programs: identical=${same} DIFFERENT=${differ} skipped=${skipped}`);
