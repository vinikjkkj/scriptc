/* better-sqlite3 in the static lane — the differential, the link gate,
 * and the refusals.
 *
 * ── why the oracle is a RECORDED file and not a live process ──────────
 *
 * Every other differential in this directory runs Node beside the
 * compiled binary and compares. This one cannot, and the reason is the
 * strongest single argument for having vendored the engine at all:
 * `better_sqlite3.node` is ABI-LOCKED. The prebuilt addon reports
 * NODE_MODULE_VERSION 127 and refuses to load on Node 25 (141), which is
 * the Node this repository gates under. A live oracle would be
 * unrunnable exactly where it matters.
 *
 * So `tests/fixtures/sqlite/node-answers.txt` holds what better-sqlite3
 * 13.0.3 printed for `tests/fixtures/sqlite/main.ts` under Node v22.18.0,
 * recorded once. To regenerate it:
 *
 *     npm i better-sqlite3@13.0.3          # under a Node whose ABI it matches
 *     node --experimental-strip-types tests/fixtures/sqlite/main.ts /tmp/x.db
 *
 * A recorded oracle can ROT — the package could change an error string
 * and this file would keep comparing against the old one. So when the
 * running Node CAN load the addon, the live answers are compared against
 * the recording as well, and a divergence fails here rather than silently
 * blessing a stale file. On a Node that cannot load it the check reports
 * that it did not run instead of passing quietly: an inert instrument and
 * a true zero are indistinguishable without an armed control.
 *
 * ── what the fixture covers ───────────────────────────────────────────
 *
 * The cells are chosen the way fetch-static.test.ts chooses its: each one
 * is a way this could be SILENTLY wrong rather than loudly refused.
 *
 *   a JS number bound as an int64      an integral 1 must land in an
 *                                      affinity-free column as REAL —
 *                                      better-sqlite3 binds every number
 *                                      with sqlite3_bind_double, and the
 *                                      obvious "optimisation" diverges
 *   an integer past 2^53 rounded       safeIntegers on and off, over
 *                                      9007199254740993, plus a bigint
 *                                      bound back
 *   a BLOB delivered as something      length, bytes, Buffer.isBuffer and
 *   that is not a Buffer               ArrayBuffer.isView, plus a BLOB
 *                                      inside a PRIMARY KEY
 *   changes() read off the wrong       an upsert that updates rather than
 *   counter                            inserts must report 1, and
 *                                      `select changes()` must agree
 *   a row shape flattened wrongly      pluck / raw / expand, and a mode
 *                                      turned back OFF
 *   an empty result invented           get() with no row is undefined,
 *                                      all() is []
 *   an error swallowed or renamed      ten throw sites: name, code and
 *                                      message for each, including the
 *                                      EXTENDED result code
 *                                      (SQLITE_CONSTRAINT_PRIMARYKEY, not
 *                                      SQLITE_CONSTRAINT) and the
 *                                      "UNIQUE constraint failed: x.id"
 *                                      text a real consumer regex-matches
 *   a second statement silently run    prepare() takes exactly one, but a
 *                                      trailing comment is not a second
 *
 * The LLVM backend is not compared: it refuses the surface by name
 * (`llvm refused: libCall:sqlite.open`) and falls back to C, which the
 * last test asserts is still a REFUSAL and not a miscompile.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, test } from "vitest";
import { compile } from "@scriptc/compiler";
import { exeName } from "./exe.js";

const repoRoot = join(import.meta.dirname, "../..");
const fixtureDir = join(repoRoot, "tests/fixtures/sqlite");
const sanitize = process.env["SCRIPTC_SAN"] === "1";

interface Run {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function run(cmd: string, args: string[], cwd: string): Promise<Run> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`sqlite fixture timed out\nstderr:\n${err}`));
    }, 180_000);
    child.stdout.on("data", (c: Buffer) => (out += c.toString("utf8")));
    child.stderr.on("data", (c: Buffer) => (err += c.toString("utf8")));
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (signal) {
        reject(new Error(`sqlite fixture died to ${signal}\nstdout:\n${out}\nstderr:\n${err}`));
        return;
      }
      resolve({ stdout: out, stderr: err, exitCode: code ?? 0 });
    });
  });
}

/** The tsconfig every program built here compiles against. */
const TSCONFIG = JSON.stringify({
  compilerOptions: {
    strict: true,
    module: "nodenext",
    moduleResolution: "nodenext",
    target: "es2022",
    lib: ["es2023"],
    types: ["node"],
  },
  include: ["*.ts"],
});

