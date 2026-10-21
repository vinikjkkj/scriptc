#!/usr/bin/env node
// Generates packages/runtime/src/scr_date_intl_en.c: the en-US half of Date.prototype.toLocale{,Date,Time}String
// with options, mined from the Node that runs it (CI pins v24.15.0; the versions are recorded in the header).
//
// WHAT IS MINED. For every option vector Node accepts (weekday, era, year, month, day, dayPeriod, hour, minute,
// second, fractionalSecondDigits, timeZoneName, hourCycle: 13,063,680 of them) the pattern ICU picked, as a token
// list read off Intl.DateTimeFormat#formatToParts at a reference instant whose fields are all distinguishable
// (Tue 2008-03-04 05:06:07.123Z: "3" vs "03" vs "Mar" vs "March" vs "M" is the month width, and so on).
// The pattern is then DECOMPOSED, and the decomposition is checked against every mined vector:
//
//   pattern(d, t) = D[d] + glue(d, t) + T[t]
//
// where d is the date half (weekday, era, year, month, day: 864), t the time half (dayPeriod, hour, minute,
// second, fractionalSecondDigits, timeZoneName, hourCycle: 15,120), D and T the patterns of the halves alone, and
// glue is ", " or " at " by d, except for a weekday-only d whose glue is " " when t has an hour. A time half with
// no time field but a zone is just the zone token. An era-only date half (reachable only next to a time field,
// since the defaults add year/month/day otherwise) is the era field. Zero exceptions over 12,973,100 reachable
// vectors; the generator refuses to write on one.
//
// T is stored as a reduced multi-valued decision diagram over its seven dimensions in the best order found by
// search; D as a flat table. dateStyle/timeStyle (125 vectors) are mined whole.
//
// THE ZONE NAMES (timeZoneName: short, long, shortGeneric, longGeneric) depend on the instant through CLDR's
// metazone history, so per zone and style the generator records the sequence of name changes 1700..2200 (and the
// 28-year window rule after the last one, as scripts/gen-date-zones.mjs does for offsets), with the localized-GMT
// form ("GMT+5:30", "GMT+05:30") stored as "computed from the offset".
//
// Usage (each phase is sharded; run them in parallel):
//   node scripts/gen-date-intl.mjs mine  DIR SHARD NSHARDS     vector patterns -> DIR/mine<SHARD>.json
//   node scripts/gen-date-intl.mjs names DIR SHARD NSHARDS     zone name sequences -> DIR/names<SHARD>.json
//   node scripts/gen-date-intl.mjs build DIR NSHARDS [--out FILE] [--check]
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const [cmd, DIR, A1, A2] = process.argv.slice(2);
const args = process.argv.slice(2);
const outPath = args.includes("--out") ? args[args.indexOf("--out") + 1] : new URL("../packages/runtime/src/scr_date_intl_en.c", import.meta.url).pathname;

// ───────────────────────── the vector space ─────────────────────────
const F = [
  ["weekday", [undefined, "narrow", "short", "long"]],
  ["era", [undefined, "narrow", "short", "long"]],
  ["year", [undefined, "numeric", "2-digit"]],
  ["month", [undefined, "numeric", "2-digit", "narrow", "short", "long"]],
  ["day", [undefined, "numeric", "2-digit"]],
  ["dayPeriod", [undefined, "narrow", "short", "long"]],
  ["hour", [undefined, "numeric", "2-digit"]],
  ["minute", [undefined, "numeric", "2-digit"]],
  ["second", [undefined, "numeric", "2-digit"]],
  ["fractionalSecondDigits", [undefined, 1, 2, 3]],
  ["timeZoneName", [undefined, "short", "long", "shortOffset", "longOffset", "shortGeneric", "longGeneric"]],
  ["hourCycle", [undefined, "h11", "h12", "h23", "h24"]],
];
const radix = F.map(([, v]) => v.length);
const ND = radix.slice(0, 5).reduce((a, b) => a * b, 1); // 864
const NT = radix.slice(5).reduce((a, b) => a * b, 1); // 15120
const TOTAL = ND * NT;
const REF = Date.UTC(2008, 2, 4, 5, 6, 7, 123); // Tue 2008-03-04 05:06:07.123 UTC
function vec(k) {
  const idx = new Array(F.length);
  for (let i = F.length - 1; i >= 0; i--) { idx[i] = k % radix[i]; k = Math.floor(k / radix[i]); }
  return idx;
}
const optsOf = (idx) => { const o = {}; F.forEach(([n, vals], i) => { if (idx[i]) o[n] = vals[idx[i]]; }); return o; };
const HAS_TIME = [5, 6, 7, 8, 9]; // dayPeriod, hour, minute, second, fractionalSecondDigits
const HAS_FIELD = [0, 2, 3, 4, 5, 6, 7, 8, 9]; // what makes a vector reachable (defaults add date fields otherwise)
function tokensOf(opts, locale = "en-US", ref = REF) {
  const f = new Intl.DateTimeFormat(locale, { ...opts, timeZone: "UTC" });
  const out = [];
  for (const p of f.formatToParts(ref)) {
    if (p.type === "literal" && out.length && out[out.length - 1][0] === "L") out[out.length - 1][1] += p.value;
    else out.push([p.type === "literal" ? "L" : p.type, p.value]);
  }
  return out;
}

