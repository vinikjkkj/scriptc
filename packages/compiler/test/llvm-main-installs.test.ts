/* The two backends' main() must install the SAME runtime hooks on the
 * SAME predicates.
 *
 * `main()` is where a program tells the runtime which optional units are
 * live: `scr_net_install` fills the event loop's net hooks, `scr_events_install`
 * its signal/stdin hooks, `scr_stream_install` its deferred-tick hook, and
 * so on. Each is gated on a module predicate that cc.ts links the unit by,
 * so the call and the symbol appear together or not at all.
 *
 * A missing install is the worst shape of bug this project has: the
 * program COMPILES, LINKS, and runs its whole synchronous surface
 * correctly, and then the loop simply never polls. That is not
 * hypothetical. The LLVM main gated its net hooks on `moduleUsesNet(mod)`
 * where the C main gates them on `moduleUsesNet(mod) || moduleUsesWsGlobal(mod)`,
 * and the first `globalThis.WebSocket` program ever to reach the LLVM tier
 * built, dialed, and answered every constructor-visible question byte for
 * byte like Node — then exited between the constructor and the handshake,
 * because scr_ws_client reads through the poller that missing hook
 * installs. It survived because it was UNREACHABLE: `wsCtor` refused on
 * that tier, so no program could take the path.
 *
 * "Unreachable today" is how every row of this kind survives, so the fix
 * is the TABLE and not the row. This test extracts the install table out
 * of both emitter sources — every `...(gate ? [ …install… ] : [])` row,
 * with local `const usesX = …` gates resolved to the module predicates
 * they name — and requires the two to be EQUAL. Drift in either direction
 * fails: a new C install with no LLVM twin, an LLVM install with no C
 * twin, or a gate that gains a disjunct on one side only.
 *
 * Order is deliberately NOT compared. Each call registers an independent
 * set of nullable hook slots or stamps its own handle-dispatch ops, and
 * the one overlap (scr_fetch_install registers the island http bridge
 * that the embedded-graph row registers too) is documented idempotent. */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const cEmitter = join(import.meta.dirname, "../src/backend/emission/emitter.ts");
const llvmEmitter = join(import.meta.dirname, "../src/backend/llvm/emitter.ts");

/** `const usesFoo = moduleUsesFoo(this.mod) || moduleUsesBar(this.mod);`
 * → usesFoo ↦ its right-hand side, so a gate spelled as a local resolves
 * to the same predicate set as one spelled inline. The LLVM main uses
 * locals throughout and the C main uses calls; without this the two
 * tables could never be compared at all. */
function localGates(src: string): Map<string, string> {
  const out = new Map<string, string>();
  // `;\r?\n`, not `;\n`: the LLVM emitter is a CRLF file and the C one is
  // not, and an anchor that only knows LF resolves nothing there — which
  // presents as "gate with no module predicate", not as a silent pass.
  for (const m of src.matchAll(/\bconst\s+(uses[A-Za-z0-9]*|embeds[A-Za-z0-9]*)\s*=\s*([\s\S]*?);\r?\n/g)) {
    out.set(m[1]!, m[2]!);
  }
  return out;
}

/** The module predicates a gate expression names, with locals expanded. */
function predicatesOf(gate: string, locals: Map<string, string>): Set<string> {
  let text = gate;
  for (let depth = 0; depth < 4; depth++) {
    let grew = false;
    for (const [name, rhs] of locals) {
      const re = new RegExp(`\\b${name}\\b`, "g");
      if (re.test(text)) {
        text = text.replace(re, `(${rhs})`);
        grew = true;
      }
    }
    if (!grew) break;
  }
  return new Set<string>([
    ...[...text.matchAll(/module[A-Za-z]+/g)].map((m) => m[0]!),
    // moduleEmbedsBuiltin's argument is part of the predicate.
    ...[...text.matchAll(/"(node:[a-z0-9_]+)"/g)].map((m) => m[1]!),
  ]);
}

