// scripts/dyn-recover-census.mjs — the POPULATION of the silent-write family.
//
// scriptc keeps composites in two physically different representations: a C
// struct (record) / packed ScrArr (array), and a ScrDyn key-value table. The
// conversion between them is a COPY in both directions, and the project
// already knows it: a static->dyn conversion of an operand the caller still
// names is wrapped in scr_dyn_mark_static_copy(), and a write THROUGH that
// dyn then refuses loudly instead of being dropped.
//
// The hole this instrument measures is the OTHER direction. A dyn->record
// recovery (`sc_dc_N` / `sc_da_N`) builds a FRESH struct with `sc_rnew_rN`.
// Nothing marks it. A write into that struct lands on the copy and is
// silently lost, which is exactly how `contextInfo` disappears from zapo's
// quoted reply.
//
// So: over an emitted TU, count every dyn->composite recovery, and split it
// by what the program then DOES with the recovered value:
//
//   WRITTEN   a field store / element store on the recovered value inside the
//             same function. The write is lost here and now.
//   ESCAPES   the recovered value is returned, stored into a global, or
//             passed on. A caller may write it -- zapo's own shape
//             (pickContextInfoTarget returns it; applyContextInfo writes it).
//   READONLY  neither. Correct today.
//
// The alias walk is deliberately SHALLOW and local: it follows plain temp
// copies and retains inside one function body. It therefore UNDERCOUNTS
// WRITTEN and overcounts READONLY. Every number it prints is a floor.
//
// usage:  node scripts/dyn-recover-census.mjs --selftest
//         node scripts/dyn-recover-census.mjs <tu.c> [--list N]
import fs from "node:fs";

/** Resolve a `check union:uN` to composite when any arm it delegates to is a
 * record or an array. zapo's own drop hides exactly there: the recovery that
 * loses `contextInfo` is `sc_dc_630`, declared `check union:u874`, whose arm
 * `sc_da_1145` is `arm record:r1385`. A classifier that reads only the
 * declaration comment calls that "other" and reports a population of ONE.
 * This is the second false zero this instrument produced before it was
 * believed. */
