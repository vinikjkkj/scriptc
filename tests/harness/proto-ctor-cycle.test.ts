/* `F.prototype.constructor = F` is a RING, and the collector has to see
 * every edge of it — including the one the closure keeps for itself.
 *
 * THE RING. A function value's minted prototype object is reachable from
 * its closure TWICE:
 *
 *   ScrClosure.props  -> the own-property table -> its `prototype` member
 *   ScrClosure.implicit_proto                   -> the same object
 *
 * and the back-link closes it:
 *
 *   the prototype's `constructor` member (a FUNC dyn) -> the closure.
 *
 * Every edge there is traced today. `implicit_proto` was not, and the
 * comment above it said that was deliberate and harmless — "a cycle
 * through it is merely never collected". That was wrong in a way an
 * untraced edge usually is not. Bacon–Rajan trial deletion decrements
 * rc once per edge it TRAVERSES, so an untraced edge into a node the walk
 * is trial-deleting leaves an un-decremented reference behind: markGray
 * took the prototype down for the props-table edge and not for this one,
 * `scan` read the surviving rc > 0 as "externally referenced", and
 * `scanBlack` restored the WHOLE subgraph. The ring was therefore not
 * merely left uncollected — it was made UNCOLLECTABLE, and so was every
 * other ring that happened to pass through a function's own prototype.
 *
 * WHY THIS FILE EXISTS AT ALL. A leak prints nothing. This one was
 * invisible to every gate the tree has: stdout is byte-identical to Node
 * with and without it, the emitted C is byte-identical (the change is
 * entirely in the runtime, so no TU grep can see it), and the one
 * instrument that does see it — the whole-corpus differential under
 * `SCRIPTC_RC_AUDIT=1` — is in no gate. `tests/corpus/2762-prototype-
 * chain.js` had been failing that lane, on one member of one factory,
 * since the day a function's prototype became an object.
 *
 * WHAT IT ASSERTS, and why each assertion is here:
 *
 *   1. the SOURCE contract, greppable and cheap: `scr_closure_trace`
 *      visits `implicit_proto`, `scr_closure_may_cycle` names it, the
 *      collector's free_fn does NOT release it and the two refcount paths
 *      DO. This runs everywhere in milliseconds, and it is what stays red
 *      if someone deletes the edge on a machine where the audit is off;
 *   2. the BEHAVIOUR, on four ring shapes and two non-ring controls,
 *      compiled with the audit armed and actually RUN: exit 0, and stdout
 *      byte-identical to this machine's Node. The controls are here so
 *      that "no program leaks" and "the audit is not armed" cannot be
 *      confused — see 3;
 *   3. that the audit is really ARMED, per case and by reading the
 *      artifact rather than by inference: the failure text the audit
 *      prints is a string literal inside `#ifdef SCR_RC_AUDIT`, so its
 *      presence in the compiled binary is a direct reading of whether the
 *      define reached that build. A leak suite that silently measures
 *      nothing passes, and this is what stops this one from being it.
 *
 * The entries all RETURN rather than calling `process.exit()`: `_Exit`
 * skips `atexit`, and the audit is an `atexit` handler, so a program that
 * exits that way reports clean no matter what it leaked.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { compile } from "@scriptc/compiler";

const repoRoot = join(import.meta.dirname, "../..");
const runtimeSrc = join(repoRoot, "packages/runtime/src");

/* ── 1. the source contract ───────────────────────────────────────────
 * scr_closure.c is the whole of the fix, and each of these four is a
 * DIFFERENT way to lose it: drop the visit and the ring is invisible
 * again; drop the may_cycle disjunct and a closure whose only
 * cycle-capable child is its prototype is never buffered as a candidate;
 * pass `true` from the collector's free_fn and a traced child is released
 * twice; pass `false` from a refcount path and the prototype leaks by
 * ordinary counting instead. */