/* The PE section table, for the link-gate comparison.
 *
 * A whole-file md5 cannot answer the gate's question on Windows: lld
 * derives the COFF TimeDateStamp and the .buildid CodeView record from a
 * hash of the LINK INPUTS INCLUDING THEIR PATHS, and two programs built
 * from two source files necessarily have different emitted-C paths. Those
 * two fields are metadata about the build; everything else is the
 * program. (Controlled: the same source, the same compiler, and nothing
 * but a different SCRIPTC_CACHE_DIR produces exactly this delta.) */
function peSectionDigests(path: string): Map<string, string> | null {
  const b = readFileSync(path);
  if (b.length < 0x40 || b.readUInt16LE(0) !== 0x5a4d) return null; // not a PE
  const pe = b.readUInt32LE(0x3c);
  const numSec = b.readUInt16LE(pe + 6);
  const optSize = b.readUInt16LE(pe + 20);
  const secOff = pe + 24 + optSize;
  const out = new Map<string, string>();
  for (let i = 0; i < numSec; i++) {
    const o = secOff + i * 40;
    const name = b.toString("latin1", o, o + 8).replace(/\0/g, "");
    if (name === ".buildid") continue;
    const ptr = b.readUInt32LE(o + 20);
    const size = b.readUInt32LE(o + 16);
    out.set(name, createHash("md5").update(b.subarray(ptr, ptr + size)).digest("hex"));
  }
  return out;
}

let workDir = "";
let golden: string[] = [];
/** The live oracle's answers, when this Node can load the addon at all. */
let live: string | null = null;
let liveWhy = "";

beforeAll(async () => {
  workDir = mkdtempSync(join(tmpdir(), "scriptc-sqlite-"));
  writeFileSync(join(workDir, "tsconfig.json"), TSCONFIG);
  golden = readFileSync(join(fixtureDir, "node-answers.txt"), "utf8").split("\n");
  try {
    // Not `import()`: the addon's failure is a LOAD-time throw, and the
    // point is to find out whether it loads at all on this Node.
    const { createRequire } = await import("node:module");
    const require = createRequire(join(repoRoot, "package.json"));
    require.resolve("better-sqlite3");
    const dbPath = join(workDir, "live.db");
    const r = await run(
      process.execPath,
      ["--experimental-strip-types", "--no-warnings", join(fixtureDir, "main.ts"), dbPath],
      workDir,
    );
    if (r.exitCode === 0) live = r.stdout;
    else liveWhy = `the addon is installed but the fixture exited ${r.exitCode}: ${r.stderr.slice(0, 400)}`;
  } catch (e) {
    liveWhy = `better-sqlite3 is not loadable here (${(e as Error).message.split("\n")[0]})`;
  }
}, 600_000);

