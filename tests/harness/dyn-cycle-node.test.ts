/* A dyn value is a cycle-collector NODE, and both tables that decide
 * whether its edges are visible have to say so.
 *
 * `ScrDyn` used to be plain `calloc`'d, so every reference edge out of a
 * dyn value was invisible to trial deletion. `scr_runtime.h` called that a
 * "documented divergence — a cycle THROUGH a dyn-boxed function is merely
 * never collected", but the checked-dynamic tree is how a compiled program
 * represents every JS-shaped object graph — members, [[Prototype]] links,
 * accessor descriptor tables and any `unknown`-typed field — so one
 * back-link through a dyn object pinned the whole graph reachable from it.
 * Measured on zapo: 8020 closures and 36990 dyn values live at exit, of
 * which 5840 closures were one library's oneof accessor pair.
 *
 * The runtime half is `scr_dyn_trace` / `scr_dyn_gcfree`. The emitter half
 * is TWO tables, and the second is the one that bites:
 *
 *   traceAdapterC   which trace symbol a dyn field/element/value stores.
 *   cycleCapable    whether the SHAPE holding it gets a header at all.
 *
 * With only the first, a shape whose sole cycle-capable field is `unknown`
 * still falls out of the fixpoint's traced set, is plain `calloc`'d, and
 * its ring stays invisible — not because an edge is untraced but because
 * the NODE is not a node. Twelve of zapo's 2120 shapes were in that state.
 *
 * There is no OUTPUT to test: a leak prints nothing on either side, and
 * this program's stdout is identical before and after. The emitted
 * artifact is the artifact, so it is what this greps — deadstrip.test.ts's
 * and dyn-adapter-cycle.test.ts's stance. Behaviour is covered by the
 * corpus differential lane under `SCRIPTC_RC_AUDIT=1`, where a leaked
 * graph exits 99 against Node's 0.
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { compile } from "@scriptc/compiler";

const repoRoot = join(import.meta.dirname, "../..");
const cacheDir = join(repoRoot, "node_modules/.cache/scriptc-tests");

/* `Owner`'s only reference fields are one `unknown` and one string, so the
 * fixpoint's dyn row is the ONLY thing that can make it cycle-capable. The
 * ring is Owner -> bag (a FUNC dyn) -> the arrow's closure -> the arrow's
 * capture box -> Owner, and every edge of it has to be visible for the
 * ring to collect. `held` adds the second population: an `unknown`-typed
 * LOCAL captured by a closure, which rides a dyn capture box. */
const PROGRAM = `class Owner {
  public bag: unknown = undefined;
  public seen = "";
  public constructor() { this.bag = (): void => { this.seen += "x"; }; }
}
function pack(src: Owner): () => string {
  let held: unknown = undefined;
  const set = (): void => { held = src; };
  set();
  return (): string => (held === undefined ? "-" : "!");
}
const o = new Owner();
console.log("done " + pack(o)());
`;

describe("a dyn value is a cycle-collector node", () => {
  test("a shape whose only cycle-capable field is dyn gets a header and a trace", async () => {
    const outDir = join(cacheDir, "dyn-cycle-node");
    mkdirSync(outDir, { recursive: true });
    const src = join(outDir, "dyn-cycle-node-input.ts");
    writeFileSync(src, PROGRAM, "utf8");
    const result = await compile(src, {
      outPath: join(outDir, "program"),
      outDir,
      // Pinned: this test measures the C backend's artifact by design.
      backend: "c",
    });
    if (!result.ok) {
      throw new Error(result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"));
    }
    const c = readFileSync(result.cPath, "utf8");

    // The shape exists at all — without this every grep below is vacuous.
    expect(c, "expected the Owner shape in the emitted TU").toContain("struct sc_o_Owner {");
    expect(c, "expected a ScrDyn field on Owner").toContain("ScrDyn *sc_fld_bag;");

    // The fixpoint graded it cycle-capable: allocated WITH a header, and
    // its release goes through the collector's hooks.
    expect(
      c,
      "Owner's only cycle-capable field is dyn and it was allocated without a cycle header",
    ).toContain("scr_cyc_alloc(sizeof *o, &sc_trace_Owner, &sc_gcfree_Owner)");
    expect(c).toContain("scr_cyc_on_dead(o);");

    // And its trace visits the dyn field — a header with a trace that
    // skips the one cycle-capable field would be worse than no header.
    const traceBody = c.slice(c.indexOf("static void sc_trace_Owner(void *o0"));
    expect(traceBody.slice(0, 300), "Owner's trace does not visit its dyn field").toContain(
      "visit(o->sc_fld_bag, ctx);",
    );

    // The other population: a dyn capture box carries the dyn trace, not
    // NULL. The NULL spelling is what made a ring through an
    // `unknown`-typed capture invisible, and it must be gone from the TU.
    expect(c, "expected a dyn capture box").toContain(
      "scr_box_new_obj(&scr_dyn_retain_v, &scr_dyn_release_v, &scr_dyn_trace_v)",
    );
    expect(c, "a dyn capture box is still untraced").not.toContain(
      "scr_box_new_obj(&scr_dyn_retain_v, &scr_dyn_release_v, NULL)",
    );
  });
});
