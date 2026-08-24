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
// THE LANE: this census reads BOTH program TUs the compiler can emit.  The
// release default is the LLVM lane (index.ts initialises `backend = "c"` and
// then `if (opts.backend !== "c")` emits the .ll first, falling back to C only
// on an LlvmUnsupportedError tier refusal), so a reader that understands only
// C is blind to whatever the shipping artefact was actually emitted from.  An
// .ll fed to the C reader used to exit through *** CENSUS FAILED *** with 97
// unclassified rows, which reads exactly like a compiler regression and is
// really a wrong-lane instrument.  The lane is decided by CONTENT and checked
// against the extension.
//
// usage: node scripts/tu-census.mjs <tu.c|tu.ll> [--sites <out>] [--json <out>] [--quiet]
import { readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const file = args[0];
if (!file || file.startsWith("-")) {
  console.error("usage: node scripts/tu-census.mjs <tu.c|tu.ll> [--sites <out>] [--json <out>] [--quiet]");
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

// ---------------------------------------------------------------- 0. lane
// A C TU has #include lines at column 0 and no `define`/`declare` there; an
// LLVM TU is the exact opposite.  Both sides are counted so "neither" and
// "both" stay distinguishable from each other, and the extension must agree:
// naming a file .c and feeding it IR is the accident this whole change exists
// to make impossible.
const N_LL = (raw.match(/^(?:declare|define) /gm) ?? []).length;
const N_C = (raw.match(/^#include /gm) ?? []).length;
const extLl = /\.ll$/i.test(file);
let lane;
if (N_LL > 0 && N_C === 0) lane = "llvm";
else if (N_C > 0 && N_LL === 0) lane = "c";
else if (raw.length === 0) lane = extLl ? "llvm" : "c";  // an EMPTY input must still reach the zero-denominator check below
else {
  console.error(`tu-census: cannot tell the lane of ${file} (${N_LL} llvm markers, ${N_C} C markers)`);
  process.exit(4);
}
if (raw.length > 0 && (extLl || /\.c$/i.test(file)) && lane !== (extLl ? "llvm" : "c")) {
  console.error(`tu-census: ${file} is named .${extLl ? "ll" : "c"} but its CONTENT is the ${lane} lane`);
  process.exit(4);
}
const isLl = lane === "llvm";

// The .ll interns every message in a module-level byte array and the failing
// call carries a POINTER to it; the C TU carries the literal inside the call
// itself.  So the reader resolves `ptr @sym` through this table, and a pointer
// it cannot resolve becomes UNKNOWN rather than an empty message.  The LLVM
// emitter's llStrBytes() escapes every non-printable byte as a two-digit UPPER
// hex \HH (never octal), so decoding to latin1 reproduces the RAW UTF-8 BYTES
// -- the same spelling the scr_trap templates carry in the C TU, which is why
// the em-dash patterns below match on both lanes with no third alternative.
const llDecode = (t) => {
  let o = "";
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (c === "\\" && i + 2 < t.length) {
      const h = t.slice(i + 1, i + 3);
      if (/^[0-9A-Fa-f]{2}$/.test(h)) { o += String.fromCharCode(parseInt(h, 16)); i += 2; continue; }
    }
    o += c;
  }
  let e = o.length;
  while (e > 0 && o.charCodeAt(e - 1) === 0) e--;   // the NUL terminator llStrBytes appends
  return o.slice(0, e);
};
const llStr = new Map();
if (isLl) {
  for (const l of lines) {
    if (l.length === 0 || l[0] !== "@") continue;
    const eq = l.indexOf(" = ");
    if (eq < 0) continue;
    const c = l.indexOf(' c"', eq);
    if (c < 0) continue;
    const end = l.lastIndexOf('"');
    if (end < c + 3) continue;
    llStr.set(l.slice(1, eq), llDecode(l.slice(c + 3, end)));
  }
}
// Resolve one `ptr @sym` operand.  null means "this census could not read it",
// which every caller turns into UNKNOWN -- the silent-failure direction.
const llMsg = (operand) => {
  const o = operand.trim();
  if (o.length < 2 || o[0] !== "@") return null;
  const v = llStr.get(o.slice(1));
  return v === undefined ? null : v;
};

let exitCode = 0;
const problems = [];
const fail = (why) => { problems.push(why); exitCode = 3; };

// ---------------------------------------------------------------- 1. hosts
// Every emitted definition starts at column 0 and closes with `}` at column 0.
// hostAt(i) is the definition enclosing line i, or null at file scope.
const hostName = new Array(lines.length).fill(null);
const hostBodyLines = new Map();   // name -> body line count
const hostFirstLine = new Map();
if (isLl) {
  // An LLVM definition opens with `define ... @name(` at column 0 and closes
  // with `}` at column 0, exactly like the C emitter's.  The name is read by
  // scanning the identifier after the FIRST @ on the header line: the classes
  // here are disjoint from the `(` that follows, so the match is linear and
  // cannot backtrack INSIDE the identifier -- the failure that made one
  // block's instrument score zero on a TU it had read with its own eyes.
  let cur = null, start = 0;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (cur === null) {
      if (!l.startsWith("define ")) continue;
      const at = l.indexOf("@");
      if (at < 0) continue;
      let name;
      if (l[at + 1] === '"') {
        const q = l.indexOf('"', at + 2);
        if (q < 0) continue;
        name = l.slice(at + 2, q);
      } else {
        let k = at + 1;
        while (k < l.length) {
          const c = l.charCodeAt(k);
          if ((c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c === 46 || c === 36) k++;
          else break;
        }
        name = l.slice(at + 1, k);
      }
      if (name.length === 0) continue;
      cur = name; start = i;
      if (!hostFirstLine.has(cur)) hostFirstLine.set(cur, i);
      hostName[i] = cur;
      continue;
    }
    hostName[i] = cur;
    if (l === "}") { hostBodyLines.set(cur, i - start + 1); cur = null; }
  }
} else {
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
];
// Two untagged constructors lift the refusal into a NAMED function, and the
// name is a unique template — so the row is attributable even though its
// message is an arbitrary diagnostic text.  `%fence.fn.N` and `%fnN_dyntrap`
// mangle `%` to `_x25_` and `.` to `_`.
const HOST_ATTRIB = [
  // The stranded dyn func thunk carries SC2009 since block/newvisible (it was
  // an UNCODED refusal before, and the UNCODED_REFUSAL rule below still
  // classifies the older TUs so a base measurement stays readable).  Coded
  // and still BRACKETLESS: the box is interned per SIGNATURE, so it has no
  // one source location.
  { re: /^sc_dfs_\d+_thunk$/,       site: "emit-walkers.ts:2077 strandedDynFuncBoxHelper" },
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
  // The LLVM lane's spelling.  Its keyed-read miss is ONE shared `sc_bad_key`
  // helper carrying a fixed message; the C lane emits a per-result-type
  // `sc_rkg_N` whose scr_trap_fmt template interpolates the runtime key AND
  // names the typed slot, which is why the C column can break ABORT.real down
  // by value type and this one cannot.  Same abort, one message instead of N.
  { re: /^scriptc: TypeError: record has no key \(typed slot /, what: "keyed read, absent key (LLVM: one shared sc_bad_key, no per-type message)" },
  { re: /^scriptc: TypeError: record has no key '%\.\*s' \(typed '([^']*)'/, what: "keyed read, absent key" },
];

// Kept for TUs emitted BEFORE the stranded box took its SC2009 code (every
// preserved TU in this workspace, and cen-keep's a3 plant): the same emitter,
// the older uncoded spelling.  A current compiler emits the coded form, which
// HOST_ATTRIB above attributes by host name instead.
const UNCODED_REFUSAL = [
  { re: /cannot be called through it \(its parameters have no checked-dynamic form\)/,
    site: "emit-walkers.ts:2077 strandedDynFuncBoxHelper (pre-SC2009 spelling)" },
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

// The classification decisions, factored out of the C scan so the LLVM scan
// reaches the SAME tables through the SAME code.  Two readers each carrying
// their own copy of a table is exactly how the two lanes would drift apart
// again, silently, and the whole point of this instrument is that they
// cannot.  `hostAt` is the enclosing definition's line index (HOST_ATTRIB
// attributes a bracketless coded throw by the emitter-mangled host name).
const classifyCoded = (msg, code, hostAt) => {
  TAGRE.lastIndex = 0;
  const tag = TAGRE.exec(msg);
  if (tag) return { cat: "REFUSAL.tagged", site: `SC${tag[1]} at ${tag[2]}` };
  if (code === "SC9002" && SC9002_MSG.test(msg)) return { cat: "BOILERPLATE", site: "lower-calls.ts:1028 SC9002" };
  const p = PARITY_CODED.find((x) => x.re.test(msg));
  if (p) return { cat: "PARITY", site: p.site };
  const u = UNTAGGED_REFUSAL_SITES.find((x) => x.re.test(msg));
  if (u) return { cat: "REFUSAL.untagged", site: u.site };
  const h = HOST_ATTRIB.find((x) => x.re.test(hostName[hostAt] ?? ""));
  if (h) return { cat: "REFUSAL.untagged", site: h.site };
  // A coded throw with an SC code and a diagnostic message that is neither the
  // SC9002 guard nor a known parity throw IS a refusal.  Counting it as one is
  // the conservative direction; what is lost is only the emitter attribution,
  // which is reported separately so it cannot pass as attributed.
  return { cat: "REFUSAL.untagged", site: "UNATTRIBUTED" };
};
const classifyUncoded = (msg) => {
  const u = UNCODED_REFUSAL.find((x) => x.re.test(msg));
  if (u) return { cat: "REFUSAL.uncoded", site: u.site };
  const p = UNCODED_PARITY.find((x) => x.re.test(msg));
  if (p) return { cat: "PARITY", site: p.site };
  return { cat: "UNKNOWN", site: "?" };
};
const classifyTrap = (msg) => {
  const r = ABORT_REAL.find((x) => x.re.test(msg));
  if (r) return { cat: "ABORT.real", site: r.what, valueType: (r.re.exec(msg) ?? [])[1] ?? null };
  const t = ABORT_STRUCTURAL.find((x) => x.re.test(msg));
  if (t) return { cat: "ABORT.structural", site: t.what, valueType: null };
  return { cat: "UNKNOWN", site: "?", valueType: null };
};

const rows = [];        // one per emitted failure statement
const bump = (map, k, n = 1) => map.set(k, (map.get(k) ?? 0) + n);

let nCodedCalls = 0, nUncodedCalls = 0, nTrapCalls = 0;
for (let i = 0; !isLl && i < lines.length; i++) {
  const l = lines[i];

  if (l.includes("scr_throw_error_msg_code(")) {
    let m, seen = 0;
    CODED.lastIndex = 0;
    while ((m = CODED.exec(l)) !== null) {
      seen++; nCodedCalls++;
      const msg = m[2], code = m[4];
      const { cat, site } = classifyCoded(msg, code, i);
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
      const { cat, site } = classifyUncoded(msg);
      rows.push({ line: i + 1, family: "uncoded", cat, code: "-", site, msg, host: hostName[i] });
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
      const { cat, site, valueType } = classifyTrap(msg);
      rows.push({ line: i + 1, family: "trap", cat, code: m[1] ? "trap_fmt" : "trap", site, msg, host: hostName[i], valueType });
    }
    if (seen === 0 && /\bscr_trap(_fmt)?\s*\(/.test(l)) {
      rows.push({ line: i + 1, family: "trap", cat: "UNKNOWN", code: "trap", site: "unparsed", msg: l.trim().slice(0, 200), host: hostName[i] });
      nTrapCalls++;
    }
  }
}


// -------------------------------------------------- 3b. the scan, LLVM lane
// The .ll spells the same three families as CALLS whose message rides a
// POINTER into the module's byte-array table:
//   call void @scr_throw_error_msg_code(i32 K, ptr @msg, i64 N, ptr @code)
//   call void @scr_throw_error_msg(i32 K, ptr @msg, i64 N)
//   call void @scr_trap(ptr @msg)                (never scr_trap_fmt: the LLVM
//                                                 lane has no formatted trap)
// `declare`/`define` lines are skipped by NAME, not by indentation: the
// prototype `declare void @scr_throw_error_msg_code(...)` contains the marker
// verbatim and would otherwise be counted as a call in every single TU.
// An operand this reader cannot resolve to a table entry becomes UNKNOWN and
// the process exits 3 -- an unreadable message must never read as zero.
if (isLl) {
  const CODED_LL = /call void @scr_throw_error_msg_code\(i32 -?\d+, ptr ([^,)]+), i64 (\d+), ptr ([^,)]+)\)/g;
  const UNCODED_LL = /call void @scr_throw_error_msg\(i32 -?\d+, ptr ([^,)]+), i64 (\d+)\)/g;
  const TRAP_LL = /call void @scr_trap\(ptr ([^,)]+)\)/g;
  // The FORMATTED trap.  The LLVM lane grew one when the keyed-read abort
  // started naming its source site (SC9003): @sc_bad_key takes the site and
  // the why as pointers and hands them to scr_trap_fmt, exactly as the C
  // lane's per-shape sc_rkg_N helper does.  Its MESSAGE is still the first
  // pointer operand, so it classifies through the same table; what changed
  // is only the call shape (a varargs call carries the `(ptr, ...)` type).
  //
  // A scr_trap_fmt call this pattern does NOT match would be a family the
  // reader drops in silence, which for an instrument whose whole job is to
  // count ways to die is the worst possible failure.  It is counted here
  // and cross-checked below.
  const TRAPF_LL = /call void \(ptr, \.\.\.\) @scr_trap_fmt\(ptr ([^,)]+)[^)]*\)/g;
  let nTrapFmtLines = 0, nTrapFmtParsed = 0;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.length === 0 || l.startsWith("declare ") || l.startsWith("define ")) continue;

    if (l.includes("@scr_throw_error_msg_code(")) {
      let m, seen = 0;
      CODED_LL.lastIndex = 0;
      while ((m = CODED_LL.exec(l)) !== null) {
        seen++; nCodedCalls++;
        const msg = llMsg(m[1]), code = llMsg(m[3]);
        if (msg === null || code === null) {
          rows.push({ line: i + 1, family: "coded", cat: "UNKNOWN", code: code ?? "?", site: "operand not in the module string table", msg: l.trim().slice(0, 200), host: hostName[i] });
          continue;
        }
        const { cat, site } = classifyCoded(msg, code, i);
        rows.push({ line: i + 1, family: "coded", cat, code, site, msg, host: hostName[i] });
      }
      if (seen === 0) {
        rows.push({ line: i + 1, family: "coded", cat: "UNKNOWN", code: "?", site: "unparsed", msg: l.trim().slice(0, 200), host: hostName[i] });
        nCodedCalls++;
      }
    }

    if (l.includes("@scr_throw_error_msg(")) {
      let m, seen = 0;
      UNCODED_LL.lastIndex = 0;
      while ((m = UNCODED_LL.exec(l)) !== null) {
        seen++; nUncodedCalls++;
        const msg = llMsg(m[1]);
        if (msg === null) {
          rows.push({ line: i + 1, family: "uncoded", cat: "UNKNOWN", code: "-", site: "operand not in the module string table", msg: l.trim().slice(0, 200), host: hostName[i] });
          continue;
        }
        const { cat, site } = classifyUncoded(msg);
        rows.push({ line: i + 1, family: "uncoded", cat, code: "-", site, msg, host: hostName[i] });
      }
      if (seen === 0) {
        rows.push({ line: i + 1, family: "uncoded", cat: "UNKNOWN", code: "-", site: "unparsed", msg: l.trim().slice(0, 200), host: hostName[i] });
        nUncodedCalls++;
      }
    }

    if (l.includes("@scr_trap(")) {
      let m, seen = 0;
      TRAP_LL.lastIndex = 0;
      while ((m = TRAP_LL.exec(l)) !== null) {
        seen++; nTrapCalls++;
        const raw0 = llMsg(m[1]);
        if (raw0 === null) {
          rows.push({ line: i + 1, family: "trap", cat: "UNKNOWN", code: "trap", site: "operand not in the module string table", msg: l.trim().slice(0, 200), host: hostName[i] });
          continue;
        }
        // the C reader strips the template's trailing newline; the IR's message
        // global carries the same byte, so strip it the same way
        const msg = raw0.replace(/\n$/, "");
        const { cat, site, valueType } = classifyTrap(msg);
        rows.push({ line: i + 1, family: "trap", cat, code: "trap", site, msg, host: hostName[i], valueType });
      }
      if (seen === 0) {
        rows.push({ line: i + 1, family: "trap", cat: "UNKNOWN", code: "trap", site: "unparsed", msg: l.trim().slice(0, 200), host: hostName[i] });
        nTrapCalls++;
      }
    }

    if (l.includes("@scr_trap_fmt(")) {
      nTrapFmtLines++;
      let m, seen = 0;
      TRAPF_LL.lastIndex = 0;
      while ((m = TRAPF_LL.exec(l)) !== null) {
        seen++; nTrapCalls++; nTrapFmtParsed++;
        const raw0 = llMsg(m[1]);
        if (raw0 === null) {
          rows.push({ line: i + 1, family: "trap", cat: "UNKNOWN", code: "trap", site: "operand not in the module string table", msg: l.trim().slice(0, 200), host: hostName[i] });
          continue;
        }
        const msg = raw0.replace(/\n$/, "");
        const { cat, site, valueType } = classifyTrap(msg);
        rows.push({ line: i + 1, family: "trap", cat, code: "trap", site, msg, host: hostName[i], valueType });
      }
      if (seen === 0) {
        rows.push({ line: i + 1, family: "trap", cat: "UNKNOWN", code: "trap", site: "unparsed", msg: l.trim().slice(0, 200), host: hostName[i] });
        nTrapCalls++;
      }
    }
  }
  // Every formatted-trap CALL line produced at least one row: a shape this
  // reader cannot parse is reported, never dropped.
  if (nTrapFmtLines > 0 && nTrapFmtParsed === 0) {
    fail(`this .ll has ${nTrapFmtLines} @scr_trap_fmt call line(s) and the reader parsed none of them — the keyed-read abort family would be counted as zero`);
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
const taggedDistinct = new Set(rows.filter((r) => r.cat === "REFUSAL.tagged").map((r) => r.msg)).size;
// The C emitter writes the message into every throw; the LLVM emitter writes
// it ONCE into the module string table and points at it, so census.mjs's
// numerator counts DISTINCT messages on the .ll and STATEMENTS on the .c.
// That is not a defect of either lane and it is not a difference in the
// program -- it is the reason the old instrument cannot be compared across
// lanes, and the reason this census prints both numbers.
const bracketUnit = isLl ? taggedDistinct : taggedRows;
if (bracketUnit !== oldTraps) {
  fail(`bracket occurrences (${oldTraps}) != ${isLl ? `DISTINCT tagged messages (${taggedDistinct})` : `tagged coded throws (${taggedRows})`} — a [SCxxxx at ...] lives outside a fence throw, or a throw carries two`);
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
  // The three SHARED ABORT HELPERS the C emitter plants (emitter.ts
  // sharedTrapDefs — the shape the LLVM emitter has always had in
  // helperDefs).  Each is ONE trap statement standing for every guard site
  // in the TU, which is exactly the stub correction: without this rule the
  // census would read ABORT.structural as 2 ways-to-die and the 3,771
  // places that can actually abort would vanish from the report.
  /^sc_oom$/,                      // OOM guard                  (emitter.ts sharedTrapDefs)
  /^sc_bad_tag$/,                  // union-tag default          (emitter.ts sharedTrapDefs)
  /^sc_stringify_undef$/,          // stringify undefined arm    (emitter.ts sharedTrapDefs)
  // The LLVM lane's keyed-read abort: llvm/emitter.ts helperDefs() emits ONE
  // `sc_bad_key` for the whole module where the C emitter emits one `sc_rkg_N`
  // per result type.  Without this rule the .ll column would read ABORT.real as
  // 1 way-to-die against the C column's hundreds, and the two lanes would look
  // like they disagree about the program when they only disagree about how many
  // helpers they spell it with.
  /^sc_bad_key$/,                  // keyed read, absent key     (llvm/emitter.ts helperDefs)
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
if (wanted.size > 0 && isLl) {
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const isDeclLine = l.startsWith("declare ") || l.startsWith("define ");
    let at = l.indexOf("@");
    while (at >= 0) {
      let k = at + 1;
      while (k < l.length) {
        const c = l.charCodeAt(k);
        if ((c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c === 46 || c === 36) k++;
        else break;
      }
      const nm = l.slice(at + 1, k);
      if (wanted.has(nm)) {
        if (l.charCodeAt(k) === 40) { bump(total, nm); if (isDeclLine) bump(decl, nm); }
        else bump(ptr, nm);
      }
      at = l.indexOf("@", k > at ? k : at + 1);
    }
  }
} else if (wanted.size > 0) {
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
/* ZERO-POPULATION is a TAG, not decoration: a caller that has to tell this
 * apart from a broken accounting invariant (both exit 3) needs something
 * stabler than the prose behind it. It is the one problem a CALLER can
 * legitimately expect — a program whose every refusal closed has nothing
 * left to count — and every other problem on this list is the instrument
 * saying it does not trust its own reading. */
if (statements === 0) fail("ZERO-POPULATION: zero failure statements in the whole TU — an empty or wrong input file reads exactly like a perfect one");
if (nCodedCalls + nUncodedCalls + nTrapCalls !== statements) {
  fail(`family totals ${nCodedCalls}+${nUncodedCalls}+${nTrapCalls} != ${statements} rows`);
}
const nUnknown = byCat.get("UNKNOWN") ?? 0;
if (nUnknown > 0) fail(`${nUnknown} failure statement(s) with a message this census does not classify`);

// context populations (not compiler failures; printed so the report cannot be
// read as "these are all the throws in the program")
// One counter for both lanes: on the C TU the whole file is the population
// (the runtime prototypes come in through #include and are not IN the TU);
// on the .ll the `declare`/`define` header lines are skipped, because a
// prototype mentions the symbol exactly the way a call does.
const ctxCount = (re) => {
  if (!isLl) return (raw.match(re) ?? []).length;
  let k = 0;
  for (const l of lines) {
    if (l.length === 0 || l.startsWith("declare ") || l.startsWith("define ")) continue;
    re.lastIndex = 0;
    while (re.exec(l) !== null) k++;
  }
  return k;
};
const ctx = {
  USERTHROW: ctxCount(/\bscr_throw_(obj|str|ref)\s*\(/g),
  rethrow: ctxCount(/\bscr_rethrow\s*\(/g),
  DYNCHECK: ctxCount(/\bscr_dyn_check_fail\s*\(/g),
  PARITY_named: ctxCount(/\bscr_throw_error_named\s*\(/g),
  PARITY_nodecoded: ctxCount(/\bscr_throw_node_coded\s*\(/g),
  PARITY_error: ctxCount(/\bscr_throw_error\s*\(/g),
};

// ---------------------------------------------------------------- 7. output
const out = [];
const say = (s) => out.push(s);
say(`FILE   ${file}   ${raw.length} bytes   ${lines.length} lines`);
say(`LANE   ${lane}   (the code generator that ACTUALLY emitted this TU, read off its own content)`);
if (isLl) {
  say(`       .ll notes: messages are INTERNED in the module string table, so census.mjs's`);
  say(`       TRAPS counts DISTINCT tagged messages (${taggedDistinct}) where the .c counts statements;`);
  say(`       the keyed-read abort is ONE shared sc_bad_key helper, so ABORT.real has no`);
  say(`       per-value-type breakdown and its ways-to-die is the helper's call-site count.`);
}
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
say(`  bracket occurrences ${oldTraps} == ${isLl ? `DISTINCT tagged messages ${taggedDistinct} (statements ${taggedRows})` : `tagged coded throws ${taggedRows}`}`);
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
    file, lane, bytes: raw.length,
    old: { traps: oldTraps, sites: oldSites.size, prose: oldProse },
    statements, byCat: Object.fromEntries(byCat), waysByCat: Object.fromEntries(waysByCat),
    /* Why the exit code is what it is. A reader that only sees `exit 3`
     * cannot tell "this TU broke an accounting invariant" from "this TU
     * has nothing in it to count", and those are opposite facts: the
     * first is an instrument failure, the second is what a program with
     * every refusal closed actually looks like. Empty on exit 0. */
    problems: [...problems],
    ctx, rows: rows.map((r) => ({ line: r.line, cat: r.cat, code: r.code, site: r.site, host: r.host, ways: r.ways, msg: r.msg.slice(0, 200) })),
  }, null, 1));
}
process.exit(exitCode);