// pattern byte codes (see the runtime's scr_date_intl.c): 0x01.. field codes, everything else a literal byte.
const CODE = {
  weekdayN: 1, weekdayS: 2, weekdayL: 3, eraN: 4, eraS: 5, eraL: 6, y: 7, yy: 8,
  M: 9, MM: 10, MMM: 11, MMMM: 12, MMMMM: 13, d: 14, dd: 15, a: 16, B: 17,
  h: 18, hh: 19, m: 20, mm: 21, s: 22, ss: 23, S: 24, tz: 25,
  K: 26, KK: 27, H: 28, HH: 29, k: 30, kk: 31,
};
// The hour LETTER (h, K, H, k) is not readable at the reference instant (05:06 shows "5" under all four), and V8 does
// not always apply the hour cycle you ask for (hourCycle h11 next to a zone-offset field stays "h" in some vectors),
// so it is mined where the four differ: at 12:06:07 they read 12, 0, 12, 12 and at 00:06:07 they read 12, 0, 0, 24.
const REF_NOON = Date.UTC(2008, 2, 4, 12, 6, 7, 123), REF_MID = Date.UTC(2008, 2, 4, 0, 6, 7, 123);
const HOUR_CODES = { h: [18, 19], K: [26, 27], H: [28, 29], k: [30, 31] };
function hourLetter(opts) {
  const at = (ref) => { const t = tokensOf(opts, "en-US", ref).find((x) => x[0] === "hour"); return t ? t[1] : null; };
  const noon = at(REF_NOON), mid = at(REF_MID);
  if (noon === null) return null;
  const n = Number(noon), m = Number(mid);
  if (n === 12 && m === 12) return "h";
  if (n === 0 && m === 0) return "K";
  if (n === 12 && m === 0) return "H";
  if (n === 12 && m === 24) return "k";
  throw new Error(`unreadable hour letter: noon ${noon} midnight ${mid} for ${JSON.stringify(opts)}`);
}
// replace the width-only hour codes of a canonical pattern by the mined letter's
function withHourLetter(bytes, letter) {
  if (letter === null || letter === "h") return bytes;
  const [one, two] = HOUR_CODES[letter];
  let out = "";
  for (const ch of bytes) { const c = ch.charCodeAt(0); out += c === CODE.h ? String.fromCharCode(one) : c === CODE.hh ? String.fromCharCode(two) : ch; }
  return out;
}
// A token -> its code. Style that the VECTOR decides (hour cycle, day period width, fraction digits, zone style)
// is not in the code: the runtime reads it from the vector, so the same pattern serves every value of it.
function codeOf(type, value) {
  switch (type) {
    case "weekday": return value.length === 1 ? CODE.weekdayN : value.length === 3 ? CODE.weekdayS : CODE.weekdayL;
    case "era": return value === "A" ? CODE.eraN : value === "AD" ? CODE.eraS : CODE.eraL;
    case "year": return value === "08" ? CODE.yy : CODE.y;
    case "month": return { "3": CODE.M, "03": CODE.MM, Mar: CODE.MMM, March: CODE.MMMM, M: CODE.MMMMM }[value];
    case "day": return value === "4" ? CODE.d : CODE.dd;
    case "dayPeriod": return value === "AM" || value === "PM" ? CODE.a : CODE.B;
    case "hour": return value.length === 2 ? CODE.hh : CODE.h;
    case "minute": return value.length === 2 ? CODE.mm : CODE.m;
    case "second": return value.length === 2 ? CODE.ss : CODE.s;
    case "fractionalSecond": return CODE.S;
    case "timeZoneName": return CODE.tz;
  }
  throw new Error("no code for " + type + ":" + value);
}
// A token list as a byte string (latin1-safe: literals are UTF-8 bytes, field codes are < 0x20).
function bytesOf(tokens) {
  const parts = [];
  // V8 replaces every U+202F NARROW NO-BREAK SPACE (what ICU 72+ puts before AM/PM) with an ASCII space in the text
  // format()/toLocaleString return, but not in formatToParts: the literals here carry the replaced form.
  for (const [t, v] of tokens) parts.push(t === "L" ? Buffer.from(v.replace(/\u202f/g, " "), "utf8") : Buffer.from([codeOf(t, v)]));
  return Buffer.concat(parts).toString("latin1");
}
const HAS_CTRL = (s) => /[\x01-\x1f]/.test(s);

// ───────────────────────── phase: mine ─────────────────────────
function mine(shard, nsh) {
  const pool = new Map();
  const ids = new Uint32Array(Math.ceil(TOTAL / nsh));
  let n = 0;
  for (let k = shard; k < TOTAL; k += nsh) {
    const idx = vec(k);
    let sig;
    if (!HAS_FIELD.some((i) => idx[i])) sig = "-";
    else {
      try { sig = tokensOf(optsOf(idx)).map((t) => (t[0] === "L" ? JSON.stringify(t[1]) : t[0] + ":" + t[1])).join("\u0001"); } catch { sig = "ERR"; }
    }
    let id = pool.get(sig);
    if (id === undefined) { id = pool.size; pool.set(sig, id); }
    ids[n++] = id;
  }
  writeFileSync(`${DIR}/mine${shard}.json`, JSON.stringify({ pool: [...pool.keys()], n }));
  writeFileSync(`${DIR}/mine${shard}.bin`, Buffer.from(ids.buffer, 0, n * 4));
}

// ───────────────────────── phase: names (zone-name sequences) ─────────────────────────
// (implemented below, after the shared timeline helpers)