describe("better-sqlite3 over the vendored SQLite amalgamation", () => {
  test("the recorded Node answers are complete", () => {
    // Without these two a fixture edited down to nothing would report a
    // green three-cell comparison.
    expect(golden.filter((l) => l !== "").length).toBeGreaterThanOrEqual(60);
    expect(golden.filter((l) => l !== "").at(-1)).toBe("END done");
  });

  test("the recording still matches a live better-sqlite3, where one can load", () => {
    if (live === null) {
      // Reported, not passed silently: this file proves less than its
      // header claims on a Node that cannot load the addon.
      console.warn(`[sqlite] the live-oracle self-check did NOT run — ${liveWhy}`);
      expect(liveWhy).not.toBe("");
      return;
    }
    expect(live.split("\n")).toEqual(golden);
  });

  test(
    "every cell of the compiled binary matches the recorded answers",
    async () => {
      const outDir = join(workDir, "c");
      mkdirSync(outDir, { recursive: true });
      const built = await compile(join(fixtureDir, "main.ts"), {
        outPath: join(outDir, exeName("program")),
        outDir,
        backend: "c",
        sanitize,
      });
      expect(
        built.ok,
        "the sqlite fixture must COMPILE — a refusal here is the row this file exists to keep closed:\n" +
          (built.diagnostics ?? []).map((d) => `${d.code}: ${d.message}`).join("\n"),
      ).toBe(true);
      const native = await run(built.binaryPath!, [join(outDir, "fixture.db")], outDir);
      const lines = native.stdout.split("\n");
      const keyOf = (l: string): string => l.split(" ")[0] ?? "";
      for (const line of golden) {
        const key = keyOf(line);
        if (key === "") continue;
        const mine = lines.find((l) => keyOf(l) === key);
        expect(mine, `'${key}' never ran (better-sqlite3 answered: ${line})`).toBeDefined();
        expect(mine, `'${key}' differs from better-sqlite3`).toBe(line);
      }
      expect(native.stdout.split("\n")).toEqual(golden);
      expect(native.exitCode).toBe(0);
    },
    900_000,
  );
});

describe("the link gate", () => {
  /* 269,649 lines of vendored engine link ONLY into binaries that hold a
   * SQLite handle. This is the measurement, not an assertion: three
   * programs, one line apart. */
  test(
    "an unused import costs nothing, and an opened database costs the engine",
    async () => {
      const cases = {
        none: 'console.log("gate");\n',
        unused: 'import Database from "better-sqlite3";\nconsole.log("gate");\n',
        used:
          'import Database from "better-sqlite3";\n' +
          'const db = new Database(":memory:");\nconsole.log("gate");\ndb.close();\n',
      };
      const sizes: Record<string, number> = {};
      const sections: Record<string, Map<string, string> | null> = {};
      for (const [name, src] of Object.entries(cases)) {
        const dir = join(workDir, `gate-${name}`);
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, "tsconfig.json"), TSCONFIG);
        writeFileSync(join(dir, "main.ts"), src);
        const built = await compile(join(dir, "main.ts"), {
          outPath: join(dir, exeName("program")),
          outDir: dir,
          backend: "c",
          sanitize,
        });
        expect(built.ok, `the ${name} gate program must compile`).toBe(true);
        sizes[name] = readFileSync(built.binaryPath!).length;
        sections[name] = peSectionDigests(built.binaryPath!);
      }
      // The gate itself: importing the package without ever making a
      // handle must not link one byte of the engine.
      expect(sizes["unused"]).toBe(sizes["none"]);
      if (sections["none"] !== null && sections["unused"] !== null) {
        expect(
          Object.fromEntries(sections["unused"]!),
          "an unused better-sqlite3 import must produce a byte-identical image",
        ).toEqual(Object.fromEntries(sections["none"]!));
      }
      // ...and opening one must cost real bytes, or the gate is measuring
      // nothing. The engine is ~1.1 MB on this target; the floor is
      // deliberately far below that so a size-class change is not a
      // failure while a MISSING engine is.
      expect(sizes["used"] - sizes["none"]).toBeGreaterThan(600_000);
    },
    900_000,
  );
});

