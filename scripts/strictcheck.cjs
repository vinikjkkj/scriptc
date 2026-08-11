// strictcheck.cjs — the STRICT extraction census.
//
// peekcheck.cjs answers "was some tag ruled out above this peek?".  That is
// not soundness.  Ruling tags OUT of a domain of unknown size never proves
// which arm is present; only an UPPER BOUND does — a positive test that
// says the tag IS one of a known set.
//
// So this analyser tracks, for every union-typed value, two separate facts:
//
//   UPPER  the tag is known to be in this set   (proof)
//   EXCL   the tag is known not to be in this set (not proof on its own)
//
// and it establishes them from every shape the emitter actually writes:
//
//   if (u->tag == N) { X }                    inside: UPPER {N}
//   if (u->tag != N) { X }                    inside: EXCL {N}
//   if (u->tag == N) { ...; return/throw }    after:  EXCL {N}
//   if (!ok) { ...; return/throw }            after:  UPPER (ok's tag set)
//   if (a == NULL || a->tag != N) return;     after:  UPPER {N}   (braceless)
//   } else {                                  inside: negation of the if
//   switch (u->tag) { case N:                 inside: UPPER {N}
//   bool t = u->tag == N;  ...  if (t) {      the bool is the predicate
//   bool t2 = t1; if (!(t2)) { t2 = u->tag == M; }   an OR-chain: UPPER {N,M}
//   cond ? peek(u) : X     / X : peek(u)      the CONDITIONAL-EXPRESSION rule
//   `}` \n `else {`                           the same construct as `} else {`
//   if (sc_ut_N(u)) { … }                     a ToBoolean helper with ONE
//                                             truthy arm IS a positive test
//   two peeks of the same union root          the same payload object
//
// An extraction is PROVEN only under an UPPER bound.  Everything reached
// with EXCL alone is reported as EXCL-ONLY together with the excluded set,
// because that is the shape whose soundness depends on a fact the emitted C
// does not carry: how many arms the union has — which is what
// SCRIPTC_EMIT_ARM_NOTES=1 puts there (`/*ARMS=n,TAG=t*/`, stripped here
// before the walk and reported in the last column, so an annotated TU
// classifies identically to a plain one).
//
// usage: node scripts/strictcheck.cjs <file.c> <outprefix>
//        node scripts/strictcheck.cjs scripts/strictcheck-fixtures/calib.c "" --selftest
//
// The fixture is the regression test: every extraction in it carries the
// verdict it must get, INCLUDING the negative controls that keep each rule
// from becoming a rubber stamp.  --selftest exits nonzero on any mismatch.
//
// Columns of the `.rows` file:
//   fn, line, primitive, verdict, upper-bound, excluded-set/shape, text,
//   arm-note ("<arms>,<tag>" when the TU was built with the notes on)
const fs = require("fs");

const file = process.argv[2];
const outPrefix = process.argv[3];

