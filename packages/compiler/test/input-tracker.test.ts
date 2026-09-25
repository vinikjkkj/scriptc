/* The probe taxonomy, and specifically the probes that record a FAILURE.
 *
 * Every case below was chosen because it is invisible to a cache that records
 * only successful reads. `shadowing module` is the sharpest: it makes no
 * recorded read stale, and it changes the program. */

import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FrontendInputTracker,
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
});
