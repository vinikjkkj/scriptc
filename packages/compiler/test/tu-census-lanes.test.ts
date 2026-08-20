/* The census reads BOTH lanes, and the two lanes agree.
 *
 * scripts/tu-census.mjs is this project's one instrument for "what can this
 * compiled program still refuse, abort or fence at run time". It was written
 * against the C translation unit, and it took `<tu.c>`. That is not the lane
 * the compiler ships: index.ts initialises `backend = "c"` and then the very
 * next statement is `if (opts.backend !== "c")`, which emits the .ll first and
 * falls back to C only on an LlvmUnsupportedError TIER refusal. Fed the .ll,
 * the census exited through `*** CENSUS FAILED ***` with 97 unclassified rows
 * — which reads exactly like a compiler regression and is really a wrong-lane
 * instrument. Every headline this board carries was therefore measured on a TU
 * built with an explicit `--backend c` in order to census it.
 *
 * So this file arms the census on BOTH lanes to the standard the C reader was
 * armed to, and adds the check the C arming could not make: that the two lanes
 * READ THE SAME. The plants are the seven the C census was armed with (one per
 * category, plus the negative control), compiled twice each.
 *
 * (A note for whoever copies this setup: the five other test files that hand
 * compile() an `emitOnly: true` are passing an option CompileOptions does not
 * declare and index.ts never reads — every one of them links a binary it
 * believes it does not. Measured, not inferred: a one-line program compiled
 * with `emitOnly: true` leaves the executable and its .pdb in the out dir.
 * This file does not repeat the claim.)
 *
 * The three directions, in the order they matter:
 *
 *  1. ARMING — every planted category is SEEN on both lanes, and leaks into no
 *     other one. A census nobody has shown a planted instance to has never
 *     been shown to see anything, and one block's instrument self-tested green
 *     and then scored zero on a TU whose contents it had read with its own
 *     eyes, because a greedy identifier class backtracked one byte.
 *  2. AGREEMENT — the seven categories, row for row, on the same program at
 *     the same revision. Where they differ, the difference is a property of
 *     the EMITTER (the .ll interns its message strings, and its keyed-read
 *     abort is one shared helper against the C emitter's one per result type),
 *     never of the program — so the counts asserted here are the ones that
 *     must not drift, and the two known emitter differences are asserted
 *     explicitly rather than smoothed over.
 *  3. SILENT FAILURE — an unreadable TU, an empty TU, an unknown message and a
 *     WRONG-LANE file must every one of them exit non-zero. A census that
 *     cannot say "I did not understand this" reads it as zero.
 */
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, test } from "vitest";
import { compile } from "../src/index.js";

const repoRoot = join(import.meta.dirname, "../../..");
const CENSUS = join(repoRoot, "scripts/tu-census.mjs");

type Cat =
  | "REFUSAL.tagged"
  | "REFUSAL.untagged"
  | "REFUSAL.uncoded"
  | "ABORT.real"
  | "ABORT.structural"
  | "BOILERPLATE"
  | "PARITY";

const CATS: readonly Cat[] = [
  "REFUSAL.tagged",
  "REFUSAL.untagged",
  "REFUSAL.uncoded",
  "ABORT.real",
  "ABORT.structural",
  "BOILERPLATE",
  "PARITY",
];

/* The plants. Each is the smallest program this project knows that reaches one
 * emitter, and each was read out of the C census's own arming set so the two
 * armings are comparable. `want` is a LOWER bound (>= the planted count) and
 * `never` is exact-zero: an emitter that leaks a category into a plant that
 * does not contain it is a classifier bug, not a finding. ABORT.structural is
 * exempt from `never` because the OOM guard and the union-tag default ride
 * along with any record or union and are nobody's plant. */
