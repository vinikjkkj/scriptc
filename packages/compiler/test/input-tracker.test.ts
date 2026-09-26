/* The probe taxonomy, and specifically the probes that record a FAILURE.
 *
 * Every case below was chosen because it is invisible to a cache that records
 * only successful reads. `shadowing module` is the sharpest: it makes no
 * recorded read stale, and it changes the program. */

import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FRONTEND_PROBE_OPS,
  FrontendInputTracker,
  type FrontendInputProbe,
  type FrontendProbeOp,
  frontendInputsStillMatch,
  trackedAccessibleEntries,
  trackedFileExists,
  trackedReadDirNames,
  trackedReadFile,
  trackedRealpath,
  validFrontendInputSnapshot,
} from "../src/frontend/input-tracker.js";

function scratch(): string {
  return mkdtempSync(join(tmpdir(), "scriptc-input-tracker-"));
}

describe("frontend input tracker", () => {
  it("matches an unchanged tree, and stops matching when a read file changes", () => {
    const dir = scratch();
    try {
      writeFileSync(join(dir, "a.ts"), "export const a = 1;\n");
      const tracker = new FrontendInputTracker();
      tracker.run(() => trackedReadFile(join(dir, "a.ts")));
      const snapshot = tracker.snapshot();
      expect(validFrontendInputSnapshot(snapshot)).toBe(true);
      expect(frontendInputsStillMatch(snapshot)).toBe(true);

      writeFileSync(join(dir, "a.ts"), "export const a = 2;\n");
      expect(frontendInputsStillMatch(snapshot)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a shadowing module that never existed invalidates the snapshot", () => {
    // The whole reason failed probes are retained. Resolution asked for
    // `mod.ts`, was told it did not exist, and settled for `mod.js`. Every
    // successful read still matches byte for byte after `mod.ts` appears.
    const dir = scratch();
    try {
      writeFileSync(join(dir, "mod.js"), "export const v = 1;\n");
      const tracker = new FrontendInputTracker();
      tracker.run(() => {
        trackedFileExists(join(dir, "mod.ts"));
        trackedReadFile(join(dir, "mod.js"));
      });
      const snapshot = tracker.snapshot();
      expect(frontendInputsStillMatch(snapshot)).toBe(true);

      writeFileSync(join(dir, "mod.ts"), "export const v: number = 1;\n");
      expect(frontendInputsStillMatch(snapshot)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a read that FAILED invalidates once the same path becomes readable", () => {
    const dir = scratch();
    try {
      const tracker = new FrontendInputTracker();
      tracker.run(() => expect(trackedReadFile(join(dir, "late.json"))).toBeNull());
      const snapshot = tracker.snapshot();
      expect(snapshot.probes.some((p) => p.op === "read-error")).toBe(true);
      expect(frontendInputsStillMatch(snapshot)).toBe(true);

      writeFileSync(join(dir, "late.json"), "{}\n");
      expect(frontendInputsStillMatch(snapshot)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("directory CONTENT is part of identity, not only the files that were read", () => {
    const dir = scratch();
    try {
      mkdirSync(join(dir, "pkg"));
      writeFileSync(join(dir, "pkg", "one.ts"), "export const one = 1;\n");
      const tracker = new FrontendInputTracker();
      tracker.run(() => trackedAccessibleEntries(join(dir, "pkg")));
      const snapshot = tracker.snapshot();
      expect(frontendInputsStillMatch(snapshot)).toBe(true);

      writeFileSync(join(dir, "pkg", "two.ts"), "export const two = 2;\n");
      expect(frontendInputsStillMatch(snapshot)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("trackedReadDirNames returns the raw listing and records the same identity", () => {
    const dir = scratch();
    try {
      mkdirSync(join(dir, "w"));
      writeFileSync(join(dir, "w", "a.ts"), "");
      const tracker = new FrontendInputTracker();
      const names = tracker.run(() => trackedReadDirNames(join(dir, "w")));
      expect(names).toEqual(["a.ts"]);
      const snapshot = tracker.snapshot();
      expect(frontendInputsStillMatch(snapshot)).toBe(true);
      mkdirSync(join(dir, "w", "sub"));
      expect(frontendInputsStillMatch(snapshot)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a realpath that retargets invalidates — the workspace-symlink class", () => {
    // The failure this project has paid for twice: a workspace symlink makes
    // a dependency compile from the PUBLISHED tree instead of the working
    // one, at exit 0 with no diagnostic. Recording what a path RESOLVED to
    // turns that from invisible into a cache miss.
    const dir = scratch();
    try {
      mkdirSync(join(dir, "real-a"));
      mkdirSync(join(dir, "real-b"));
      const link = join(dir, "link");
      try {
        symlinkSync(join(dir, "real-a"), link, "dir");
      } catch {
        return; // no symlink privilege on this host; the probe is covered above
      }
      const tracker = new FrontendInputTracker();
      tracker.run(() => trackedRealpath(link));
      const snapshot = tracker.snapshot();
      expect(frontendInputsStillMatch(snapshot)).toBe(true);

      rmSync(link, { recursive: true, force: true });
      symlinkSync(join(dir, "real-b"), link, "dir");
      expect(frontendInputsStillMatch(snapshot)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("an input that changes DURING the frontend marks the snapshot unstable", () => {
    const dir = scratch();
    try {
      const path = join(dir, "moving.ts");
      writeFileSync(path, "export const v = 1;\n");
      const tracker = new FrontendInputTracker();
      tracker.run(() => {
        trackedReadFile(path);
        writeFileSync(path, "export const v = 2;\n");
        trackedReadFile(path);
      });
      const snapshot = tracker.snapshot();
      expect(snapshot.stable).toBe(false);
      // An unstable snapshot can never validate, whatever the disk says.
      expect(frontendInputsStillMatch(snapshot)).toBe(false);
      expect(validFrontendInputSnapshot(snapshot)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("compiler-owned outputs do not invalidate the frontend that produced them", () => {
    const dir = scratch();
    try {
      const outDir = join(dir, ".scriptc");
      const tracker = new FrontendInputTracker();
      // The frontend observed outDir MISSING; emission then created it.
      tracker.run(() => trackedFileExists(outDir));
      const snapshot = tracker.snapshot();
      mkdirSync(outDir);
      writeFileSync(join(outDir, "program.ll"), "; ir\n");
      expect(
        frontendInputsStillMatch(snapshot, {
          outputPaths: [join(outDir, "program.ll")],
          outputDirectories: [outDir],
        }),
      ).toBe(true);
      // ...but a USER file appearing there still invalidates resolution.
      writeFileSync(join(outDir, "shadow.ts"), "export const s = 1;\n");
      expect(
        frontendInputsStillMatch(snapshot, {
          outputPaths: [join(outDir, "program.ll")],
          outputDirectories: [outDir],
        }),
      ).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects a malformed stamp before it touches any path", () => {
    expect(validFrontendInputSnapshot(null)).toBe(false);
    expect(validFrontendInputSnapshot({ version: 2, stable: true, probes: [] })).toBe(false);
    expect(validFrontendInputSnapshot({ version: 1, stable: true, probes: [{ op: "file", path: "x" }] })).toBe(false);
    expect(validFrontendInputSnapshot({ version: 1, stable: true, probes: [{ op: "nope", path: "x" }] })).toBe(false);
    expect(validFrontendInputSnapshot({ version: 1, stable: true, probes: [] })).toBe(true);
  });

  /* One case per op FOUND, not per op remembered.
   *
   * The nine tests above are introduced by the file header as cases that were
   * "chosen" -- chosen, that is, from what their author thought of. The ops
   * are a discriminated union, erased at runtime, consumed by two switches,
   * so until FRONTEND_PROBE_OPS existed nothing could enumerate them and a
   * seventh op would have been rejected SILENTLY by both consumers: the
   * validator ends in `default: return false`, and the matcher falls out of
   * its switch returning undefined. The cache would quietly stop hitting for
   * every program that emitted one, with nothing red anywhere.
   *
   * This test drives off the array, so an op with no case here is named out
   * loud instead. The per-op fixtures are necessarily hand-written -- each op
   * means something different -- but the ENUMERATION is not. */
  it("every probe op has an agreeing and a contradicting case, enumerated from FRONTEND_PROBE_OPS", () => {
    const dir = mkdtempSync(join(tmpdir(), "scriptc-probe-ops-"));
    try {
      const present = join(dir, "present.txt");
      writeFileSync(present, "hello");
      const absent = join(dir, "absent.txt");
      const sub = join(dir, "sub");
      mkdirSync(sub);
      writeFileSync(join(sub, "a.txt"), "a");
      const digest = createHash("sha256").update("hello").digest("hex");
      const snap = (probe: FrontendInputProbe) => ({ version: 1 as const, probes: [probe], stable: true });

      const cases: Partial<Record<FrontendProbeOp, { agrees: FrontendInputProbe; contradicts: FrontendInputProbe }>> = {
        file: {
          agrees: { op: "file", path: present, digest },
          contradicts: { op: "file", path: present, digest: "0".repeat(64) },
        },
        "read-error": {
          agrees: { op: "read-error", path: absent },
          contradicts: { op: "read-error", path: present },
        },
        kind: {
          agrees: { op: "kind", path: present, kind: "file" },
          contradicts: { op: "kind", path: present, kind: "missing" },
        },
        entries: {
          agrees: { op: "entries", path: sub, files: ["a.txt"], directories: [] },
          contradicts: { op: "entries", path: sub, files: ["a.txt", "ghost.txt"], directories: [] },
        },
        "entries-error": {
          agrees: { op: "entries-error", path: absent },
          contradicts: { op: "entries-error", path: sub },
        },
        realpath: {
          agrees: { op: "realpath", path: present, target: realpathSync(present) },
          contradicts: { op: "realpath", path: present, target: join(dir, "elsewhere.txt") },
        },
      };

      const uncovered: string[] = [];
      const wrong: string[] = [];
      for (const op of FRONTEND_PROBE_OPS) {
        const probe = cases[op];
        if (probe === undefined) {
          uncovered.push(op);
          continue;
        }
        // The agreeing half is the per-op control. Without it a matcher that
        // returned false for everything would satisfy every contradiction
        // below and this test would pass while proving nothing.
        if (!frontendInputsStillMatch(snap(probe.agrees))) {
          wrong.push(`${op}: a probe that AGREES with the tree failed to match`);
        }
        if (frontendInputsStillMatch(snap(probe.contradicts))) {
          wrong.push(`${op}: a probe that CONTRADICTS the tree still matched`);
        }
        if (!validFrontendInputSnapshot(snap(probe.agrees))) {
          wrong.push(`${op}: a well-formed probe failed shape validation`);
        }
      }
      expect(uncovered, `probe ops with no case in this test: ${uncovered.join(", ")}`).toEqual([]);
      expect(wrong, `probe ops behaving wrongly:\n  ${wrong.join("\n  ")}`).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
