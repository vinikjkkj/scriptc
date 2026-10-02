#!/usr/bin/env python3
"""MUTATION CONTROL for the fragment suite.

A suite that has never said no is indistinguishable from a suite that was not
executed. Each mutant below breaks one property the suite claims to pin; a
surviving mutant means that property is decorative. The IMPLEMENTATION is
mutated, never the test -- mutating a test only proves the file is loaded.

THIS REPLACES A SHELL VERSION THAT COULD LIE. It passed each mutation as a
Python snippet inside a bash heredoc, so the escapes crossed two parse layers
and three of them silently failed to apply -- and the harness reported those
as SURVIVED, which is the same word it uses for "the property is not pinned".
Two very different facts under one label, in the tool whose entire job is to
tell them apart. Here the mutation table is data in one file with no second
parse layer, and a mutation that does not change the file is reported as NOT
APPLIED and fails the run.
"""
import shutil
import subprocess
import sys
from pathlib import Path

WT = Path("G:/blocks/libcache/wt")
SRC = WT / "packages/compiler/src/frontend/lowering"
FILES = [
    "packages/compiler/test/lowering-fragment.test.ts",
    "packages/compiler/test/structural-form.test.ts",
    "packages/compiler/test/fragment-build.test.ts",
]
TARGETS = {
    "frag": SRC / "fragment.ts",
    "form": SRC / "structural-form.ts",
    "build": SRC / "fragment-build.ts",
}

# name, target, find, replace
MUTANTS = [
    ("collision guard returns none", "frag",
     "  const byForm = new Map<string, string[]>();",
     "  if (true) return [];\n  const byForm = new Map<string, string[]>();"),
    ("id-leak guard never throws", "form",
     '  if (form.includes(\'"shapeId":"\') || form.includes(\'"unionId":"\')) {',
     "  if (false) {"),
    ("canonicalJson stops sorting", "frag",
     "for (const k of Object.keys(o).sort())", "for (const k of Object.keys(o))"),
    ("collection assertion never throws", "frag",
     "  if (owned.length === 0) return;", "  if (true) return;"),
    ("census never counts a refusal", "frag",
     "  for (const r of refusals) census.refusedByCode[r.code]++;",
     "  for (const r of refusals) void r;"),
    ("unresolvable-id scan finds nothing", "frag",
     '  const re = /"(?:shapeId|unionId)":"([ru][0-9]+)"/g;',
     "  const re = /__never__/g;"),
    ("form drops declaredOrder", "form",
     "  if (shape.declaredOrder !== undefined) out += `|order${J(shape.declaredOrder)}`;", ""),
    ("form INCLUDES ownmask", "form",
     '  if (shape.tostr === true) out += "|tostr";',
     '  if (shape.tostr === true) out += "|tostr";\n  if (shape.ownmask === true) out += "|ownmask";'),
    ("collection leaks into byModule", "build",
     '    if (rec.phase === "collect") {', "    if (false) {"),
    ("ordinals do not restart per slot", "build",
     "    const slot = `${loop} ${module}`;", '    const slot = "GLOBAL";'),
    ("id scan drops the property name", "build",
     '  const re = /"(?:shapeId|unionId)":"([ru][0-9]+)"/g;\n  const json',
     "  const re = /([ru][0-9]+)/g;\n  const json"),
    ("readEntities stops subtracting", "build",
     "    if (minted.has(id)) continue;", ""),
    ("helpers ignore definedHere", "build",
     "    if (definedHere.has(name)) continue;", ""),
    ("unrecognised phase dropped", "build",
     "      unknown.set(rec.phase, (unknown.get(rec.phase) ?? 0) + 1);", ""),
    ("npm-static build not refused", "frag",
     "  if (build.npmStatic === undefined) return [];",
     "  if (true) return [];"),
    ("every build refused as npm-static", "frag",
     "  if (build.npmStatic === undefined) return [];", ""),
]


def run_suite() -> bool:
    """True when the suite FAILS (i.e. the mutant was caught)."""
    r = subprocess.run(
        ["npx", "vitest", "run", *FILES, "--reporter=dot"],
        cwd=WT, capture_output=True, text=True, shell=True,
        encoding="utf-8", errors="replace",
    )
    # Decoding is pinned to utf-8 with replacement: the default is the
    # console codepage, and vitest prints check marks. A decode error made
    # stdout None on the first attempt, which would have thrown rather than
    # lied -- but a harness that dies on its own output is not one either.
    out = (r.stdout or "") + (r.stderr or "")
    if "Test Files" not in out:
        raise RuntimeError("vitest produced no summary; the harness cannot tell caught from broken: " + out[-400:])
    return "failed" in out


def main() -> int:
    originals = {k: v.read_text(encoding="utf-8") for k, v in TARGETS.items()}

    def restore() -> None:
        for k, v in TARGETS.items():
            v.write_text(originals[k], encoding="utf-8", newline="")

    # RESTORE ON EVERY EXIT PATH. An earlier run of this harness died on a
    # decode error partway through the loop and left `if (true) return [];`
    # planted in fragment.ts -- so the next run reported BASELINE RED, which
    # looked like a real regression in the suite. A tool that edits the tree
    # has to put it back even when it fails, or its next failure is a lie
    # about the code rather than about itself.
    try:
        print("=== baseline: the suite must PASS before any mutant means anything ===")
        if run_suite():
            print("  BASELINE RED -- every 'CAUGHT' below would be meaningless.")
            print("  Check `git diff` first: a crashed earlier run may have left a mutant planted.")
            return 2
        print("  baseline green")

        bad = 0
        for name, target, find, repl in MUTANTS:
            restore()
            path = TARGETS[target]
            before = originals[target]
            after = before.replace(find, repl, 1)
            if after == before:
                print(f"  NOT APPLIED  {name}   <-- pattern did not match; this is NOT a survival")
                bad += 1
                continue
            path.write_text(after, encoding="utf-8", newline="")
            if run_suite():
                print(f"  CAUGHT       {name}")
            else:
                print(f"  SURVIVED     {name}   <-- the property it breaks is not pinned")
                bad += 1
        print(f"=== {len(MUTANTS) - bad}/{len(MUTANTS)} caught ===")
        return 1 if bad else 0
    finally:
        restore()
        print("=== tree restored ===")


if __name__ == "__main__":
    sys.exit(main())
