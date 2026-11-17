/* Program lifecycle over typescript@7.0.2's unstable sync API — the
 * ts.createProgram-shaped entry the survey's probe7b proved out.
 *
 * 7.0.2 has no createProgram(roots, options): the model is
 * new API({cwd, fs}) -> updateSnapshot({openProjects: [tsconfig]}) ->
 * snapshot.getProject(...), strictly tsconfig-driven. scriptc's no-tsconfig /
 * extra-roots story (entry + ambient dts + fallback/overrides dts, forced
 * options) maps onto that through a SYNTHESIZED IN-MEMORY tsconfig: the
 * virtual-FS hooks serve one nonexistent tsconfig path whose "files" lists
 * exactly our roots (absolute paths) and whose compilerOptions serialize our
 * options; every other path falls through to the real filesystem, so real
 * entries, ambient .d.ts files, and node_modules resolve exactly as on disk.
 *
 * One Ts7Host owns one spawned tsgo server (54 ms warm spawn per the survey;
 * 387 cold). createProgram() takes an optional shared host — the default
 * spawns a private one that dispose() closes. */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { API } from "typescript/unstable/sync";
import type {
  CompilerOptions,
  Diagnostic,
  Project,
  Snapshot,
} from "typescript/unstable/sync";
import type { SourceFile } from "typescript/unstable/ast";
import { CheckerFacade } from "./checker.js";
import { installSymbolCanon } from "./symbol-canon.js";
import { closeTsgo, phaseTimesOn, registerTsgo, span } from "../../phase-times.js";
import { enumKeyOf, ModuleKind, ModuleResolutionKind, ScriptTarget } from "./enums.js";
import { tsgoPath } from "../shared.js";
import { jsDesugar } from "../js-desugar.js";
import { setServedSourceText } from "../../source-text.js";
import {
  frontendInputTrackingActive,
  trackedAccessibleEntries,
  trackedDirectoryExists,
  trackedFileExists,
  trackedReadFile,
  trackedRealpath,
} from "../input-tracker.js";

/** The compiler options our createProgram accepts: TS7's CompilerOptions
 * shape (numeric enums for target/module/moduleResolution — the enums module
 * re-exports them symbolically) with the 5.9.3 "lib.es2025.d.ts" lib
 * spelling also accepted. */
export type Ts7CompilerOptions = CompilerOptions;

/* tsconfig JSON wants enum NAMES; the options object carries TS7's numeric
 * enum values. The names come from the enum objects' own reverse mappings —
 * nothing here knows a number. */
function serializeOptions(options: Ts7CompilerOptions): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(options)) {
    if (value === undefined) continue;
    switch (key) {
      // tsgo's tsconfig parser is case-sensitive about enum-option spellings
      // (5.9.3's was not): the enum KEY names lowercase to the accepted forms
      // ("ESNext" -> "esnext", "Bundler" -> "bundler", "NodeNext" ->
      // "nodenext").
      case "target":
        // ScriptTarget.ESNext and .Latest share a value; the reverse map
        // answers "Latest", which the option parser does not accept.
        out[key] =
          value === ScriptTarget.ESNext
            ? "esnext"
            : (enumKeyOf(ScriptTarget as never, value as number)?.toLowerCase() ?? value);
        break;
      case "module":
        out[key] = enumKeyOf(ModuleKind as never, value as number)?.toLowerCase() ?? value;
        break;
      case "moduleResolution":
        out[key] = enumKeyOf(ModuleResolutionKind as never, value as number)?.toLowerCase() ?? value;
        break;
      case "lib":
        // 5.9.3 spells lib entries "lib.es2025.d.ts"; tsconfig wants "es2025".
        out[key] = (value as string[]).map((lib) =>
          lib.startsWith("lib.") && lib.endsWith(".d.ts") ? lib.slice(4, -5) : lib,
        );
        break;
      default: {
        if (typeof value === "number" && key !== "maxNodeModuleJsDepth") {
          throw new Error(`ts7 createProgram: unhandled enum-valued compiler option '${key}'`);
        }
        out[key] = value;
      }
    }
  }
  return out;
}

