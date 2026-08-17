// cen2.mjs — ONE census over an emitted scriptc C translation unit that sees
// EVERY compiler-planted runtime refusal and abort, with the categories kept
// apart.  Written for block/census2; it inherits no code from census.mjs or
// untagged.mjs, and it reproduces both of their headline numbers so the old
// and the new metric can be printed side by side from a single pass.
//
// WHY: three separate instruments have each measured one slice of this
// population and reported it as the whole:
//   census.mjs   greps `[SCxxxx at file:line]` — sees only fence throws whose
//                MESSAGE was tagged (7 of the 14 fence constructors tag).
//   untagged.mjs greps `scr_trap` — sees only the emitter-planted ABORTS, and
//                only the `sc_rkg_` family of them.
//   neither      sees `scr_throw_error_msg` (uncoded refusals), and neither
//                separates the SC9002 fall-through guards from real refusals.
//
// THE CATEGORIES (every emitted failure statement lands in exactly one):
//
//   REFUSAL      the compiler declined to compile a construct and deferred the
//                refusal to run time.  A defect surface: the program cannot do
//                what its source says.
//     .tagged      message carries `[SCxxxx at file:line]`   (census.mjs's TRAPS)
//     .untagged    coded SCxxxx, no bracket                  (invisible to census.mjs)
//     .uncoded     no SC code at all                         (invisible to BOTH,
//                                                             and to SCRIPTC_TRAP_TRACE)
//   ABORT        an uncatchable process abort (scr_trap / scr_trap_fmt,
//                0xC0000409).  Past every catch clause.
//     .real        `record has no key` — reachable on ordinary input
//     .structural  OOM guards, union-tag defaults, stringify-undefined-arm
//   BOILERPLATE  SC9002 "unreachable: a non-void function completed without
//                returning" — one per function whose fall-through the lowering
//                cannot prove dead.  Not a refusal.
//   PARITY       a throw the program is SUPPOSED to make: Node's own
//                TypeError/ReferenceError at the same point (TDZ, destructuring
//                null, "Cannot read properties of undefined", not-iterable,
//                the data-listener chunk mismatch, node-coded errors).
//   DYNCHECK     scr_dyn_check_fail — the dyn->static boundary validator
//                ("expected string at $, got undefined").  Catchable.  Not a
//                refusal (the construct DID compile) and not boilerplate: it is
//                the class that fires on zapo's incoming decrypt.
//   USERTHROW    the program's own `throw` (scr_throw_obj/str/ref, rethrow).
//                Reported for context and never counted as a compiler failure.
//
// SILENT-FAILURE DIRECTION: any statement in a failure family whose message is
// not in the classification table lands in UNKNOWN and the process exits 3.
// A zero denominator, a bracket outside a coded throw, and a family total that
// does not equal the sum of its categories each exit non-zero too.  The
// instrument is built so that "I did not understand this" cannot read as zero.
//
// usage: node scripts/tu-census.mjs <tu.c> [--sites <out>] [--json <out>] [--quiet]
import { readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const file = args[0];
if (!file || file.startsWith("-")) {
  console.error("usage: node scripts/tu-census.mjs <tu.c> [--sites <out>] [--json <out>] [--quiet]");
  process.exit(2);
}
const optOf = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
};
const sitesOut = optOf("--sites");
const jsonOut = optOf("--json");
const quiet = args.includes("--quiet");

// Read as latin1 (bytes, never re-encoded).  The emitted TU mixes two
// spellings of the SAME em dash: cStringLiteral() octal-escapes non-ASCII
// (\342\200\224) while the scr_trap templates carry raw UTF-8 bytes.  Matching
// on the character would silently miss one of the two families.
const raw = readFileSync(file, "latin1");
const lines = raw.split("\n");

let exitCode = 0;
const problems = [];
const fail = (why) => { problems.push(why); exitCode = 3; };

