// scripts/payload-field-cmp.mjs — a FIELD-BY-FIELD comparison of the DECODED payloads a
// paired zapo run produces, Node oracle against compiled binary.
//
// Why this exists: every merge on this board was signed off with "76/76
// stanzas, identical tag multiset, exit 0". A tag multiset compares stanza
// KINDS. A field vanishing from a message BODY passes it in silence, and one
// had been vanishing since before the session (`contextInfo` on a quoted
// reply). This descends into the decoded payload instead.
//
// The three ways a comparison like this passes vacuously, and the guard each
// one earns here:
//
//   * ZERO DENOMINATOR. "0 differences" over an empty parse. Every run
//     reports how many RECORDS, OBJECTS, ARRAYS and LEAF FIELDS it actually
//     compared; zero on either side of any artefact kind is exit 2, never a
//     pass.
//   * OVER-NORMALISATION. Masking the volatile fields by hand is exactly how
//     a hole opens: the masker writes down what it expects to vary, and the
//     defect hides behind the mask. Here the volatile set is MEASURED, from
//     two runs of the NODE ORACLE against each other (--derive-mask). A path
//     is masked only because the oracle itself was observed to disagree with
//     itself there. Nothing is masked by taste, and the whole mask is
//     printed.
//   * A DIFFERENCE THE WALKER CANNOT REACH. --selftest plants known facts (a
//     removed field, an added field, a changed scalar, a changed byte string,
//     a reordered array, a type change, a record-count change, a stanza
//     reorder that must NOT fire, a stanza payload change that must, a change
//     UNDER the mask that must NOT fire, and an empty input that must exit 2)
//     and refuses to be believed until all of them are recovered.
//
// usage:
//   node scripts/payload-field-cmp.mjs --selftest
//   node scripts/payload-field-cmp.mjs --derive-mask <oracleA-base> <oracleB-base> -o mask.json
//   node scripts/payload-field-cmp.mjs --compare <node-base> <exe-base> [--mask mask.json]
//
// <base> is the driver's log path without the .log suffix, e.g.
// G:/pcx/logs/drv-oracleA — the four artefacts are <base>.peer.txt,
// <base>.cmp.txt, <base>.stanzas.txt and <base>.appstate.txt.
import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------- the grammar
// The driver's norm() output: JSON with three extra unquoted leaf tokens
// (bytes:<hex>, long:<lo>/<hi>/<unsigned>, fn) and bare undefined/NaN.
class ParseError extends Error {}