// ───────────────────────── shared timeline helpers (the offset generator's, restated) ─────────────────────────
const UTC_MS = (y, mo, d, h = 0, mi = 0, s = 0) => { const u = new Date(0); u.setUTCFullYear(y, mo, d); u.setUTCHours(h, mi, s, 0); return u.getTime(); };
const isLeapY = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const jan1Wd = (y) => { const u = new Date(0); u.setUTCFullYear(y, 0, 1); return u.getUTCDay(); };
function equivYear(y, E) {
  const w = jan1Wd(y), leap = isLeapY(y);
  for (let c = E; c >= E - 27; c--) if (isLeapY(c) === leap && jan1Wd(c) === w) return c;
  return -1;
}
const lookupSeq = (T, V, v0, t) => {
  let lo = 0, hi = T.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (T[mid] <= t) lo = mid + 1; else hi = mid; }
  return lo === 0 ? v0 : V[lo - 1];
};
// ICU's metazone mapping ends at 9999-12-31T23:59:00Z (measured on six zones and four styles). From then on a name is
// the zone's metazone-FREE one: the localized GMT form, the location name ("Sao Paulo Time"), or a zone-level name
// that has no metazone ("Irish Standard Time" in Europe/Dublin's summer), which still alternates with daylight
// saving. So per zone and style there are TWO sequences: one up to META_END and one from META_END on, each with
// its own explicit span and 28-year window.
const META_END = 253402300740;
function modelSeq(rec, t) {
  if (rec.T.length === 0) return rec.v0;
  if (t >= rec.tail) {
    const d = new Date(t * 1000);
    const ey = equivYear(d.getUTCFullYear(), rec.end);
    if (ey < 0) return undefined;
    const u = new Date(0);
    u.setUTCFullYear(ey, d.getUTCMonth(), d.getUTCDate());
    u.setUTCHours(d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), 0);
    t = u.getTime() / 1000;
  }
  return lookupSeq(rec.T, rec.V, rec.v0, t);
}
const SCAN_STEP = 86400000;
// the two segments: [1700, 2200) explicit to a window end in 1727..2199, and [META_END, 10300) explicit to a window
// end in 10027..10299 (ICU's zone rules answer far beyond either; the window rule carries them)
const SEGS = [
  { from: UTC_MS(1700, 0, 1), to: UTC_MS(2200, 0, 1), endMin: 1727, endMax: 2199 },
  { from: META_END * 1000, to: UTC_MS(10300, 0, 1), endMin: 10027, endMax: 10299 },
];
const mkRec = (L, E) => {
  const tail = UTC_MS(E + 1, 0, 1) / 1000;
  const T = [], V = [];
  for (let i = 0; i < L.T.length; i++) if (L.T[i] < tail) { T.push(L.T[i]); V.push(L.V[i]); }
  return { v0: L.v0, T, V, end: E, tail };
};
const validEnd = (L, E, seg) => {
  const r = mkRec(L, E);
  for (let i = 0; i < L.T.length; i++) for (const t of [L.T[i] - 1, L.T[i]]) if (t >= r.tail && modelSeq(r, t) !== lookupSeq(L.T, L.V, L.v0, t)) return false;
  for (let t = r.tail; t < seg.to / 1000; t += 86400) if (modelSeq(r, t) !== lookupSeq(L.T, L.V, L.v0, t)) return false;
  return true;
};
function fitEnd(L, seg) {
  if (L.T.length === 0) return { v0: L.v0, T: [], V: [], end: seg.endMin, tail: 0 };
  if (!validEnd(L, seg.endMax, seg)) throw new Error("no end year reproduces the sequence");
  let lo = seg.endMin, hi = seg.endMax;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (validEnd(L, mid, seg)) hi = mid; else lo = mid + 1; }
  const classes = (E) => { const s = new Set(); for (let c = E - 27; c <= E; c++) s.add((isLeapY(c) ? 7 : 0) + jan1Wd(c)); return s.size; };
  while (classes(lo) < 14) lo++;
  if (lo > seg.endMax || !validEnd(L, lo, seg)) throw new Error("no end year with a complete window");
  return mkRec(L, lo);
}
const modelPair = (pair, t) => modelSeq(t >= META_END ? pair.late : pair.main, t);

// ───────────────────────── phase: names ─────────────────────────
const NAME_STYLES = ["short", "long", "shortGeneric", "longGeneric"];
const pad2 = (n) => String(n).padStart(2, "0");
// ICU's localized GMT format as V8 prints it: long "GMT+05:30[:SS]", short "GMT+5[:30[:SS]]"; zero is "GMT+00:00" / "GMT+0".
function gmtName(offSec, long) {
  const sign = offSec < 0 ? "-" : "+";
  const a = Math.abs(offSec), h = Math.floor(a / 3600), m = Math.floor(a / 60) % 60, s = a % 60;
  return long
    ? `GMT${sign}${pad2(h)}:${pad2(m)}${s ? ":" + pad2(s) : ""}`
    : `GMT${sign}${h}${m || s ? ":" + pad2(m) : ""}${s ? ":" + pad2(s) : ""}`;
}
const COMPUTED = "\u0000computed";
// LocalTZA at a whole-second instant, in exact seconds: the local fields minus the UTC fields, read from ICU
// itself through Intl.DateTimeFormat (not through the TZ variable and Date getters). That is the truth for every id:
// a host that lacks a legacy id's zoneinfo file (Debian's tzdata-legacy: CET, EET, MET, EST, MST, HST, Cuba, Iran,
// PRC, ROC, ROK, W-SU) makes `TZ=CET node` read UTC while ICU knows the zone, and a runtime that bundles Node's
// zone data should carry ICU's rules. Intl also has no DST cache, so a query's answer cannot depend on the queries
// before it (V8's Date cache mis-extends a DST interval across closely spaced transitions: Africa/Tunis
// 1943-03-29T01:00:00Z reads 3600 or 7200 by history).
let tzNow = null;
const fmtCache = new Map();
function intlFmt(id, era) {
  const key = id + (era ? "|era" : "");
  let f = fmtCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: id, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric", ...(era ? { era: "short" } : {}) });
    fmtCache.set(key, f);
  }
  return f;
}
const INTL_RE = /^(\d+)\/(\d+)\/(\d+), (\d+):(\d+):(\d+)$/;
function offSec(tms) {
  let y, mo, d, h, mi, s;
  const m = tms >= -62135596800000 ? INTL_RE.exec(intlFmt(tzNow, false).format(tms)) : null;
  if (m) { mo = +m[1]; d = +m[2]; y = +m[3]; h = +m[4]; mi = +m[5]; s = +m[6]; }
  else {
    const p = Object.fromEntries(intlFmt(tzNow, true).formatToParts(tms).map((x) => [x.type, x.value]));
    y = +p.year; if (p.era === "BC") y = 1 - y;
    mo = +p.month; d = +p.day; h = +p.hour; mi = +p.minute; s = +p.second;
  }
  const u = new Date(0);
  u.setUTCFullYear(y, mo - 1, d);
  u.setUTCHours(h, mi, s, 0);
  return (u.getTime() - Math.floor(tms / 1000) * 1000) / 1000;
}

