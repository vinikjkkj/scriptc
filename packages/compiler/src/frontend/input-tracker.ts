/* Filesystem observations made while constructing and lowering ONE frontend
 * program.
 *
 * The early build cache replays these probes before trusting a generated
 * translation unit: successful reads are content-addressed, while FAILED
 * candidate probes are retained so a newly-created module cannot hide behind
 * an old resolution answer. That asymmetry is the whole point. A cache that
 * records only the files it read is wrong: dropping a `foo.ts` next to a
 * `foo.js` that resolution previously won changes the program while every
 * recorded read still matches byte for byte.
 *
 * Taxonomy (from upstream's frontend/input-tracker.ts — the one asset worth
 * taking from their cache family; their native-artifact stack is NOT ported,
 * see executable/early-cache.ts):
 *
 *   { op: "file",         path, digest }       a successful read
 *   { op: "read-error",   path }               a read that FAILED
 *   { op: "kind",         path, kind }         file | directory | other | missing
 *   { op: "entries",      path, files, dirs }  a directory LISTING
 *   { op: "entries-error" path }
 *   { op: "realpath",     path, target }       symlink resolution
 *
 * `entries` makes a directory's CONTENT part of identity, not merely the
 * files that were read out of it. `realpath` is what makes a workspace
 * symlink — the failure that silently compiles the PUBLISHED source of an
 * attested package instead of the working tree — a cache MISS rather than an
 * invisible wrong build.
 *
 * Cost note: tracking is OFF unless a tracker is running (`run()`). Every
 * probe helper answers `null`/`false` semantics identically either way, and
 * the tsgo filesystem hooks consult `frontendInputTrackingActive()` so that a
 * build with no cache configured keeps today's command line, today's
 * server-side reads, and today's cost exactly. */

import { createHash } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

export type FrontendInputProbe =
  | { op: "file"; path: string; digest: string }
  | { op: "read-error"; path: string }
  | { op: "kind"; path: string; kind: "file" | "directory" | "other" | "missing" }
  | { op: "entries"; path: string; files: string[]; directories: string[] }
  | { op: "entries-error"; path: string }
  | { op: "realpath"; path: string; target: string | null };

export interface FrontendInputSnapshot {
  version: 1;
  probes: FrontendInputProbe[];
  /** False when an input was observed to CHANGE while the frontend ran. The
   * build may still finish normally; it must never be published as a cache
   * entry, because no single filesystem state describes what it compiled. */
  stable: boolean;
}

/** Compiler-owned paths whose creation or removal must not invalidate the
 * frontend that produced them. Directory CONTENT stays tracked: only the
 * named artifacts, and a generated directory's formerly-"missing"
 * observation, are excluded. */
export interface FrontendInputExclusions {
  outputPaths?: Iterable<string>;
  outputDirectories?: Iterable<string>;
}

function digestText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function pathKind(path: string): Extract<FrontendInputProbe, { op: "kind" }>["kind"] {
  try {
    const info = statSync(path);
    return info.isFile() ? "file" : info.isDirectory() ? "directory" : "other";
  } catch {
    return "missing";
  }
}

const activeTracker = new AsyncLocalStorage<FrontendInputTracker>();

export class FrontendInputTracker {
  private readonly probes = new Map<string, FrontendInputProbe>();
  private stable = true;

  run<T>(fn: () => T): T {
    const parent = activeTracker.getStore();
    if (parent === undefined || parent === this) return activeTracker.run(this, fn);
    return activeTracker.run(this, () => {
      const result = fn();
      for (const probe of this.probes.values()) parent.record(probe);
      return result;
    });
  }

  record(probe: FrontendInputProbe): void {
    const key = `${probe.op}\0${probe.path}`;
    const previous = this.probes.get(key);
    if (previous !== undefined && JSON.stringify(previous) !== JSON.stringify(probe)) {
      // The same operation on the same path answered twice, differently:
      // the input changed underneath this build.
      this.stable = false;
    }
    this.probes.set(key, probe);
    if (probe.op === "file") {
      // A successful content read supersedes an earlier existence probe on
      // the same path ONLY when that probe also saw a file. A missing (or
      // non-file) answer followed by a successful read means the input moved
      // mid-frontend, and the mixed observation must never be published.
      const previousKind = this.probes.get(`kind\0${probe.path}`);
      if (previousKind?.op === "kind" && previousKind.kind !== "file") this.stable = false;
      this.probes.delete(`kind\0${probe.path}`);
      if (this.probes.has(`read-error\0${probe.path}`)) this.stable = false;
      this.probes.delete(`read-error\0${probe.path}`);
    } else if (probe.op === "read-error") {
      // A path can stay a regular file while its READABILITY changes. Keep
      // the failed operation itself rather than reducing it to a kind probe,
      // so a permission repair invalidates the cached frontend.
      if (this.probes.has(`file\0${probe.path}`)) this.stable = false;
      this.probes.delete(`file\0${probe.path}`);
    }
  }

