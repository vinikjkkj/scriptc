/* The SIGNATURE a SCR_DYN_FUNC box carries, and the two ways it has been
 * a crash inside EMITTED code naming no unit and no line.
 *
 * The emitted dynCheck for a function type is, verbatim (both lanes —
 * emit-walkers.ts's `func` case and llvm/dyn.ts's):
 *
 *     if (strcmp(d->v.fn.sig, "func(f64,dyn)=>void") == 0)
 *         return scr_closure_retain(d->v.fn.clo);
 *
 * so `sig` is load-bearing in two directions at once, and BOTH have bitten:
 *
 * 1. NULL. `scr_dyn_new_func` stored whatever it was handed, the emitted
 *    `strcmp` dereferenced it, and the program died with no `[SCxxxx]`, no
 *    file and no line — the worst diagnostic shape this project has. It was
 *    found only because a block happened to be reading the emitted C.
 *    Substituting `""` at the mint (which is what the first fix did) makes
 *    the CRASH go away and makes the DEFECT unnameable: the box then takes
 *    the per-target adapter forever and nothing ever says a runtime unit
 *    forgot its signature. It traps at the mint now, naming the box.
 *
 * 2. A TYPE KEY out of the runtime — the silent twin, one `strcmp` later.
 *    That branch UNWRAPS the closure and calls `clo->fn` through the static
 *    C signature the key names. A closure minted by the RUNTIME holds a dyn
 *    thunk, whose C signature is `(ScrClosure *, ScrDyn *const *, size_t)`
 *    and nothing else, so a runtime `sig` that collides with a type key is
 *    a call through the wrong signature — a crash, or worse a silent one,
 *    in the same nameless place. Three units already say so in comments
 *    (scr_stream.c, scr_dc.c, scr_ws_dispatch.c). Nothing checked it.
 *
 * The two spellings have DIFFERENT contracts and that is the whole design:
 * `scr_dyn_new_func_src` is the COMPILER's, and its `sig` IS an interned
 * type key — that is what makes the unwrap sound. `scr_dyn_new_func` is the
 * RUNTIME's, and its `sig` must be a human spelling that can never collide.
 * `typeKey` spells every function type `func(...)=>...` (ir/nodes.ts), so
 * the prefix is an exact discriminator rather than a heuristic.
 *
 * WHY A SOURCE SCAN AND NOT ONLY A RUNNING CELL: the trap can only fire on
 * the day a unit regresses, and by then it is a shipped abort. The scan is
 * the thing that fails on the commit that introduces it. The running cell
 * is here for the other half — that the guards are LINKED into a shipping
 * binary rather than dead-stripped, checked by byte scan for the reason the
 * trap-trace rule in this repo exists: a count of zero taken on a binary
 * that does not carry the string is DID-NOT-RUN, not a zero.
 */
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, test } from "vitest";
import { compile } from "@scriptc/compiler";
import { exeName } from "./exe.js";

const execFileAsync = promisify(execFile);
const repoRoot = join(import.meta.dirname, "../..");
const runtimeSrc = join(repoRoot, "packages/runtime/src");

/** Every `scr_dyn_new_func(...)` / `scr_dyn_new_func_src(...)` CALL in a C
 * source, with the argument list split at top-level commas. Splitting by
 * DEPTH rather than by regex is what keeps a nested call
 * (`scr_closure_new((void *)t, 0)`) inside argument 0 instead of becoming
 * two arguments and shifting `sig` one place left. */
function callsIn(text: string, fn: string): string[][] {
  const out: string[][] = [];
  const needle = fn + "(";
  for (let i = text.indexOf(needle); i !== -1; i = text.indexOf(needle, i + 1)) {
    // A longer identifier that merely ENDS in this name (scr_dyn_new_func
    // is a prefix of scr_dyn_new_func_src, so this runs in both directions).
    const before = text[i - 1] ?? " ";
    if (/[A-Za-z0-9_]/.test(before)) continue;
    let depth = 0;
    let cur = "";
    const args: string[] = [];
    for (let j = i + needle.length - 1; j < text.length; j++) {
      const c = text[j]!;
      if (c === "(") {
        depth++;
        if (depth === 1) continue;
      } else if (c === ")") {
        depth--;
        if (depth === 0) {
          args.push(cur.trim());
          break;
        }
      } else if (c === "," && depth === 1) {
        args.push(cur.trim());
        cur = "";
        continue;
      }
      cur += c;
    }
    // The function's own DEFINITION and its prototype are not call sites:
    // their argument 3 is the declarator `const char *sig`, which would
    // read as a signature that is neither a literal nor a forward and fail
    // every row below for the wrong reason.
    if (args.length > 1 && !/\bScrClosure\s*\*\s*[A-Za-z_]/.test(args[0] ?? "")) out.push(args);
  }
  return out;
}

