/* THE "node" EXPORT CONDITION — the three resolvers must answer one file.
 *
 * scriptc compiles for Node, and it carries three resolutions of the same
 * bare specifier:
 *
 *   1. the CHECKER's, tsgo's own, under program.ts's FORCED_OPTIONS;
 *   2. scriptc's own types resolution (resolve.ts EXPORT_CONDITIONS) —
 *      what decides the island's type surface and --npm-static's target;
 *   3. the RUNTIME resolution (npm.ts resolveExports) — what the island
 *      loads, and what an import edge is judged against.
 *
 * (3) has always enabled "node"; npm-static.ts HOISTS the node target for
 * the same reason ("the browser dist is a DIFFERENT artifact"). (1) and
 * (2) did not. For a package whose "." is `{ node: {...}, default: {...} }`
 * and which publishes NO "./node" subpath to spell instead — file-type@19
 * is the one this was found on — the TYPES came off the default/browser
 * entry while the VALUES came off the node entry, and a member that exists
 * only in the node entry refused to exist on a module the island then
 * loaded it from. There is no source-level spelling that avoids it.
 *
 * NODE ITSELF IS THE ORACLE here, not a transcription of its algorithm:
 * every case resolves through `import.meta.resolve` from a real file in a
 * real tree, and both compiler answers are compared against that.
 *
 * A one-sided version of this suite passes by accident: a resolver that
 * always answered the node arm would be wrong for a map that lists "types"
 * or "import" AHEAD of "node" (first match in OBJECT KEY order wins), and
 * wrong for a map with no "node" key at all. Both are cases below, and
 * both must answer the non-node file. */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect, test } from "vitest";
import { resolveExports } from "../src/frontend/npm.js";
import { clearResolveCaches, resolveBareModule } from "../src/frontend/resolve.js";

function write(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

let root = "";
let from = "";
/** A real ESM file inside the fixture tree: the oracle's resolution base. */
let probe = "";

/** One installed package with the given exports map, plus every target
 * file it can name, so a resolution that reaches one finds it on disk. */
function install(name: string, exports: unknown): void {
  const dir = join(root, "node_modules", name);
  write(join(dir, "package.json"), JSON.stringify({ name, version: "1.0.0", type: "module", exports }));
  for (const stem of ["index", "core", "browser"]) {
    write(join(dir, `${stem}.js`), `export const which = ${JSON.stringify(stem)};\n`);
    write(join(dir, `${stem}.d.ts`), `export declare const which: ${JSON.stringify(stem)};\n`);
  }
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "scriptc-nodecond-"));
  write(join(root, "package.json"), '{"name":"nodecond-app","version":"1.0.0","type":"module"}');
  from = join(root, "app.ts");
  write(from, "export const x = 1;\n");
  probe = join(root, "resolve-probe.mjs");
  write(probe, "process.stdout.write(import.meta.resolve(process.argv[2]))\n");

  // THE SHAPE THAT MOVED: node first, default second, no "./node" subpath.
  install("nc-node-first", {
    ".": {
      node: { types: "./index.d.ts", import: "./index.js" },
      default: { types: "./core.d.ts", import: "./core.js" },
    },
  });
  // CONTROL: types listed BEFORE node. First match in key order wins, so
  // this must still answer the types target and must NOT move.
  install("nc-types-first", {
    ".": {
      types: "./core.d.ts",
      node: "./index.js",
      default: "./browser.js",
    },
  });
  // CONTROL: no "node" key anywhere. Nothing to match; must not move.
  install("nc-no-node", {
    ".": { types: "./core.d.ts", import: "./core.js", default: "./core.js" },
  });
  // The node arm names a file that DOES NOT EXIST. Node does NOT fall
  // through to "default" here — it resolves to ./absent.js and throws
  // ERR_MODULE_NOT_FOUND at load (asserted below). Enabling "node"
  // therefore turns this package from a types lane answering ./core.js —
  // a file Node would never load — into a refusal. That is the loud
  // direction, and it is the whole point: a wrong answer became a
  // refusal, not the other way round.
  install("nc-node-missing", {
    ".": {
      node: "./absent.js",
      default: "./core.js",
    },
  });
  clearResolveCaches();
});

afterAll(() => {
  clearResolveCaches();
  rmSync(root, { recursive: true, force: true });
});

/** Node's own answer for an ESM import of `spec` from `from`, as a bare
 * file stem ("index" / "core" / "browser"), or the thrown error code.
 *
 * SPAWNED, not called: this suite runs under vite's SSR transform, where
 * `import.meta.resolve` is not Node's. A real node process doing a real
 * ESM resolution is the only form of this oracle worth having — a
 * transcription of Node's algorithm is precisely what is under test. */
