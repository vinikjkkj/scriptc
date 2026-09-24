/* The LLVM backend's runtime LAYOUT guard — the offset twin of
 * llvm-runtime-abi.test.ts's signature guard.
 *
 * The C backend gets this for free: clang checks every `b->len` against
 * scr_runtime.h. The LLVM lane writes `getelementptr inbounds i8, ptr %p,
 * i64 24` and the linker takes it on faith, so a struct that gains,
 * reorders, or re-widens a field silently miscompiles this lane while the
 * C lane stays correct and every existing test stays green.
 *
 * The instrument is deliberately NOT a TypeScript re-derivation of C's
 * padding rules — that would be a third copy of the layout, guarding the
 * second copy with a hand-written model of the first. Instead the constants
 * in runtime-layout.ts are compiled INTO a C translation unit as
 * `_Static_assert(offsetof(S, f) == N)` and handed to the same driver, with
 * the same target flags, that builds the runtime. The toolchain adjudicates;
 * this file only asks it the question.
 *
 * Failure mode by construction: a wrong constant is a COMPILE error naming
 * the struct and field, not a diff to interpret. */
import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";
import { fileURLToPath } from "node:url";
import { resolveCc } from "../src/backend/cc.js";
import {
  LAYOUT_POINTER_BITS,
  RUNTIME_FIELD_OFFSETS,
} from "../src/backend/llvm/runtime-layout.js";

const execFileAsync = promisify(execFile);
const NL = "\n";

/* NOT cc.ts's runtimeSrcDir(). That resolves @scriptc/runtime through
 * node_modules, and the workspace link is an ABSOLUTE symlink planted by
 * the install: in any checkout whose node_modules is shared with or linked
 * from another -- a git worktree reusing the main tree's install, which is
 * the normal way to run a block -- it points at the OTHER tree's runtime.
 * This guard would then compile that tree's header, pass, and say nothing
 * about the header sitting beside the offsets it is supposed to guard.
 *
 * Not hypothetical: it is how this test first behaved. A deliberately
 * poisoned ScrBytes in this worktree went GREEN, because the probe was
 * reading G:/scriptc/packages/runtime/src/scr_runtime.h instead.
 *
 * Resolve from THIS FILE, so the header checked is always the one in the
 * same checkout as the constants being checked. */
const RUNTIME_SRC = fileURLToPath(new URL("../../runtime/src", import.meta.url));

/* A C string literal cannot span lines, so a multi-line message is emitted
 * as ADJACENT literals and the compiler concatenates them. JSON.stringify
 * does the quoting and escaping. */
function cMessage(lines: readonly string[]): string {
  return lines.map((l) => `  ${JSON.stringify(l)}`).join(NL);
}

/* The probe TU: the pointer-width assert first — on an ILP32 target every
 * offset is wrong, and saying that once is clearer than four confusing
 * offset failures — then one assert per entry. */
function probeSource(
  entries: readonly { struct: string; field: string; offset: number }[],
): string {
  return [
    `#include <stddef.h>`,
    `#include "scr_runtime.h"`,
    ``,
    `_Static_assert(sizeof(void *) * 8 == ${LAYOUT_POINTER_BITS},`,
    cMessage([
      `runtime-layout.ts offsets assume LP64; this target's pointers are a `,
      `different width, so every offset in that file is wrong rather than `,
      `merely unverified.`,
    ]),
    `);`,
    ``,
    ...entries.flatMap((e) => [
      `_Static_assert(offsetof(${e.struct}, ${e.field}) == ${e.offset},`,
      cMessage([
        `${e.struct}.${e.field} moved: runtime-layout.ts says ${e.offset}. `,
        `The LLVM backend emits that byte offset directly and no linker `,
        `checks it, so the C lane would stay correct while the LLVM lane `,
        `silently miscompiled. Fix the constant AND every GEP using it.`,
      ]),
      `);`,
    ]),
    ``,
    `int main(void) { return 0; }`,
    ``,
  ].join(NL);
}

async function compileProbe(source: string): Promise<{ ok: boolean; stderr: string }> {
  const dir = await mkdtemp(join(tmpdir(), "scriptc-layout-"));
  const cPath = join(dir, "layout-probe.c");
  await writeFile(cPath, source, "utf8");
  const d = resolveCc(process.env);
  try {
    await execFileAsync(d.argv[0]!, [
      ...d.argv.slice(1),
      ...d.targetArgs,
      `-I${RUNTIME_SRC}`,
      "-c",
      "-o", join(dir, "layout-probe.o"),
      cPath,
    ]);
    return { ok: true, stderr: "" };
  } catch (e) {
    return { ok: false, stderr: String((e as { stderr?: string }).stderr ?? e) };
  }
}

test("every raw byte offset the LLVM backend emits matches scr_runtime.h", async () => {
  expect(RUNTIME_FIELD_OFFSETS.length).toBeGreaterThan(0);
  const { ok, stderr } = await compileProbe(probeSource(RUNTIME_FIELD_OFFSETS));
  expect(ok, `the layout probe did not compile:${NL}${stderr}`).toBe(true);
}, 300_000);

/* The guard's own guard. A layout test that has only ever printed green
 * proves nothing: it could be asserting against a header it never read, or
 * compiling a TU whose asserts were silently dropped. Feed it a deliberately
 * wrong offset and require the toolchain to reject it, naming the field. */
test("the probe REJECTS a wrong offset (this test is not vacuous)", async () => {
  const poisoned = RUNTIME_FIELD_OFFSETS.map((e, i) =>
    i === 0 ? { ...e, offset: e.offset + 1 } : e,
  );
  const { ok, stderr } = await compileProbe(probeSource(poisoned));
  expect(ok, "a deliberately wrong offset COMPILED — the probe checks nothing").toBe(false);
  expect(stderr).toMatch(/static_assert|static assertion/i);
  expect(stderr).toContain(RUNTIME_FIELD_OFFSETS[0]!.field);
}, 300_000);