const PLANTS: readonly {
  name: string;
  ext: "ts" | "js";
  want: Partial<Record<Cat, number>>;
  what: string;
  src: string;
}[] = [
  {
    name: "a0-clean",
    ext: "ts",
    want: {},
    what: "the NEGATIVE control: nothing in here refuses, aborts or fences",
    src: [
      "function add(a: number, b: number): number { return a + b; }",
      "console.log(add(2, 3));",
      "",
    ].join("\n"),
  },
  {
    name: "a1-tagged",
    ext: "ts",
    want: { "REFUSAL.tagged": 1 },
    what: "a refusal whose message carries [SCxxxx at file:line]",
    src: [
      "const a: unknown = \"1\";",
      "const b: unknown = 1;",
      "if ((a as any) == (b as any)) console.log(\"eq\"); else console.log(\"ne\");",
      "",
    ].join("\n"),
  },
  {
    name: "a2-untagged",
    ext: "ts",
    want: { "REFUSAL.untagged": 1 },
    what: "fenceClosureProbe: an unlowerable method emitted as a VALUE in an object literal (zapo's own construct)",
    src: [
      "import { EventEmitter } from \"node:events\";",
      "interface Deps { emitEvent: (name: string, ...args: unknown[]) => boolean }",
      "class C extends EventEmitter {",
      "  readonly deps: Deps;",
      "  constructor() { super(); this.deps = { emitEvent: this.emit.bind(this) }; }",
      "}",
      "const c = new C();",
      "console.log(typeof c.deps.emitEvent);",
      "",
    ].join("\n"),
  },
  {
    name: "a3-stranded",
    ext: "ts",
    want: { "REFUSAL.untagged": 1 },
    what: "a stranded dyn func thunk (SC2009, coded and BRACKETLESS: the box is interned per SIGNATURE, so it has no one source location)",
    src: [
      "interface Api { load: (p: Promise<number>) => void }",
      "const api: Api = { load: (p: Promise<number>) => { void p; } };",
      "const u: unknown = api;",
      "console.log(typeof u);",
      "",
    ].join("\n"),
  },
  {
    name: "a4-abort",
    ext: "ts",
    want: { "ABORT.real": 1, "ABORT.structural": 1 },
    what: "an index-signature keyed read whose miss cannot be represented, flowing into a bare `string` parameter (uncatchable), and an OOM guard",
    // TWO reads of the SAME result type, on purpose. Both emitters lift the
    // keyed read into ONE shared helper -- `sc_rkg_N` per result type on the C
    // lane, the single `sc_bad_key` on the LLVM one -- so this plant is one
    // ABORT.real STATEMENT and TWO ways to die on both lanes, and the shared-
    // helper correction is what has to find the second one. With a single read
    // the correction is unobservable and removing it entirely still passes.
    src: [
      "function need(s: string): string { return s.toUpperCase(); }",
      "const bag: Record<string, string> = { present: \"yes\" };",
      "const key = process.argv[2] ?? \"absent\";",
      "const other = process.argv[3] ?? \"absent2\";",
      "console.log(need(bag[key]));",
      "console.log(need(bag[other]));",
      "",
    ].join("\n"),
  },
  {
    name: "a5-boilerplate",
    ext: "ts",
    want: { BOILERPLATE: 2 },
    what: "two SC9002 fall-through guards - boilerplate, NOT refusals",
    src: [
      "function pick(x: number): string {",
      "  switch (x) {",
      "    case 1: return \"one\";",
      "    case 2: return \"two\";",
      "    default: return \"many\";",
      "  }",
      "}",
      "function spin(x: number): string {",
      "  while (true) { if (x > 0) return \"pos\"; x += 1; }",
      "}",
      "console.log(pick(1) + spin(1));",
      "",
    ].join("\n"),
  },
  {
    // tests/corpus/5510: the fixture the DIFFERENTIAL oracle also validates.
    // The plants above are compiled-only; this one is a corpus program, so the
    // corpus suite proves it runs exactly like Node while this file proves the
    // two lanes read the same population out of it. `// @deferred-fences: 1`
    // on its first line is the corpus contract for the one planted refusal.
    name: "a7-corpus5510",
    ext: "js",
    want: { "REFUSAL.tagged": 1, "ABORT.structural": 1, BOILERPLATE: 1 },
    what: "corpus 5510: one deferred fence, one SC9002 fall-through and one OOM guard, all on paths the program never takes",
    src: readFileSync(
      join(repoRoot, "tests/corpus/5510-a-census-population-on-untaken-paths.js"),
      "utf8",
    ),
  },
  {
    name: "a6-parity",
    ext: "js",
    want: { PARITY: 1 },
    what: "SC1031 destructuring a null match - Node throws a TypeError here too; correct, and not a refusal",
    src: [
      "const m = \"abc\".match(/b/);",
      "const [x] = m;",
      "console.log(x);",
      "",
    ].join("\n"),
  },
];

interface CensusJson {
  file: string;
  lane: "c" | "llvm";
  bytes: number;
  statements: number;
  byCat: Partial<Record<string, number>>;
  waysByCat: Partial<Record<string, number>>;
  ctx: Record<string, number>;
  rows: { line: number; cat: string; code: string; site: string; host: string | null; ways: number; msg: string }[];
}