describe("the minted prototype is a traced edge (source contract)", () => {
  const closureC = readFileSync(join(runtimeSrc, "scr_closure.c"), "utf8");

  test("scr_closure_trace visits BOTH props and implicit_proto", () => {
    const body = closureC.slice(
      closureC.indexOf("static void scr_closure_trace(void *o"),
      closureC.indexOf("void (*scr_closure_ctor_unlink)"),
    );
    expect(body, "scr_closure_trace not found").not.toBe("");
    expect(body).toContain("visit(c->props, ctx);");
    expect(body).toContain("visit(c->implicit_proto, ctx);");
    // The captures too, or the edge that started this whole population
    // (`Foo.create = () => new Foo()`) goes with it.
    expect(body).toContain("for (size_t i = 0; i < c->ncaps; i++) visit(c->caps[i], ctx);");
  });

  test("scr_closure_may_cycle names every child the trace can visit", () => {
    expect(closureC).toContain(
      "return c->ncaps != 0 || c->props != NULL || c->implicit_proto != NULL;",
    );
  });

  test("the COLLECTOR's teardown erases without releasing; the refcount paths release", () => {
    // The trace/teardown complement (scr_runtime.h): a free_fn must not
    // release a traced child, because markGray already accounted it.
    expect(closureC).toContain("scr_closure_drop_ctor((ScrClosure *)o, false);");
    // …and both ordinary refcount paths still own the release.
    expect(closureC).toContain("scr_closure_drop_ctor(c, true);");
    expect(closureC.match(/scr_closure_drop_ctor\(c, true\);/g)?.length).toBe(2);
    // Spelled out rather than `[^)]*`, which cannot span the ")" inside the
    // cast — the first spelling of this assertion matched nothing and read
    // as `undefined`, which is the shape of a check that measures nothing.
    expect(
      closureC.match(/scr_closure_drop_ctor\(\(ScrClosure \*\)o, false\);/g)?.length,
    ).toBe(1);
    // No call site may leave the release decision implicit.
    expect(closureC).not.toMatch(/scr_closure_drop_ctor\([^,]*\);/);
  });

  test("the registry erase is keyed by ADDRESS and never dereferences it", () => {
    const jsonC = readFileSync(join(runtimeSrc, "scr_json.c"), "utf8");
    const fn = jsonC.slice(
      jsonC.indexOf("static void scr_dyn_ctor_unlink(ScrClosure *c"),
      jsonC.indexOf("static void scr_dyn_ctor_unlink(ScrClosure *c") + 900,
    );
    expect(fn).toContain("scr_dyn_ctor_unlink(ScrClosure *c, bool release)");
    // erase unconditional, release conditional — in that order.
    expect(fn.indexOf("scr_ctor_erase(proto);")).toBeGreaterThan(0);
    expect(fn).toContain("if (release) scr_dyn_release(proto);");
    expect(fn.indexOf("scr_ctor_erase(proto);")).toBeLessThan(
      fn.indexOf("if (release) scr_dyn_release(proto);"),
    );
  });
});

/* ── 2/3. behaviour, with the audit armed ─────────────────────────────
 * Each case carries its OWN arming assertion — see the binary read at the
 * bottom of the loop. Without one, this whole table would pass on a build
 * where -DSCR_RC_AUDIT never reached the compiler, which is the failure
 * mode a leak suite has to be built against. */
interface Case {
  readonly name: string;
  readonly src: string;
}

const CASES: readonly Case[] = [
  {
    // The ring itself, minted inside a factory so the closure is NOT an
    // interned top-level function value — an immortal closure is torn
    // down by scr_closure_static_teardown and never reaches the collector.
    name: "explicit constructor back-link",
    src: `"use strict";
function mk(tag) {
  function N(v) { this.tag = tag; this.v = v; }
  N.prototype.constructor = N;
  N.prototype.d = function () { return this.tag + this.v + typeof this.constructor; };
  return N;
}
const A = mk("a");
console.log(new A(1).d(), typeof A.prototype.constructor);
`,
  },
  {
    // The props half of the same ring: a capturing static. This one was
    // already collectable; it is here so a change that fixes one half by
    // breaking the other cannot pass.
    name: "capturing static on the constructor",
    src: `"use strict";
function mk() {
  function N() { this.k = 1; }
  N.prototype.constructor = N;
  N.create = function () { return new N(); };
  return N;
}
const C = mk();
console.log(C.create().k, typeof C.prototype.constructor);
`,
  },
  {
    // Rings made and DROPPED mid-run: the collector has to reclaim them
    // at its threshold, not only at exit.
    name: "many rings dropped mid-run",
    src: `"use strict";
function mk(tag) {
  function N(v) { this.tag = tag; this.v = v; }
  N.prototype.constructor = N;
  N.prototype.d = function () { return this.tag + this.v; };
  return N;
}
let last = "";
for (let i = 0; i < 60; i++) { const K = mk("k" + i); last = new K(i).d(); }
console.log(last);
`,
  },
  {
    // Two objects deep before the ring closes.
    name: "two-object ring through both prototypes",
    src: `"use strict";
function mk() {
  function Outer() { this.s = "o"; }
  function Inner() { this.s = "i"; }
  Outer.prototype.constructor = Outer;
  Inner.prototype.constructor = Inner;
  Outer.prototype.other = function () { return Inner; };
  Inner.prototype.other = function () { return Outer; };
  return Outer;
}
const O = mk();
const o = new O();
console.log(o.s, new (o.other())().s, typeof o.constructor);
`,
  },
  {
    // CONTROL: prototype members but NO back-link. Clean before the fix
    // and after it — so "everything is clean now" cannot be read as
    // "nothing was ever dirty" without also reading the leaking case.
    name: "control: prototype members with no back-link",
    src: `"use strict";
function mk() {
  function N() { this.k = 1; }
  N.prototype.tag = "t";
  N.prototype.m = function () { return 2; };
  return N;
}
const K = mk();
console.log(new K().k, K.prototype.tag, new K().m());
`,
  },
];