function parseNorm(src, where) {
  let i = 0;
  const err = (m) => { throw new ParseError(where + ": " + m + " at offset " + i); };
  const ws = () => { while (i < src.length && (src[i] === " " || src[i] === "\t")) i++; };
  function value() {
    ws();
    if (i >= src.length) err("unexpected end");
    const c = src[i];
    if (c === "{") return obj();
    if (c === "[") return arr();
    if (c === '"') return str();
    if (src.startsWith("bytes:", i)) {
      i += 6;
      const s = i;
      while (i < src.length && /[0-9a-fA-F]/.test(src[i])) i++;
      return { $: "bytes", hex: src.slice(s, i) };
    }
    if (src.startsWith("long:", i)) {
      i += 5;
      const m = /^(-?\d+)\/(-?\d+)\/(true|false)/.exec(src.slice(i));
      if (!m) err("malformed long");
      i += m[0].length;
      return { $: "long", lo: m[1], hi: m[2], u: m[3] };
    }
    const TOKENS = [["null", null], ["undefined", { $: "undefined" }],
                    ["true", true], ["false", false],
                    ["NaN", { $: "nan" }], ["-Infinity", { $: "-inf" }],
                    ["Infinity", { $: "inf" }], ["fn", { $: "fn" }]];
    for (const pair of TOKENS) {
      const tok = pair[0];
      if (src.startsWith(tok, i)) {
        const after = src[i + tok.length];
        if (after === undefined || /[,}\]\s]/.test(after)) { i += tok.length; return pair[1]; }
      }
    }
    if (/[-0-9]/.test(c)) {
      const m = /^-?\d+(\.\d+)?([eE][-+]?\d+)?/.exec(src.slice(i));
      if (!m) err("malformed number");
      i += m[0].length;
      return Number(m[0]);
    }
    err("unexpected character " + JSON.stringify(c));
  }
  function str() {
    const s = i;
    i++;
    while (i < src.length) {
      if (src[i] === "\\") { i += 2; continue; }
      if (src[i] === '"') { i++; return JSON.parse(src.slice(s, i)); }
      i++;
    }
    err("unterminated string");
  }
  function obj() {
    i++; ws();
    const o = new Map();
    if (src[i] === "}") { i++; return { $: "obj", m: o }; }
    for (;;) {
      ws();
      if (src[i] !== '"') err("expected a key");
      const k = str();
      ws();
      if (src[i] !== ":") err("expected ':'");
      i++;
      o.set(k, value());
      ws();
      if (src[i] === ",") { i++; continue; }
      if (src[i] === "}") { i++; return { $: "obj", m: o }; }
      err("expected ',' or '}'");
    }
  }
  function arr() {
    i++; ws();
    const a = [];
    if (src[i] === "]") { i++; return { $: "arr", a }; }
    for (;;) {
      a.push(value());
      ws();
      if (src[i] === ",") { i++; continue; }
      if (src[i] === "]") { i++; return { $: "arr", a }; }
      err("expected ',' or ']'");
    }
  }
  const v = value();
  ws();
  if (i !== src.length) err("trailing input");
  return v;
}

// ------------------------------------------------------------- the artefacts
const KINDS = ["peer", "cmp", "stanzas", "appstate"];

function readLines(p) {
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n").split("\n").filter((l) => l.length > 0);
}

// Each artefact kind becomes a list of { id, value }. `id` is what the two
// sides are aligned by; it never carries a value the comparison is meant to
// be checking.
function loadSet(base) {
  const out = {};
  for (const kind of KINDS) {
    const lines = readLines(base + "." + kind + ".txt");
    if (lines === null) { out[kind] = null; continue; }
    const recs = [];
    lines.forEach((line, n) => {
      try {
        if (kind === "peer") {
          const m = /^#(\d+) encType=(\S+) message=(.*)$/.exec(line);
          if (!m) throw new ParseError("peer line does not match #N encType=X message=V");
          recs.push({ id: "peer#" + m[1], enc: m[2], value: parseNorm(m[3], kind + ":" + (n + 1)) });
        } else if (kind === "cmp") {
          const sp = line.indexOf(" ");
          if (sp < 0) throw new ParseError("cmp line has no tag");
          recs.push({ id: line.slice(0, sp), value: parseNorm(line.slice(sp + 1), kind + ":" + (n + 1)) });
        } else {
          recs.push({ id: kind + "#" + (n + 1), value: parseNorm(line, kind + ":" + (n + 1)) });
        }
      } catch (e) {
        recs.push({ id: kind + "#" + (n + 1), value: { $: "unparsed", text: line }, parseError: String(e.message || e) });
      }
    });
    // cmp tags repeat; disambiguate by occurrence so the alignment is stable.
    if (kind === "cmp") {
      const seen = new Map();
      for (const r of recs) {
        const n = (seen.get(r.id) || 0) + 1;
        seen.set(r.id, n);
        r.id = r.id + "[" + n + "]";
      }
    }
    out[kind] = recs;
  }
  return out;
}

// ----------------------------------------------------------------- the walker
function isObj(v) { return v !== null && typeof v === "object" && v.$ === "obj"; }
function isArr(v) { return v !== null && typeof v === "object" && v.$ === "arr"; }