const EXTRACT = /scr_union_(peek|get_f64|get_bool)\(([A-Za-z_][A-Za-z0-9_]*)\)/g;
const FNDEF = /^[A-Za-z_].*\)\s*\{\s*(?:\/\*.*)?$/;
const FNNAME = /([A-Za-z_][A-Za-z0-9_]*)\s*\(/;
const ALIAS = /^\s*ScrUnion \*([A-Za-z_][A-Za-z0-9_]*) = (?:scr_union_retain|)\(?([A-Za-z_][A-Za-z0-9_]*)\)?\s*;/;
const RETAIN = /^\s*ScrUnion \*([A-Za-z_][A-Za-z0-9_]*) = scr_union_retain\(([A-Za-z_][A-Za-z0-9_]*)\)/;
const ATOM = /([A-Za-z_][A-Za-z0-9_]*)->tag (==|!=) (\d+)/g;
const TERM = /^(return\b|return;|throw\b|goto |scr_trap\(|continue;|break;)/;

const src = fs.readFileSync(file, "utf8").split("\n");

// `/*ARMS=n,TAG=t*/` — the arm-count note the emitter appends under
// SCRIPTC_EMIT_ARM_NOTES=1.  It is STRIPPED before the walk and kept in a
// side table: this analyser is text-based, so leaving the note in place
// would make the instrumented build classify differently from the plain one
// (the alias regexes anchor on `);` at end of line) and the two censuses
// would not be comparable.  Verified: with the strip, an instrumented TU
// classifies byte-identically to its uninstrumented twin.
const ARMNOTE = /\s*\/\*ARMS=(-?\d+),TAG=(\d+)\*\//;
const armNote = new Array(src.length).fill("");
for (let i = 0; i < src.length; i++) {
  const m = ARMNOTE.exec(src[i]);
  if (m) { armNote[i] = m[1] + "," + m[2]; src[i] = src[i].replace(ARMNOTE, ""); }
}

// Two shapes the line walk cannot see without help, both of which are real
// proof and both of which a scope walk reports as BARE:
//
//  (a) a TAG-EQUALITY guard between two values — `if (a->tag != b->tag)
//      return false;` opens the union equality helpers, and after it a fact
//      about a's tag is a fact about b's.
//  (b) a re-read of a tag-tested FIELD — `if (m->f->tag == 1) { … peek(a
//      SECOND read of m->f) … }`. The two reads are the same value provided
//      nothing wrote the field and nothing ran in between, so the field is
//      given a canonical root and that root is INVALIDATED by a store to
//      the field or by any call that is not a pure retain/release/read.
// ALLOCATION is on this list too, and the reason is narrow: `sc_rnew_rN()`
// and the `scr_*_new*` constructors return a FRESH object and take no
// pointer to an existing one, so no store they perform can reach the field
// under test. Without them the walk withdrew the field credit at the first
// `sc_rnew_r8()` in an entries/spread loop and reported a re-read that is
// three lines away from its own guard as if nothing had been tested
// (535-object-statics was the first one seen). `scr_map_get_str_ref` /
// `scr_map_has_str` / `scr_arr_get_*` are reads. Nothing that can run USER
// code is on this list — the c4 control still withdraws the credit.
const PURE_CALL =
  /^(scr_union_(?:retain|release|peek|get_f64|get_bool)|scr_arr_(?:get_ref|len)|scr_(?:str|bytes|arr|closure|error|dyn|promise|box)_(?:retain|release)|sc_rretain_\w+|sc_rrelease_\w+|sc_retain_\w+|sc_release_\w+|scr_box_get_ref|sc_rnew_[A-Za-z0-9_]+|scr_(?:arr|union|str|bytes|map|set)_new[A-Za-z0-9_]*|scr_map_(?:get_str_ref|has_str)|scr_arr_get_[a-z0-9_]+)$/;
const ANYRETAIN = /^\s*(?:const )?[A-Za-z_][A-Za-z0-9_]*\s*\*?\s*([A-Za-z_][A-Za-z0-9_]*) = (?:sc_rretain_[A-Za-z0-9_]+|sc_retain_[A-Za-z0-9_]+|scr_[a-z]+_retain)\(([A-Za-z_][A-Za-z0-9_]*)\)\s*;/;
const FIELDREAD = /^\s*ScrUnion \*([A-Za-z_][A-Za-z0-9_]*) = scr_union_retain\(([A-Za-z_][A-Za-z0-9_]*)->(sc_fld_[A-Za-z0-9_]+)\)\s*;/;
const FIELDSTORE = /^\s*[A-Za-z_][A-Za-z0-9_]*->(sc_fld_[A-Za-z0-9_]+) = /;
const TAGEQGUARD = /^\s*if \(([A-Za-z_][A-Za-z0-9_]*)->tag != ([A-Za-z_][A-Za-z0-9_]*)->tag\)\s*(?:return|\{)/;
const DECLNAME = /^\s*(?:const )?[A-Za-z_][A-Za-z0-9_]*\s*\*?\s*([A-Za-z_][A-Za-z0-9_]*) = /;
const CALLNAME = /\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
/** `sc_rs_rN *X = sc_rretain_rN((sc_rs_rN *)scr_union_peek(Y));` — the
 * PAYLOAD of union root Y.  Two peeks of the same root in the same block
 * are the same object, so the second one has to canonicalise to the first
 * or a `if (u.f !== undefined) { … u.f … }` written over an optional-record
 * arm loses its guard purely because the record was reached through the
 * union twice.  Invalidation is the field rule's: any impure call, any
 * store to the field, or a write to Y. */
const PEEKPAYLOAD =
  /^\s*[A-Za-z_][A-Za-z0-9_]*\s*\*\s*([A-Za-z_][A-Za-z0-9_]*) = (?:sc_rretain_[A-Za-z0-9_]+|scr_[a-z]+_retain)\(\((?:const )?[A-Za-z_][A-Za-z0-9_]*\s*\*\)scr_union_peek\(([A-Za-z_][A-Za-z0-9_]*)\)\)\s*;/;

/** The ToBoolean helpers.  `sc_ut_N` is the emitter's per-union
 * `ToBoolean`: a switch over the tag whose arms answer whether THAT arm's
 * payload is truthy.  If exactly ONE arm can ever answer true, then
 * `if (sc_ut_N(u))` is a positive tag test — an UPPER bound — and the `||`
 * / `??` / truthiness lowering's extraction under it is proven.  If two or
 * more arms can answer true it proves nothing and nothing is credited;
 * the FALSE side never proves anything either way (a falsy payload of the
 * truthy-capable arm also lands there), so `whenFalse` stays null. */
const UT = new Map();
function scanToBooleanHelpers(lines) {
  for (let i = 0; i < lines.length; i++) {
    const h = /^static bool (sc_ut_\d+)\(ScrUnion \*[A-Za-z_][A-Za-z0-9_]*\)\s*\{/.exec(lines[i]);
    if (!h) continue;
    const truthy = [];
    let ok = true;
    for (let j = i + 1; j < lines.length; j++) {
      // a trailing block comment (the fixture's EXPECT markers) is not an
      // arm shape — strip it before matching, or the scan gives up and the
      // helper is silently never registered.
      const t = lines[j].replace(/\s*\/\*.*\*\/\s*$/, "").trim();
      if (t === "}") break;
      const c = /^case (\d+): return (.*);$/.exec(t);
      if (c) { if (c[2] !== "false") truthy.push(c[1]); continue; }
      if (/^default: scr_trap\(/.test(t)) continue;
      if (/^switch \(/.test(t)) continue;
      ok = false; // an arm shape this scan does not understand: credit nothing
    }
    if (ok && truthy.length === 1) UT.set(h[1], truthy[0]);
  }
}
scanToBooleanHelpers(src);

let fn = "<top>";
let sameAs = new Map();
let alias = new Map();
let preds = new Map(); // name -> {root, tags:Set, positive:boolean}
let frames = []; // {depth, upper:Map<root,Set>, excl:Map<root,Set>, negOnTerm, switchRoot, caseUpper}
let depth = 0;
let pending = null; // condition facts to apply to the next opened block
let pendingNeg = null; // facts to apply to the enclosing frame if the block terminates
let lastReal = "";
let lastClosedNeg = null; // for `} else {`
let sawElse = false;

const root = (v) => { let n = 0; while (alias.has(v) && alias.get(v) !== v && n++ < 64) v = alias.get(v); return v; };

const peers = (r) => (sameAs.has(r) ? [r, sameAs.get(r)] : [r]);
function upperOf(r) {
  let best = null;
  for (const rr of peers(r)) {
    for (const f of frames) {
      const s = f.upper.get(rr);
      if (s) best = best === null ? new Set(s) : new Set([...best].filter((x) => s.has(x)));
      if (f.caseUpper && f.caseUpper.root === rr) best = new Set(f.caseUpper.tags);
    }
  }
  return best;
}
function exclOf(r) {
  const out = new Set();
  for (const rr of peers(r)) for (const f of frames) { const s = f.excl.get(rr); if (s) for (const x of s) out.add(x); }
  return out;
}
/** Every fact about a FIELD-derived root dies: a store to that field, or a
 * call that could have written it. */
function killFieldFacts(suffix) {
  for (const f of frames) {
    for (const m of [f.upper, f.excl]) {
      for (const k of [...m.keys()]) if (k.includes("->") && (suffix === null || k.endsWith(suffix))) m.delete(k);
    }
    if (f.caseUpper && f.caseUpper.root.includes("->")) f.caseUpper = null;
  }
}
function newFrame(d) { return { depth: d, upper: new Map(), excl: new Map(), negOnTerm: null, switchRoot: null, caseUpper: null }; }
function addUpper(f, r, tags) {
  const cur = f.upper.get(r);
  f.upper.set(r, cur ? new Set([...cur].filter((x) => tags.has(x))) : new Set(tags));
}
function addExcl(f, r, tags) {
  const cur = f.excl.get(r) ?? new Set();
  for (const t of tags) cur.add(t);
  f.excl.set(r, cur);
}
function applyFacts(f, facts) {
  if (!facts) return;
  for (const [r, tags, isUpper] of facts) { if (isUpper) addUpper(f, r, tags); else addExcl(f, r, tags); }
}

// Parse a C condition into {whenTrue:[[root,Set,isUpper]], whenFalse:[...]}.
// Recognised atoms are `X->tag == N` / `X->tag != N` and bare predicate
// variables that were bound to such an atom (possibly an OR-chain).
function parseCond(cond) {
  const atoms = [];
  ATOM.lastIndex = 0;
  let m;
  while ((m = ATOM.exec(cond)) !== null) atoms.push({ root: root(m[1]), eq: m[2] === "==", tag: m[3] });
  // A single-truthy-arm ToBoolean call IS a positive tag test.
  const ut = /^\s*(!?)\(?\s*(!?)\s*(sc_ut_\d+)\(([A-Za-z_][A-Za-z0-9_]*)\)\s*\)?\s*$/.exec(cond);
  if (atoms.length === 0 && ut && UT.has(ut[3])) {
    const neg = (ut[1] === "!") !== (ut[2] === "!");
    const fact = [[root(ut[4]), new Set([UT.get(ut[3])]), true]];
    return neg ? { whenTrue: null, whenFalse: fact } : { whenTrue: fact, whenFalse: null };
  }
  // a bare predicate variable, possibly negated
  const bare = /^\s*(!?)\(?\s*(!?)\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)?\s*$/.exec(cond);
  if (atoms.length === 0 && bare) {
    const neg = (bare[1] === "!") !== (bare[2] === "!");
    const p = preds.get(bare[3]);
    if (!p) return { whenTrue: null, whenFalse: null };
    const sense = neg ? !p.positive : p.positive;
    return sense
      ? { whenTrue: [[p.root, p.tags, true]], whenFalse: [[p.root, p.tags, false]] }
      : { whenTrue: [[p.root, p.tags, false]], whenFalse: [[p.root, p.tags, true]] };
  }
  if (atoms.length === 0) return { whenTrue: null, whenFalse: null };
  const hasOr = /\|\|/.test(cond);
  const hasAnd = /&&/.test(cond);
  if (atoms.length === 1 && !hasOr) {
    const a = atoms[0];
    return a.eq
      ? { whenTrue: [[a.root, new Set([a.tag]), true]], whenFalse: [[a.root, new Set([a.tag]), false]] }
      : { whenTrue: [[a.root, new Set([a.tag]), false]], whenFalse: [[a.root, new Set([a.tag]), true]] };
  }
  if (hasOr && !hasAnd) {
    // TRUE: if every atom is `== N` on one root, the tag is in their union.
    const roots = new Set(atoms.map((a) => a.root));
    const whenTrue =
      roots.size === 1 && atoms.every((a) => a.eq) ? [[atoms[0].root, new Set(atoms.map((a) => a.tag)), true]] : null;
    // FALSE: every disjunct is false, so every atom's negation holds.
    const whenFalse = atoms.map((a) => [a.root, new Set([a.tag]), !a.eq]);
    return { whenTrue, whenFalse };
  }
  if (hasAnd && !hasOr) {
    const whenTrue = atoms.map((a) => [a.root, new Set([a.tag]), a.eq]);
    return { whenTrue, whenFalse: null };
  }
  return { whenTrue: null, whenFalse: null };
}

/** The CONDITIONAL-EXPRESSION rule.
 *
 * A scope walk sees statements; the emitter also writes guards as `?:`
 * chains on ONE line, and every extraction inside one reads as BARE to a
 * line-based analyser even though a positive tag test dominates it:
 *
 *   bool t = (u->tag == 1 ? push_null(s)
 *           : u->tag == 2 ? push_str(s, (ScrStr *)scr_union_peek(u))
 *                         : push(s, (ScrBytes *)scr_union_peek(u)));
 *
 * The first extraction is dominated by `u->tag == 2` (UPPER {2}); the
 * second is in the final else of a chain that ruled out 1 and 2
 * (EXCL-ONLY, exactly the same standing as a statement-level `} else {`).
 *
 * `condFacts(text, off)` returns the facts that hold at character offset
 * `off` of one logical line, by locating every `? :` whose branch contains
 * that offset. Conditions are parsed by the SAME `parseCond` the statement
 * walk uses, so nothing is credited here that would not be credited there.
 */
function condFacts(text, off) {
  const out = [];
  const walk = (lo, hi) => {
    let d = 0, q = -1;
    for (let i = lo; i < hi; i++) {
      const c = text[i];
      if (c === "(" || c === "[") d++;
      else if (c === ")" || c === "]") d--;
      else if (c === "?" && d === 0) { q = i; break; }
    }
    if (q < 0) {
      // No conditional at this level: descend into each parenthesised group.
      let depth = 0, start = -1;
      for (let i = lo; i < hi; i++) {
        const c = text[i];
        if (c === "(" || c === "[") { if (depth === 0) start = i + 1; depth++; }
        else if (c === ")" || c === "]") { depth--; if (depth === 0 && start >= 0 && off > start && off < i) { walk(start, i); return; } }
      }
      return;
    }
    let d2 = 0, nest = 0, col = -1;
    for (let i = q + 1; i < hi; i++) {
      const c = text[i];
      if (c === "(" || c === "[") d2++;
      else if (c === ")" || c === "]") d2--;
      else if (d2 === 0) {
        if (c === "?") nest++;
        else if (c === ":") { if (nest === 0) { col = i; break; } nest--; }
      }
    }
    if (col < 0) return;
    const pc = parseCond(text.slice(lo, q));
    if (off > q && off < col) { if (pc.whenTrue) out.push(...pc.whenTrue); walk(q + 1, col); }
    else if (off > col && off < hi) { if (pc.whenFalse) out.push(...pc.whenFalse); walk(col + 1, hi); }
  };
  walk(0, text.length);
  return out;
}

const rows = [];
const counts = { total: 0, upper: 0, exclOnly: 0, bare: 0 };

function classify(lineNo, line, extras) {
  EXTRACT.lastIndex = 0;
  let m;
  while ((m = EXTRACT.exec(line)) !== null) {
    const kindPrim = m[1];
    const r = root(m[2]);
    counts.total++;
    let up = upperOf(r);
    let ex = exclOf(r);
    const all = [...(extras ?? []), ...condFacts(line, m.index)];
    for (const [rr, tags, isUpper] of all) {
      if (rr !== r) continue;
      if (isUpper) up = up ? new Set([...up].filter((x) => tags.has(x))) : new Set(tags);
      else for (const t of tags) ex.add(t);
    }
    let kind;
    if (up && up.size > 0) { kind = "UPPER"; counts.upper++; }
    else if (ex.size > 0) { kind = "EXCL-ONLY"; counts.exclOnly++; }
    else { kind = "BARE"; counts.bare++; }
    const exArr = [...ex].map(Number).sort((a, b) => a - b);
    let exShape = "";
    if (kind === "EXCL-ONLY") {
      const max = exArr[exArr.length - 1];
      const missing = [];
      for (let i = 0; i <= max; i++) if (!exArr.includes(i)) missing.push(i);
      exShape = (missing.length === 0 ? `CONTIGUOUS-0..${max}(TAIL)` : `GAP{${missing.join(",")}}/0..${max}`) + ` excl=${exArr.join("|")}`;
    }
    rows.push([fn, lineNo, kindPrim, kind, up ? "upper=" + [...up].join("|") : "", exShape, line.trim().slice(0, 130), armNote[lineNo - 1]].join("\t"));
  }
}

for (let i = 0; i < src.length; i++) {
  const line = src[i];
  const lineNo = i + 1;

  if (FNDEF.test(line) && !/^\s/.test(line)) {
    depth = 0;
    const nm = FNNAME.exec(line);
    fn = nm ? nm[1] : "<anon>";
    alias = new Map(); preds = new Map(); frames = [newFrame(0)]; sameAs = new Map();
    pending = null; pendingNeg = null; lastReal = ""; lastClosedNeg = null; sawElse = false;
  }
  if (frames.length === 0) frames = [newFrame(0)];

  // ---- case labels, BEFORE the extractions: `case N: return peek(v);` puts
  // the label and the extraction on one line.
  const cs0 = /^\s*case (\d+):/.exec(line);
  if (cs0) {
    for (let k = frames.length - 1; k >= 0; k--) {
      if (frames[k].switchRoot) { frames[k].caseUpper = { root: frames[k].switchRoot, tags: new Set([cs0[1]]) }; break; }
    }
  }
  if (/^\s*default:/.test(line)) {
    for (let k = frames.length - 1; k >= 0; k--) { if (frames[k].switchRoot) { frames[k].caseUpper = null; break; } }
  }

  // ---- same-line braceless guard: `if (cond) return;` / `if (cond) X;`
  const oneLine = /^\s*(?:\} else )?if \((.*)\)\s*([^{].*)$/.exec(line);
  let sameLineExtras = null;
  let afterGuard = null;
  if (oneLine) {
    const pc = parseCond(oneLine[1]);
    const body = oneLine[2].trim();
    if (TERM.test(body)) afterGuard = pc.whenFalse;
    else sameLineExtras = pc.whenTrue; // the extraction, if any, runs under the condition
  }

  classify(lineNo, line, sameLineExtras);
  if (afterGuard) applyFacts(frames[frames.length - 1], afterGuard);

  // ---- a plain assignment RE-BINDS the variable, so every tag fact about
  // it dies here.  Facts are scoped to the textual block, not to the value,
  // and a local that is written in a loop body would otherwise carry the
  // previous iteration's exclusions into the next one — which inflates the
  // excluded set and can dress an interior gap up as a tail.
  const asn = /^\s*([A-Za-z_][A-Za-z0-9_]*) = /.exec(line);
  if (asn) {
    const r = root(asn[1]);
    for (const f of frames) {
      f.upper.delete(r); f.excl.delete(r);
      // …and every DERIVED root: the payload behind it and that payload's
      // fields are a different object once the variable is rebound.
      for (const mp of [f.upper, f.excl]) for (const k of [...mp.keys()]) if (k.startsWith(r + "@") || k.startsWith(r + "->")) mp.delete(k);
      if (f.caseUpper && (f.caseUpper.root === r || f.caseUpper.root.startsWith(r + "@") || f.caseUpper.root.startsWith(r + "->"))) f.caseUpper = null;
    }
  }

  // ---- predicate bindings
  let pm = /^\s*bool ([A-Za-z_][A-Za-z0-9_]*) = (.*);\s*$/.exec(line);
  if (pm) {
    const name = pm[1];
    const rhs = pm[2];
    const a = /^([A-Za-z_][A-Za-z0-9_]*)->tag (==|!=) (\d+)$/.exec(rhs);
    if (a) preds.set(name, { root: root(a[1]), tags: new Set([a[3]]), positive: a[2] === "==" });
    else {
      const cp = /^(!?)\(?([A-Za-z_][A-Za-z0-9_]*)\)?$/.exec(rhs);
      if (cp && preds.has(cp[2])) {
        const p = preds.get(cp[2]);
        preds.set(name, { root: p.root, tags: new Set(p.tags), positive: cp[1] === "!" ? !p.positive : p.positive });
      } else {
        // a disjunction written inline: `a->tag == 1 || a->tag == 2`
        const pc = parseCond(rhs);
        if (pc.whenTrue && pc.whenTrue.length === 1 && pc.whenTrue[0][2]) {
          preds.set(name, { root: pc.whenTrue[0][0], tags: new Set(pc.whenTrue[0][1]), positive: true });
        } else preds.delete(name);
      }
    }
  } else {
    // OR-chain accumulation: `t2 = u->tag == M;` re-assigning an existing predicate
    const rm = /^\s*([A-Za-z_][A-Za-z0-9_]*) = ([A-Za-z_][A-Za-z0-9_]*)->tag (==|!=) (\d+);\s*$/.exec(line);
    if (rm && preds.has(rm[1])) {
      const p = preds.get(rm[1]);
      if (p.positive && rm[3] === "==" && p.root === root(rm[2])) p.tags.add(rm[4]);
      else preds.set(rm[1], { root: root(rm[2]), tags: new Set([rm[4]]), positive: rm[3] === "==" });
    }
  }

  // ---- a tag-equality guard makes the two values one, for tags
  const teq = TAGEQGUARD.exec(line);
  if (teq) sameAs.set(root(teq[2]), root(teq[1]));

  // ---- aliasing
  const fr = FIELDREAD.exec(line);
  const pp = fr ? null : PEEKPAYLOAD.exec(line);
  if (fr) alias.set(fr[1], root(fr[2]) + "->" + fr[3]);
  else if (pp) alias.set(pp[1], root(pp[2]) + "@peek");
  else {
    const ar = ANYRETAIN.exec(line);
    if (ar) alias.set(ar[1], root(ar[2]));
    else {
      const rt = RETAIN.exec(line);
      if (rt) { const r = root(rt[2]); alias.set(rt[1], r); }
      else {
        const al = ALIAS.exec(line);
        if (al) alias.set(al[1], root(al[2]));
        else {
          const d = DECLNAME.exec(line);
          if (d && !alias.has(d[1])) alias.set(d[1], d[1]);
        }
      }
    }
  }

  // ---- what invalidates a field-derived root
  const fs2 = FIELDSTORE.exec(line);
  if (fs2) killFieldFacts("->" + fs2[1]);
  CALLNAME.lastIndex = 0;
  let cn;
  while ((cn = CALLNAME.exec(line)) !== null) {
    const name = cn[1];
    if (/^(if|for|while|switch|return|sizeof)$/.test(name)) continue;
    if (PURE_CALL.test(name)) continue;
    killFieldFacts(null);
    break;
  }

  // ---- block-opening conditions
  const sw = /^\s*switch \(([A-Za-z_][A-Za-z0-9_]*)->tag\)/.exec(line);
  let pendingSwitch = null;
  if (sw) pendingSwitch = root(sw[1]);
  const ifb = /^\s*(?:\} else )?if \((.*)\)\s*\{\s*(?:\/\*.*)?$/.exec(line);
  if (ifb) {
    const pc = parseCond(ifb[1]);
    pending = pc.whenTrue;
    pendingNeg = pc.whenFalse;
  }
  // `} else {` and `} else if (...) {` — the negation of the if just closed
  // also holds, but only after this line's `}` has popped its frame, so the
  // flag is consumed inside the brace loop below.
  //
  // The emitter writes BOTH `} else {` and a bare `else {` on its own line
  // (the second whenever the `if` block ends with its own `}` line).
  // Matching only the joined spelling scored every extraction in a
  // split-spelling else-block as if no test had run at all — 2370's
  // `Map.groupBy` accumulate was the first one seen.
  const isElseLine = /^\s*(?:\} )?else\b/.test(line);
  if (isElseLine) sawElse = true;

  // ---- brace tracking (string and char literals stripped first, so a `{`
  // inside emitted XML or JSON text cannot drift the depth)
  const scan = line.replace(/\\./g, "").replace(/"[^"]*"/g, '""').replace(/'[^']*'/g, "''");
  for (const ch of scan) {
    if (ch === "{") {
      depth++;
      const f = newFrame(depth);
      if (sawElse) { applyFacts(f, lastClosedNeg); sawElse = false; }
      applyFacts(f, pending);
      f.negOnTerm = pendingNeg;
      if (pendingSwitch) { f.switchRoot = pendingSwitch; pendingSwitch = null; }
      frames.push(f);
      pending = null; pendingNeg = null;
    } else if (ch === "}") {
      const top = frames[frames.length - 1];
      if (top && top.depth === depth) {
        lastClosedNeg = top.negOnTerm;
        if (top.negOnTerm && TERM.test(lastReal)) {
          const parent = frames[frames.length - 2];
          if (parent) applyFacts(parent, top.negOnTerm);
        }
        frames.pop();
      }
      while (frames.length && frames[frames.length - 1].depth >= depth) frames.pop();
      depth--;
      if (depth <= 0) { depth = 0; if (frames.length === 0) frames = [newFrame(0)]; }
    }
  }
  const t = line.trim();
  if (t && t !== "{" && t !== "}") lastReal = t;
}

console.log("STRICT extraction census — " + file);
console.log("  extractions TOTAL            " + counts.total);
console.log("  PROVEN (an UPPER bound holds) " + counts.upper);
console.log("  EXCL-ONLY (arms ruled out, no upper bound) " + counts.exclOnly);
console.log("  BARE (nothing at all)        " + counts.bare);

const byShape = new Map();
for (const r of rows) {
  const f = r.split("\t");
  if (f[3] !== "EXCL-ONLY") continue;
  const key = /TAIL/.test(f[5]) ? "CONTIGUOUS-TAIL" : "INTERIOR-GAP";
  byShape.set(key, (byShape.get(key) ?? 0) + 1);
}
console.log("  … EXCL-ONLY by shape: " + [...byShape].map(([k, v]) => k + "=" + v).join(", "));

if (outPrefix) {
  fs.writeFileSync(outPrefix + ".rows", rows.join("\n") + "\n");
  const bare = rows.filter((r) => r.split("\t")[3] === "BARE");
  const ex = rows.filter((r) => r.split("\t")[3] === "EXCL-ONLY");
  fs.writeFileSync(outPrefix + ".bare", bare.join("\n") + "\n");
  fs.writeFileSync(outPrefix + ".exclonly", ex.join("\n") + "\n");
}

// ---- --selftest: every `/* EXPECT <kind>[, <kind>…] */` marker in the
// input must match the verdicts this analyser gives for the extractions on
// that line, in order.  The fixture carries the negative controls too, so a
// rule that turned into a rubber stamp fails here rather than in a report.
if (process.argv.includes("--selftest")) {
  let bad = 0, seen = 0;
  const byLine = new Map();
  for (const r of rows) {
    const f = r.split("\t");
    if (!byLine.has(f[1])) byLine.set(f[1], []);
    byLine.get(f[1]).push(f[3]);
  }
  for (let i = 0; i < src.length; i++) {
    const m = /\/\* EXPECT ([A-Z ,-]+?) \*\//.exec(src[i]);
    if (!m) continue;
    // `EXCL-ONLY TAIL` in the oldest fixture lines: the shape word is
    // reported separately, so compare kinds only.
    const want = m[1].split(",").map((s) => s.trim().replace(/^(UPPER|EXCL-ONLY|BARE).*$/, "$1"));
    const got = byLine.get(String(i + 1)) ?? [];
    seen += want.length;
    if (want.join("|") !== got.join("|")) {
      bad++;
      console.log(`  MISMATCH line ${i + 1}: expected [${want.join(", ")}] got [${got.join(", ")}]`);
      console.log(`           ${src[i].trim()}`);
    }
  }
  console.log(`selftest: ${seen} expectations, ${bad} mismatched`);
  process.exit(bad === 0 ? 0 : 1);
}