function cSources(): { name: string; text: string }[] {
  return readdirSync(runtimeSrc)
    .filter((f) => f.endsWith(".c"))
    .map((f) => ({ name: f, text: readFileSync(join(runtimeSrc, f), "utf8") }));
}

describe("the SCR_DYN_FUNC box's signature contract", () => {
  test("the scan itself sees the call sites it is about", () => {
    // An empty scan passes every assertion below it vacuously, which is the
    // failure mode this repo has paid for three times. This row is the
    // self-test: it fails if the parser, the path or the spelling drifts.
    const plain = cSources().flatMap(({ name, text }) =>
      callsIn(text, "scr_dyn_new_func").map((a) => `${name}:${a[3] ?? "?"}`),
    );
    const src = cSources().flatMap(({ name, text }) =>
      callsIn(text, "scr_dyn_new_func_src").map((a) => `${name}:${a[3] ?? "?"}`),
    );
    expect(plain.length).toBeGreaterThan(5);
    expect(src.length).toBeGreaterThan(1);
    // Argument 3 really is the signature and not a neighbour: every plain
    // call site's is either a string literal or a forwarded `sig` parameter.
    for (const p of plain) {
      const sig = p.slice(p.indexOf(":") + 1);
      expect(sig === "sig" || sig.startsWith('"'), `argument 3 of ${p} is not a signature`).toBe(true);
    }
  });

  test("no runtime call site passes NULL as `sig` — the segfault in emitted code", () => {
    const bad: string[] = [];
    for (const { name, text } of cSources()) {
      for (const fn of ["scr_dyn_new_func", "scr_dyn_new_func_src"]) {
        for (const args of callsIn(text, fn)) {
          const sig = args[3];
          if (sig === undefined) continue;
          if (sig === "NULL" || sig === "0") bad.push(`${name}: ${fn}(..., ${sig}, ...)`);
        }
      }
    }
    expect(bad, "a NULL `sig` is dereferenced by the emitted dynCheck's strcmp").toEqual([]);
  });

  test("no RUNTIME-minted box carries a compiler type key as its signature", () => {
    // Only `scr_dyn_new_func` — `_src` is the COMPILER's spelling and its
    // `sig` IS a type key, which is exactly what makes the unwrap sound.
    const bad: string[] = [];
    for (const { name, text } of cSources()) {
      for (const args of callsIn(text, "scr_dyn_new_func")) {
        const sig = args[3];
        if (sig === undefined || !sig.startsWith('"')) continue;
        if (sig.startsWith('"func(')) bad.push(`${name}: ${sig}`);
      }
    }
    expect(bad, "a runtime `sig` equal to a type key is a call through the wrong C signature").toEqual([]);
  });

  test("both guards stand at the mint, in scr_json.c", () => {
    const text = readFileSync(join(runtimeSrc, "scr_json.c"), "utf8");
    expect(text).toContain("was minted with no signature");
    expect(text).toContain('strncmp(sig, "func(", 5)');
    // And the coercion that made the defect unnameable is gone.
    expect(text).not.toContain('d->v.fn.sig = sig != NULL ? sig : ""');
  });

  for (const backend of ["c", "llvm"] as const) {
    test(`a runtime-minted box reaches a typed slot, and both guards are linked (${backend})`, async () => {
      const dir = mkdtempSync(join(tmpdir(), `scr-fnsig-${backend}-`));
      mkdirSync(dir, { recursive: true });
      const file = join(dir, "main.ts");
      // `cb` here is minted by scr_stream.c's `scr_stream_dynopt_done` with
      // the human signature "(error)", arrives as a dyn, and is dynChecked
      // into `(e?: Error | null) => void`. The type key cannot match, so the
      // per-target adapter runs it — which is the right answer precisely
      // because the closure holds a dyn thunk and not a typed entry point.
      writeFileSync(
        file,
        'import { Writable } from "node:stream"\n' +
          "const w = new Writable({\n" +
          "  write(chunk: Buffer, enc: string, cb: (e?: Error | null) => void): void {\n" +
          '    console.log("chunk " + String(chunk.length))\n' +
          "    cb()\n" +
          "  },\n" +
          "})\n" +
          'w.write(Buffer.from("abc"))\n' +
          'w.end(() => { console.log("done") })\n',
        "utf8",
      );
      const built = await compile(file, { outPath: join(dir, exeName("program")), outDir: dir, backend });
      expect(built.diagnostics ?? []).toEqual([]);
      expect(built.ok).toBe(true);
      const bin = built.binaryPath!;
      const { stdout } = await execFileAsync(bin, [], { timeout: 60_000 });
      expect(stdout).toBe("chunk 3\ndone\n");
      // The guards are in the SHIPPING binary. A trap the linker dropped is
      // not a guard, and the byte scan is the only thing that can say so.
      const bytes = readFileSync(bin).toString("latin1");
      expect(bytes).toContain("was minted with no signature");
      expect(bytes).toContain("as its signature");
    }, 300_000);
  }
});
