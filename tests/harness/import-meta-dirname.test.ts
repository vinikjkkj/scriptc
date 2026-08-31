/* `import.meta.dirname` / `__dirname` in a compiled binary: the value is
 * the BUILD-TIME source directory, and this file is the artifact that says
 * so out loud instead of leaving it to be discovered.
 *
 * Node derives these at RUN time from the module's own location. A compiled
 * binary has no module file to derive them from, so the compiler bakes the
 * source file's directory as a constant (lower-exprs' nativeModulePath).
 * Run in place, that IS Node's answer, and the corpus pins it byte-for-byte
 * (7333 for the import.meta spelling, 7334 for the separators). The
 * divergence only becomes visible when the binary MOVES — which is a thing
 * a corpus program cannot express, because a corpus program is compared
 * against Node on the same host and would simply match.
 *
 * So this test moves one. It asserts the answer does NOT follow the binary,
 * because that is the deliberate semantics: programs that read data files
 * or fork siblings out of their own source tree get the path they want.
 * Answering the binary's own directory was considered and rejected — it is
 * a different question, and a plausible-looking wrong answer is the failure
 * mode this compiler most consistently refuses.
 *
 * If someone later makes these run-time values, this test is the one that
 * should fail, and its message is the argument they have to answer.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, sep } from "node:path";
import { describe, expect, test } from "vitest";
import { compile } from "@scriptc/compiler";
import { exeName } from "./exe.js";

const repoRoot = join(import.meta.dirname, "../..");
const cacheDir = join(repoRoot, "node_modules/.cache/scriptc-tests");
const sanitize = process.env["SCRIPTC_SAN"] === "1";
const BACKENDS = ["c", "llvm"] as const;

/** `import.meta.dirname` needs an ES module; `__dirname` needs a CommonJS
 * one. Both spellings bake through the same helper, so both are moved. */
const CASES = [
  { name: "import-meta", ext: "mts", body: "console.log(import.meta.dirname);\nconsole.log(import.meta.filename);\n" },
  { name: "cjs-globals", ext: "cjs", body: "console.log(__dirname);\nconsole.log(__filename);\n" },
] as const;

async function buildOne(
  c: (typeof CASES)[number],
  backend: "c" | "llvm",
): Promise<{ binaryPath: string; sourceDir: string }> {
  const key = createHash("sha256")
    .update(c.body).update(backend).update(sanitize ? "san" : "plain")
    .digest("hex").slice(0, 16);
  const outDir = join(cacheDir, `import-meta-dirname-${c.name}-${key}`);
  mkdirSync(outDir, { recursive: true });
  const file = join(outDir, `${c.name}.${c.ext}`);
  writeFileSync(file, c.body, "utf8");
  const result = await compile(file, {
    outPath: join(outDir, exeName(c.name)),
    outDir,
    sanitize,
    backend,
  });
  // A cell that could not compile did not run: say so with the refusal
  // attached rather than letting it read as "no divergence observed".
  if (!result.ok) {
    throw new Error(
      `[${backend}] ${c.name} DID NOT RUN (compile refused):\n` +
        result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"),
    );
  }
  return { binaryPath: result.binaryPath, sourceDir: dirname(file) };
}

const runLines = (exe: string): string[] =>
  execFileSync(exe, [], { encoding: "utf8" }).trimEnd().split("\n").map((l) => l.trimEnd());

describe("import.meta.dirname / __dirname are the BUILD-TIME source directory", () => {
  for (const c of CASES) {
    for (const backend of BACKENDS) {
      test(`${c.name} (${backend}): in place it is Node's answer, and it does not follow a moved binary`, async () => {
        const { binaryPath, sourceDir } = await buildOne(c, backend);

        // (1) In place: the baked value is the source file's real directory,
        // native separators and all. This is the cell the corpus also pins.
        const inPlace = runLines(binaryPath);
        expect(inPlace[0], "dirname in place").toBe(sourceDir);
        expect(inPlace[1], "filename in place").toBe(join(sourceDir, `${c.name}.${c.ext}`));
        expect(sourceDir.includes(sep), "the baked path uses native separators").toBe(true);

        // (2) MOVED: copy the binary to a sibling directory and run it from
        // there. Node's import.meta.dirname would follow the module; this
        // does not follow the binary, and that is the documented divergence.
        const elsewhere = join(cacheDir, `import-meta-dirname-moved-${c.name}-${backend}`);
        mkdirSync(elsewhere, { recursive: true });
        const movedExe = join(elsewhere, exeName(c.name));
        copyFileSync(binaryPath, movedExe);

        const moved = runLines(movedExe);
        expect(
          moved,
          "the moved binary must answer the BUILD-TIME source directory, not its own location",
        ).toEqual(inPlace);
        expect(
          moved[0],
          "the answer must NOT be the directory the binary now sits in — if this fails because " +
            "someone made these run-time values, that is a semantic change: it fixes the moved " +
            "binary and breaks every program that reads a data file or forks a sibling out of " +
            "its own source tree",
        ).not.toBe(elsewhere);
      });
    }
  }
});

/* `process.execPath` is the same question one step over: not "where is my
 * module" but "what executable am I". Node answers the path of the `node`
 * that started the process. A compiled binary has no node in the picture,
 * so it answers ITSELF — which is literally correct (that IS the executable
 * that started this process) and is a trap with teeth, because the
 * idiomatic use of execPath is "get node so I can spawn another node". In a
 * compiled binary that silently becomes "spawn myself": a probe written
 * that way forked ~3300 copies of itself on this host before it was killed.
 *
 * It is pinned here rather than in the corpus because the corpus compares
 * against Node on the same host and this cell differs BY DESIGN — a corpus
 * program could only pin it by being permanently red.
 */
describe("process.execPath in a compiled binary is the binary, not node", () => {
  for (const backend of BACKENDS) {
    test(`${backend}: execPath names this binary, and spawning it is not spawning node`, async () => {
      const c = {
        name: "execpath",
        ext: "mts",
        body: 'import { basename } from "node:path";\nconsole.log(basename(process.execPath));\n',
      } as const;
      const { binaryPath } = await buildOne(c, backend);
      const printed = runLines(binaryPath)[0];

      expect(printed, "execPath must name the compiled binary").toBe(basename(binaryPath));
      expect(
        printed.toLowerCase().startsWith("node"),
        "if this ever names node, spawning process.execPath changed meaning — every program " +
          "that uses it to launch a Node child is affected, in both directions",
      ).toBe(false);
    });
  }
});
