/* The record KIND GATE, and the two control dials that price relaxing it.
 *
 * The first statement of every record validator is
 *
 *     if (d->kind != SCR_DYN_OBJ) { scr_dyn_check_fail(path, "object", d); ... }
 *
 * and it is the largest single shape in a compiled program's dyn-check
 * population. It is also, on its face, wrong about JavaScript: `as T` is
 * ERASED, so Node answers a declared member from any receiver that has one --
 * `["a","b","c"] as {length:number}` reads 3 and `"abcd"` reads 4. Over a
 * generated 108-case population (18 receiver kinds x 6 record targets, every
 * expectation taken from running the same file under Node) that one gate
 * accounted for 66 of 96 divergences.
 *
 * Relaxing it can be done in two independent places, and this file exists so
 * that BOTH prices are re-measurable rather than remembered:
 *
 *   SCRIPTC_KINDGATE_WIDE=1   the BUILDER reads the receiver's declared
 *                             members instead of refusing. Monotone for union
 *                             tags (arms are picked by the matcher, so nothing
 *                             about arm selection changes) and it turns 14 of
 *                             the 108 into Node's own answer. It is still OFF,
 *                             and the reason is MATERIALIZATION: a checked
 *                             record cast copies the declared members into a C
 *                             struct and drops the receiver, so a widened
 *                             array answers its `length` right and then
 *                             answers Array.isArray, typeof, String() and
 *                             JSON.stringify wrong. Over a generated 35-case
 *                             surface population: 25 loud refusals become 9
 *                             correct answers and 11 NEW SILENT divergences.
 *
 *   SCRIPTC_KINDGATE_MATCH=1  the MATCHER is widened too, which is the change
 *                             the union hazard is about: over a generated
 *                             66-case union population it moves 26 answers and
 *                             makes 4 of them silently wrong -- a string
 *                             coming back tagged as the record arm of
 *                             `{length:number} | string`. tests/corpus/5270 is
 *                             the differential guard for exactly those two.
 *
 * The hazard this file is armed against is the one a probe always has: a dial
 * that is "off" but still moves a byte. Both dials must emit NOTHING when
 * unset, and that is asserted as the absence of every symbol they can
 * introduce rather than of one marker.
 */
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { compile } from "../src/index.js";

/* A record target with two declared fields, a second shape sharing one of
 * them, a TUPLE, an INDEX-SIGNATURE shape and a UNION carrying a record arm
 * beside an array arm -- every shape whose wide-lane eligibility differs. A
 * program with no record check would make every assertion below vacuous, so
 * the statement count is asserted non-trivial first. */
const PROGRAM = [
  `type Rec = { name: string; n: number };`,
  `type Len = { length: number };`,
  `type Tup = [string, number];`,
  `type Idx = { [k: string]: string };`,
  `type U = Len | string[];`,
  `function hide(v: unknown): unknown {`,
  `  const box: unknown[] = [v];`,
  `  return box[box.length - 1];`,
  `}`,
  `function main(): void {`,
  `  const r = JSON.parse('{"name":"a","n":1}') as Rec;`,
  `  console.log(r.name, r.n);`,
  `  const l = JSON.parse('{"length":3}') as Len;`,
  `  console.log(l.length);`,
  `  const t = JSON.parse('["x",2]') as Tup;`,
  `  console.log(t[0], t[1]);`,
  `  const i = JSON.parse('{"a":"b"}') as Idx;`,
  `  console.log(i["a"]);`,
  `  const u = hide(["p", "q"]) as U;`,
  `  console.log(Array.isArray(u) ? "array" : "record");`,
  `}`,
  `main();`,
  `export {};`,
  ``,
].join("\n");