function leafKey(v) {
  if (v === null) return "null";
  if (typeof v === "boolean") return "bool:" + v;
  if (typeof v === "number") return "num:" + v;
  if (typeof v === "string") return "str:" + v;
  switch (v.$) {
    case "bytes": return "bytes:" + v.hex;
    case "long": return "long:" + v.lo + "/" + v.hi + "/" + v.u;
    case "undefined": return "undefined";
    case "nan": return "NaN";
    case "inf": return "Infinity";
    case "-inf": return "-Infinity";
    case "fn": return "fn";
    case "unparsed": return "unparsed:" + v.text;
    default: return "?" + JSON.stringify(v);
  }
}

function shallow(v) {
  if (isObj(v)) return "{" + [...v.m.keys()].sort().join(",") + "}";
  if (isArr(v)) return "[" + v.a.length + "]";
  return leafKey(v);
}

// Compare two parsed values, appending one row per difference. Counts every
// leaf it looked at, so a run can prove it examined something.
function walk(a, b, p, diffs, stats, masked) {
  if (masked.has(p)) { stats.maskedHits++; return; }
  const aIs = a !== undefined, bIs = b !== undefined;
  if (!aIs && !bIs) return;
  if (!aIs) { stats.leaves++; diffs.push({ path: p, kind: "EXTRA_IN_B", a: "<absent>", b: shallow(b) }); return; }
  if (!bIs) { stats.leaves++; diffs.push({ path: p, kind: "MISSING_IN_B", a: shallow(a), b: "<absent>" }); return; }
  if (isObj(a) && isObj(b)) {
    stats.objects++;
    const keys = new Set([...a.m.keys(), ...b.m.keys()]);
    for (const k of [...keys].sort()) walk(a.m.get(k), b.m.get(k), p + "." + k, diffs, stats, masked);
    return;
  }
  if (isArr(a) && isArr(b)) {
    stats.arrays++;
    if (a.a.length !== b.a.length) {
      diffs.push({ path: p, kind: "ARRAY_LENGTH", a: String(a.a.length), b: String(b.a.length) });
    }
    const n = Math.max(a.a.length, b.a.length);
    for (let k = 0; k < n; k++) walk(a.a[k], b.a[k], p + "[" + k + "]", diffs, stats, masked);
    return;
  }
  if (isObj(a) !== isObj(b) || isArr(a) !== isArr(b)) {
    stats.leaves++;
    diffs.push({ path: p, kind: "TYPE_DIFFERS", a: shallow(a), b: shallow(b) });
    return;
  }
  stats.leaves++;
  const ka = leafKey(a), kb = leafKey(b);
  if (ka !== kb) diffs.push({ path: p, kind: "VALUE_DIFFERS", a: ka, b: kb });
}

// Stanza ORDER is not stable between two runs of the same binary (the exe's
// own A/A moves in a 39-46 window), so stanzas align as a MULTISET of their
// whole normalised form; whatever does not match exactly is then paired
// greedily by tag and structurally diffed. peer / cmp / appstate keep their
// order, which two oracle runs reproduce.
function canonical(v) {
  if (isObj(v)) return "{" + [...v.m.keys()].sort().map((k) => JSON.stringify(k) + ":" + canonical(v.m.get(k))).join(",") + "}";
  if (isArr(v)) return "[" + v.a.map(canonical).join(",") + "]";
  return leafKey(v);
}

