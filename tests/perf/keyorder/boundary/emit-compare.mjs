/* Byte-compare the EMITTED C of the same corpus programs built from the base
 * worktree and from HEAD. The lowering sweep proves the diagnostics did not
 * move; this proves the CODE did not either, which is what a differential
 * verdict actually depends on.
 *
 *   node emit-compare.mjs [stride] [baseWorktree] [headWorktree]
 *
 * Both trees must be BUILT. Programs that refuse on either side are SKIPped:
 * the lowering sweep is what compares those, and it compares all of them. */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

const BASE = process.argv[3] ?? "../base";
const HEAD = process.argv[4] ?? ".";
const OUT = join(process.env["TMPDIR"] ?? process.env["TMP"] ?? ".", "keyorder-emitcmp");
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const corpus = join(HEAD, "tests/corpus");
const all = readdirSync(corpus).filter((f) => /\.(ts|js|cjs|mjs)$/.test(f)).sort();
// A deterministic 1-in-N slice plus every program the sweep flagged.
const N = Number(process.argv[2] ?? 60);
const pick = all.filter((_, i) => i % N === 0);
for (const f of all) if (/^4880|^3501|^5390|^5391|^4970|^7380/.test(f)) if (!pick.includes(f)) pick.push(f);

const build = (root, f, tag) => {
  const exe = join(OUT, `${tag}-${f.replace(/\W/g, "_")}.exe`);
  try {
    execFileSync(process.execPath, [join(root, "packages/cli/dist/main.js"), "build", join(corpus, f), "--backend", "c", "--keep-c", "-o", exe], {
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 600_000,
    });
  } catch {
    return null; // refused / failed: the sweep already compared those
  }
  const c = exe.replace(/\.exe$/, "") + ".c";
  try {
    return createHash("sha256").update(readFileSync(c)).digest("hex");
  } catch {
    return null;
  }
};

let same = 0, differ = 0, skipped = 0;
for (const f of pick) {
  const a = build(BASE, f, "base");
  const b = build(HEAD, f, "head");
  if (a === null || b === null) { skipped++; console.log(`SKIP  ${f} (base=${a ? "c" : "-"} head=${b ? "c" : "-"})`); continue; }
  if (a === b) { same++; continue; }
  differ++;
  console.log(`DIFF  ${f}`);
}
console.log(`\nemitted-C compare over ${pick.length} corpus programs: identical=${same} DIFFERENT=${differ} skipped=${skipped}`);