const FAIL = /\bscr_dyn_check_fail\s*\(/g;
/* The record kind gate, as the emitter writes it. Anchored on the whole
 * statement rather than on `SCR_DYN_OBJ`, which the matchers, the tuple arm
 * and the %Error leaf also spell. */
const GATE =
  /if \(d->kind != SCR_DYN_OBJ\) \{ scr_dyn_check_fail\(path, "[^"]*", d\); return NULL; \}/g;

/** How many ARM-walker BODIES contain `needle`.
 *
 * Reading the whole file for `sc_da_` would count prototypes and call sites,
 * which is how an instrument reports a clean sweep it never took. This walks
 * definition headers only -- `static <T> sc_da_<n>(const ScrDyn *d, const
 * ScrDynPath *path, bool *ok) {` at column 0 -- and takes each body up to the
 * next `\n}` at column 0, which is how emit-walkers.ts closes every one. */
function armBodiesContaining(tu: string, needle: string): number {
  const header = /^static [^\n]*?\bsc_da_\d+\(const ScrDyn \*d, const ScrDynPath \*path, bool \*ok\) \{/gm;
  let n = 0;
  let m: RegExpExecArray | null;
  while ((m = header.exec(tu)) !== null) {
    const end = tu.indexOf("\n}\n", m.index);
    const body = tu.slice(m.index, end < 0 ? tu.length : end);
    if (body.includes(needle)) n++;
  }
  return n;
}

interface Dials {
  wide?: boolean;
  match?: boolean;
}

let dir: string | undefined;
async function emit(d: Dials): Promise<string> {
  dir ??= await mkdtemp(join(tmpdir(), "scriptc-kindgate-"));
  const tag = `${d.wide === true ? "w" : "n"}${d.match === true ? "m" : "n"}`;
  const src = join(dir, `main-${tag}.ts`);
  await writeFile(src, PROGRAM, "utf8");
  const hadW = process.env["SCRIPTC_KINDGATE_WIDE"];
  const hadM = process.env["SCRIPTC_KINDGATE_MATCH"];
  if (d.wide === true) process.env["SCRIPTC_KINDGATE_WIDE"] = "1";
  else delete process.env["SCRIPTC_KINDGATE_WIDE"];
  if (d.match === true) process.env["SCRIPTC_KINDGATE_MATCH"] = "1";
  else delete process.env["SCRIPTC_KINDGATE_MATCH"];
  try {
    const res = await compile(src, {
      outPath: join(dir, `program-${tag}`),
      outDir: dir,
      backend: "c",
      emitOnly: true,
    });
    if (!res.ok) {
      throw new Error(`the dial program did not compile: ${res.diagnostics[0]?.message ?? "?"}`);
    }
    return await readFile(res.cPath, "utf8");
  } finally {
    if (hadW === undefined) delete process.env["SCRIPTC_KINDGATE_WIDE"];
    else process.env["SCRIPTC_KINDGATE_WIDE"] = hadW;
    if (hadM === undefined) delete process.env["SCRIPTC_KINDGATE_MATCH"];
    else process.env["SCRIPTC_KINDGATE_MATCH"] = hadM;
  }
}

let cached: Promise<{ off: string; wide: string; match: string }> | undefined;
function all(): Promise<{ off: string; wide: string; match: string }> {
  return (cached ??= (async () => ({
    off: await emit({}),
    wide: await emit({ wide: true }),
    match: await emit({ match: true }),
  }))());
}

afterAll(() => {
  delete process.env["SCRIPTC_KINDGATE_WIDE"];
  delete process.env["SCRIPTC_KINDGATE_MATCH"];
});

describe("the record kind gate and its two control dials", () => {
  test("the program really does plant record checks -- nothing below is vacuous", async () => {
    const { off } = await all();
    expect((off.match(FAIL) ?? []).length).toBeGreaterThanOrEqual(8);
    expect((off.match(GATE) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  test("BOTH DIALS OFF is the default, and the default is what ships", async () => {
    /* Read as: with neither variable set the emitter writes the file it wrote
     * before this change existed. Asserted as absence of every symbol the
     * dials can introduce, not as absence of one marker. */
    const { off } = await all();
    expect(off).not.toContain("sc_dyn_rec_wide");
    expect(off).not.toContain("sc_dyn_rec_wideable");
    expect(off).not.toContain("sc_kgk_");
    expect(off).not.toContain("sc_kgl_");
    expect(off).not.toContain("SCRIPTC_KINDGATE_MATCH control");
  });

  test("WIDE keeps the kind-gate STATEMENT: the census counts what it counted", async () => {
    const { off, wide } = await all();
    /* The point that decides whether either dial could ever ship: widening is
     * not a deletion. Every scr_dyn_check_fail the census counts is still
     * there -- the refusal moved behind a second test, it did not go away.
     *
     * ANCHOR, with its attribution. This program plants 11 of them on
     * `f0bc798d`; it planted 11 on `66faa36b` too, because `matcherbuild`'s
     * merge removes the statements of validators reached ONLY through a union
     * arm and this program reaches every one of its targets directly as well.
     * The number that DID move with that merge is zapo's: DYNCHECK 3 024 ->
     * 1 355 (estado-matcherbuild.md section 6), and the widening leaves THAT
     * unchanged too -- measured at 1 355 on both sides of the dial in
     * estado-kindgate.md. The absolute is pinned here so that a future change
     * which deletes checks and a future change which merely renumbers them
     * cannot both slip through the relative test above. */
    expect((off.match(FAIL) ?? []).length).toBe(11);
    expect((wide.match(FAIL) ?? []).length).toBe((off.match(FAIL) ?? []).length);
    expect(wide).toContain("sc_dyn_rec_wideable(d)");
    expect(wide).toContain("static ScrDyn *sc_dyn_rec_wide(");
    expect(wide.length).toBeGreaterThan(off.length);
  });

  test("WIDE reads members through the SAME [[Get]] the JS lane's d[k] takes", async () => {
    /* Not a stylistic preference: two independently written reads are how the
     * matcher and the builder drifted apart over accessors once already. The
     * wide lane calls sc_dyn_key_get, so a widened cast cannot answer a member
     * differently from a plain property read of the same value. */
    const { wide } = await all();
    expect(wide).toMatch(/sc_dyn_rec_wide\([\s\S]{0,400}?sc_dyn_key_get\(/);
  });

  test("WIDE leaves TUPLE and INDEX-SIGNATURE shapes on the narrow gate", async () => {
    /* A tuple wants an array of an exact arity, and an index-signature shape
     * CAPTURES the receiver's undeclared keys -- a projection carrying only
     * the declared ones would answer an empty overflow map where Node has the
     * array's own indices, which is a silent wrong answer and not a widening.
     * Both keep refusing, and this is where that is written down. */
    const { wide } = await all();
    expect(wide).toContain("if (d->kind != SCR_DYN_ARR) {");
    expect((wide.match(GATE) ?? []).length).toBeGreaterThanOrEqual(1);
  });

  /* THE ASSERTION THIS FILE EXISTS FOR, since `block/matcherbuild` merged the
   * matcher into the builder.
   *
   * On the old shape the two questions were two emitted functions -- `sc_dm_`
   * decided a union arm, `sc_dc_` built it -- so editing the builder's kind
   * gate could not reach arm selection at all; widening it was monotone by
   * construction and that was the premise of estado-kindgate.md.
   *
   * On the merged shape BOTH come out of one body generator and the only thing
   * separating them is its `soft` parameter. The premise still holds, but it
   * is now a boolean instead of a boundary, and the DEFAULT of a careless edit
   * has inverted: touching the gate reaches the arm walker unless it says not
   * to. These two tests are what hold that line. If they ever both pass with
   * the same emitted text, the separation is gone and the union-tag argument
   * in estado-kindgate.md is void. */
  test("the ARM-BODY scanner is not vacuous: it finds arm walkers to look inside", async () => {
    /* The two tests below are each other's control -- if the scanner counted
     * nothing at all, the WIDE assertion would pass for the wrong reason and
     * the MATCH one would fail. This makes that explicit rather than lucky:
     * the program emits arm walkers, and the scanner sees them. */
    const { off, wide, match } = await all();
    for (const [tag, tu] of [["off", off], ["wide", wide], ["match", match]] as const) {
      expect(
        armBodiesContaining(tu, "const ScrDyn *d"),
        `${tag}: the scanner found no sc_da_ bodies at all`,
      ).toBeGreaterThanOrEqual(3);
    }
    /* and it separates bodies from prototypes and call sites: the file
     * mentions sc_da_ far more often than it defines one. */
    expect((off.match(/sc_da_\d+/g) ?? []).length).toBeGreaterThan(
      armBodiesContaining(off, "const ScrDyn *d"),
    );
  });

  test("WIDE does NOT reach the ARM walker -- arm selection is untouched", async () => {
    const { wide } = await all();
    /* Every wide lane in the WIDE build sits in a HARD body (sc_dc_ / the
     * entry walker), never in a soft one. Read the bodies rather than the
     * file: `sc_da_` is also the name of a prototype and of call sites. */
    expect(armBodiesContaining(wide, "sc_dyn_rec_wideable(d)")).toBe(0);
    expect((wide.match(/sc_dyn_rec_wideable\(d\)/g) ?? []).length).toBeGreaterThanOrEqual(1);
    /* and the soft refusal spelling never appears beside the gate */
    expect(wide).not.toMatch(/sc_dyn_rec_wideable\(d\)\) \{ \*ok = false;/);
  });

  test("MATCH is the CONTROL: it DOES reach the arm walker, and implies WIDE", async () => {
    const { off, wide, match } = await all();
    /* This is the change that manufactures a silently wrong union tag: with it
     * on, `"abcd"` fits the `{length:number}` arm of `{length:number} | string`
     * and the union wears the record tag. Measured at 4 silent tags over a
     * generated 66-case union population, on this exact shape.
     * tests/corpus/5270 is the differential guard for two of them. */
    expect(armBodiesContaining(match, "sc_dyn_rec_wideable(d)")).toBeGreaterThanOrEqual(1);
    expect(match).toMatch(/sc_dyn_rec_wideable\(d\)\) \{ \*ok = false;/);
    /* it implies WIDE: the hard lanes are all still there */
    expect(match).toContain("static ScrDyn *sc_dyn_rec_wide(");
    expect(match.length).toBeGreaterThan(wide.length);
    /* and it still deletes no census statement */
    expect((match.match(FAIL) ?? []).length).toBe((off.match(FAIL) ?? []).length);
  });

  test("the three lanes are three DIFFERENT files -- the dials are not no-ops", async () => {
    const { off, wide, match } = await all();
    expect(wide).not.toBe(off);
    expect(match).not.toBe(off);
    expect(match).not.toBe(wide);
  });
});