// Every explicit offset transition of every zone in the runtime's table (scr_date_tzdb.c, decoded with its codec).
// ICU's GENERIC names depend on whether the zone's offset matches its metazone's golden zone at that instant, so a
// name can change for the few hours between two zones' transitions: the candidate instants must include every
// transition of every zone, not only this zone's own.
let ALLT = null;
function allTransitions() {
  if (ALLT) return ALLT;
  const src = readFileSync(new URL("../packages/runtime/src/scr_date_tzdb.c", import.meta.url), "utf8");
  const arr = (name) => { const m = new RegExp(`${name}\\[\\d+\\] = \\{([^}]*)\\}`).exec(src); return m[1]; };
  const blob = arr("scr_tz_blob").split(",").map(Number);
  const recsSrc = /scr_tz_recs\[\d+\] = \{\n([\s\S]*?)\n\};/.exec(src)[1];
  const recs = [...recsSrc.matchAll(/\{(-?\d+),(\d+),(\d+),(\d+)\}/g)].map((m) => ({ cnt: +m[2], off: +m[4] }));
  const set = new Set();
  for (const r of recs) {
    const p = { i: r.off };
    const noff = getVar(blob, p);
    for (let i = 0; i < noff; i++) getVar(blob, p);
    const T = [], idx = [];
    for (let i = 0; i < r.cnt; i++) {
      const v = getVar(blob, p);
      const mm = v % 2, days = Math.floor(v / 2) % 2, z = Math.floor(v / 4);
      const pred = i === 0 ? 0 : i === 1 ? T[0] : T[i - 2] + 31536000;
      T.push(pred + unzz(z) * (days ? 86400 : 1));
      idx.push(mm ? blob[p.i++] : i < 2 ? 0 : idx[i - 2]);
      set.add(T[i]);
    }
  }
  ALLT = [...set].sort((a, b) => a - b);
  return ALLT;
}
function candidates(seg) {
  const c = new Set();
  for (let t = seg.from; t <= seg.to; t += SCAN_STEP) c.add(t);
  for (const t of allTransitions()) { const ms = t * 1000; if (ms >= seg.from && ms <= seg.to) { c.add(ms - 1000); c.add(ms); c.add(ms + 1000); } }
  return [...c].sort((a, b) => a - b);
}
function nameSequence(id, style, seg) {
  tzNow = id;
  const f = new Intl.DateTimeFormat("en-US", { timeZone: id, timeZoneName: style, hour: "numeric" });
  const long = style === "long" || style === "longGeneric";
  const valueAt = (tms) => {
    const n = f.formatToParts(tms).find((p) => p.type === "timeZoneName").value;
    return n.startsWith("GMT") && n === gmtName(offSec(tms), long) ? COMPUTED : n;
  };
  let cur = valueAt(seg.from);
  const v0 = cur, T = [], V = [];
  let prev = seg.from;
  const cand = candidates(seg);
  for (let i = 1; i < cand.length;) {
    const t = cand[i];
    const v = valueAt(t);
    if (v !== cur) {
      let lo = prev, hi = t;
      while (hi - lo > 1000) { const mid = lo + Math.floor((hi - lo) / 2000) * 1000; if (valueAt(mid) === cur) lo = mid; else hi = mid; }
      cur = valueAt(hi);
      T.push(hi / 1000);
      V.push(cur);
      prev = hi;
      continue;
    }
    prev = t;
    i++;
  }
  return { v0, T, V };
}
function zoneIds() {
  // the same universe as gen-date-zones.mjs: every id the runtime table carries
  const src = readFileSync(new URL("../packages/runtime/src/scr_date_tzdb.c", import.meta.url), "utf8");
  const a = src.indexOf("const char scr_tz_ids[] ="), b = src.indexOf("  ;", a);
  return [...src.slice(a, b).matchAll(/"([^"\\]+)" "\\0"/g)].map((m) => m[1]);
}
function names(shard, nsh) {
  const ids = zoneIds();
  const out = {};
  ids.forEach((id, i) => {
    if (i % nsh !== shard) return;
    out[id] = {};
    for (const st of NAME_STYLES) {
      out[id][st] = { main: fitEnd(nameSequence(id, st, SEGS[0]), SEGS[0]), late: fitEnd(nameSequence(id, st, SEGS[1]), SEGS[1]) };
      // verify against node at a weekly grid and at random instants (fresh formatter, so the answer is ICU's)
      const rec = out[id][st];
      tzNow = id;
      const f = new Intl.DateTimeFormat("en-US", { timeZone: id, timeZoneName: st, hour: "numeric" });
      const long = st === "long" || st === "longGeneric";
      const check = (t) => {
        const n = f.formatToParts(t * 1000).find((p) => p.type === "timeZoneName").value;
        let want = n;
        if (n.startsWith("GMT") && n === gmtName(offSec(t * 1000), long)) want = COMPUTED;
        const got = modelPair(rec, t);
        if (got !== want) throw new Error(`${id} ${st}: model ${got} != node ${want} at ${t} (${new Date(t * 1000).toISOString()})`);
      };
      for (let t = UTC_MS(1700, 0, 1) / 1000 + 19; t < UTC_MS(3200, 0, 1) / 1000; t += 7 * 86400 + 5 * 3600 + 13) check(t);
      let x = 0x9e3779b9;
      for (let k = 0; k < 2000; k++) { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; check(Math.floor((x / 4294967296 * 2 - 1) * 8.639e12)); }
      for (let k = 0; k < 3000; k++) { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; check(Math.floor(UTC_MS(2200, 0, 1) / 1000 + (x / 4294967296) * (UTC_MS(10100, 0, 1) - UTC_MS(2200, 0, 1)) / 1000)); }
      check(META_END - 1); check(META_END);
      for (const t of [...rec.main.T, ...rec.late.T]) { check(t - 1); check(t); }
      { // around random transitions of ANY zone (the golden-zone windows), seconds to hours either side
        const at = allTransitions();
        for (let k = 0; k < 4000; k++) { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; const base = at[x % at.length]; x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; check(base + (x % 86400) - 43200); }
      }
    }
  });
  writeFileSync(`${DIR}/names${shard}.json`, JSON.stringify(out));
}

