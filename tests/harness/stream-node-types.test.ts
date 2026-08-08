/* node:stream under REAL @types/node.
 *
 * The runtime stream implementation (scr_stream.c, the five %-classes, the
 * whole lower-stream spoke) used to be reachable only through the SHIPPED
 * FALLBACK declarations: both places that decided "this symbol is a
 * node:stream class" carried their own copy of the provenance test, and
 * both copies excluded @types/node. Every project that installs
 * @types/node — which is every real project — therefore saw its streams
 * as unsupported surface, `Readable` in particular being claimed by the
 * child-stdio mapping instead.
 *
 * These tests pin the fix from both ends: the CAPABILITY (the fixture
 * compiles and matches Node under @types/node), and the ACCOUNTING (one
 * provenance test, and it covers every class in the registry — so adding
 * a sixth stream class without teaching the mapping about it fails here
 * rather than silently reproducing the original bug).
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";
import { compile, ir } from "@scriptc/compiler";
import { exeName } from "./exe.js";

const execFileAsync = promisify(execFile);
const repoRoot = join(import.meta.dirname, "../..");
/* POSIX spelling: renderAll reports forward-slash paths on every host. */
const nodeTypesDir = join(repoRoot, "tests/fixtures/node-types").split("\\").join("/");
const sanitize = process.env["SCRIPTC_SAN"] === "1";

function outDirFor(name: string): string {
  return mkdtempSync(join(tmpdir(), `scriptc-stream-nt-${name}-`));
}

/* The oracle for both halves below: the fixture under Node itself. */
async function nodeOutputOf(entry: string): Promise<string> {
  const { stdout } = await execFileAsync(process.execPath, [entry]);
  return stdout;
}

test("node-types: the stream classes lower statically under @types/node and match Node", async () => {
  const outDir = outDirFor("streams");
  const entry = join(nodeTypesDir, "streams.ts");
  const result = await compile(entry, {
    outPath: join(outDir, exeName("streams")),
    outDir,
    sanitize,
  });
  expect(result.ok, !result.ok ? JSON.stringify(result.diagnostics, null, 2) : "").toBe(true);
  if (!result.ok) return;
  const { stdout } = await execFileAsync(result.binaryPath);
  expect(stdout).toBe(await nodeOutputOf(entry));
});

/* The accounting test. RUNTIME_STREAM_CLASSES is the registry of runtime
 * stream classes; runtimeStreamClassOf is the ONE provenance test that
 * maps a declared symbol onto it. This walks the registry itself, so it
 * cannot go stale against a class the registry gains later: every entry
 * must construct and destroy under @types/node, whose declarations are
 * the source the original bug excluded.
 *
 * Constructors differ per class (a Writable needs a write callback, a
 * Transform a transform callback), so the probe asks each class only for
 * what every stream can answer: construction with its required callbacks,
 * `destroyed`, and destroy(). */
const CTOR_ARGS: Readonly<Record<string, string>> = {
  Readable: "{ read() {} }",
  Writable: "{ write(_c: Buffer, _e: string, cb) { cb(); } }",
  Duplex: "{ read() {}, write(_c: Buffer, _e: string, cb) { cb(); } }",
  Transform: "{ transform(c: Buffer, _e: string, cb) { cb(null, c); } }",
  PassThrough: "{}",
};

test("node-types: EVERY class in RUNTIME_STREAM_CLASSES maps under @types/node", async () => {
  const names = [...ir.RUNTIME_STREAM_CLASSES.values()].map((r) => r.lib);
  expect(names.length).toBeGreaterThan(0);
  // A registry entry with no probe here is the staleness this test exists
  // to catch: add the class to CTOR_ARGS when you add it to the registry.
  expect(Object.keys(CTOR_ARGS).sort()).toStrictEqual([...names].sort());

  const outDir = outDirFor("registry");
  const lines = [
    `import { ${[...names].sort().join(", ")} } from "node:stream";`,
    ...names.map(
      (n, i) =>
        `const s${i} = new ${n}(${CTOR_ARGS[n]!}); ` +
        `console.log("${n}", s${i}.destroyed); s${i}.destroy(); console.log("${n}", s${i}.destroyed);`,
    ),
  ];
  // Inside the fixture dir so the vendored, pinned @types/node resolves.
  const entry = join(nodeTypesDir, "registry-probe.generated.ts");
  writeFileSync(entry, lines.join("\n") + "\n");
  try {
    const result = await compile(entry, {
      outPath: join(outDir, exeName("registry-probe")),
      outDir,
      sanitize,
    });
    expect(result.ok, !result.ok ? JSON.stringify(result.diagnostics, null, 2) : "").toBe(true);
    if (!result.ok) return;
    const { stdout } = await execFileAsync(result.binaryPath);
    expect(stdout).toBe(await nodeOutputOf(entry));
  } finally {
    /* Generated INSIDE the fixture dir (only there does its vendored,
     * pinned @types/node resolve), so it must not survive the run. */
    rmSync(entry, { force: true });
  }
});