/** The TS 7 client decodes every node text and file text through its
 * Wtf8Decoder, a TextDecoder built with the DEFAULT ignoreBOM:false. A
 * TextDecoder drops a leading U+FEFF from each decode call, and the client
 * makes one call per string value, so a string VALUE that begins with U+FEFF
 * ("﻿", a literal BOM followed by text, a template) reached the compiler
 * with that character gone (MEASURED: "﻿".length was 0, Node 1).
 * Rebuild the same decoder class with ignoreBOM:true. A file that starts with
 * a BOM keeps it in its text too, where the TS scanner skips it as trivia
 * exactly as before, and where the offsets now agree with the bytes on disk. */
function keepLeadingBom(program: object): void {
  const holder = program as { decoder: object };
  const Wtf8Decoder = holder.decoder.constructor as unknown as new (label: string, options: { ignoreBOM: boolean }) => object;
  holder.decoder = new Wtf8Decoder("utf-8", { ignoreBOM: true });
}

let nextConfigId = 0;

/** THE DESUGAR MEMO. A reload (the pin and twin passes) reads every file again, and jsDesugar parses and rewrites a big file from scratch each
 * time: on zapo's 1.87 MB `spec/proto/index.js` that is about 18 s of Node CPU per load, repeated for a text that did not change. The answer is kept
 * per (file name, sha1 of the text) for the texts big enough to matter. An edited file hashes differently and misses.
 *
 * ONE COMPILE'S, never the process's. jsDesugar reads OTHER files from disk (the names a `__exportStar(require("./dep"), exports)` copies come from
 * `./dep`), so the same file name and text can desugar differently once a neighbour changed; the in-process callers (the test workers, a watch loop)
 * compile many programs in one process. The memo is therefore an object the compile creates (runFrontend), hands to every load of that compile
 * through LoadOptions.desugarMemo and drops with the compile; a load given none desugars without a memo. Inside one compile the disk does not change
 * (every load already assumes it), so a hit is exact.
 *
 * Bounded: only texts of at least MIN chars are kept, and the kept output strings stop at MAX chars in total (a null answer is free). */
export class DesugarMemo {
  static readonly MIN = 100_000;
  static readonly MAX = 8_000_000;
  private readonly entries = new Map<string, string | null>();
  private chars = 0;
  desugar(fileName: string, text: string): string | null {
    if (text.length < DesugarMemo.MIN) return jsDesugar(fileName, text);
    const key = `${fileName}\0${text.length}\0${createHash("sha1").update(text).digest("hex")}`;
    const hit = this.entries.get(key);
    if (hit !== undefined) return hit;
    const out = jsDesugar(fileName, text);
    const cost = out === null ? 0 : out.length;
    if (this.chars + cost <= DesugarMemo.MAX) {
      this.entries.set(key, out);
      this.chars += cost;
    }
    return out;
  }
  /** Entries kept (for the tests that show the memo is live). */
  get size(): number {
    return this.entries.size;
  }
}

/** The desugared text (js-desugar.ts) of a plain-JS file, given the text a
 * shadow already derived for it (or undefined to read the disk), or the
 * shadow's own text unchanged when nothing in the file needs desugaring.
 * Undefined means "serve nothing of mine": not a .js/.cjs file, or no
 * desugaring applies and no shadow text exists. */
function desugaredJs(fileName: string, derived: string | undefined, memo: DesugarMemo | null): string | undefined {
  if (!/\.c?js$/.test(fileName) || fileName.endsWith(".d.ts")) return derived;
  let text = derived;
  if (text === undefined) {
    try {
      text = frontendInputTrackingActive() ? (trackedReadFile(fileName) ?? undefined) : readFileSync(fileName, "utf8");
    } catch {
      return derived;
    }
    if (text === undefined) return derived;
  }
  const out = memo === null ? jsDesugar(fileName, text) : memo.desugar(fileName, text);
  if (out === null) return derived;
  // srcSite (the C emitter) maps a SrcLoc OFFSET back to file:line:col by
  // reading the file a second time: record what was actually served.
  setServedSourceText(fileName, out);
  return out;
}