function runCensus(tu: string, jsonOut?: string): { rc: number; out: string } {
  const args = [CENSUS, tu, "--quiet", ...(jsonOut === undefined ? [] : ["--json", jsonOut])];
  try {
    return { rc: 0, out: execFileSync(process.execPath, args, { encoding: "utf8", maxBuffer: 1 << 28 }) };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; status?: number };
    return { rc: err.status ?? -1, out: (err.stdout ?? "") + (err.stderr ?? "") };
  }
}

/** The census of one TU. `data` is null when the census produced no JSON at
 * all, which is a different failure from "the census read zero". */
function censusOf(tu: string): { rc: number; out: string; data: CensusJson | null } {
  const j = `${tu}.census.json`;
  const r = runCensus(tu, j);
  return { ...r, data: existsSync(j) ? (JSON.parse(readFileSync(j, "utf8")) as CensusJson) : null };
}

const cat = (d: CensusJson | null, c: Cat): number => d?.byCat[c] ?? 0;

let LAB = "";
const TU = new Map<string, string>();            // `${plant}:${lane}` -> path
const CEN = new Map<string, CensusJson | null>(); // same key -> census

beforeAll(async () => {
  LAB = await mkdtemp(join(tmpdir(), "scriptc-census-lanes-"));
  for (const p of PLANTS) {
    for (const backend of ["c", "llvm"] as const) {
      const dir = join(LAB, `${p.name}-${backend}`);
      const src = join(dir, `${p.name}.${p.ext}`);
      await mkdtempInto(dir);
      await writeFile(src, p.src, "utf8");
      const res = await compile(src, {
        outPath: join(dir, "program"),
        outDir: dir,
        backend,
        // the plants are deliberately unlowerable in one spot each; without
        // this the refusal is a compile ERROR and there is no TU to census
        bestEffort: true,
      });
      if (!res.ok) {
        throw new Error(
          `${p.name} refused on the ${backend} lane: ${res.diagnostics[0]?.code ?? "?"} ${res.diagnostics[0]?.message?.slice(0, 160) ?? "?"}`,
        );
      }
      // `backend` is the code generator that ACTUALLY emitted the TU; an
      // explicit pin must never silently produce the other lane's file.
      expect(res.backend, `${p.name}: asked for ${backend}, got ${res.backend}`).toBe(backend);
      expect(res.cPath.endsWith(backend === "llvm" ? ".ll" : ".c")).toBe(true);
      TU.set(`${p.name}:${backend}`, res.cPath);
      CEN.set(`${p.name}:${backend}`, censusOf(res.cPath).data);
    }
  }
}, 900_000);

async function mkdtempInto(dir: string): Promise<void> {
  const { mkdir } = await import("node:fs/promises");
  await mkdir(dir, { recursive: true });
}