describe("rings through a function's own prototype collect (RC audit armed)", () => {
  for (const c of CASES) {
    test(c.name, { timeout: 300_000 }, async () => {
      const dir = mkdtempSync(join(tmpdir(), "scr-protoring-"));
      // A .js entry: the prototype route is JS-gated, like the corpus
      // program this derives from.
      const src = join(dir, "prog.js");
      writeFileSync(src, c.src);

      // SCRIPTC_RC_AUDIT is a BUILD dial (cc.ts's rcAuditRequested), not
      // a runtime one — read at compile time, so it has to be set around
      // the compile() call and not around the exec.
      const prev = process.env["SCRIPTC_RC_AUDIT"];
      let cPath: string;
      let binaryPath: string;
      try {
        process.env["SCRIPTC_RC_AUDIT"] = "1";
        const result = await compile(src, {
          // The extension matters on Windows: the driver names the artifact
          // from this path, and a bare "prog" is not executable there.
          outPath: join(dir, `prog${process.platform === "win32" ? ".exe" : ""}`),
          outDir: dir,
          // Pinned: the RC audit is a C-runtime artifact by construction.
          backend: "c",
        });
        if (!result.ok) {
          throw new Error(result.diagnostics.map((d) => `${d.code}: ${d.message}`).join("\n"));
        }
        cPath = result.cPath;
        binaryPath = result.binaryPath;
      } finally {
        if (prev === undefined) delete process.env["SCRIPTC_RC_AUDIT"];
        else process.env["SCRIPTC_RC_AUDIT"] = prev;
      }

      // The emitted TU must be innocent of all this: the fix is entirely
      // in the runtime, so a change that moved the EMITTER instead would
      // be a different claim than the one this file makes.
      expect(readFileSync(cPath, "utf8")).not.toContain("implicit_proto, ctx");

      const nodeOut = execFileSync(process.execPath, [src], { encoding: "buffer" });

      let status = 0;
      let stdout: Buffer;
      let stderr = "";
      try {
        stdout = execFileSync(binaryPath, { encoding: "buffer", stdio: ["ignore", "pipe", "pipe"] });
      } catch (e) {
        const err = e as { status?: number; stdout?: Buffer; stderr?: Buffer };
        status = err.status ?? -1;
        stdout = err.stdout ?? Buffer.alloc(0);
        stderr = (err.stderr ?? Buffer.alloc(0)).toString("utf8");
      }

      // Output first: a leak is invisible in stdout, which is exactly why
      // this one survived so long, so the byte comparison has to be here
      // as well as the exit code and not instead of it.
      expect(stdout.toString("utf8")).toBe(nodeOut.toString("utf8"));

      // ARMED, per case, and not by inference. The audit's failure text is
      // a string literal inside `#ifdef SCR_RC_AUDIT`, so its presence in
      // THIS binary is a direct reading of whether -DSCR_RC_AUDIT reached
      // THIS build. Without it, every exit-0 below is vacuous — which is
      // the failure mode a leak suite has to be built against, and the one
      // this file was written with. (The first arming attempt here was a
      // program expected to LEAK by holding a ring in a module-level
      // `const`; it exits 0, because the emitted main releases module
      // bindings before returning. A program that leaks on demand is
      // harder to write than a build flag is to read.)
      expect(
        readFileSync(binaryPath).includes(Buffer.from("scriptc RC AUDIT FAILED")),
        "-DSCR_RC_AUDIT did not reach this build: the audit's failure text is " +
          "absent from the binary, so its exit 0 says nothing about leaks",
      ).toBe(true);

      expect(status, `RC audit failed:\n${stderr}`).toBe(0);
      expect(stderr).toBe("");
    });
  }
});