describe("the surface refused by name", () => {
  /* Complete or refuse. Every member below is DECLARED in the shipped
   * types on purpose, so that its refusal names it — an undeclared member
   * would report "property does not exist" and send the reader hunting
   * for a typo in a name that is perfectly real. The failure this guards
   * against is the one measured on this project's npm surface: a partial
   * surface answers `undefined` where Node answers a function, at exit 0
   * with nothing printed. */
  const refused: [string, string][] = [
    ["transaction", "db.transaction(() => 1)"],
    ["function", 'db.function("f", () => 1)'],
    ["aggregate", 'db.aggregate("a", {})'],
    ["table", 'db.table("t", {})'],
    ["backup", 'db.backup("x")'],
    ["serialize", "db.serialize()"],
    ["loadExtension", 'db.loadExtension("x")'],
    ["unsafeMode", "db.unsafeMode()"],
    ["defaultSafeIntegers", "db.defaultSafeIntegers()"],
    ["explain", 'db.explain("select 1")'],
    ["iterate", 'db.prepare("select 1").iterate()'],
    ["bind", 'db.prepare("select 1").bind(1)'],
  ];

  test.each(refused)(
    "%s refuses by name",
    async (member, expr) => {
      const dir = join(workDir, `refuse-${member}`);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "tsconfig.json"), TSCONFIG);
      writeFileSync(
        join(dir, "main.ts"),
        `import Database from "better-sqlite3";\nconst db = new Database(":memory:");\nvoid (${expr});\n`,
      );
      const built = await compile(join(dir, "main.ts"), {
        outPath: join(dir, exeName("program")),
        outDir: dir,
        backend: "c",
        sanitize,
      });
      expect(built.ok, `${member} must NOT compile`).toBe(false);
      const diags = built.diagnostics ?? [];
      const named = diags.find((d) => d.message.includes(member));
      expect(
        named,
        `the refusal must NAME ${member}; got:\n${diags.map((d) => `${d.code}: ${d.message}`).join("\n")}`,
      ).toBeDefined();
      // ...and it must carry the alternative, not just the refusal.
      expect(named!.hint ?? "", `${member}'s refusal must say what to do instead`).not.toBe("");
    },
    900_000,
  );

  test(
    "the two refused constructor options name themselves",
    async () => {
      for (const [option, literal] of [
        ["verbose", "{ verbose: () => {} }"],
        ["nativeBinding", '{ nativeBinding: "x" }'],
      ]) {
        const dir = join(workDir, `refuse-opt-${option}`);
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, "tsconfig.json"), TSCONFIG);
        writeFileSync(
          join(dir, "main.ts"),
          `import Database from "better-sqlite3";\nvoid (new Database(":memory:", ${literal}));\n`,
        );
        const built = await compile(join(dir, "main.ts"), {
          outPath: join(dir, exeName("program")),
          outDir: dir,
          backend: "c",
          sanitize,
        });
        expect(built.ok, `the ${option} option must NOT compile`).toBe(false);
        expect(
          (built.diagnostics ?? []).some((d) => d.message.includes(option)),
          `the refusal must NAME ${option}`,
        ).toBe(true);
      }
    },
    900_000,
  );

  test(
    "a spread argument refuses and names the array form that replaces it",
    async () => {
      const dir = join(workDir, "refuse-spread");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "tsconfig.json"), TSCONFIG);
      writeFileSync(
        join(dir, "main.ts"),
        'import Database from "better-sqlite3";\n' +
          'const db = new Database(":memory:");\n' +
          "const ps: unknown[] = [1];\n" +
          'void (db.prepare("select ?").get(...ps));\n',
      );
      const built = await compile(join(dir, "main.ts"), {
        outPath: join(dir, exeName("program")),
        outDir: dir,
        backend: "c",
        sanitize,
      });
      expect(built.ok).toBe(false);
      const d = (built.diagnostics ?? []).find((x) => x.message.includes("spread"));
      expect(d, "the refusal must name the spread").toBeDefined();
      expect(d!.hint ?? "").toContain("binds an array argument positionally");
    },
    900_000,
  );
});