// ───────────────────────── phase: build ─────────────────────────
const parseSig = (sig) => sig.split("\u0001").map((t) => (t[0] === '"' ? ["L", JSON.parse(t)] : [t.slice(0, t.indexOf(":")), t.slice(t.indexOf(":") + 1)]));
const zz = (n) => (n < 0 ? -2 * n - 1 : 2 * n);
const unzz = (v) => (v % 2 === 1 ? -(v + 1) / 2 : v / 2);
const mkBlob = () => {
  const blob = [];
  const putVar = (v) => { while (v >= 128) { blob.push((v % 128) | 128); v = Math.floor(v / 128); } blob.push(v); };
  return { blob, putVar };
};
const getVar = (b, p) => { let v = 0, m = 1; while (b[p.i] >= 128) { v += (b[p.i++] - 128) * m; m *= 128; } v += b[p.i++] * m; return v; };
const cstr = (bytes) => { // a latin1 byte string as a C initializer list
  return [...Buffer.from(bytes, "latin1")].join(",");
};

function build(nsh) {
  // ── load the mined vectors ──
  const gl = []; const gmap = new Map(); const gid = new Uint32Array(TOTAL);
  for (let sh = 0; sh < nsh; sh++) {
    const meta = JSON.parse(readFileSync(`${DIR}/mine${sh}.json`));
    const bin = readFileSync(`${DIR}/mine${sh}.bin`);
    const ids = new Uint32Array(bin.buffer, bin.byteOffset, meta.n);
    const map = meta.pool.map((sig) => { let id = gmap.get(sig); if (id === undefined) { id = gl.length; gmap.set(sig, id); gl.push(sig); } return id; });
    for (let i = 0; i < meta.n; i++) gid[sh + i * nsh] = map[ids[i]];
  }
  const U = (id) => gl[id] === "-" || gl[id] === "ERR";
  const tokCache = new Map();
  const toks = (id) => { let v = tokCache.get(id); if (!v) { v = parseSig(gl[id]); tokCache.set(id, v); } return v; };
  const bytesCache = new Map();
  const bytes = (id) => { let v = bytesCache.get(id); if (v === undefined) { v = bytesOf(toks(id)); bytesCache.set(id, v); } return v; };
  const at = (di, ti) => gid[di * NT + ti];
  const dimsT = (ti) => vec(ti); // the first five entries are the date half (zeros)
  const hasTimeField = (ti) => { const x = vec(ti); return HAS_TIME.some((i) => x[i]); };
  const hasHour = (ti) => !!vec(ti)[6];
  const tzOf = (ti) => vec(ti)[10];

  // ── D: the date half alone ──
  const D = new Array(ND).fill(null);
  for (let di = 1; di < ND; di++) { const id = at(di, 0); if (!U(id)) D[di] = bytes(id); }
  // era-only date halves: reachable only beside a time field, where the era field is all of the date half
  for (let di = 1; di < ND; di++) {
    const x = vec(di * NT);
    if (D[di] === null && x[1] && !x[0] && !x[2] && !x[3] && !x[4]) D[di] = String.fromCharCode(codeOf("era", ["", "A", "AD", "Anno Domini"][x[1]]));
  }
  // ── T: the time half alone ──
  const T = new Array(NT).fill(null);
  T[0] = "";
  for (let ti = 1; ti < NT; ti++) {
    if (hasTimeField(ti)) { const id = at(0, ti); if (U(id)) throw new Error("time half unreachable at " + ti); T[ti] = bytes(id); }
    else if (tzOf(ti)) T[ti] = String.fromCharCode(CODE.tz);
    else T[ti] = ""; // hourCycle only: no time field, no zone
  }
  // ── glue: one per date half, except a weekday-only one, whose glue is a function of the time half's PATTERN ──
  const GL = [", ", " at ", " "];
  const glue = new Uint8Array(ND);
  const weekdayOnly = (di) => { const x = vec(di * NT); return x[0] && !x[1] && !x[2] && !x[3] && !x[4]; };
  const spaceGlueT = new Set(); // T patterns that follow a weekday-only date half after a plain space ("Tue 5:06 AM")
  let checked = 0;
  for (let di = 1; di < ND; di++) {
    let seen = null;
    for (let ti = 1; ti < NT; ti++) {
      const id = at(di, ti);
      if (U(id)) continue;
      if (D[di] === null) throw new Error("date half missing for " + di);
      const comp = bytes(id), d = D[di], t = T[ti];
      if (!comp.startsWith(d) || !comp.endsWith(t) || comp.length < d.length + t.length) throw new Error(`composition: ${di},${ti}`);
      const g = comp.slice(d.length, comp.length - t.length);
      const gi = GL.indexOf(g);
      if (t === "") { if (g !== "") throw new Error("glue with an empty time half"); continue; }
      if (gi < 0) throw new Error(`unknown glue ${JSON.stringify(g)} at ${di},${ti}`);
      checked++;
      if (weekdayOnly(di)) {
        if (g === " ") spaceGlueT.add(t);
        else if (g !== ", ") throw new Error("weekday-only glue " + JSON.stringify(g));
        continue;
      }
      if (seen === null) seen = gi; else if (seen !== gi) throw new Error(`glue not a function of d: d=${di}`);
    }
    glue[di] = weekdayOnly(di) ? 0 : seen ?? 0;
  }
  // a time half's glue after a weekday-only date half must not vary within one pattern
  for (const di of [...Array(ND).keys()].filter((d) => d && weekdayOnly(d))) for (let ti = 1; ti < NT; ti++) {
    const id = at(di, ti); if (U(id) || T[ti] === "") continue;
    const g = bytes(id).slice(D[di].length, bytes(id).length - T[ti].length);
    if ((g === " ") !== spaceGlueT.has(T[ti])) throw new Error("weekday-only glue is not a function of the time pattern");
  }
  // date-only and time-only vectors
  for (let di = 1; di < ND; di++) if (D[di] !== null && !U(at(di, 0)) && bytes(at(di, 0)) !== D[di]) throw new Error("date-only mismatch " + di);
  for (let ti = 1; ti < NT; ti++) if (hasTimeField(ti) && bytes(at(0, ti)) !== T[ti]) throw new Error("time-only mismatch " + ti);
  // ── the full check: every reachable vector is D + glue + T ──
  let nOk = 0;
  for (let di = 0; di < ND; di++) {
    for (let ti = 0; ti < NT; ti++) {
      const id = at(di, ti);
      if (U(id)) continue;
      let got;
      if (di === 0) got = T[ti];
      else if (ti === 0) got = D[di];
      else got = D[di] + (T[ti] === "" ? "" : weekdayOnly(di) ? (spaceGlueT.has(T[ti]) ? " " : ", ") : GL[glue[di]]) + T[ti];
      if (got !== bytes(id)) throw new Error(`recomposition differs at ${di},${ti}: ${JSON.stringify(got)} vs ${JSON.stringify(bytes(id))}`);
      // the style a code leaves to the vector must be there to read
      const x = vec(di * NT + ti);
      for (const ch of got) {
        const c = ch.charCodeAt(0);
        if (c === CODE.B && !x[5]) throw new Error("B without dayPeriod");
        if (c === CODE.S && !x[9]) throw new Error("S without fractionalSecondDigits");
        if (c === CODE.tz && !x[10]) throw new Error("zone without timeZoneName");
      }
      nOk++;
    }
  }
  console.error(`composition verified: ${nOk} reachable vectors, ${checked} glue checks`);

  // ── the final time halves carry the mined hour letter; the canonical ones (width-only) stay the verified ones ──
  const Tfinal = T.slice();
  const hourLetters = new Map();
  for (let ti = 1; ti < NT; ti++) {
    if (!vec(ti)[6]) continue;
    const letter = hourLetter(optsOf(vec(ti)));
    hourLetters.set(letter, (hourLetters.get(letter) || 0) + 1);
    Tfinal[ti] = withHourLetter(T[ti], letter);
  }
  console.error("hour letters over the time halves:", JSON.stringify([...hourLetters]));

  // ── dateStyle / timeStyle: mined whole, [dateStyle][timeStyle][hourCycle] ──
  const STY = ["", "full", "long", "medium", "short"];
  const style = [];
  for (let ds = 0; ds < 5; ds++) for (let ts = 0; ts < 5; ts++) for (let hc = 0; hc < 5; hc++) {
    if (!ds && !ts) { style.push(null); continue; }
    const o = {};
    if (ds) o.dateStyle = STY[ds];
    if (ts) o.timeStyle = STY[ts];
    if (hc) o.hourCycle = F[11][1][hc];
    style.push(withHourLetter(bytesOf(tokensOf(o)), hourLetter(o)));
  }

  // ── the pattern pool ──
  const pool = new Map(); const poolList = []; let poolBytes = 0;
  const poolOf = (b) => { let o = pool.get(b); if (o === undefined) { o = poolBytes; pool.set(b, o); poolList.push(b); poolBytes += Buffer.byteLength(b, "latin1") + 1; } return o; };
  poolOf(""); // offset 0 is the empty pattern
  for (const b of D) if (b !== null) poolOf(b);
  for (const b of Tfinal) poolOf(b);
  for (const b of style) if (b !== null) poolOf(b);
  if (poolBytes >= 0x7ffe) throw new Error("pattern pool too large for 15-bit offsets: " + poolBytes);
  const dTab = D.map((b) => (b === null ? 0xffff : poolOf(b)));
  const styleTab = style.map((b) => (b === null ? 0xffff : poolOf(b)));

  // ── T as a reduced decision diagram: search the dimension order ──
  const tdims = F.slice(5).map(([n, v]) => [n, v.length]); // dayPeriod, hour, minute, second, fsd, tz, hc
  const tr = tdims.map((x) => x[1]);
  const stride = []; { let m = 1; for (let i = tr.length - 1; i >= 0; i--) { stride[i] = m; m *= tr[i]; } }
  const leafOf = (ti) => (Tfinal[ti] === null ? 0xffff : 0x8000 | poolOf(Tfinal[ti]));
  const leaves = new Uint16Array(NT); for (let ti = 0; ti < NT; ti++) leaves[ti] = leafOf(ti);
  function mdd(order, emit) {
    const nodes = new Map(); const edges = [];
    const build = (level, base) => {
      if (level === order.length) return leaves[base];
      const d = order[level]; const kids = [];
      for (let v = 0; v < tr[d]; v++) kids.push(build(level + 1, base + v * stride[d]));
      if (kids.every((k) => k === kids[0])) return kids[0]; // reduction: a level that decides nothing is skipped
      const key = d + ":" + kids.join(",");
      let p = nodes.get(key);
      if (p === undefined) { p = edges.length; nodes.set(key, p); edges.push(d, ...kids); } // a node: its dimension, then one child per value
      return p;
    };
    const root = build(0, 0);
    return { root, edges };
  }
  function* permutations(a, n = a.length) { if (n <= 1) yield a.slice(); else for (let i = 0; i < n; i++) { yield* permutations(a, n - 1); const j = n % 2 ? 0 : i; [a[n - 1], a[j]] = [a[j], a[n - 1]]; } }
  let best = null;
  for (const p of permutations([0, 1, 2, 3, 4, 5, 6])) { const r = mdd(p); if (!best || r.edges.length < best.edges.length) best = { ...r, order: p.slice() }; }
  if (best.edges.length >= 0x8000) throw new Error("diagram too large");
  // verify the diagram reproduces every T entry
  for (let ti = 0; ti < NT; ti++) {
    const x = vec(ti);
    let v = best.root;
    while (!(v & 0x8000) && v !== 0xffff) { const d = best.edges[v]; v = best.edges[v + 1 + x[5 + d]]; }
    if (v !== leaves[ti]) throw new Error(`diagram mismatch at ${ti}`);
  }
  console.error(`T diagram: order ${best.order.join("")}, ${best.edges.length} edges; pool ${poolBytes} bytes in ${poolList.length} patterns`);
  // the glue after a weekday-only date half follows the time pattern; every hour-letter variant of one is the same pattern
  const spaceGlue = [...new Set([...Array(NT).keys()].filter((ti) => T[ti] !== null && spaceGlueT.has(T[ti])).map((ti) => poolOf(Tfinal[ti])))];
  return { best, dTab, glue, styleTab, poolList, poolBytes, nOk, spaceGlue };
}