function overlap(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

function countTree(v, stats) {
  if (isObj(v)) { stats.objects++; for (const x of v.m.values()) countTree(x, stats); return; }
  if (isArr(v)) { stats.arrays++; for (const x of v.a) countTree(x, stats); return; }
  stats.leaves++;
}

function compareKind(kind, A, B, masked) {
  const stats = { records: 0, objects: 0, arrays: 0, leaves: 0, maskedHits: 0 };
  const diffs = [];
  if (A === null || B === null) return { stats, diffs, absent: true };
  if (kind === "stanzas") {
    const bag = new Map();
    for (const r of B) {
      const c = canonical(r.value);
      bag.set(c, (bag.get(c) || 0) + 1);
    }
    const leftA = [];
    for (const r of A) {
      const c = canonical(r.value);
      const n = bag.get(c) || 0;
      if (n > 0) { bag.set(c, n - 1); countTree(r.value, stats); stats.records++; }
      else leftA.push(r);
    }
    // Rebuild the leftovers on the B side from the counts that survived.
    const bag2 = new Map(bag);
    const leftB = [];
    for (const r of B) {
      const c = canonical(r.value);
      const n = bag2.get(c) || 0;
      if (n > 0) { bag2.set(c, n - 1); leftB.push(r); }
    }
    const used = new Set();
    for (const ra of leftA) {
      const tagA = isObj(ra.value) ? ra.value.m.get("tag") : null;
      let best = -1, bestScore = -1;
      for (let j = 0; j < leftB.length; j++) {
        if (used.has(j)) continue;
        const rb = leftB[j];
        const tagB = isObj(rb.value) ? rb.value.m.get("tag") : null;
        if (leafKey(tagA === undefined ? null : tagA) !== leafKey(tagB === undefined ? null : tagB)) continue;
        const s = overlap(canonical(ra.value), canonical(rb.value));
        if (s > bestScore) { bestScore = s; best = j; }
      }
      stats.records++;
      if (best < 0) {
        diffs.push({ path: kind + "[" + ra.id + "]", kind: "MISSING_IN_B", a: shallow(ra.value), b: "<no stanza of this tag left>" });
        continue;
      }
      used.add(best);
      walk(ra.value, leftB[best].value, kind + "[" + ra.id + "]", diffs, stats, masked);
    }
    for (let j = 0; j < leftB.length; j++) {
      if (used.has(j)) continue;
      stats.records++;
      diffs.push({ path: kind + "[" + leftB[j].id + "]", kind: "EXTRA_IN_B", a: "<absent>", b: shallow(leftB[j].value) });
    }
    return { stats, diffs, absent: false };
  }
  const n = Math.max(A.length, B.length);
  for (let k = 0; k < n; k++) {
    const ra = A[k], rb = B[k];
    stats.records++;
    if (!ra) { diffs.push({ path: kind + "[" + (k + 1) + "]", kind: "EXTRA_RECORD_IN_B", a: "<absent>", b: rb.id }); continue; }
    if (!rb) { diffs.push({ path: kind + "[" + (k + 1) + "]", kind: "MISSING_RECORD_IN_B", a: ra.id, b: "<absent>" }); continue; }
    if (ra.id !== rb.id) diffs.push({ path: kind + "[" + (k + 1) + "]", kind: "RECORD_ID_DIFFERS", a: ra.id, b: rb.id });
    if (ra.enc !== rb.enc) diffs.push({ path: kind + "[" + (k + 1) + "].encType", kind: "VALUE_DIFFERS", a: String(ra.enc), b: String(rb.enc) });
    walk(ra.value, rb.value, kind + "[" + ra.id + "]", diffs, stats, masked);
  }
  return { stats, diffs, absent: false };
}

// ------------------------------------------------------------------- the mask
// MEASURED, never written by hand: the set of paths at which two runs of the
// NODE ORACLE disagreed with each other. Anything outside it the oracle
// reproduces exactly, so the compiled binary has to as well.
function deriveMask(baseA, baseB) {
  const A = loadSet(baseA), B = loadSet(baseB);
  const paths = new Set();
  const detail = [];
  for (const kind of KINDS) {
    const r = compareKind(kind, A[kind], B[kind], new Set());
    for (const d of r.diffs) {
      paths.add(d.path);
      detail.push({ kind: d.kind, path: d.path, a: d.a, b: d.b });
    }
  }
  return { paths: [...paths].sort(), detail };
}

// ---------------------------------------------------------------- the reports
function fmt(n) { return String(n).padStart(8); }

function runCompare(baseA, baseB, masked, label) {
  const A = loadSet(baseA), B = loadSet(baseB);
  const total = { records: 0, objects: 0, arrays: 0, leaves: 0, maskedHits: 0 };
  const allDiffs = [];
  const perKind = [];
  let zero = false;
  for (const kind of KINDS) {
    const r = compareKind(kind, A[kind], B[kind], masked);
    perKind.push(Object.assign({ kind, diffs: r.diffs.length, absent: r.absent }, r.stats));
    for (const k of Object.keys(total)) total[k] += r.stats[k];
    for (const d of r.diffs) allDiffs.push(d);
    if (!r.absent && (r.stats.leaves === 0 || r.stats.records === 0)) zero = true;
  }
  const parseErrors = [];
  const sides = [[A, "node"], [B, "exe"]];
  for (const pair of sides)
    for (const kind of KINDS)
      for (const r of pair[0][kind] || [])
        if (r.parseError) parseErrors.push(pair[1] + " " + kind + " " + r.id + ": " + r.parseError);
  return { perKind, total, diffs: allDiffs, zero, parseErrors, label };
}

function printReport(res) {
  console.log("=== payloadcmp " + res.label + " ===");
  console.log("  kind      records objects  arrays  leaves  masked   diffs");
  for (const k of res.perKind) {
    console.log("  " + k.kind.padEnd(8) + fmt(k.records) + fmt(k.objects) + fmt(k.arrays) +
      fmt(k.leaves) + fmt(k.maskedHits) + fmt(k.diffs) + (k.absent ? "  (artefact absent)" : ""));
  }
  const t = res.total;
  console.log("  TOTAL   " + fmt(t.records) + fmt(t.objects) + fmt(t.arrays) + fmt(t.leaves) +
    fmt(t.maskedHits) + fmt(res.diffs.length));
  if (res.parseErrors.length > 0) {
    console.log("  PARSE ERRORS (" + res.parseErrors.length + "):");
    for (const e of res.parseErrors.slice(0, 20)) console.log("    " + e);
  }
  if (res.diffs.length > 0) {
    console.log("  DIFFERENCES (" + res.diffs.length + "):");
    for (const d of res.diffs) {
      console.log("    " + d.kind + " " + d.path);
      console.log("      node: " + String(d.a).slice(0, 300));
      console.log("      exe : " + String(d.b).slice(0, 300));
    }
  }
}

// ---------------------------------------------------------------- the selftest
function selftest() {
  const dir = fs.mkdtempSync(path.join(process.env.TMP || ".", "pcmpst-"));
  const facts = [];
  const record = (name, ok, note) => { facts.push({ name, ok, note }); };

  const basePeer = [
    '#1 encType=msg message={"conversation":"hello","messageContextInfo":{"messageSecret":bytes:aabb,"threadId":[]}}',
    '#2 encType=msg message={"extendedTextMessage":{"contextInfo":{"participant":"p@s","stanzaId":"ID1"},"endCardTiles":[],"text":"quoted-reply"},"messageContextInfo":{"messageSecret":bytes:ccdd}}',
  ];
  const baseCmp = [
    'message.key {"fromMe":false,"id":"AAA","remoteJid":"x@s"}',
    'send.ack {"attrs":{"class":"message"},"tag":"ack"}',
  ];
  const baseSt = [
    '{"attrs":{"id":"<masked>","to":"s.whatsapp.net","type":"result"},"tag":"iq"}',
    '{"attrs":{"id":"<masked>","type":"text"},"content":[{"attrs":{},"content":"bytes:114","tag":"enc"}],"tag":"message"}',
  ];
  const baseAs = [
    '{"action":"mute","collection":"regular_high","value":{"muteAction":{"muted":true},"timestamp":long:1/0/false},"version":2}',
  ];
  const write = (name, peer, cmp, st, as) => {
    const b = path.join(dir, name);
    fs.writeFileSync(b + ".peer.txt", peer.join("\n") + (peer.length ? "\n" : ""));
    fs.writeFileSync(b + ".cmp.txt", cmp.join("\n") + (cmp.length ? "\n" : ""));
    fs.writeFileSync(b + ".stanzas.txt", st.join("\n") + (st.length ? "\n" : ""));
    fs.writeFileSync(b + ".appstate.txt", as.join("\n") + (as.length ? "\n" : ""));
    return b;
  };
  const ref = write("ref", basePeer, baseCmp, baseSt, baseAs);
  const NOMASK = new Set();

  // 0 — identical inputs: zero diffs AND a non-zero denominator.
  {
    const same = write("same", basePeer, baseCmp, baseSt, baseAs);
    const r = runCompare(ref, same, NOMASK, "selftest/identical");
    record("identical pair reports 0 differences", r.diffs.length === 0, "diffs=" + r.diffs.length);
    record("identical pair reports a NON-ZERO denominator", r.total.leaves > 20 && r.total.records >= 7,
      "leaves=" + r.total.leaves + " records=" + r.total.records);
    record("identical pair does not raise the zero-denominator flag", r.zero === false, "zero=" + r.zero);
    record("identical pair parses every line", r.parseErrors.length === 0, r.parseErrors.join(" | "));
  }
  // 1 — a REMOVED nested field: the real defect's shape.
  {
    const p = basePeer.slice();
    p[1] = p[1].replace('"contextInfo":{"participant":"p@s","stanzaId":"ID1"},', "");
    const b = write("drop", p, baseCmp, baseSt, baseAs);
    const r = runCompare(ref, b, NOMASK, "selftest/removed-field");
    const hit = r.diffs.filter((d) => d.path.indexOf("contextInfo") >= 0);
    record("a removed nested field fires", hit.length > 0 && hit.every((d) => d.kind === "MISSING_IN_B"),
      hit.map((d) => d.kind + " " + d.path).join(" | ") || "NO HIT");
  }
  // 2 — an ADDED field.
  {
    const p = basePeer.slice();
    p[0] = p[0].replace('"conversation":"hello"', '"brandNew":1,"conversation":"hello"');
    const b = write("add", p, baseCmp, baseSt, baseAs);
    const r = runCompare(ref, b, NOMASK, "selftest/added-field");
    const hit = r.diffs.filter((d) => d.path.endsWith(".brandNew"));
    record("an added field fires", hit.length === 1 && hit[0].kind === "EXTRA_IN_B",
      hit.map((d) => d.kind).join(",") || "NO HIT");
  }
  // 3 — a CHANGED scalar.
  {
    const p = basePeer.slice();
    p[1] = p[1].replace('"stanzaId":"ID1"', '"stanzaId":"ID2"');
    const b = write("chg", p, baseCmp, baseSt, baseAs);
    const r = runCompare(ref, b, NOMASK, "selftest/changed-scalar");
    const hit = r.diffs.filter((d) => d.path.endsWith(".stanzaId"));
    record("a changed scalar fires", hit.length === 1 && hit[0].kind === "VALUE_DIFFERS",
      hit.map((d) => d.kind).join(",") || "NO HIT");
  }
  // 4 — a CHANGED byte string at a path the mask does not cover.
  {
    const p = basePeer.slice();
    p[1] = p[1].replace("bytes:ccdd", "bytes:ccde");
    const b = write("bytes", p, baseCmp, baseSt, baseAs);
    const r = runCompare(ref, b, NOMASK, "selftest/changed-bytes");
    const hit = r.diffs.filter((d) => d.path.endsWith(".messageSecret"));
    record("a changed byte string fires", hit.length === 1 && hit[0].kind === "VALUE_DIFFERS",
      hit.map((d) => d.kind).join(",") || "NO HIT");
  }
  // 5 — a REORDERED array (order is meaning in a repeated protobuf field).
  {
    const cmp = baseCmp.slice();
    cmp[0] = 'message.key {"fromMe":false,"id":"AAA","opts":["a","b"],"remoteJid":"x@s"}';
    const refB = write("ord-ref", basePeer, cmp, baseSt, baseAs);
    const cmp2 = cmp.slice();
    cmp2[0] = 'message.key {"fromMe":false,"id":"AAA","opts":["b","a"],"remoteJid":"x@s"}';
    const b = write("ord", basePeer, cmp2, baseSt, baseAs);
    const r = runCompare(refB, b, NOMASK, "selftest/reordered-array");
    const hit = r.diffs.filter((d) => d.path.indexOf(".opts[") >= 0);
    record("a reordered array fires", hit.length === 2 && hit.every((d) => d.kind === "VALUE_DIFFERS"),
      hit.map((d) => d.kind + " " + d.path).join(" | ") || "NO HIT");
  }
  // 6 — a TYPE change.
  {
    const p = basePeer.slice();
    p[1] = p[1].replace('"text":"quoted-reply"', '"text":{"a":1}');
    const b = write("type", p, baseCmp, baseSt, baseAs);
    const r = runCompare(ref, b, NOMASK, "selftest/type-change");
    const hit = r.diffs.filter((d) => d.path.endsWith(".text"));
    record("a type change fires", hit.length === 1 && hit[0].kind === "TYPE_DIFFERS",
      hit.map((d) => d.kind).join(",") || "NO HIT");
  }
  // 7 — a MISSING RECORD (a whole message that never went out).
  {
    const b = write("short", [basePeer[0]], baseCmp, baseSt, baseAs);
    const r = runCompare(ref, b, NOMASK, "selftest/missing-record");
    const hit = r.diffs.filter((d) => d.kind === "MISSING_RECORD_IN_B");
    record("a missing record fires", hit.length === 1, hit.map((d) => d.kind).join(",") || "NO HIT");
  }
  // 8 — a change UNDER the mask must NOT fire, and must be counted as masked.
  {
    const p = basePeer.slice();
    p[1] = p[1].replace("bytes:ccdd", "bytes:ccde");
    const b = write("maskedchg", p, baseCmp, baseSt, baseAs);
    const mask = new Set(["peer[peer#2].messageContextInfo.messageSecret"]);
    const r = runCompare(ref, b, mask, "selftest/masked-change");
    record("a change under the mask does NOT fire", r.diffs.length === 0, "diffs=" + r.diffs.length);
    record("a masked path is COUNTED as masked", r.total.maskedHits === 1, "maskedHits=" + r.total.maskedHits);
  }
  // 9 — an EMPTY artefact is a zero denominator, not a pass.
  {
    const b = write("empty", [], [], [], []);
    const r = runCompare(ref, b, NOMASK, "selftest/empty");
    record("an empty side raises the zero-denominator flag", r.zero === true,
      "zero=" + r.zero + " diffs=" + r.diffs.length);
  }
  // 10 — stanza order alone is NOT a difference, but a stanza payload is.
  {
    const b = write("stord", basePeer, baseCmp, [baseSt[1], baseSt[0]], baseAs);
    const r = runCompare(ref, b, NOMASK, "selftest/stanza-reorder");
    record("stanza REORDER alone is not a difference", r.diffs.length === 0, "diffs=" + r.diffs.length);
    const st2 = [baseSt[0], baseSt[1].replace('"bytes:114"', '"bytes:130"')];
    const b2 = write("stpay", basePeer, baseCmp, st2, baseAs);
    const r2 = runCompare(ref, b2, NOMASK, "selftest/stanza-payload");
    record("a stanza PAYLOAD change fires through the multiset alignment",
      r2.diffs.length === 1 && r2.diffs[0].kind === "VALUE_DIFFERS",
      r2.diffs.map((d) => d.kind + " " + d.path).join(" | ") || "NO HIT");
  }
  // 11 — the derived mask really is derived, and covers only what varied.
  {
    const p = basePeer.slice();
    p[0] = p[0].replace("bytes:aabb", "bytes:aabc");
    const b = write("volB", p, baseCmp, baseSt, baseAs);
    const m = deriveMask(ref, b);
    record("--derive-mask names exactly the path that varied",
      m.paths.length === 1 && m.paths[0] === "peer[peer#1].messageContextInfo.messageSecret",
      JSON.stringify(m.paths));
  }
  // 12 — an UNPARSEABLE line is reported, never silently skipped.
  {
    const b = write("garbage", [basePeer[0], "#2 encType=msg message={not json"], baseCmp, baseSt, baseAs);
    const r = runCompare(ref, b, NOMASK, "selftest/unparsed");
    record("an unparseable line is reported as a parse error",
      r.parseErrors.length === 1, "parseErrors=" + r.parseErrors.length);
  }
  fs.rmSync(dir, { recursive: true, force: true });

  console.log("=== payload-field-cmp --selftest ===");
  let bad = 0;
  for (const f of facts) {
    if (!f.ok) bad++;
    console.log("  " + (f.ok ? "ok  " : "FAIL") + " " + f.name + (f.ok ? "" : "  <- " + f.note));
  }
  console.log("  " + facts.length + " planted facts, " + (facts.length - bad) + " recovered, " + bad + " lost");
  return bad === 0 ? 0 : 1;
}

// -------------------------------------------------------------------- the CLI
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(n); return i < 0 ? (d === undefined ? null : d) : argv[i + 1]; };