/* Installs gated on PROGRAM CONTENT rather than on a module predicate.
 * These are not optional-unit hooks — no cc.ts link decision rides them —
 * so "does the program contain any closure site" is the right gate and
 * there is no moduleX predicate to name. They are excluded from the table
 * by SYMBOL, never by relaxing the assertion, so an unrecognized
 * predicate-less gate still fails loudly — that assertion is what catches
 * a real hook whose gate lost its predicate.
 *
 * Every member is pinned BY NAME in its own test below, because an
 * exclusion nobody checks is exactly the blind spot this file exists to
 * close.
 *
 * scr_closure_sites_install: the RC-audit per-site table (SCRIPTC_RC_SITES=1,
 * inside #ifdef SCR_RC_AUDIT), gated on `rcSiteRows.length > 0`. C-only
 * today; the LLVM backend builds no closure-site table at all. That
 * asymmetry is real but it is not the failure shape this file exists to
 * reject — a missing AUDIT table costs a diagnostic, not a poll.
 *
 * scr_fn_names_install: the function-name table (ScrFnName), gated on
 * `fnNameRows.length > 0`. NOT instrumentation and NOT one-sided — it is
 * a program ANSWER (`[Function: name]` for every box a walker builds) and
 * both mains emit it. It cannot be compared as a table row because its
 * gate is a row COUNT rather than a predicate, so the both-sides property
 * is asserted by name instead, on the npm-table precedent. */
const CONTENT_GATED_INSTALLS = new Set(["scr_closure_sites_install", "scr_fn_names_install"]);

/** install symbol → the module predicates its gate names. */
function installTable(src: string): Map<string, Set<string>> {
  const locals = localGates(src);
  const out = new Map<string, Set<string>>();
  // A gate runs from `...(` to the `?` that opens the array; neither
  // emitter's gates contain a `?` of their own, which the "no predicate"
  // assertion below would catch if that ever changed.
  for (const row of src.matchAll(/\.\.\.\(([^?]*?)\?\s*\[([\s\S]*?)\]\s*:\s*\[\]\)/g)) {
    const installs = [...row[2]!.matchAll(/scr_[a-z0-9_]*_install/g)]
      .map((m) => m[0]!)
      .filter((s) => !CONTENT_GATED_INSTALLS.has(s));
    if (installs.length === 0) continue;
    const preds = predicatesOf(row[1]!, locals);
    expect(preds.size, `gate with no module predicate: ${row[1]!.trim()}`).toBeGreaterThan(0);
    for (const sym of installs) {
      const prev = out.get(sym);
      if (prev) for (const p of preds) prev.add(p);
      else out.set(sym, new Set(preds));
    }
  }
  return out;
}

const show = (s: Set<string>): string => [...s].sort().join(" | ");