// ───────────────────────── phase: emit ─────────────────────────
const hdr = (what) =>
  `/* GENERATED by scripts/gen-date-intl.mjs -- do not edit by hand.\n` +
  ` * Source: node ${process.version}, icu ${process.versions.icu}, tz ${process.versions.tz}, cldr ${process.versions.cldr}.\n` + what;
const cEsc = (s) => { // a UTF-8 C string literal with octal escapes for everything outside printable ASCII
  let out = '"';
  for (const b of Buffer.from(s, "utf8")) {
    if (b === 0x22 || b === 0x5c) out += "\\" + String.fromCharCode(b);
    else if (b >= 0x20 && b < 0x7f) out += String.fromCharCode(b);
    else out += "\\" + b.toString(8).padStart(3, "0");
  }
  return out + '"';
};
function emitNames(nsh, ids) {
  const all = {};
  for (let sh = 0; sh < nsh; sh++) Object.assign(all, JSON.parse(readFileSync(`${DIR}/names${sh}.json`)));
  for (const id of ids) if (!all[id]) throw new Error("no names for " + id);
  // string pool: 0 is the computed GMT form
  const pool = [COMPUTED], pidx = new Map([[COMPUTED, 0]]);
  const pid = (s) => { let i = pidx.get(s); if (i === undefined) { i = pool.length; pidx.set(s, i); pool.push(s); } return i; };
  const recs = new Map(); const recList = [];
  const idRec = [];
  const add = (r) => {
    const norm = { v0: pid(r.v0), end: r.end, T: r.T, V: r.V.map(pid) };
    const key = JSON.stringify(norm);
    let ri = recs.get(key);
    if (ri === undefined) { ri = recList.length; recs.set(key, ri); recList.push(norm); }
    return ri;
  };
  for (const id of ids) for (const st of NAME_STYLES) { idRec.push(add(all[id][st].main)); idRec.push(add(all[id][st].late)); }
  const nb = mkBlob();
  const recOut = [];
  for (const r of recList) {
    const off = nb.blob.length;
    nb.putVar(r.v0);
    for (let i = 0; i < r.T.length; i++) {
      const pred = i === 0 ? 0 : i === 1 ? r.T[0] : r.T[i - 2] + 31536000;
      const res = r.T[i] - pred, days = res % 86400 === 0;
      const predV = i < 2 ? r.v0 : r.V[i - 2];
      const mm = r.V[i] !== predV ? 1 : 0;
      nb.putVar(zz(days ? res / 86400 : res) * 4 + (days ? 2 : 0) + mm);
      if (mm) nb.putVar(r.V[i]);
    }
    // decode round trip
    const p = { i: off }, v0 = getVar(nb.blob, p), T = [], V = [];
    for (let i = 0; i < r.T.length; i++) {
      const v = getVar(nb.blob, p), mm = v % 2, days = Math.floor(v / 2) % 2, z = Math.floor(v / 4);
      const pred = i === 0 ? 0 : i === 1 ? T[0] : T[i - 2] + 31536000;
      T.push(pred + unzz(z) * (days ? 86400 : 1));
      V.push(mm ? getVar(nb.blob, p) : i < 2 ? v0 : V[i - 2]);
    }
    if (JSON.stringify([v0, T, V]) !== JSON.stringify([r.v0, r.T, r.V])) throw new Error("names codec round trip failed");
    recOut.push({ cnt: r.T.length, end: r.end, off });
  }
  const poolBytes = pool.slice(1).reduce((a, s) => a + Buffer.byteLength(s) + 1, 0);
  const trans = recList.reduce((a, r) => a + r.T.length, 0);
  let o = hdr(` * ${ids.length} zone ids x 4 name styles x 2 segments -> ${recList.length} distinct sequences, ${trans} name changes,\n` +
    ` * ${pool.length - 1} names (${poolBytes} bytes), blob ${nb.blob.length} bytes. See scr_date_intl.c for how they are read. */\n`);
  o += `#include <stddef.h>\n#include <stdint.h>\n#include "scr_date_zones.h"\n\n`;
  o += `const char scr_tzn_names[] =\n` + pool.slice(1).map((s) => `  ${cEsc(s)} "\\0"`).join("\n") + `\n  ;\n`;
  let off = 0;
  o += `const uint16_t scr_tzn_name_off[${pool.length - 1}] = {${pool.slice(1).map((s) => { const v = off; off += Buffer.byteLength(s) + 1; return v; }).join(",")}};\n`;
  o += `const uint8_t scr_tzn_blob[${nb.blob.length}] = {${nb.blob.join(",")}};\n`;
  o += `const scr_tzn_rec scr_tzn_recs[${recOut.length}] = {\n` + recOut.map((r) => `{${r.cnt},${r.end},${r.off}}`).join(",") + `\n};\n`;
  o += `const size_t scr_tzn_nrecs = ${recOut.length};\n`;
  o += `const uint16_t scr_tzn_id_rec[${idRec.length}] = {${idRec.join(",")}}; /* [id * 8 + style * 2 + segment]: styles short, long, shortGeneric, longGeneric; segments before / from scr_tzn_meta_end */\n`;
  o += `const int64_t scr_tzn_meta_end = ${META_END}; /* seconds: ICU's metazone mapping ends here; later instants use the second sequence */\n`;
  return o;
}
function emitIntl(r) {
  let o = hdr(` * ${r.nOk} option vectors reproduced exactly by D + glue + T (see the generator); pool ${r.poolBytes} bytes in ${r.poolList.length} patterns,\n` +
    ` * T diagram ${r.best.edges.length} edges. Pattern bytes: 0x01.. field codes (scr_date_intl.c), anything else a literal byte. */\n`);
  o += `#include <stddef.h>\n#include <stdint.h>\n#include "scr_date_zones.h"\n\n`;
  const bytes = [];
  for (const b of r.poolList) { for (const c of Buffer.from(b, "latin1")) bytes.push(c); bytes.push(0); }
  o += `const uint8_t scr_di_pool[${bytes.length}] = {${bytes.join(",")}};\n`;
  o += `const uint16_t scr_di_d[${r.dTab.length}] = {${r.dTab.join(",")}};\n`;
  o += `const uint8_t scr_di_glue[${r.glue.length}] = {${[...r.glue].join(",")}};\n`;
  o += `const uint16_t scr_di_spaceglue[${r.spaceGlue.length}] = {${r.spaceGlue.join(",")}};\n`;
  o += `const int scr_di_nspaceglue = ${r.spaceGlue.length};\n`;
  o += `const uint16_t scr_di_tedges[${r.best.edges.length}] = {${r.best.edges.join(",")}};\n`;
  o += `const uint16_t scr_di_troot = ${r.best.root};\n`;
  o += `const uint16_t scr_di_style[${r.styleTab.length}] = {${r.styleTab.join(",")}}; /* [dateStyle * 25 + timeStyle * 5 + hourCycle] */\n`;
  return o;
}
if (cmd === "build") {
  const nsh = +A1;
  const r = build(nsh);
  const ids = zoneIds();
  const intlC = emitIntl(r);
  if (args.includes("--only-intl")) { writeFileSync(outPath, intlC); console.log(`wrote ${outPath}`); process.exit(0); }
  const namesC = emitNames(+(args[args.indexOf("--names-shards") + 1] || 11), ids);
  const namesPath = args.includes("--names-out") ? args[args.indexOf("--names-out") + 1] : new URL("../packages/runtime/src/scr_date_tznames.c", import.meta.url).pathname;
  if (args.includes("--check")) {
    const a = existsSync(outPath) ? readFileSync(outPath, "utf8") : "", b = existsSync(namesPath) ? readFileSync(namesPath, "utf8") : "";
    if (a !== intlC || b !== namesC) { console.error("scr_date_intl_en.c / scr_date_tznames.c is stale"); process.exit(1); }
    console.log("scr_date_intl_en.c and scr_date_tznames.c are current");
  } else {
    writeFileSync(outPath, intlC);
    writeFileSync(namesPath, namesC);
    console.log(`wrote ${outPath} and ${namesPath}`);
  }
}
export { F, radix, ND, NT, TOTAL, REF, vec, optsOf, tokensOf, bytesOf, CODE, HAS_TIME, HAS_FIELD };
if (cmd === "mine") mine(+A1, +A2);
if (cmd === "names") names(+A1, +A2);