// ---------------------------------------------------------------- 1. hosts
// Every emitted definition starts at column 0 and closes with `}` at column 0.
// hostAt(i) is the definition enclosing line i, or null at file scope.
const hostName = new Array(lines.length).fill(null);
const hostBodyLines = new Map();   // name -> body line count
const hostFirstLine = new Map();
{
  const DEF = /^(?:static\s)?[A-Za-z_][^;=]*?\b([A-Za-z_][A-Za-z0-9_]*)\s*\([^;]*$/;
  let cur = null, start = 0;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (cur === null) {
      if (l.length === 0 || l[0] === " " || l[0] === "\t" || l[0] === "}") continue;
      if (l.endsWith(";")) continue;                 // prototype
      if (!l.includes("(")) continue;
      const m = DEF.exec(l);
      if (m && (l.includes("{") || (lines[i + 1] ?? "").startsWith("{"))) {
        cur = m[1]; start = i;
        if (!hostFirstLine.has(cur)) hostFirstLine.set(cur, i);
      }
      if (cur !== null) hostName[i] = cur;
      continue;
    }
    hostName[i] = cur;
    if (l === "}") { hostBodyLines.set(cur, i - start + 1); cur = null; }
  }
}

// -------------------------------------------------------- 2. classification
const EMDASH = "(?:\\\\342\\\\200\\\\224|\\u00e2\\u0080\\u0094)";  // both spellings
const SC9002_MSG = new RegExp(
  "^unreachable: a non-void function completed without returning " +
  "\\(the checker proved every path returns\\) " + EMDASH + " please report this$",
);

// A REFUSAL message that carries no bracket is still a refusal.  These are the
// six lowering constructors + one backend one that do not tag, keyed by a
// distinctive fragment of the message each of them builds.  Every fragment was
// read out of the compiler source at 0d84672f, and the site is named so a
// reader can check it rather than trust it.
const UNTAGGED_REFUSAL_SITES = [
  { re: /has no compiled implementation \(/,                       site: "lower-calls.ts:526 (PROSE)" },
  { re: /writing the function member '.*' through a DYNAMIC reference/, site: "lower-expando.ts:605" },
  { re: /export is .* of the compiled program, which cannot cross into 'unknown' yet/, site: "lower-island.ts:815 dynTrapFnValue" },
  { re: /^this function's body has no static lowering$/,           site: "lower-exprs.ts:5845 fenceClosureProbe (fallback msg)" },
  { re: /the 'ws' package's option-bag second argument/,           site: "emit-ws.ts:446 (backend, no loc)" },
  { re: /the 'ws' package's '(agent|dispatcher)' option/,          site: "emit-ws.ts:446 (backend, no loc)" },
];
// Two untagged constructors lift the refusal into a NAMED function, and the
// name is a unique template — so the row is attributable even though its
// message is an arbitrary diagnostic text.  `%fence.fn.N` and `%fnN_dyntrap`
// mangle `%` to `_x25_` and `.` to `_`.
const HOST_ATTRIB = [
  { re: /^sc_f__x25_fence_fn_\d+$/, site: "lower-exprs.ts:5845 fenceClosureProbe" },
  { re: /^sc_f__x25_fn\d+_dyntrap$/, site: "lower-island.ts:815 dynTrapFnValue" },
  { re: /^sc_wsw_/,                 site: "emit-ws.ts:446 (backend, no loc)" },
];
const PARITY_CODED = [
  { re: /^destructuring a null\/undefined value \(Node throws TypeError here\)$/, site: "lower-stmts.ts:1736 SC1031" },
];

const ABORT_STRUCTURAL = [
  { re: /^scriptc: out of memory/,                                    what: "OOM allocation guard" },
  { re: /^scriptc: internal error: invalid union tag/,                what: "union-tag switch default" },
  { re: /^scriptc: internal error: stringify reached an undefined arm/, what: "stringify undefined arm" },
];
const ABORT_REAL = [
  { re: /^scriptc: TypeError: record has no key '%\.\*s' \(typed '([^']*)'/, what: "keyed read, absent key" },
];

const UNCODED_REFUSAL = [
  { re: /cannot be called through it \(its parameters have no checked-dynamic form\)/,
    site: "emit-walkers.ts:2077 strandedDynFuncBoxHelper" },
];
const UNCODED_PARITY = [
  { re: /^a 'data' listener declaring a (Buffer chunk received a string|string chunk received a Buffer)/,
    site: "emit-async.ts:1105/1114" },
];

// ------------------------------------------------------------- 3. the scan
const CODED = /scr_throw_error_msg_code\(\s*([A-Z_]+)\s*,\s*"((?:[^"\\]|\\.)*)"\s*,\s*(\d+)\s*,\s*"([^"]*)"\s*\)/g;
const UNCODED = /scr_throw_error_msg\(\s*([A-Z_]+)\s*,\s*(?:"((?:[^"\\]|\\.)*)"|([A-Za-z_][A-Za-z0-9_]*))\s*,/g;
const TRAP = /\bscr_trap(_fmt)?\s*\(\s*"((?:[^"\\]|\\.)*)"/g;
const TAGRE = /\[SC(\d{4}) at ([^\]]+)\]/g;