describe("the two mains install the same hooks on the same predicates", () => {
  test("the install tables are equal, row for row", async () => {
    const c = installTable(await readFile(cEmitter, "utf8"));
    const ll = installTable(await readFile(llvmEmitter, "utf8"));

    // The extraction has to have found rows on both sides, or everything
    // below is vacuously green — the failure shape this file exists to
    // reject. Eleven is the count at the time of writing; a drop means the
    // parser stopped seeing a row, not that a row went away.
    expect(c.size, "no install rows parsed out of the C emitter").toBeGreaterThanOrEqual(11);
    expect(ll.size, "no install rows parsed out of the LLVM emitter").toBeGreaterThanOrEqual(11);

    const problems: string[] = [];
    for (const [sym, cPreds] of c) {
      const llPreds = ll.get(sym);
      if (!llPreds) {
        problems.push(
          `${sym}: the C main installs it (${show(cPreds)}) and the LLVM main never does. ` +
            `A missing install is a program that compiles, links, and then never polls — ` +
            `emit it on the same predicate cc.ts links the unit by.`,
        );
        continue;
      }
      if (show(cPreds) !== show(llPreds)) {
        problems.push(`${sym}: C gates on [${show(cPreds)}], LLVM gates on [${show(llPreds)}]`);
      }
    }
    for (const sym of ll.keys()) {
      if (!c.has(sym)) problems.push(`${sym}: the LLVM main installs it and the C main does not`);
    }
    expect(problems).toEqual([]);
  });

  test("the net hooks carry the WebSocket and static-fetch disjuncts on BOTH sides", async () => {
    // Named on its own because it is the row that was wrong TWICE, and
    // because the symptom — a socket that dials and never fires — is
    // invisible to every compile-time check there is. The WebSocket
    // disjunct was the first; the static fetch was the second, and it
    // presented as a program that printed NOTHING and exited 0 between
    // the dial and the response head.
    const c = installTable(await readFile(cEmitter, "utf8"));
    const ll = installTable(await readFile(llvmEmitter, "utf8"));
    for (const [name, t] of [["C", c], ["LLVM", ll]] as const) {
      const preds = t.get("scr_net_install");
      expect(preds, `${name} main does not install scr_net_install at all`).toBeDefined();
      expect([...preds!].sort(), `${name} main's scr_net_install gate`).toEqual([
        "moduleUsesFetchStatic",
        "moduleUsesNet",
        "moduleUsesWsGlobal",
      ]);
    }
  });

  /* The installs the table above deliberately does not compare, pinned by
   * hand so an exclusion can never quietly become a blind spot. If the
   * LLVM tier grows a closure-site table this fails, and the right response
   * is to delete that exclusion and let the table compare the row properly. */
  test("the RC-audit closure-site table is C-only, and nothing else is excluded", async () => {
    const c = await readFile(cEmitter, "utf8");
    const ll = await readFile(llvmEmitter, "utf8");
    expect(c).toContain("scr_closure_sites_install(sc_clo_site_tbl");
    expect(c).toContain("ScrClosureSite sc_clo_site_tbl[]");
    // Not merely absent from main: the LLVM tier builds no such table.
    expect(ll).not.toContain("scr_closure_sites_install");
    expect(ll).not.toContain("ScrClosureSite");
    // The exclusion list grows only with a named justification and a
    // by-name test of its own: every excluded symbol must be a real
    // install in the C main, so a typo'd or stale entry cannot silently
    // widen the hole.
    expect([...CONTENT_GATED_INSTALLS]).toEqual([
      "scr_closure_sites_install",
      "scr_fn_names_install",
    ]);
    for (const sym of CONTENT_GATED_INSTALLS) expect(c).toContain(sym);
  });

  test("the function-name table is installed on BOTH sides", async () => {
    // The row-count gate keeps this out of the compared table, so the
    // both-sides property is asserted here — and it matters for the same
    // reason every row in this file matters: a name table the LLVM main
    // forgot to install is a tier that prints `[Function (anonymous)]`
    // where the C tier prints node's answer, with nothing failing.
    const c = await readFile(cEmitter, "utf8");
    const ll = await readFile(llvmEmitter, "utf8");
    expect(c).toContain("ScrFnName sc_fn_name_tbl[]");
    expect(c).toContain("scr_fn_names_install(sc_fn_name_tbl");
    expect(ll).toContain("%ScrFnName = type { ptr, ptr }");
    expect(ll).toContain("@sc_fn_name_tbl = internal constant");
    expect(ll).toContain("scr_fn_names_install(ptr @sc_fn_name_tbl");
  });

  test("the npm-table registration, which is not _install-shaped, is on BOTH sides", async () => {
    // The one main-time registration that does not end in _install is the
    // embedded npm module table (scr_island_modules / scr_island_set_inflate),
    // gated on `embedded && embedded.modules.length > 0`. The LLVM emitter
    // used to refuse exactly that during its module scan — the tier`s last
    // refusal, and the reason this row could not be reached rather than
    // being merely absent. It now emits the two tables (llvm/island.ts is
    // emission/emit-island.ts in IR) and registers them in the same
    // position the C main does: last before the entry call.
    //
    // installTable above cannot compare this row, because neither gate is
    // a moduleX predicate — C tests `embedded.modules.length > 0` and LLVM
    // the null-ness of that same computation. So it is checked by name.
    const ll = await readFile(llvmEmitter, "utf8");
    const c = await readFile(cEmitter, "utf8");
    const island = await readFile(join(import.meta.dirname, "../src/backend/llvm/island.ts"), "utf8");
    expect(c).toContain("scr_island_modules(sc_npm_modules");
    expect(ll).toContain("@scr_island_modules(ptr @sc_npm_modules");
    // The refusal is gone from the source, not merely unreachable.
    expect(ll).not.toContain("npmEmbedding");
    // The inflater rides the SAME predicate on both sides: main installs
    // it exactly when some module stored compressed, which is also the
    // predicate index.ts links scr_zlib.c by (moduleEmbedsCompressedNpm).
    expect(c).toContain("scr_island_set_inflate(scr_zlib_inflate_exact)");
    expect(ll).toContain("@scr_island_set_inflate(ptr @scr_zlib_inflate_exact)");
    // …and both decide "compressed" with the same store() rule, so the
    // two backends embed identical bytes rather than merely equivalent
    // ones. A divergence here is a binary that inflates garbage.
    for (const src of [await readFile(join(import.meta.dirname, "../src/backend/emission/emit-island.ts"), "utf8"), island]) {
      expect(src).toContain("NPM_COMPRESS_MIN");
      expect(src).toContain("deflateRawSync(plain, { level: 9 })");
      expect(src).toContain("deflated.length < plain.length");
    }
  });
});