describe("the census reads the LLVM lane", () => {
  test("every plant really did build on both lanes, and neither TU is empty", () => {
    for (const p of PLANTS) {
      for (const backend of ["c", "llvm"] as const) {
        const tu = TU.get(`${p.name}:${backend}`);
        expect(tu, `${p.name}:${backend}: no TU`).toBeDefined();
        // an empty file reads exactly like a clean one, and this project has
        // published IDENTICAL over two empty files three times
        expect(readFileSync(tu!).length, `${p.name}:${backend}: implausibly small TU`).toBeGreaterThan(400);
      }
    }
  });

  test("the census names the lane it read, and the lane is the one that emitted the TU", () => {
    for (const p of PLANTS) {
      expect(CEN.get(`${p.name}:c`)?.lane, `${p.name}: C TU`).toBe("c");
      expect(CEN.get(`${p.name}:llvm`)?.lane, `${p.name}: LLVM TU`).toBe("llvm");
    }
  });

  test("the NEGATIVE control reads zero in every category, on BOTH lanes", () => {
    for (const backend of ["c", "llvm"] as const) {
      const d = CEN.get(`a0-clean:${backend}`);
      expect(d, `a0-clean:${backend}: no census json`).not.toBeNull();
      for (const c of CATS) {
        expect(cat(d!, c), `a0-clean:${backend} reports ${cat(d!, c)} in ${c}`).toBe(0);
      }
    }
  });

  test("every planted category is SEEN on both lanes and leaks into no other", () => {
    for (const p of PLANTS) {
      if (p.name === "a0-clean") continue;
      for (const backend of ["c", "llvm"] as const) {
        const d = CEN.get(`${p.name}:${backend}`);
        expect(d, `${p.name}:${backend}: no census json`).not.toBeNull();
        for (const c of CATS) {
          const want = p.want[c] ?? 0;
          const got = cat(d!, c);
          if (want > 0) {
            expect(got, `${p.name}:${backend}: the census DID NOT SEE the planted ${c} (${p.what})`).toBeGreaterThanOrEqual(want);
          } else if (c !== "ABORT.structural") {
            expect(got, `${p.name}:${backend}: the classifier leaks ${got} into ${c}, which this plant does not contain`).toBe(0);
          }
        }
      }
    }
  });

  test("the two lanes read the SAME seven categories, plant for plant", () => {
    const disagree: string[] = [];
    for (const p of PLANTS) {
      for (const c of CATS) {
        const a = cat(CEN.get(`${p.name}:c`)!, c);
        const b = cat(CEN.get(`${p.name}:llvm`)!, c);
        if (a !== b) disagree.push(`${p.name} ${c}: c=${a} llvm=${b}`);
      }
    }
    expect(disagree, "the lanes disagree about what the SAME program can do at run time").toEqual([]);
  });

  test("the two lanes agree on WAYS TO DIE too, not just on statements", () => {
    // The statement count is the emitter's unit; the ways-to-die count is the
    // program's. They can only agree if the shared-helper correction found the
    // right helper family on each lane -- `sc_rkg_N` on the C side against the
    // single `sc_bad_key` on the LLVM one.
    const disagree: string[] = [];
    for (const p of PLANTS) {
      for (const c of CATS) {
        const a = CEN.get(`${p.name}:c`)?.waysByCat[c] ?? 0;
        const b = CEN.get(`${p.name}:llvm`)?.waysByCat[c] ?? 0;
        if (a !== b) disagree.push(`${p.name} ${c}: c=${a} llvm=${b}`);
      }
    }
    expect(disagree).toEqual([]);
  });

  test("the context populations agree: a runtime PROTOTYPE in the .ll is not a call", () => {
    // `declare void @scr_throw_obj(ptr, ptr, ptr, ptr)` mentions the symbol
    // exactly the way a call does, and the first version of this reader
    // counted it -- a4-abort read USERTHROW 3 against the C lane's 2.
    const disagree: string[] = [];
    for (const p of PLANTS) {
      const a = CEN.get(`${p.name}:c`)?.ctx ?? {};
      const b = CEN.get(`${p.name}:llvm`)?.ctx ?? {};
      for (const k of Object.keys(a)) {
        if (a[k] !== b[k]) disagree.push(`${p.name} ${k}: c=${a[k]} llvm=${b[k]}`);
      }
    }
    expect(disagree).toEqual([]);
  });

  test("the corpus fixture's population is EXACTLY what its header declares, on both lanes", () => {
    // Not >= this time: the corpus file is a fixture whose whole point is a
    // known population, and a plant that has quietly grown a second refusal is
    // a corpus program that no longer says what it says it says.
    for (const backend of ["c", "llvm"] as const) {
      const d = CEN.get(`a7-corpus5510:${backend}`);
      expect(d, `corpus 5510 on ${backend}: no census json`).not.toBeNull();
      expect(
        Object.fromEntries(CATS.map((c) => [c, cat(d!, c)])),
        `corpus 5510 on the ${backend} lane`,
      ).toEqual({
        "REFUSAL.tagged": 1,
        "REFUSAL.untagged": 0,
        "REFUSAL.uncoded": 0,
        "ABORT.real": 0,
        "ABORT.structural": 1,
        BOILERPLATE: 1,
        PARITY: 0,
      });
    }
  });

  test("the emitter differences the lanes DO have are the two known ones", () => {
    // (1) the .ll interns its message strings, so the bracket census.mjs
    //     counts is one per DISTINCT message and not one per throw;
    // (2) the .ll's keyed-read abort is ONE shared sc_bad_key helper carrying
    //     a fixed message, where the C emitter emits one sc_rkg_N per result
    //     type whose scr_trap_fmt template names the typed slot.
    // Both are properties of the emitter. Neither changes what the program can
    // do, which is what the two tests above assert.
    const ll = readFileSync(TU.get("a4-abort:llvm")!, "latin1");
    const c = readFileSync(TU.get("a4-abort:c")!, "latin1");
    expect(ll).toContain("define internal void @sc_bad_key()");
    expect(ll).not.toContain("scr_trap_fmt");
    expect(c).toContain("scr_trap_fmt");
    // and the tagged plant's message really does ride a pointer on the .ll
    const a1 = readFileSync(TU.get("a1-tagged:llvm")!, "latin1");
    expect(a1).toMatch(/call void @scr_throw_error_msg_code\(i32 -?\d+, ptr @[A-Za-z0-9_.$]+, i64 \d+, ptr @[A-Za-z0-9_.$]+\)/);
    expect(a1).toMatch(/^@[A-Za-z0-9_.$]+ = internal constant \[\d+ x i8\] c".*\[SC\d{4} at /m);
  });
});

describe("the census cannot report a failure it did not understand as zero", () => {
  test("an UNKNOWN trap message exits non-zero on the LLVM lane", () => {
    const src = readFileSync(TU.get("a4-abort:llvm")!, "latin1");
    const before = "scriptc: out of memory";
    expect(src, "no OOM message to mutate").toContain(before);
    const mutant = join(LAB, "mutant-unknown.ll");
    writeFileSync(mutant, src.replace(before, "scriptc: a failure mode invented by this test"), "latin1");
    expect(runCensus(mutant).rc, "the census accepted an unknown trap message with exit 0").not.toBe(0);
  });

  test("a message POINTER with no table entry exits non-zero", () => {
    // the direction that is unique to the .ll: the call is well formed and the
    // message it names does not exist, which must not read as an empty message
    const src = readFileSync(TU.get("a1-tagged:llvm")!, "latin1");
    const m = /call void @scr_throw_error_msg_code\(i32 (-?\d+), ptr (@[A-Za-z0-9_.$]+),/.exec(src);
    expect(m, "no coded throw to repoint").not.toBeNull();
    const mutant = join(LAB, "mutant-ptr.ll");
    writeFileSync(
      mutant,
      src.replace(m![0], m![0].replace(m![2], "@sc_cs_no_such_symbol")),
      "latin1",
    );
    expect(runCensus(mutant).rc, "an unresolvable message pointer passed as a classified row").not.toBe(0);
  });

  test("a FAMILY the .ll reader does not know is not silence", () => {
    // scr_trap_fmt is the C lane's formatted trap (the per-result-type
    // keyed-read template) and the LLVM lane has never emitted one. If it ever
    // grows one, the reader would drop the whole family without a word, so it
    // checks for the symbol rather than trusting that it stays absent.
    const src = readFileSync(TU.get("a4-abort:llvm")!, "latin1");
    const mutant = join(LAB, "mutant-trapfmt.ll");
    const site = "  call void @scr_trap(ptr @sc_oom_msg)";
    expect(src, "no trap call to plant beside").toContain(site);
    writeFileSync(mutant, src.replace(site, `  call void @scr_trap_fmt(ptr @sc_oom_msg)\n${site}`), "latin1");
    expect(runCensus(mutant).rc, "an unhandled trap family passed as zero").not.toBe(0);
  });

  test("an EMPTY .ll is not clean", () => {
    const empty = join(LAB, "empty.ll");
    writeFileSync(empty, "", "latin1");
    expect(runCensus(empty).rc, "the census called an EMPTY .ll clean").not.toBe(0);
  });

  test("a [SCxxxx at ...] outside a coded throw breaks the identity census.mjs rests on", () => {
    const src = readFileSync(TU.get("a4-abort:llvm")!, "latin1");
    const planted = join(LAB, "bracket.ll");
    writeFileSync(planted, `${src}\n; [SC9999 at nowhere.ts:1]\n`, "latin1");
    expect(runCensus(planted).rc, "a bracket outside a fence throw passed unnoticed").not.toBe(0);
  });

  test("a WRONG-LANE file is refused by NAME, not misread", () => {
    // this is the accident the whole change exists to make impossible: the .ll
    // fed to the C reader used to exit with 97 unclassified rows, which reads
    // like a compiler regression and is really a wrong-lane instrument
    const llAsC = join(LAB, "wrong-lane.c");
    writeFileSync(llAsC, readFileSync(TU.get("a4-abort:llvm")!));
    const a = runCensus(llAsC);
    expect(a.rc, "an .ll named .c was read as C").toBe(4);
    expect(a.out).toContain("its CONTENT is the llvm lane");

    const cAsLl = join(LAB, "wrong-lane.ll");
    writeFileSync(cAsLl, readFileSync(TU.get("a4-abort:c")!));
    const b = runCensus(cAsLl);
    expect(b.rc, "a .c named .ll was read as IR").toBe(4);
    expect(b.out).toContain("its CONTENT is the c lane");
  });
});