function resolveUnions(kinds, src) {
  const calls = new Map();
  for (const fn of functions(src)) {
    if (!/^sc_d[ca]_\d+$/.test(fn.name)) continue;
    const out = new Set();
    for (const line of fn.body) for (const m of line.matchAll(/\b(sc_d[ca]_\d+)\(/g)) if (m[1] !== fn.name) out.add(m[1]);
    calls.set(fn.name, out);
  }
  let grew = true, rounds = 0;
  while (grew && rounds++ < 64) {
    grew = false;
    for (const [fn, outs] of calls) {
      const k = kinds.get(fn);
      if (!k || k.k === "record" || k.k === "array") continue;
      for (const o of outs) {
        const ok = kinds.get(o);
        if (ok && (ok.k === "record" || ok.k === "array")) {
          kinds.set(fn, { k: ok.k, cType: k.cType, what: k.what + " -> " + ok.what, viaUnion: true });
          grew = true;
          break;
        }
      }
    }
  }
  return kinds;
}

function classifyCheckers(src) {
  // static sc_rs_r1 *sc_dc_0(const ScrDyn *d, const ScrDynPath *path); /* check record:r1 */
  // static ScrArr *sc_da_3(const ScrDyn *d, const ScrDynPath *path, bool *ok); /* arm array<...> */
  const kind = new Map();
  const re = /^static\s+(?:const\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*\*\s*(sc_d[ca]_\d+)\([^)]*\);\s*\/\*\s*(check|arm)\s+([^*]+?)\s*\*\//gm;
  let m;
  while ((m = re.exec(src)) !== null) {
    const cType = m[1], fn = m[2], what = m[4];
    let k = "other";
    if (/^record:/.test(what)) k = "record";
    else if (/^array</.test(what)) k = "array";
    kind.set(fn, { k, cType, what });
  }
  return kind;
}

/** Split the TU into function bodies. An emitted function DEFINITION starts
 * at column 0 with `static ` (or `int main`), carries a parameter list, and
 * opens its brace on the same line — often with a `/ * file:line * /` comment
 * AFTER the brace, which is what defeated the first version of this splitter
 * and made it report a false ZERO on a 121 MB TU whose 1 776 recovery sites
 * `rg` counts directly. The body ends at a line that is exactly `}`.
 *
 * `static struct { ... } sc_lit_0 =` lines are excluded by requiring a `)`
 * before the brace. */
const FN_START = /^(?:static\s|int\s+main)[^;]*\)\s*\{\s*(?:\/\*.*)?$/;
function* functions(src) {
  const lines = src.split("\n");
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (!FN_START.test(l)) { i++; continue; }
    const nameM = /([A-Za-z_][A-Za-z0-9_]*)\s*\(/.exec(l);
    const name = nameM ? nameM[1] : "<anon>";
    let j = i + 1;
    while (j < lines.length && lines[j] !== "}") j++;
    yield { name, start: i + 1, body: lines.slice(i + 1, j) };
    i = j + 1;
  }
}

/** The checker helpers (`sc_dc_*`, `sc_da_*`) recover composites from dyn
 * INSIDE THEMSELVES, recursively, to build a fresh tree. Those recoveries are
 * correct by construction — the tree they fill is brand new and nobody else
 * holds it. Only recoveries in PROGRAM code can lose a write. */
function isProgramFunction(name) {
  return name === "main" || name.startsWith("sc_f_");
}

const DECL = /^\s*(?:const\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*\*\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(sc_d[ca]_\d+)\(/;
// A step that keeps the SAME underlying composite: a plain temp copy, a
// refcount retain, or a union narrow (which hands back the arm's payload
// pointer, not a fresh struct). `sc_f__x25_union_narrow_183` is the step
// between zapo's `pickContextInfoTarget` result and the store that is lost.
const COPY = /^\s*(?:(?:const\s+)?[A-Za-z_][A-Za-z0-9_]*\s*\*\s*)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:sc_rretain_r\d+|scr_arr_retain|scr_union_retain|sc_f__x25_union_narrow_\d+)?\(?\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)?\s*;\s*(?:\/\*.*)?$/;
// `ScrUnion *u = scr_union_new_ref(1, rec, ...)` — a union built AROUND the
// recovered record holds it by reference, so returning the union returns the
// record. The checker sometimes hands back the union itself (zapo's
// `sc_dc_630` is declared `check union:u874`) and sometimes hands back the
// bare record for the emitter to wrap here; both spellings are the same
// escape, and an instrument that follows only one of them reports a false
// zero on whichever program uses the other.
const UNIONWRAP = /^\s*(?:const\s+)?ScrUnion\s*\*\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*scr_union_new_ref\(\s*\d+\s*,\s*([A-Za-z_][A-Za-z0-9_]*)/;
// `TYPE *v = someFunction(arg);` — the one call boundary this instrument
// follows, so that a recovery which ESCAPES its own function can still be
// tied to the store that loses it in the caller.
const CALLASSIGN = /^\s*(?:const\s+)?[A-Za-z_][A-Za-z0-9_]*\s*\*\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(sc_f_[A-Za-z0-9_]*)\(/;

function analyse(src, kinds, listLimit) {
  const totals = { recoveries: 0, record: 0, array: 0, other: 0, written: 0, escapes: 0, readonly: 0,
                   fromMarked: 0, lostLocal: 0, realised: 0, lostViaCall: 0 };
  const sites = [];
  let programFns = 0, helperFns = 0;
  for (const fn of functions(src)) {
    if (!isProgramFunction(fn.name)) { helperFns++; continue; }
    programFns++;
    // collect recoveries in this body
    const roots = [];
    for (let n = 0; n < fn.body.length; n++) {
      const m = DECL.exec(fn.body[n]);
      if (!m) continue;
      const k = kinds.get(m[3]);
      if (!k || (k.k !== "record" && k.k !== "array")) {
        if (k) { totals.recoveries++; totals.other++; }
        continue;
      }
      roots.push({ varName: m[2], helper: m[3], k, line: n, arg: (/=\s*sc_d[ca]_\d+\(\s*([A-Za-z_][A-Za-z0-9_]*)/.exec(fn.body[n]) || [])[1] });
    }
    if (roots.length === 0) continue;
    // Which dyn values in this body are a MARKED STATIC COPY of a composite
    // the program still names? Only a recovery fed by one of those can lose a
    // write: a dyn that came fresh out of a protobuf decode or a JSON parse
    // has no original to diverge from. Without this the instrument charges
    // WaPairingFlow.buildPairSuccessResponseIdentity, whose recovered record
    // IS the value used downstream and whose `deviceSignature` store is
    // perfectly correct -- and the paired run proves it, byte for byte.
    const marked = new Set();
    for (let pass = 0; pass < 4; pass++) {
      for (const line of fn.body) {
        let m2 = /^\s*(?:const\s+)?ScrDyn\s*\*\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*scr_dyn_mark_static_copy\(/.exec(line);
        if (m2) { marked.add(m2[1]); continue; }
        m2 = /^\s*(?:(?:const\s+)?ScrDyn\s*\*\s*)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:sc_dyn_key_get|scr_dyn_retain|scr_dyn_obj_get|sc_dyn_idx_get)\(\s*([A-Za-z_][A-Za-z0-9_]*)/.exec(line);
        if (m2 && marked.has(m2[2])) { marked.add(m2[1]); continue; }
        m2 = /^\s*(?:(?:const\s+)?ScrDyn\s*\*\s*)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([A-Za-z_][A-Za-z0-9_]*)\s*;/.exec(line);
        if (m2 && marked.has(m2[2])) marked.add(m2[1]);
      }
    }
    for (const r of roots) {
      totals.recoveries++;
      totals[r.k.k]++;
      // shallow alias closure, forward only
      const alias = new Set([r.varName]);
      let grew = true;
      while (grew) {
        grew = false;
        for (let n = r.line + 1; n < fn.body.length; n++) {
          const c = COPY.exec(fn.body[n]);
          if (c && alias.has(c[2]) && !alias.has(c[1])) { alias.add(c[1]); grew = true; }
          const u = UNIONWRAP.exec(fn.body[n]);
          if (u && alias.has(u[2]) && !alias.has(u[1])) { alias.add(u[1]); grew = true; }
        }
      }
      let written = false, escapes = false;
      const evidence = [];
      for (let n = r.line + 1; n < fn.body.length; n++) {
        const line = fn.body[n];
        for (const a of alias) {
          // field / element store on the recovered value
          const w = new RegExp("(?:^|[^A-Za-z0-9_])" + a + "->sc_(?:fld|ovf)[A-Za-z0-9_]*\\s*=[^=]").test(line) ||
                    new RegExp("scr_arr_set\\w*\\(\\s*" + a + "\\b").test(line) ||
                    new RegExp("scr_map_set\\w*\\(\\s*" + a + "->").test(line);
          if (w) { written = true; if (evidence.length < 3) evidence.push(line.trim().slice(0, 140)); }
          if (new RegExp("^\\s*return\\s+" + a + "\\s*;").test(line)) escapes = true;
          if (new RegExp("^\\s*sc_g_e_[A-Za-z0-9_]+\\s*=\\s*" + a + "\\s*;").test(line)) escapes = true;
        }
      }
      const fromMarked = r.arg !== undefined && marked.has(r.arg);
      if (written) totals.written++;
      else if (escapes) totals.escapes++;
      else totals.readonly++;
      if (fromMarked) {
        totals.fromMarked++;
        if (written) totals.lostLocal++;
      }
      if (written || escapes) {
        sites.push({ fn: fn.name, helper: r.helper, shape: r.k.what, fromMarked,
                     cls: written ? "WRITTEN" : "ESCAPES", evidence });
      }
    }
  }
  if (listLimit > 0) {
    console.log("  sites (" + sites.length + " WRITTEN or ESCAPES; first " + Math.min(listLimit, sites.length) + "):");
    for (const s of sites.slice(0, listLimit)) {
      console.log("    " + s.cls + " " + s.fn + " <- " + s.helper + " (" + s.shape + ")");
      for (const e of s.evidence) console.log("        " + e);
    }
  }
  // ---- pass 2: follow ONE call boundary.
  // A recovery that ESCAPES its own function is only a defect if a CALLER
  // writes through it. zapo's is exactly that shape: pickContextInfoTarget
  // returns the recovered union, applyContextInfo narrows it and stores
  // `contextInfo` into the result. Pass 1 alone calls that ESCAPES and
  // stops; this pass turns the ones that ARE written into a number.
  const escaping = new Set(sites.filter((x) => x.cls === 'ESCAPES').map((x) => x.fn));
  const escapingMarked = new Set(sites.filter((x) => x.cls === 'ESCAPES' && x.fromMarked).map((x) => x.fn));
  const realised = [];
  if (escaping.size > 0) {
    for (const fn of functions(src)) {
      if (!isProgramFunction(fn.name)) continue;
      for (let n = 0; n < fn.body.length; n++) {
        const m = CALLASSIGN.exec(fn.body[n]);
        if (!m || !escaping.has(m[2])) continue;
        const alias = new Set([m[1]]);
        let grew = true;
        while (grew) {
          grew = false;
          for (let k = n + 1; k < fn.body.length; k++) {
            const c = COPY.exec(fn.body[k]);
            if (c && alias.has(c[2]) && !alias.has(c[1])) { alias.add(c[1]); grew = true; }
            const u = UNIONWRAP.exec(fn.body[k]);
            if (u && alias.has(u[2]) && !alias.has(u[1])) { alias.add(u[1]); grew = true; }
          }
        }
        for (let k = n + 1; k < fn.body.length; k++) {
          const line = fn.body[k];
          for (const a of alias) {
            if (new RegExp('(?:^|[^A-Za-z0-9_])' + a + '->sc_(?:fld|ovf)[A-Za-z0-9_]*[ ]*=[^=]').test(line)) {
              realised.push({ caller: fn.name, callee: m[2], fromMarked: escapingMarked.has(m[2]),
                              store: line.trim().slice(0, 160) });
              k = fn.body.length;
              break;
            }
          }
        }
      }
    }
  }
  totals.realised = realised.length;
  totals.lostViaCall = realised.filter((x) => x.fromMarked).length;
  return { totals, sites, programFns, helperFns, realised };
}

function report(label, kinds, res) {
  const t = res.totals;
  console.log("=== dynrecover " + label + " ===");
  console.log("  dyn->composite RECOVERY HELPERS declared: " +
    [...kinds.values()].filter((v) => v.k === "record").length + " record, " +
    [...kinds.values()].filter((v) => v.k === "array").length + " array, " +
    [...kinds.values()].filter((v) => v.k === "other").length + " other");
  console.log("  program functions scanned: " + res.programFns + "   (helper/checker bodies skipped: " + res.helperFns + ")");
  console.log("  recovery CALL SITES in program code: " + t.recoveries +
    "   (record " + t.record + ", array " + t.array + ", other " + t.other + ")");
  console.log("    WRITTEN  " + t.written + "   a field/element store lands on the copy, here and now");
  console.log("    ESCAPES  " + t.escapes + "   returned or stored globally; a caller may write it");
  console.log("    READONLY " + t.readonly + "   correct today");
  console.log("    of the ESCAPES, REALISED " + t.realised + "   a caller really does store through the recovered value");
  console.log("  of ALL recoveries, fed by a MARKED static copy: " + t.fromMarked +
    "   (only these have an original that can diverge)");
  console.log("  ==> SILENT LOST WRITES: " + (t.lostLocal + t.lostViaCall) +
    "   (" + t.lostLocal + " local, " + t.lostViaCall + " across one call boundary)");
  for (const r of res.realised) { console.log("      " + r.caller + " <- " + r.callee); console.log("          " + r.store); }
}

function selftest() {
  const NL = String.fromCharCode(10);
  const facts = [];
  const rec = (n, ok, note) => facts.push({ n, ok, note });
  // Every line below is the SHAPE the emitter really produces, copied from
  // zapo's own TU (a trailing /* file:line */ comment after the opening
  // brace; a `sc_dc_` call inside an indented block; a retained alias). The
  // first version of this self-test invented tidier lines, passed 13/13, and
  // then scored a FALSE ZERO on 1 776 real sites.
  const src = [
    'static sc_rs_r1 *sc_dc_0(const ScrDyn *d, const ScrDynPath *path); /* check record:r1 */',
    'static ScrArr *sc_dc_1(const ScrDyn *d, const ScrDynPath *path); /* check array<f64> */',
    'static ScrStr *sc_da_2(const ScrDyn *d, const ScrDynPath *path, bool *ok); /* arm string */',
    'static SCR_STR_LIT(6) sc_lit_0 =',
    '    { SCR_STR_IMMORTAL, 5, 5, "hello" };',
    'static void sc_f_written(ScrDyn *sc_l_v_0) { /* G:/x/a.ts:12 */',
    '  sc_rs_r1 *sc_t0 = sc_dc_0(sc_l_v_0, NULL);',
    '  sc_rs_r1 *sc_t1 = sc_rretain_r1(sc_t0);',
    '  sc_t1->sc_fld_contextInfo = sc_t2; /* G:/x/a.ts:13 */',
    '}',
    // zapo's own shape: the record is copied into a dyn, MARKED, a sub-dyn is
    // taken out of the copy, recovered as a record, and returned.
    'static sc_rs_r1 * sc_f_escapes(sc_rs_r4 *sc_l_message_0) { /* G:/x/a.ts:20 */',
    '  if (scr_dyn_is_nullish(sc_l_message_0)) {',
    '    ScrDyn *sc_t8 = scr_dyn_mark_static_copy(sc_td_4(sc_l_message_0));',
    '    ScrDyn *sc_t9 = sc_dyn_key_get(sc_t8, sc_t7, false);',
    '    sc_rs_r1 *sc_t0 = sc_dc_0(sc_t9, NULL);',
    '    return sc_t0;',
    '  }',
    '  return NULL;',
    '}',
    // The same escape, but from a dyn that came FRESH out of a decode. No
    // original exists, so a caller writing through it loses nothing.
    // The OTHER spelling of the same escape: the checker hands back a bare
    // record and the emitter wraps it in a union before returning.
    'static ScrUnion * sc_f_escapes_wrapped(sc_rs_r4 *sc_l_message_0) { /* G:/x/a.ts:22 */',
    '  ScrDyn *sc_t8 = scr_dyn_mark_static_copy(sc_td_4(sc_l_message_0));',
    '  ScrDyn *sc_t9 = sc_dyn_key_get(sc_t8, sc_t7, false);',
    '  sc_rs_r1 *sc_t17 = sc_dc_0(sc_t9, NULL);',
    '  ScrUnion *sc_t18 = scr_union_new_ref(1, sc_t17, &sc_rretain_r1_v, &sc_rrelease_r1_v, NULL);',
    '  return sc_t18;',
    '}',
    'static void sc_f_caller_wrapped(sc_rs_r4 *m) { /* G:/x/a.ts:23 */',
    '  ScrUnion *sc_t44 = sc_f_escapes_wrapped(m);',
    '  sc_rs_r1 *sc_t45 = sc_f__x25_union_narrow_2(sc_t44);',
    '  sc_t45->sc_fld_contextInfo = sc_t51; /* G:/x/a.ts:24 */',
    '}',
    'static sc_rs_r1 * sc_f_escapes_fresh(ScrDyn *d) { /* G:/x/a.ts:25 */',
    '  ScrDyn *sc_t6 = scr_dyn_invoke(d, "decode", sc_t5, 1, "proto.X.decode");',
    '  sc_rs_r1 *sc_t7 = sc_dc_0(sc_t6, NULL);',
    '  return sc_t7;',
    '}',
    'static void sc_f_caller_fresh(ScrDyn *d) { /* G:/x/a.ts:26 */',
    '  sc_rs_r1 *sc_t0 = sc_f_escapes_fresh(d);',
    '  sc_t0->sc_fld_contextInfo = sc_t2; /* G:/x/a.ts:27 */',
    '}',
    'static void sc_f_readonly(ScrDyn *d) { /* G:/x/a.ts:30 */',
    '  sc_rs_r1 *sc_t0 = sc_dc_0(d, NULL);',
    '  scr_console_log(1, sc_t0);',
    '}',
    'static void sc_f_arraywrite(ScrDyn *d) { /* G:/x/a.ts:40 */',
    '  ScrArr *sc_t0 = sc_dc_1(d, NULL);',
    '  scr_arr_set_f64(sc_t0, 0, 1.0);',
    '}',
    'static void sc_f_notacomposite(ScrDyn *d) { /* G:/x/a.ts:50 */',
    '  bool ok = true;',
    '  ScrStr *sc_t0 = sc_da_2(d, NULL, &ok);',
    '  scr_console_log(1, sc_t0);',
    '}',
    'static void sc_f_caller(ScrDyn *d) { /* G:/x/a.ts:70 */',
    '  sc_rs_r1 *sc_t0 = sc_f_escapes(d);',
    '  sc_rs_r1 *sc_t1 = sc_f__x25_union_narrow_183(sc_t0);',
    '  sc_t1->sc_fld_contextInfo = sc_t2; /* G:/x/a.ts:71 */',
    '}',
    'static void sc_f_innocent(ScrDyn *d) { /* G:/x/a.ts:80 */',
    '  sc_rs_r1 *sc_t0 = sc_f_escapes(d);',
    '  scr_console_log(1, sc_t0);',
    '}',
    'static void sc_f_globalescape(ScrDyn *d) { /* G:/x/a.ts:60 */',
    '  sc_rs_r1 *sc_t0 = sc_dc_0(d, NULL);',
    '  sc_g_e_target = sc_t0;',
    '}',
    'static sc_rs_r1 *sc_dc_0(const ScrDyn *d, const ScrDynPath *path) { /* check record:r1 */',
    '  sc_rs_r1 *r = sc_rnew_r1();',
    '  sc_rs_r1 *sc_t0 = sc_dc_0(d, path);',
    '  r->sc_fld_inner = sc_t0;',
    '  return r;',
    '}',
  ].join(NL);
  const kinds = classifyCheckers(src);
  rec("classifies a record checker", kinds.get("sc_dc_0") && kinds.get("sc_dc_0").k === "record", JSON.stringify(kinds.get("sc_dc_0")));
  rec("classifies an array checker", kinds.get("sc_dc_1") && kinds.get("sc_dc_1").k === "array", JSON.stringify(kinds.get("sc_dc_1")));
  rec("classifies a string arm as neither", kinds.get("sc_da_2") && kinds.get("sc_da_2").k === "other", JSON.stringify(kinds.get("sc_da_2")));
  const names = [...functions(src)].map((f) => f.name);
  rec("the splitter finds every function DESPITE the trailing source comment",
    names.length === 13 && names[0] === "sc_f_written" && names[12] === "sc_dc_0", JSON.stringify(names));
  rec("the splitter does NOT mistake a string-literal struct for a function",
    !names.includes("sc_lit_0"), JSON.stringify(names));
  const r = analyse(src, kinds, 0);
  const t = r.totals;
  rec("the CHECKER body is skipped, the twelve program bodies are not",
    r.programFns === 12 && r.helperFns === 1, "program=" + r.programFns + " helper=" + r.helperFns);
  rec("pass 2 finds BOTH callers that store through an escaping recovery",
    r.totals.realised === 3 && r.realised.some((x) => x.caller === "sc_f_caller" && x.callee === "sc_f_escapes"),
    JSON.stringify(r.realised));
  rec("pass 2 does NOT charge a caller that only reads it",
    !r.realised.some((x) => x.caller === "sc_f_innocent"), JSON.stringify(r.realised));
  rec("only the MARKED-copy escapes are charged as SILENT LOST WRITES, in BOTH spellings",
    r.totals.lostViaCall === 2 && r.realised.filter((x) => x.fromMarked).length === 2 &&
      r.realised.filter((x) => x.fromMarked).map((x) => x.callee).sort().join(",") === "sc_f_escapes,sc_f_escapes_wrapped",
    "lostViaCall=" + r.totals.lostViaCall + " " + JSON.stringify(r.realised.map((x) => x.callee + ":" + x.fromMarked)));
  rec("a recovery from a FRESH decode is not charged, even though it IS written",
    r.totals.written >= 1 && r.totals.lostLocal === 0,
    "written=" + r.totals.written + " lostLocal=" + r.totals.lostLocal);
  rec("finds all eight program recovery call sites", t.recoveries === 8, "recoveries=" + t.recoveries);
  rec("a store through a RETAINED alias counts as WRITTEN", t.written === 2, "written=" + t.written);
  rec("a returned recovery from inside a BLOCK counts as ESCAPES",
    r.sites.some((s) => s.fn === "sc_f_escapes" && s.cls === "ESCAPES"),
    JSON.stringify(r.sites.map((s) => s.fn + ":" + s.cls)));
  rec("a globally stored recovery counts as ESCAPES", r.sites.some((s) => s.fn === "sc_f_globalescape" && s.cls === "ESCAPES"), "");
  rec("ESCAPES total is 4", t.escapes === 4, "escapes=" + t.escapes);
  rec("exactly two recoveries are fed by a MARKED static copy", t.fromMarked === 2, "fromMarked=" + t.fromMarked);
  rec("a read-only recovery is READONLY", t.readonly === 1, "readonly=" + t.readonly);
  rec("a non-composite recovery is counted apart", t.other === 1 && t.record === 6 && t.array === 1,
    "other=" + t.other + " record=" + t.record + " array=" + t.array);
  // negative control: the same source with every store removed must report 0 WRITTEN
  // and MUST NOT lose a recovery -- a sweep that reports 0 because it stopped
  // looking is the failure this project has paid for three times.
  const noWrite = src.split(NL).filter((l) => !/sc_t1->sc_fld_contextInfo\s*=/.test(l) && !/scr_arr_set_f64/.test(l)).join(NL);
  const r2 = analyse(noWrite, classifyCheckers(noWrite), 0);
  rec("removing every store drops WRITTEN to 0", r2.totals.written === 0, "written=" + r2.totals.written);
  rec("removing every store does NOT drop the recovery count", r2.totals.recoveries === 8, "recoveries=" + r2.totals.recoveries);
  // negative control: an empty TU reports zero, and zero is not evidence.
  const r3 = analyse("", new Map(), 0);
  rec("an empty TU reports 0 recoveries (and is therefore not evidence)", r3.totals.recoveries === 0, "");

  console.log("=== dyn-recover-census --selftest ===");
  let bad = 0;
  for (const f of facts) { if (!f.ok) bad++; console.log("  " + (f.ok ? "ok  " : "FAIL") + " " + f.n + (f.ok ? "" : "  <- " + f.note)); }
  console.log("  " + facts.length + " planted facts, " + (facts.length - bad) + " recovered, " + bad + " lost");
  return bad === 0 ? 0 : 1;
}

const argv = process.argv.slice(2);
if (argv.includes("--selftest")) process.exit(selftest());
const file = argv.find((a) => !a.startsWith("--"));
if (!file) { console.error("usage: dyn-recover-census.mjs --selftest | <tu.c> [--list N]"); process.exit(2); }
const li = argv.indexOf("--list");
const listLimit = li < 0 ? 0 : Number(argv[li + 1] || "40");
const src = fs.readFileSync(file, "utf8");
const kinds = resolveUnions(classifyCheckers(src), src);
if (kinds.size === 0) { console.error("ZERO CHECKERS: " + file + " declares no sc_dc_/sc_da_ helpers"); process.exit(2); }
const res = analyse(src, kinds, listLimit);
report(file, kinds, res);
// The static->dyn direction, for scale: how many conversions the compiler
// already judged observable and marked.
const marks = (src.match(/scr_dyn_mark_static_copy\(/g) || []).length;
console.log("  for scale, the OTHER direction: " + marks + " scr_dyn_mark_static_copy() sites (already loud on write)");
if (res.totals.recoveries === 0) { console.error("ZERO DENOMINATOR"); process.exit(2); }
process.exit(0);