const rows = [];        // one per emitted failure statement
const bump = (map, k, n = 1) => map.set(k, (map.get(k) ?? 0) + n);

let nCodedCalls = 0, nUncodedCalls = 0, nTrapCalls = 0;
for (let i = 0; i < lines.length; i++) {
  const l = lines[i];

  if (l.includes("scr_throw_error_msg_code(")) {
    let m, seen = 0;
    CODED.lastIndex = 0;
    while ((m = CODED.exec(l)) !== null) {
      seen++; nCodedCalls++;
      const msg = m[2], code = m[4];
      TAGRE.lastIndex = 0;
      const tag = TAGRE.exec(msg);
      let cat, site;
      if (tag) { cat = "REFUSAL.tagged"; site = `SC${tag[1]} at ${tag[2]}`; }
      else if (code === "SC9002" && SC9002_MSG.test(msg)) { cat = "BOILERPLATE"; site = "lower-calls.ts:1028 SC9002"; }
      else {
        const p = PARITY_CODED.find((x) => x.re.test(msg));
        const u = UNTAGGED_REFUSAL_SITES.find((x) => x.re.test(msg));
        const h = HOST_ATTRIB.find((x) => x.re.test(hostName[i] ?? ""));
        if (p) { cat = "PARITY"; site = p.site; }
        else if (u) { cat = "REFUSAL.untagged"; site = u.site; }
        else if (h) { cat = "REFUSAL.untagged"; site = h.site; }
        else {
          // A coded throw with an SC code and a diagnostic message that is
          // neither the SC9002 guard nor a known parity throw IS a refusal.
          // Counting it as one is the conservative direction; what is lost is
          // only the emitter attribution, which is reported separately so it
          // cannot pass as attributed.
          cat = "REFUSAL.untagged"; site = "UNATTRIBUTED";
        }
      }
      rows.push({ line: i + 1, family: "coded", cat, code, site, msg, host: hostName[i] });
    }
    if (seen === 0) {
      rows.push({ line: i + 1, family: "coded", cat: "UNKNOWN", code: "?", site: "unparsed", msg: l.trim().slice(0, 200), host: hostName[i] });
      nCodedCalls++;
    }
  }

  if (/scr_throw_error_msg\s*\(/.test(l)) {
    let m, seen = 0;
    UNCODED.lastIndex = 0;
    while ((m = UNCODED.exec(l)) !== null) {
      seen++; nUncodedCalls++;
      // the emit-async spelling puts the text in a `static const char sc_m[]`
      // on the PREVIOUS line; recover it so the row is classifiable.
      let msg = m[2];
      if (msg === undefined) {
        const prev = lines[i - 1] ?? "";
        const q = /"((?:[^"\\]|\\.)*)"/.exec(prev);
        msg = q ? q[1] : `<symbol ${m[3]}>`;
      }
      const u = UNCODED_REFUSAL.find((x) => x.re.test(msg));
      const p = UNCODED_PARITY.find((x) => x.re.test(msg));
      const cat = u ? "REFUSAL.uncoded" : p ? "PARITY" : "UNKNOWN";
      rows.push({ line: i + 1, family: "uncoded", cat, code: "-", site: (u ?? p)?.site ?? "?", msg, host: hostName[i] });
    }
    if (seen === 0) {
      rows.push({ line: i + 1, family: "uncoded", cat: "UNKNOWN", code: "-", site: "unparsed", msg: l.trim().slice(0, 200), host: hostName[i] });
      nUncodedCalls++;
    }
  }

  if (l.includes("scr_trap")) {
    let m, seen = 0;
    TRAP.lastIndex = 0;
    while ((m = TRAP.exec(l)) !== null) {
      seen++; nTrapCalls++;
      const msg = m[2].replace(/\\n$/, "");
      const r = ABORT_REAL.find((x) => x.re.test(msg));
      const s = ABORT_STRUCTURAL.find((x) => x.re.test(msg));
      const cat = r ? "ABORT.real" : s ? "ABORT.structural" : "UNKNOWN";
      const t = r ? (ABORT_REAL[0].re.exec(msg) ?? [])[1] : null;
      rows.push({ line: i + 1, family: "trap", cat, code: m[1] ? "trap_fmt" : "trap", site: (r ?? s)?.what ?? "?", msg, host: hostName[i], valueType: t });
    }
    if (seen === 0 && /\bscr_trap(_fmt)?\s*\(/.test(l)) {
      rows.push({ line: i + 1, family: "trap", cat: "UNKNOWN", code: "trap", site: "unparsed", msg: l.trim().slice(0, 200), host: hostName[i] });
      nTrapCalls++;
    }
  }
}

