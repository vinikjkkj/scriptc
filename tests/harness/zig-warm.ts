/* Warms zig's global cache for the exact link the tests do, once, before any worker starts.
 *
 * The Windows lanes cross-compile with `zig cc -target x86_64-windows-gnu`. zig builds the mingw CRT and compiler-rt lazily, into a cache keyed by
 * the compilation's settings, and scriptc's link (-O2 with `-Wl,--gc-sections -Wl,--strip-all`) is a different key from the plain `int main` the
 * workflow's warm-up step links: measured on a fresh cache after that warm-up, the first real build's link took 31 s and every later one 50 ms, and
 * four workers racing to be first took 37 s of wall on a 12-core box (the zig cache lock serialises them) where a runner with four cores and a
 * slow disk saw about 120 s inside whichever test happened to compile first. Compiling one trivial program through the compiler itself, before the
 * workers start, pays that once with the real flags (and builds the default runtime object set into the shared cache on the way).
 *
 * Only for a zig-driven cross target; any failure is swallowed, because this is a warm-up and the tests that follow report their own errors. */
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export default async function setup(): Promise<void> {
  if (process.env["SCRIPTC_CC"] !== "zigcc" || (process.env["SCRIPTC_TARGET"] ?? "") === "") return;
  if (process.env["SCRIPTC_NO_ZIG_WARM"] === "1") return;
  process.env["SCRIPTC_CACHE_DIR"] ??= fileURLToPath(new URL("../../node_modules/.cache/scriptc-tests/cas", import.meta.url));
  // One warm-up per job: a marker beside the OS temp dir (a fresh runner starts without it) spares the second and third vitest step of a lane.
  const marker = join(
    tmpdir(),
    `scriptc-zig-warm-${createHash("sha256").update(`${process.env["ZIG_GLOBAL_CACHE_DIR"] ?? ""}\0${process.env["SCRIPTC_TARGET"]}`).digest("hex").slice(0, 16)}`,
  );
  if (existsSync(marker)) return;
  const dir = mkdtempSync(join(tmpdir(), "scr-zigwarm-"));
  const t0 = performance.now();
  try {
    const { compile } = await import("@scriptc/compiler");
    const src = join(dir, "warm.ts");
    writeFileSync(src, 'console.log("warm");\n');
    const exe = process.env["SCRIPTC_TARGET"]?.includes("windows") ? ".exe" : "";
    const r = await compile(src, { outPath: join(dir, `warm${exe}`), outDir: dir });
    console.log(`[zig-warm] ${r.ok ? "ok" : "compile refused"} in ${Math.round(performance.now() - t0)} ms`);
    if (r.ok) writeFileSync(marker, "warm\n");
  } catch (e) {
    console.log(`[zig-warm] skipped: ${String((e as Error)?.message ?? e).slice(0, 200)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