  /** Probes recorded so far, for callers that want to inspect resolution
   * without publishing anything (the provenance symlink audit). */
  peek(): readonly FrontendInputProbe[] {
    return [...this.probes.values()];
  }

  snapshot(): FrontendInputSnapshot {
    return {
      version: 1,
      probes: [...this.probes.values()].sort((a, b) =>
        a.path === b.path ? a.op.localeCompare(b.op) : a.path.localeCompare(b.path),
      ),
      stable: this.stable,
    };
  }
}

export function frontendInputTrackingActive(): boolean {
  return activeTracker.getStore() !== undefined;
}

export function currentFrontendInputTracker(): FrontendInputTracker | undefined {
  return activeTracker.getStore();
}

function record(probe: FrontendInputProbe): void {
  activeTracker.getStore()?.record(probe);
}

export function trackedReadFile(path: string): string | null {
  path = resolve(path);
  try {
    const text = readFileSync(path, "utf8");
    record({ op: "file", path, digest: digestText(text) });
    return text;
  } catch {
    record({ op: "read-error", path });
    return null;
  }
}

export function trackedFileExists(path: string): boolean {
  path = resolve(path);
  const kind = pathKind(path);
  record({ op: "kind", path, kind });
  return kind === "file";
}

export function trackedDirectoryExists(path: string): boolean {
  path = resolve(path);
  const kind = pathKind(path);
  record({ op: "kind", path, kind });
  return kind === "directory";
}

export function trackedExists(path: string): boolean {
  path = resolve(path);
  const kind = pathKind(path);
  record({ op: "kind", path, kind });
  return kind !== "missing";
}

export function trackedRealpath(path: string): string | null {
  path = resolve(path);
  try {
    const target = realpathSync(path);
    record({ op: "realpath", path, target });
    return target;
  } catch {
    record({ op: "realpath", path, target: null });
    return null;
  }
}

export function trackedAccessibleEntries(
  path: string,
): { files: string[]; directories: string[] } | null {
  path = resolve(path);
  try {
    const files: string[] = [];
    const directories: string[] = [];
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const kind = entry.isSymbolicLink() ? pathKind(resolve(path, entry.name)) : null;
      if (entry.isFile() || kind === "file") files.push(entry.name);
      if (entry.isDirectory() || kind === "directory") directories.push(entry.name);
    }
    files.sort();
    directories.sort();
    const answer = { files, directories };
    record({ op: "entries", path, ...answer });
    return answer;
  } catch {
    // Enumeration can fail while the path remains a directory. Preserve the
    // failed OPERATION so a permission repair invalidates the entry, rather
    // than replaying only an unchanged path kind.
    record({ op: "entries-error", path });
    return null;
  }
}

/** `readdirSync(path)` with an `entries` probe recorded beside it. Returns the
 * RAW name list, in readdir order, so callers that scan it see exactly what
 * they saw before.
 *
 * The probe classifies into files and directories only. An entry that is
 * neither — a broken symlink, a fifo — is therefore not part of the recorded
 * directory identity. That is sound rather than merely convenient: such an
 * entry cannot be a module, so it cannot change resolution, and any path that
 * IS a resolution candidate gets its own `kind` probe when resolution asks
 * about it. */
export function trackedReadDirNames(path: string): string[] | null {
  const resolved = resolve(path);
  try {
    const entries = readdirSync(resolved, { withFileTypes: true });
    const files: string[] = [];
    const directories: string[] = [];
    for (const entry of entries) {
      const kind = entry.isSymbolicLink() ? pathKind(resolve(resolved, entry.name)) : null;
      if (entry.isFile() || kind === "file") files.push(entry.name);
      if (entry.isDirectory() || kind === "directory") directories.push(entry.name);
    }
    files.sort();
    directories.sort();
    record({ op: "entries", path: resolved, files, directories });
    return entries.map((entry) => entry.name);
  } catch {
    record({ op: "entries-error", path: resolved });
    return null;
  }
}