// ------------------------------------------- 4. the OLD instruments, verbatim
// census.mjs: TRAPS = every bracket occurrence anywhere in the file.
const oldSites = new Map();
const oldCodes = new Map();
let oldTraps = 0;
TAGRE.lastIndex = 0;
for (let m; (m = TAGRE.exec(raw)) !== null; ) {
  oldTraps++;
  bump(oldSites, `SC${m[1]} at ${m[2]}`);
  bump(oldCodes, `SC${m[1]}`);
}
const oldProse = (raw.match(/has no compiled implementation/g) ?? []).length;

// CONTROL: every bracket must live inside a coded throw.  census.mjs's
// numerator is only clean if nothing else in 127 MB spells `[SCxxxx at ...]`.
const taggedRows = rows.filter((r) => r.cat === "REFUSAL.tagged").length;
if (taggedRows !== oldTraps) {
  fail(`bracket occurrences (${oldTraps}) != tagged coded throws (${taggedRows}) — a [SCxxxx at ...] lives outside a fence throw, or a throw carries two`);
}

// ------------------------------------------------------- 5. the call-site unit
// A statement is one way to die WHERE IT SITS.  A statement that is the whole
// body of a dedicated stub is one way to die PER CALLER — which is the unit
// `block/untagged` had to invent for the keyed-read helpers (103 call sites
// behind 24 statements).  The same correction applies to fence stubs and to
// the stranded-dyn thunks, so it is applied to all three here.
// A statement inside an ordinary program function is ONE way to die: it
// corresponds to one place in the source.  A statement inside a helper the
// EMITTER synthesises and SHARES between unrelated source sites is one way to
// die PER CALLER — that is the correction `block/untagged` had to invent when
// it found 24 `record has no key` statements standing for 208 call sites.  The
// helper families are named by the emitter's own mangling, so the rule is a
// name test and not a body-length guess: an earlier version of this census
// used "body <= 8 lines" and undercounted by 6 call sites, because a keyed-read
// helper on a HYBRID shape emits one `if` per declared field and runs to
// hundreds of lines (§ my own wrong measurements).
const SHARED_HELPER = [
  /^sc_rkg_\d+$/,                  // r[k] keyed read            (emit-walkers)
  /^sc_dfs_\d+_thunk$/,            // stranded dyn func thunk    (emit-walkers:2077)
  /^sc_wsw_\d+$/,                  // WebSocket ctor wrapper     (emit-ws)
  /^sc_f__x25_fence_fn_\d+$/,      // fenceClosureProbe stub     (lower-exprs:5845)
  /^sc_f__x25_fn\d+_dyntrap$/,     // island export trap value   (lower-island:815)
];
const wanted = new Set();
for (const r of rows) {
  r.stub = r.host !== null && SHARED_HELPER.some((re) => re.test(r.host));
  if (r.stub) wanted.add(r.host);
}
// ONE pass for every wanted name at once: a per-name regex over a 127 MB
// string is ~1 s each and there are hundreds of stubs.  `total` counts
// `name(`; `decl` counts the ones that open at column 0 (the prototype and the
// definition header, which mention the name without calling it); `ptr` counts
// `&name`, the function-POINTER spelling, which is how a lifted closure is
// handed to scr_closure_new and is NOT a countable call site.
// A LIFTED stub is reached through a closure value: the emitter builds
// `sc_w_<suffix>` (the closure trampoline) and an immortal `sc_fc_<suffix>`
// closure struct holding `&sc_w_<suffix>`, and the stub itself is then called
// exactly ONCE by name — from the trampoline.  Its real number of ways to die
// is the number of times the closure VALUE is invoked, which is not statically
// countable (block/deeper: an sc_f_ walk is degenerate for lifted closures).
// The census says so instead of printing a 1 that looks like a measurement.
const closureOf = (h) => (h.startsWith("sc_f_") ? "sc_fc_" + h.slice(5) : null);
const closureSeen = new Set();
const total = new Map(), decl = new Map(), ptr = new Map();
for (const r of rows) {
  const c = r.stub ? closureOf(r.host) : null;
  if (c !== null && raw.includes(c + " ")) closureSeen.add(r.host);
}
if (wanted.size > 0) {
  const CALL = /(^|[^A-Za-z0-9_])([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    // Emitted STATEMENTS are always indented; a mention of `name(` on a line
    // that starts at column 0 is the prototype or the definition header, which
    // is a declaration and not a call.  (untagged.mjs subtracts exactly these
    // two per helper; this generalises the same rule without assuming the
    // `static` keyword.)
    const isDeclLine = l.length > 0 && l[0] !== " " && l[0] !== "\t";
    CALL.lastIndex = 0;
    for (let m; (m = CALL.exec(l)) !== null; ) {
      const n = m[2];
      if (!wanted.has(n)) continue;
      bump(total, n);
      if (isDeclLine) bump(decl, n);
    }
    const amp = l.indexOf("&");
    if (amp >= 0) {
      const PTR = /&([A-Za-z_][A-Za-z0-9_]*)\b/g;
      for (let m; (m = PTR.exec(l)) !== null; ) if (wanted.has(m[1])) bump(ptr, m[1]);
    }
  }
}
for (const r of rows) {
  if (r.stub) {
    const direct = Math.max(0, (total.get(r.host) ?? 0) - (decl.get(r.host) ?? 0));
    const p = ptr.get(r.host) ?? 0;
    // A stub reached ONLY through a function pointer (closure env, vtable
    // slot) has at least one caller and no countable one — block/deeper's
    // warning that an sc_f_ closure walk is degenerate for lifted closures.
    r.ways = direct + (direct === 0 && p > 0 ? 1 : 0);
    r.ptr = p; r.direct = direct;
    r.viaClosure = closureSeen.has(r.host) || (direct === 0 && p > 0);
  } else {
    r.ways = 1; r.ptr = 0; r.direct = 0;
  }
}

// ------------------------------------------------------------ 6. accounting
const byCat = new Map();
const waysByCat = new Map();
for (const r of rows) { bump(byCat, r.cat); bump(waysByCat, r.cat, r.ways); }
const statements = rows.length;
if (statements === 0) fail("zero failure statements in the whole TU — an empty or wrong input file reads exactly like a perfect one");
if (nCodedCalls + nUncodedCalls + nTrapCalls !== statements) {
  fail(`family totals ${nCodedCalls}+${nUncodedCalls}+${nTrapCalls} != ${statements} rows`);
}
const nUnknown = byCat.get("UNKNOWN") ?? 0;
if (nUnknown > 0) fail(`${nUnknown} failure statement(s) with a message this census does not classify`);

// context populations (not compiler failures; printed so the report cannot be
// read as "these are all the throws in the program")
const ctx = {
  USERTHROW: (raw.match(/\bscr_throw_(obj|str|ref)\s*\(/g) ?? []).length,
  rethrow: (raw.match(/\bscr_rethrow\s*\(/g) ?? []).length,
  DYNCHECK: (raw.match(/\bscr_dyn_check_fail\s*\(/g) ?? []).length,
  PARITY_named: (raw.match(/\bscr_throw_error_named\s*\(/g) ?? []).length,
  PARITY_nodecoded: (raw.match(/\bscr_throw_node_coded\s*\(/g) ?? []).length,
  PARITY_error: (raw.match(/\bscr_throw_error\s*\(/g) ?? []).length,
};

// ---------------------------------------------------------------- 7. output
const out = [];
const say = (s) => out.push(s);
say(`FILE   ${file}   ${raw.length} bytes   ${lines.length} lines`);
say("");
say("=== THE OLD INSTRUMENTS, REPRODUCED ============================");
say(`census.mjs   TRAPS ${oldTraps}   SITES ${oldSites.size}   PROSE ${oldProse}`);
const rkg = rows.filter((r) => r.cat === "ABORT.real");
const rkgWays = rkg.reduce((a, b) => a + b.ways, 0);
say(`untagged.mjs TRAP STATEMENTS ${nTrapCalls}   'record has no key' STATEMENTS ${rkg.length}   ABORTABLE CALL SITES ${rkgWays}`);
say("");
say("=== THE WHOLE POPULATION, BY CATEGORY ==========================");
say("                          statements   ways-to-die   (a stub counts once per caller)");
const order = ["REFUSAL.tagged", "REFUSAL.untagged", "REFUSAL.uncoded", "ABORT.real",
               "ABORT.structural", "BOILERPLATE", "PARITY", "UNKNOWN"];
for (const c of order) {
  const n = byCat.get(c) ?? 0;
  if (n === 0 && c === "UNKNOWN") continue;
  say(`  ${c.padEnd(22)} ${String(n).padStart(8)}   ${String(waysByCat.get(c) ?? 0).padStart(10)}`);
}
say(`  ${"TOTAL".padEnd(22)} ${String(statements).padStart(8)}   ${String([...waysByCat.values()].reduce((a, b) => a + b, 0)).padStart(10)}`);
say("");
const refusalStmts = (byCat.get("REFUSAL.tagged") ?? 0) + (byCat.get("REFUSAL.untagged") ?? 0) + (byCat.get("REFUSAL.uncoded") ?? 0);
const refusalWays = (waysByCat.get("REFUSAL.tagged") ?? 0) + (waysByCat.get("REFUSAL.untagged") ?? 0) + (waysByCat.get("REFUSAL.uncoded") ?? 0);
say(`REFUSALS (all three kinds)   ${refusalStmts} statements / ${refusalWays} ways to die`);
say(`ABORTS   (real, uncatchable) ${(byCat.get("ABORT.real") ?? 0)} statements / ${(waysByCat.get("ABORT.real") ?? 0)} call sites`);
say("");
say("=== EVERY REFUSAL THE OLD TRAP CENSUS CANNOT SEE ===============");
const invisible = rows.filter((r) => r.cat === "REFUSAL.untagged" || r.cat === "REFUSAL.uncoded");
if (invisible.length === 0) say("  (none)");
const invBySite = new Map();
for (const r of invisible) {
  const k = `${r.cat}${r.code}${r.site}${r.msg.slice(0, 100)}`;
  if (!invBySite.has(k)) invBySite.set(k, { r, n: 0, ways: 0, hosts: new Set(), clo: false });
  const e = invBySite.get(k); e.n++; e.ways += r.ways; e.hosts.add(r.host ?? "<file scope>");
  if (r.viaClosure) e.clo = true;
}
for (const [, e] of [...invBySite].sort((a, b) => b[1].n - a[1].n)) {
  const w = e.clo ? `>=${e.ways} (through a closure VALUE — not statically countable)` : String(e.ways);
  say(`  x${String(e.n).padStart(3)}  ways=${w}  ${e.r.cat}  ${e.r.code}`);
  say(`        emitter: ${e.r.site}`);
  say(`        host(s): ${[...e.hosts].slice(0, 4).join(", ")}${e.hosts.size > 4 ? ` +${e.hosts.size - 4}` : ""}`);
  say(`        msg: ${e.r.msg.slice(0, 150)}`);
}
say("");
say("=== ABORTS, BY VALUE TYPE (the 103 unit) =======================");
const byType = new Map();
for (const r of rkg) bump(byType, r.valueType ?? "?", r.ways);
for (const [t, n] of [...byType].sort((a, b) => b[1] - a[1])) say(`  ${String(n).padStart(5)}  ${t}`);
say("");
say("=== STRUCTURAL / PARITY, FOR COMPLETENESS ======================");
const bySite = new Map();
for (const r of rows) if (r.cat === "ABORT.structural" || r.cat === "BOILERPLATE" || r.cat === "PARITY") bump(bySite, `${r.cat}  ${r.site}`);
for (const [s, n] of [...bySite].sort((a, b) => b[1] - a[1])) say(`  ${String(n).padStart(6)}  ${s}`);
say("");
say("=== NOT COMPILER FAILURES (context; never counted above) =======");
say(`  the program's own throw   scr_throw_obj/str/ref ${ctx.USERTHROW}   scr_rethrow ${ctx.rethrow}`);
say(`  Node-parity throws        scr_throw_error_named ${ctx.PARITY_named}   scr_throw_node_coded ${ctx.PARITY_nodecoded}   scr_throw_error ${ctx.PARITY_error}`);
say(`  dyn boundary validator    scr_dyn_check_fail ${ctx.DYNCHECK}   (catchable; "expected X at $, got Y")`);
say("");
say("=== ACCOUNTING =================================================");
say(`  coded throws ${nCodedCalls} = tagged ${byCat.get("REFUSAL.tagged") ?? 0} + untagged ${byCat.get("REFUSAL.untagged") ?? 0} + SC9002 ${byCat.get("BOILERPLATE") ?? 0} + parity ${rows.filter((r) => r.family === "coded" && r.cat === "PARITY").length} + unknown ${rows.filter((r) => r.family === "coded" && r.cat === "UNKNOWN").length}`);
say(`  uncoded throws ${nUncodedCalls} = refusal ${byCat.get("REFUSAL.uncoded") ?? 0} + parity ${rows.filter((r) => r.family === "uncoded" && r.cat === "PARITY").length} + unknown ${rows.filter((r) => r.family === "uncoded" && r.cat === "UNKNOWN").length}`);
say(`  traps ${nTrapCalls} = real ${byCat.get("ABORT.real") ?? 0} + structural ${byCat.get("ABORT.structural") ?? 0} + unknown ${rows.filter((r) => r.family === "trap" && r.cat === "UNKNOWN").length}`);
say(`  bracket occurrences ${oldTraps} == tagged coded throws ${taggedRows}`);
if (problems.length) {
  say("");
  say("*** CENSUS FAILED ***");
  for (const p of problems) say(`  ! ${p}`);
  for (const r of rows.filter((x) => x.cat === "UNKNOWN").slice(0, 20)) {
    say(`  ! line ${r.line} [${r.family}] ${r.msg.slice(0, 160)}`);
  }
}
const text = out.join("\n");
if (!quiet) console.log(text);

if (sitesOut) {
  const s = [...new Set(rows.filter((r) => r.cat === "REFUSAL.tagged").map((r) => r.site))].sort();
  const u = [...new Set(invisible.map((r) => `${r.cat} ${r.code} ${r.site} :: ${r.msg.slice(0, 120)}`))].sort();
  writeFileSync(sitesOut, s.join("\n") + "\n#UNTAGGED/UNCODED\n" + u.join("\n") + "\n");
}
if (jsonOut) {
  writeFileSync(jsonOut, JSON.stringify({
    file, bytes: raw.length,
    old: { traps: oldTraps, sites: oldSites.size, prose: oldProse },
    statements, byCat: Object.fromEntries(byCat), waysByCat: Object.fromEntries(waysByCat),
    ctx, rows: rows.map((r) => ({ line: r.line, cat: r.cat, code: r.code, site: r.site, host: r.host, ways: r.ways, msg: r.msg.slice(0, 200) })),
  }, null, 1));
}
process.exit(exitCode);