function nodeStem(spec: string): string {
  // The probe is a real file IN the tree: `import.meta.resolve` takes one
  // argument in current Node (the parent-URL form is behind a flag), so
  // the resolution base is the probe's own location, which is what makes
  // the fixture's node_modules the tree Node walks.
  const r = spawnSync(process.execPath, [probe, spec], { encoding: "utf8" });
  if (r.status !== 0) {
    const m = /\b(ERR_[A-Z_]+)\b/.exec(r.stderr ?? "");
    return m === null ? `<node failed: ${(r.stderr ?? "").slice(0, 160)}>` : m[1]!;
  }
  return fileURLToPath(r.stdout.trim())
    .replace(/^.*[/\\]/, "")
    .replace(/\.[cm]?js$/, "");
}

/** The error code a real `import()` of `spec` throws in a real Node
 * process, or "" when it loads. */
function loadThrows(spec: string): string {
  const r = spawnSync(
    process.execPath,
    [
      "-e",
      `import(${JSON.stringify(spec)}).then(()=>process.stdout.write("")).catch(e=>process.stdout.write(e.code??String(e)))`,
    ],
    { encoding: "utf8", cwd: root },
  );
  return r.stdout.trim();
}

/** scriptc's own TYPES resolution, as the same bare stem. */
function typesStem(spec: string): string {
  const r = resolveBareModule(from, spec);
  return r === null ? "<null>" : r.typesFile.replace(/^.*[/\\]/, "").replace(/\.d\.ts$|\.[cm]?js$/, "");
}

/** The RUNTIME resolution (what the island loads), as the same bare stem. */
function runtimeStem(spec: string): string {
  const pkg = JSON.parse(readFileSync(join(root, "node_modules", spec, "package.json"), "utf8"));
  const t = resolveExports(pkg.exports, ".", "import");
  return t === null ? "<null>" : t.replace(/^.*\//, "").replace(/\.[cm]?js$/, "");
}

test("Node itself resolves the node arm, and both compiler resolvers agree", () => {
  expect(nodeStem("nc-node-first")).toBe("index");
  expect(typesStem("nc-node-first")).toBe("index");
  expect(runtimeStem("nc-node-first")).toBe("index");
});

test("a condition listed before node still wins — key order, not set order", () => {
  // Node has no "types" condition, so ITS first match is "node"; the types
  // lane's first match is "types". The point of the case is that adding
  // "node" to the set did not reorder anything: the types lane must still
  // answer core, which is what it answered before.
  expect(typesStem("nc-types-first")).toBe("core");
  expect(runtimeStem("nc-types-first")).toBe("index");
});

test("a package with no node key does not move", () => {
  expect(nodeStem("nc-no-node")).toBe("core");
  expect(typesStem("nc-no-node")).toBe("core");
  expect(runtimeStem("nc-no-node")).toBe("core");
});

test("a node arm naming a missing file does not fall through — it refuses", () => {
  // Node's own behaviour first, so this is not an assumption: it picks the
  // node arm, does NOT retry "default", and the import throws.
  expect(nodeStem("nc-node-missing")).toBe("absent");
  expect(loadThrows("nc-node-missing")).toBe("ERR_MODULE_NOT_FOUND");
  // The runtime lane answers the same target Node picked.
  expect(runtimeStem("nc-node-missing")).toBe("absent");
  // The types lane finds nothing on disk at that target and refuses. It
  // used to answer "core" — a file Node will never load. The refusal is
  // the improvement.
  expect(typesStem("nc-node-missing")).toBe("<null>");
});

test("the types lane and the runtime lane answer the same file where one exists", () => {
  // The invariant resolveBareModule's own comment states ("the two
  // resolvers must answer one file"), asserted for every case whose map
  // does not deliberately separate them. nc-types-first does separate
  // them, by naming a "types" key Node cannot see — that separation is the
  // pre-existing and intended one. nc-node-missing separates them too, but
  // in the safe direction (refusal vs. a target that does not exist), and
  // is asserted above rather than here.
  for (const spec of ["nc-node-first", "nc-no-node"]) {
    expect(`${spec}:${typesStem(spec)}`).toBe(`${spec}:${runtimeStem(spec)}`);
    expect(`${spec}:${typesStem(spec)}`).toBe(`${spec}:${nodeStem(spec)}`);
  }
});