/** Re-run every recorded probe against the filesystem as it is NOW. */
export function frontendInputsStillMatch(
  snapshot: FrontendInputSnapshot,
  exclusions: FrontendInputExclusions = {},
): boolean {
  if (snapshot.version !== 1 || snapshot.stable !== true || !Array.isArray(snapshot.probes)) {
    return false;
  }
  const outputPaths = new Set([...(exclusions.outputPaths ?? [])].map((path) => resolve(path)));
  const outputDirectories = new Set(
    [...(exclusions.outputDirectories ?? [])].map((path) => resolve(path)),
  );
  const generatedOnlyDirectory = (directory: string): boolean => {
    const allowedFiles = new Set<string>();
    for (const output of outputPaths) {
      if (dirname(output) === directory) allowedFiles.add(basename(output));
    }
    const allowedDirectories = new Map<string, string>();
    for (const outputDir of outputDirectories) {
      if (outputDir !== directory && dirname(outputDir) === directory) {
        allowedDirectories.set(basename(outputDir), outputDir);
      }
    }
    try {
      return readdirSync(directory).every((name) => {
        if (allowedFiles.has(name)) return true;
        const child = allowedDirectories.get(name);
        return child !== undefined && generatedOnlyDirectory(child);
      });
    } catch {
      return false;
    }
  };
  return snapshot.probes.every((probe) => {
    if (outputPaths.has(probe.path)) return true;
    if (outputDirectories.has(probe.path)) {
      // A fresh output directory can be absent while the frontend runs and
      // created only when emission starts. Admit it ONLY while its current
      // contents are exactly the named compiler artifacts; a user file that
      // appears there still invalidates module resolution.
      if (probe.op === "kind" && probe.kind === "missing") {
        return pathKind(probe.path) === "missing" || generatedOnlyDirectory(probe.path);
      }
      if (probe.op === "entries-error") {
        try {
          readdirSync(probe.path);
          return generatedOnlyDirectory(probe.path);
        } catch {
          return true;
        }
      }
      if (probe.op === "realpath" && probe.target === null) {
        try {
          realpathSync(probe.path);
          return generatedOnlyDirectory(probe.path);
        } catch {
          return true;
        }
      }
    }
    switch (probe.op) {
      case "file": {
        try {
          return digestText(readFileSync(probe.path, "utf8")) === probe.digest;
        } catch {
          return false;
        }
      }
      case "read-error": {
        try {
          readFileSync(probe.path, "utf8");
          return false;
        } catch {
          return true;
        }
      }
      case "kind":
        return pathKind(probe.path) === probe.kind;
      case "entries": {
        try {
          const ignored = new Set<string>();
          for (const output of outputPaths) {
            if (dirname(output) === probe.path) ignored.add(basename(output));
          }
          for (const outputDir of outputDirectories) {
            if (dirname(outputDir) !== probe.path) continue;
            const name = basename(outputDir);
            // A directory that already existed during the frontend keeps
            // being tracked. Only one INTRODUCED by this build is suppressed.
            if (
              !probe.files.includes(name) &&
              !probe.directories.includes(name) &&
              generatedOnlyDirectory(outputDir)
            ) {
              ignored.add(name);
            }
          }
          const files: string[] = [];
          const directories: string[] = [];
          for (const entry of readdirSync(probe.path, { withFileTypes: true })) {
            const kind = entry.isSymbolicLink() ? pathKind(resolve(probe.path, entry.name)) : null;
            if (entry.isFile() || kind === "file") files.push(entry.name);
            if (entry.isDirectory() || kind === "directory") directories.push(entry.name);
          }
          files.sort();
          directories.sort();
          return (
            JSON.stringify(files.filter((name) => !ignored.has(name))) ===
              JSON.stringify(probe.files.filter((name) => !ignored.has(name))) &&
            JSON.stringify(directories.filter((name) => !ignored.has(name))) ===
              JSON.stringify(probe.directories.filter((name) => !ignored.has(name)))
          );
        } catch {
          return false;
        }
      }
      case "entries-error": {
        try {
          readdirSync(probe.path, { withFileTypes: true });
          return false;
        } catch {
          return true;
        }
      }
      case "realpath": {
        try {
          return realpathSync(probe.path) === probe.target;
        } catch {
          return probe.target === null;
        }
      }
    }
  });
}

/** Pure shape check, run by the cache reader BEFORE it touches any path. A
 * stamp on disk is untrusted input. */
export function validFrontendInputSnapshot(snapshot: unknown): snapshot is FrontendInputSnapshot {
  if (snapshot === null || typeof snapshot !== "object") return false;
  const candidate = snapshot as Partial<FrontendInputSnapshot>;
  if (candidate.version !== 1 || candidate.stable !== true || !Array.isArray(candidate.probes)) {
    return false;
  }
  return candidate.probes.every((probe) => {
    if (probe === null || typeof probe !== "object") return false;
    const value = probe as Partial<FrontendInputProbe>;
    if (typeof value.path !== "string" || typeof value.op !== "string") return false;
    switch (value.op) {
      case "file":
        return typeof value.digest === "string" && /^[0-9a-f]{64}$/.test(value.digest);
      case "read-error":
        return true;
      case "kind":
        return (
          value.kind === "file" ||
          value.kind === "directory" ||
          value.kind === "other" ||
          value.kind === "missing"
        );
      case "entries":
        return (
          Array.isArray(value.files) &&
          value.files.every((entry) => typeof entry === "string") &&
          Array.isArray(value.directories) &&
          value.directories.every((entry) => typeof entry === "string")
        );
      case "entries-error":
        return true;
      case "realpath":
        return value.target === null || typeof value.target === "string";
      default:
        return false;
    }
  });
}