/** One spawned tsgo server plus the virtual-FS overlay serving synthesized
 * tsconfigs. Share a host across programs to pay the spawn once; the overlay
 * is a live map, so each createProgram call adds its config before taking
 * the snapshot. */
export class Ts7Host {
  private readonly virtualFiles = new Map<string, string>();
  private readonly api: API;
  private readonly reg: ReturnType<typeof registerTsgo>;
  private closed = false;

  constructor(options?: {
    cwd?: string;
    collectTiming?: boolean;
    /** The compile's desugar memo (DesugarMemo); none = every file desugars afresh. */
    desugarMemo?: DesugarMemo;
    /** Optional real-path shadow (the --npm-static resolution lever):
     * `readFile` may answer REPLACEMENT content for a real file (a
     * types-stripped package.json) and `hideFile` may shadow a real file
     * out of existence (an opted-in package's shipped .d.ts). Virtual
     * files always win; unshadowed paths fall through to the real FS. */
    fsShadow?: {
      readFile: (path: string) => string | undefined;
      hideFile: (path: string) => boolean;
    } | null;
  }) {
    const virtualFiles = this.virtualFiles;
    const shadow = options?.fsShadow ?? null;
    const desugarMemo = options?.desugarMemo ?? null;
    this.api = span("tsgo.spawn", () => new API({
      cwd: options?.cwd ?? process.cwd(),
      ...(options?.collectTiming !== undefined ? { collectTiming: options.collectTiming } : phaseTimesOn ? { collectTiming: true } : {}),
      fs: {
        // string => virtual (or shadowed) hit; null => shadowed out of
        // existence; undefined => real-FS fallthrough.
        /* `undefined` means "fall through to tsgo's own server-side
         * filesystem". That is the historical answer and it stays the answer
         * whenever no FrontendInputTracker is running: a build with no cache
         * configured pays not one extra round trip.
         *
         * When a tracker IS running the hooks must answer node-side instead.
         * A server-side read is invisible to the tracker, and an input the
         * fingerprint cannot see is an input the cache would happily serve a
         * stale artifact for. tsgo resolves the whole transitive graph —
         * @types/node, every node_modules candidate, every lib.d.ts — so
         * falling through for even one operation would leave the snapshot
         * silently incomplete rather than merely coarse. */
        readFile: (fileName) => {
          const virtual = virtualFiles.get(tsgoPath(fileName));
          if (virtual !== undefined) return virtual;
          if (shadow !== null && shadow.hideFile(fileName)) return null;
          // The shadow may SERVE derived bytes — an npm-static-transformed
          // package.json, a provenance-alias-rewritten source — and a plain-JS
          // source with a spelling that means a sequence of already-modeled
          // forms is served desugared on top of whatever it derived
          // (js-desugar.ts). Every other file falls through exactly as before.
          const replacement = desugaredJs(fileName, shadow?.readFile(fileName), desugarMemo);
          if (replacement !== undefined) {
            // The bytes served were derived from the disk through helpers of
            // their own. Record the disk bytes here regardless, so no amount
            // of untracked reading inside a helper can leave a served file
            // outside the snapshot. The derivation itself is keyed separately:
            // the provenance source set and the --npm-static selection are
            // both in the explicit half of the cache key.
            if (frontendInputTrackingActive()) trackedReadFile(fileName);
            return replacement;
          }
          return frontendInputTrackingActive() ? trackedReadFile(fileName) : undefined;
        },
        fileExists: (fileName) => {
          if (virtualFiles.has(tsgoPath(fileName))) return true;
          if (shadow !== null && shadow.hideFile(fileName)) return false;
          return frontendInputTrackingActive() ? trackedFileExists(fileName) : undefined;
        },
        directoryExists: (path) =>
          frontendInputTrackingActive() ? trackedDirectoryExists(path) : undefined,
        realpath: (path) =>
          virtualFiles.has(tsgoPath(path))
            ? path
            : frontendInputTrackingActive()
              ? (trackedRealpath(path) ?? path)
              : undefined,
        getAccessibleEntries: (path) =>
          frontendInputTrackingActive()
            ? (trackedAccessibleEntries(path) ?? { files: [], directories: [] })
            : undefined,
      },
    }));
    this.reg = registerTsgo(this.api);
  }