if (argv.includes("--selftest")) process.exit(selftest());

if (argv.includes("--derive-mask")) {
  const i = argv.indexOf("--derive-mask");
  const a = argv[i + 1], b = argv[i + 2];
  if (!a || !b) { console.error("usage: --derive-mask <oracleA-base> <oracleB-base> -o mask.json"); process.exit(2); }
  if (path.resolve(a) === path.resolve(b)) { console.error("SAME BASE TWICE: " + a); process.exit(4); }
  const m = deriveMask(a, b);
  const outp = opt("-o", "mask.json");
  fs.writeFileSync(outp, JSON.stringify(m, null, 2) + "\n");
  console.log("=== derived volatile mask, " + m.paths.length + " paths, from two NODE ORACLE runs ===");
  for (const d of m.detail) {
    console.log("  " + d.kind + " " + d.path);
    console.log("    A: " + String(d.a).slice(0, 160));
    console.log("    B: " + String(d.b).slice(0, 160));
  }
  console.log("  -> " + outp);
  process.exit(0);
}

if (argv.includes("--compare")) {
  const i = argv.indexOf("--compare");
  const a = argv[i + 1], b = argv[i + 2];
  if (!a || !b) { console.error("usage: --compare <node-base> <exe-base> [--mask mask.json]"); process.exit(2); }
  if (path.resolve(a) === path.resolve(b)) { console.error("SAME BASE TWICE: " + a); process.exit(4); }
  const mp = opt("--mask", null);
  const masked = new Set(mp ? JSON.parse(fs.readFileSync(mp, "utf8")).paths : []);
  const res = runCompare(a, b, masked, path.basename(a) + " (node) vs " + path.basename(b) + " (exe)");
  printReport(res);
  console.log("  mask: " + masked.size + " paths" + (mp ? " from " + mp : " (NONE - every field compared raw)"));
  if (res.zero) { console.log("  ZERO DENOMINATOR: an artefact kind compared 0 records or 0 leaves"); process.exit(2); }
  if (res.parseErrors.length > 0) { console.log("  UNPARSED LINES PRESENT - the comparison did not see them"); process.exit(3); }
  process.exit(res.diffs.length === 0 ? 0 : 1);
}

console.error("usage: --selftest | --derive-mask A B -o mask.json | --compare A B [--mask mask.json]");
process.exit(2);
