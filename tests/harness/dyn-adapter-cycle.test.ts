/* The dyn-function adapter's capture must be VISIBLE to the cycle
 * collector.
 *
 * A listener whose parameters the frontend could not annotate registers
 * through `scr_emitter_on_dyn`: the emitter registry owns the original
 * closure (traced by `scr_emitter_reg_trace`) and emit invokes a
 * compiler-built adapter. That adapter needs two things from the dyn value
 * it adapts — the closure and that closure's thunk — and it used to keep
 * the whole `ScrDyn` to get them, in an `SCR_BOX_OBJ` box with a NULL
 * trace.
 *
 * `ScrDyn` carries no cycle header, so that edge was invisible, and ONE
 * invisible strong reference is all Bacon-Rajan trial deletion needs to
 * declare a dead ring externally referenced: the listener had rc 2, markGray
 * reached one of the two, `scr_scan` saw rc > 0, and `scan_black` blackened
 * the whole subgraph. A listener that captured its own emitter's owner
 * leaked that owner and everything it reached — measured on zapo as 6956
 * boxes, 8690 closures and 36997 dyn values live at exit.
 *
 * There is no OUTPUT to test: a leak prints nothing. The shape of the
 * emitted adapter is the artifact, so it is what this greps — the same
 * stance as deadstrip.test.ts. Under `SCRIPTC_RC_AUDIT=1` the corpus's own
 * differential lane covers the behaviour, because a leaked graph makes the
 * program exit 99 where Node exits 0.
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { compile } from "@scriptc/compiler";

const repoRoot = join(import.meta.dirname, "../..");
const cacheDir = join(repoRoot, "node_modules/.cache/scriptc-tests");

/* An UNTYPED emitter (zapo's WaNodeTransport shape) with a listener whose
 * parameter has no annotation: exactly the registration that takes the dyn
 * adapter path, and the listener captures the object that owns the
 * emitter, which is what closes the ring. */
const PROGRAM = `import { EventEmitter } from "node:events";
class Raw extends EventEmitter {
  public fire(n: number): void { this.emit("tick", n); }
}
class Owner {
  public readonly raw: Raw = new Raw();
  public seen = "";
  public constructor() { this.raw.on("tick", (n) => { this.seen += String(n); }); }
  public go(): void { this.raw.fire(1); }
}
const o = new Owner();
o.go();
console.log("done " + o.seen);
`;

describe("the dyn-function adapter's capture", () => {
  test("is a traced FUNC box, not an untraced dyn box", async () => {
    const outDir = join(cacheDir, "dyn-adapter-cycle");
    mkdirSync(outDir, { recursive: true });
    const src = join(outDir, "dyn-adapter-cycle-input.ts");
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

    // The adapter exists at all — without this the greps below are vacuous.
    expect(c, "expected a dyn fn adapter for the unannotated listener").toContain(
      "/* dyn fn adapter to ",
    );

    // caps[0] is the CLOSURE in a FUNC box (the box's trace visits a FUNC
    // payload unconditionally), and caps[1] is the thunk in a scalar box.
    expect(c).toContain("a->caps[0] = scr_box_new(SCR_BOX_FUNC);");
    expect(c).toContain("scr_box_set_ref(a->caps[0], scr_closure_retain(d->v.fn.clo));");
    expect(c).toContain("a->caps[1] = scr_box_new(SCR_BOX_F64);");
    expect(c).toContain("scr_box_set_thunk(a->caps[1], d->v.fn.thunk);");

    // And the untraced form is gone from the adapter arm. The same
    // `scr_box_new_obj(..., NULL)` spelling still appears for dyn-typed
    // CAPTURES (a different population, and one that needs a cycle header
    // on ScrDyn itself), so the assertion is scoped to the arm: no adapter
    // construction may be followed by an untraced dyn box.
    const adapterConstructions = c.split("ScrClosure *a = scr_closure_new((void *)&sc_dfa_");
    expect(adapterConstructions.length, "no adapter construction found").toBeGreaterThan(1);
    for (const tail of adapterConstructions.slice(1)) {
      const arm = tail.slice(0, 400);
      expect(
        arm,
        "an adapter still captures the whole dyn in an untraced box",
      ).not.toContain("scr_box_new_obj(&scr_dyn_retain_v, &scr_dyn_release_v, NULL)");
    }
  });
});