  /** Registers an in-memory file served to tsgo by the virtual-FS hooks. */
  addVirtualFile(path: string, content: string): void {
    this.virtualFiles.set(tsgoPath(path), content);
  }

  /** tsgo's own tsconfig parser (extends chains resolved server-side) — the
   * 7-world replacement for ts.readConfigFile + ts.parseJsonConfigFileContent.
   * Returns raw option values (strings for enum-ish knobs) and the resolved
   * file list. */
  parseConfigFile(configPath: string): { options: Record<string, unknown>; fileNames: string[] } {
    return this.api.parseConfigFile(resolve(configPath));
  }

  createProgram(
    rootNames: readonly string[],
    options: Ts7CompilerOptions,
    /** Internal: true when the program owns this host and dispose() closes it. */
    programOwnsHost = false,
  ): Ts7Program {
    if (this.closed) throw new Error("Ts7Host is closed");
    const roots = rootNames.map((r) => resolve(r));
    const first = roots[0];
    if (first === undefined) throw new Error("ts7 createProgram: no root files");
    const configPath = join(dirname(first), `__scriptc-ts7-${nextConfigId++}.tsconfig.json`);
    this.addVirtualFile(
      configPath,
      JSON.stringify({ compilerOptions: serializeOptions(options), files: roots, include: [] }),
    );
    const { snapshot, project } = span("tsgo.snapshot", () => {
      const snapshot = this.api.updateSnapshot({ openProjects: [configPath] });
      return { snapshot, project: snapshot.getProject(configPath) };
    });
    if (!project) {
      snapshot.dispose();
      throw new Error(`ts7 createProgram: project failed to open for ${first}`);
    }
    keepLeadingBom(project.program);
    installSymbolCanon(project.checker);
    return new Ts7Program(project, snapshot, this, !programOwnsHost);
  }

  getTimingInfo(): unknown {
    return this.api.getTimingInfo();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    closeTsgo(this.reg);
    this.api.close();
  }
}

/** ts.Program-shaped facade over a TS7 Project: same-name query surface plus
 * getTypeChecker() returning the memoizing/batching CheckerFacade. dispose()
 * releases the snapshot (and the host, when this program spawned it). */
export class Ts7Program {
  private sourceFilesCache: readonly SourceFile[] | null = null;
  private checkerFacade: CheckerFacade | null = null;

  constructor(
    /** The underlying TS7 project (program + checker + emitter). */
    readonly project: Project,
    private readonly snapshot: Snapshot,
    private readonly host: Ts7Host,
    private readonly sharedHost: boolean,
  ) {}

  getCompilerOptions(): CompilerOptions {
    return this.project.program.getCompilerOptions();
  }

  getSourceFile(fileName: string): SourceFile | undefined {
    // resolve() spells a Windows path with backslashes; the project's file names are slash-normalized (tsgoPath)
    return this.project.program.getSourceFile(tsgoPath(resolve(fileName)));
  }

  getSourceFileNames(): readonly string[] {
    return this.project.program.getSourceFileNames();
  }

  /** Materializes every file of the program (5.9.3's getSourceFiles shape).
   * 7.0.2 serves files one by one; the result is cached, so the full-program
   * sweeps (preflight's user-file scan) pay the transfer once. */
  getSourceFiles(): readonly SourceFile[] {
    if (this.sourceFilesCache === null) {
      const program = this.project.program;
      this.sourceFilesCache = program
        .getSourceFileNames()
        .map((name) => program.getSourceFile(name))
        .filter((sf): sf is SourceFile => sf !== undefined);
    }
    return this.sourceFilesCache;
  }

  getTypeChecker(): CheckerFacade {
    this.checkerFacade ??= new CheckerFacade(this.project.checker, { project: this.project });
    return this.checkerFacade;
  }

  getSyntacticDiagnostics(sourceFile?: SourceFile): readonly Diagnostic[] {
    return this.project.program.getSyntacticDiagnostics(sourceFile?.fileName);
  }

  getSemanticDiagnostics(sourceFile?: SourceFile): readonly Diagnostic[] {
    return this.project.program.getSemanticDiagnostics(sourceFile?.fileName);
  }

  getGlobalDiagnostics(): readonly Diagnostic[] {
    return this.project.program.getGlobalDiagnostics();
  }

  getProgramDiagnostics(): readonly Diagnostic[] {
    return this.project.program.getProgramDiagnostics();
  }

  getConfigFileParsingDiagnostics(): readonly Diagnostic[] {
    return this.project.program.getConfigFileParsingDiagnostics();
  }

  isSourceFileDefaultLibrary(file: SourceFile): boolean {
    return this.project.program.isSourceFileDefaultLibrary(file);
  }

  isSourceFileFromExternalLibrary(file: SourceFile): boolean {
    return this.project.program.isSourceFileFromExternalLibrary(file);
  }

  dispose(): void {
    this.snapshot.dispose();
    if (!this.sharedHost) this.host.close();
  }
}

/** The ts.createProgram-shaped entry: roots + options, tsconfig synthesized
 * behind the scenes. Without a shared host each call spawns (and owns) its
 * own tsgo server — pass one Ts7Host when building several programs (the
 * lowering world and preflight's project world). */
export function createProgram(
  rootNames: readonly string[],
  options: Ts7CompilerOptions,
  host?: Ts7Host,
): Ts7Program {
  if (host) return host.createProgram(rootNames, options);
  const first = rootNames[0];
  const owned = new Ts7Host({ cwd: first !== undefined ? dirname(resolve(first)) : process.cwd() });
  return owned.createProgram(rootNames, options, /* programOwnsHost */ true);
}

/** 5.9.3's getPreEmitDiagnostics, composed from 7.0.2's split surface (the
 * package dropped the aggregate). Order mirrors 5.9.3: config, options/
 * program, global, syntactic, semantic. */
export function getPreEmitDiagnostics(program: Ts7Program): readonly Diagnostic[] {
  return [
    ...program.getConfigFileParsingDiagnostics(),
    ...program.getProgramDiagnostics(),
    ...program.getGlobalDiagnostics(),
    ...program.getSyntacticDiagnostics(),
    ...program.getSemanticDiagnostics(),
  ];
}

/** ts.findConfigFile: nearest configName walking up from searchPath. */
export function findConfigFile(
  searchPath: string,
  fileExists: (fileName: string) => boolean = sys.fileExists,
  configName = "tsconfig.json",
): string | undefined {
  let dir = resolve(searchPath);
  for (;;) {
    const candidate = join(dir, configName);
    if (fileExists(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/** The ts.sys subset the census uses (program.ts, npm.ts — 8 call sites),
 * over node:fs. 7.0.2 ships no ts.sys; the compiler runs on Node, so these
 * are the direct implementations. */
export const sys = {
  fileExists(path: string): boolean {
    if (frontendInputTrackingActive()) return trackedFileExists(path);
    return existsSync(path) && statSync(path).isFile();
  },
  readFile(path: string): string | undefined {
    if (frontendInputTrackingActive()) return trackedReadFile(path) ?? undefined;
    try {
      return readFileSync(path, "utf8");
    } catch {
      return undefined;
    }
  },
  writeFile(path: string, data: string): void {
    writeFileSync(path, data);
  },
  directoryExists(path: string): boolean {
    if (frontendInputTrackingActive()) return trackedDirectoryExists(path);
    return existsSync(path) && statSync(path).isDirectory();
  },
  getCurrentDirectory(): string {
    return process.cwd();
  },
  useCaseSensitiveFileNames: true,
  newLine: "\n",
};
