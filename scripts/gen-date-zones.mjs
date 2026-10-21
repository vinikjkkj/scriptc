#!/usr/bin/env node
// Generates two runtime tables from the Node that runs it:
//   packages/runtime/src/scr_date_zones.c  the ICU long zone names Date.prototype.toString
//                                          prints, for every IANA zone id Node knows;
//   packages/runtime/src/scr_date_tzdb.c   the zone ids and each zone's UTC OFFSET HISTORY
//                                          (what the local getters, the setters and every
//                                          formatter read), so a binary's local time is
//                                          Node's by construction on every platform.
//
// THE OFFSET TABLE (scr_date_tzdb.c). Per zone: the initial offset (constant from the
// start of time to the first transition: measured, no zone changes before 1700), every
// transition from 1700 up to a per-zone END year, and after END the instants map to the
// EQUIVALENT year of the 28-year window [END-27, END] (same leap-ness and same weekday of
// Jan 1: the final recurring rule is calendar-periodic). END is the smallest year for
// which that mapping reproduces Node's own offsets to year 2140; the whole table is then
// checked against Node on transition edges, a weekly grid 1700..3200 and random instants
// over Date's whole range, and the generator refuses to write on any difference.
//
// THE NAME TABLE (scr_date_zones.c).
// WHAT NODE (V8 + ICU) DOES, as measured by this script's own checks:
//  - a zone has TWO display names, standard and daylight, fixed per process
//    (V8 caches icu::TimeZone::getDisplayName(isDst, LONG, en-US) once per
//    flag; for zones without a CLDR metazone name it is "GMT+01:00" form);
//  - which of the two a given instant prints is ICU's dst!=0 at that instant
//    for 0 <= t <= 2^31-1 seconds, and the flag of the EQUIVALENT instant
//    (same month/day/time of day, in the 2008..2037 year with the same
//    weekday pattern and leap-ness) outside that window.
// So a zone is: two names + the instants in [0, 2^31) at which the flag
// toggles. This script samples every zone daily across that window under
// process.env.TZ = <id>, bisects each change to the second, and writes the
// table. Zones whose data is identical share one record.
//
// Usage: node scripts/gen-date-zones.mjs [--out FILE] [--check]
// Run it with the Node whose output the runtime must reproduce (CI pins
// v24.15.0; its tzdata/ICU/CLDR versions are recorded in the output header).
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const args = process.argv.slice(2);
const outPath = args.includes("--out") ? args[args.indexOf("--out") + 1] : new URL("../packages/runtime/src/scr_date_zones.c", import.meta.url).pathname;
const tzdbPath = args.includes("--tzdb-out") ? args[args.indexOf("--tzdb-out") + 1] : new URL("../packages/runtime/src/scr_date_tzdb.c", import.meta.url).pathname;
const TMAX = 2147483647; // seconds: V8's kMaxEpochTimeInMs / 1000
const DAY = 86400;

function candidateIds() {
  const ids = new Set(Intl.supportedValuesOf("timeZone"));
  for (const extra of ["UTC", "GMT", "Etc/UTC", "Etc/GMT", "Etc/UCT", "UCT", "Zulu", "Universal", "Greenwich", "Etc/Zulu", "Etc/Universal", "Etc/Greenwich", "Etc/GMT0", "Etc/GMT+0", "Etc/GMT-0", "GMT0", "GMT+0", "GMT-0"]) ids.add(extra);
  for (let i = -14; i <= 12; i++) if (i !== 0) ids.add("Etc/GMT" + (i > 0 ? "+" : "-") + Math.abs(i));
  // legacy ids: every zone and link line of the host's tzdata source
  const zi = "/usr/share/zoneinfo/tzdata.zi";
  if (existsSync(zi)) {
    for (const line of readFileSync(zi, "utf8").split("\n")) {
      const m = /^[ZL] (\S+)(?: (\S+))?/.exec(line);
      if (!m) continue;
      if (line[0] === "L") ids.add(m[2]);
      else ids.add(m[1]);
    }
  }
  // the ids that were never in zi but ICU still resolves
  for (const extra of ["EST5EDT", "CST6CDT", "MST7MDT", "PST8PDT", "EST", "MST", "HST", "CET", "MET", "EET", "WET"]) ids.add(extra);
  const ok = [];
  for (const id of [...ids].sort()) {
    try { new Intl.DateTimeFormat("en", { timeZone: id }); ok.push(id); } catch { /* not an ICU id */ }
  }
  return ok;
}

const nameOf = (tsec) => {
  const s = new Date(tsec * 1000).toString();
  return s.slice(s.indexOf("(") + 1, -1);
};

function timeline(id) {
  process.env.TZ = id;
  const first = nameOf(0);
  let other = null;
  const toggles = [];
  let cur = first;
  let prevT = 0;
  const idx = (n) => (n === first ? 0 : 1);
  for (let t = DAY; t <= TMAX + DAY; t += DAY) {
    const tt = Math.min(t, TMAX);
    const n = nameOf(tt);
    if (n !== cur) {
      if (n !== first) { if (other === null) other = n; else if (other !== n) throw new Error(id + ": more than two names"); }
      // bisect (prevT, tt] for the first second whose name is n
      let lo = prevT, hi = tt;
      while (hi - lo > 1) {
        const mid = Math.floor((lo + hi) / 2);
        if (nameOf(mid) === cur) lo = mid; else hi = mid;
      }
      toggles.push(hi);
      cur = n;
    }
    prevT = tt;
    if (tt === TMAX) break;
  }
  return { n0: first, n1: other ?? first, toggles, idx };
}

const ids = candidateIds();

// ───────────────────────── offsets ─────────────────────────
const UTC_MS = (y, mo, d, h = 0, mi = 0, s = 0) => { const u = new Date(0); u.setUTCFullYear(y, mo, d); u.setUTCHours(h, mi, s, 0); return u.getTime(); };
// LocalTZA at a whole-second instant, in exact seconds: the local fields minus the UTC fields.
// V8 caches DST intervals per process and mis-extends one across closely spaced transitions (measured:
// Africa/Tunis 1943-03-29T01:00:00Z reads 3600 or 7200 depending on the queries that came before), so
// every query starts from a fresh cache (assigning TZ clears it): the answer is ICU's, not the history's.
let tzNow = null;
function offSec(tms) {
  process.env.TZ = tzNow;
  const d = new Date(tms);
  const u = new Date(0);
  u.setUTCFullYear(d.getFullYear(), d.getMonth(), d.getDate());
  u.setUTCHours(d.getHours(), d.getMinutes(), d.getSeconds(), 0);
  return (u.getTime() - Math.floor(tms / 1000) * 1000) / 1000;
}
const SCAN_FROM = UTC_MS(1700, 0, 1);
const SCAN_TO = UTC_MS(2200, 0, 1);
const SCAN_STEP = 12 * 3600 * 1000;
function offsetTimeline(id) {
  tzNow = id;
  process.env.TZ = id;
  let cur = offSec(SCAN_FROM);
  const off0 = cur;
  const T = [], O = [];
  let prev = SCAN_FROM;
  for (let t = SCAN_FROM + SCAN_STEP; t <= SCAN_TO;) {
    const o = offSec(t);
    if (o !== cur) {
      let lo = prev, hi = t; // offSec(lo) == cur, offSec(hi) != cur
      while (hi - lo > 1000) { const mid = lo + Math.floor((hi - lo) / 2000) * 1000; if (offSec(mid) === cur) lo = mid; else hi = mid; }
      // The state AT hi, not at t: two transitions can sit inside one sample step (Africa/El_Aaiun has a
      // one-second +00:00 between -01:00 and +01:00 in 1976). Re-examine the same sample against the new state.
      cur = offSec(hi);
      T.push(hi / 1000);
      O.push(cur);
      prev = hi;
      continue;
    }
    prev = t;
    t += SCAN_STEP;
  }
  return { off0, T, O };
}
// The latest year in the window [E-27, E] with the same leap-ness and the same weekday of Jan 1 as y, or -1
// when the window has none (it straddles a non-leap century year such as 2100 and lacks that class).
const isLeapY = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const jan1Wd = (y) => { const u = new Date(0); u.setUTCFullYear(y, 0, 1); return u.getUTCDay(); };
function equivYear(y, E) {
  const w = jan1Wd(y), leap = isLeapY(y);
  for (let c = E; c >= E - 27; c--) if (isLeapY(c) === leap && jan1Wd(c) === w) return c;
  return -1;
}
function lookup(T, O, off0, t) { // offset after the last transition <= t
  let lo = 0, hi = T.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (T[mid] <= t) lo = mid + 1; else hi = mid; }
  return lo === 0 ? off0 : O[lo - 1];
}
// The model the C runtime implements: explicit transitions before `tail`, the mapped year after it.
function modelOffset(rec, t) {
  if (rec.T.length === 0) return rec.off0;
  if (t >= rec.tail) {
    const d = new Date(t * 1000);
    const ey = equivYear(d.getUTCFullYear(), rec.end);
    if (ey < 0) return NaN; // no equivalent year in the window: this end year cannot serve
    const u = new Date(0);
    u.setUTCFullYear(ey, d.getUTCMonth(), d.getUTCDate());
    u.setUTCHours(d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), 0);
    t = u.getTime() / 1000;
  }
  return lookup(rec.T, rec.O, rec.off0, t);
}
const mkRec = (L, E) => {
  const tail = UTC_MS(E + 1, 0, 1) / 1000;
  const T = [], O = [];
  for (let i = 0; i < L.T.length; i++) if (L.T[i] < tail) { T.push(L.T[i]); O.push(L.O[i]); }
  return { off0: L.off0, T, O, end: E, tail };
};
const validEnd = (L, E) => {
  const r = mkRec(L, E);
  const lastT = SCAN_TO / 1000;
  for (let i = 0; i < L.T.length; i++) {
    for (const t of [L.T[i] - 1, L.T[i]]) if (t >= r.tail && modelOffset(r, t) !== lookup(L.T, L.O, L.off0, t)) return false;
  }
  for (let t = r.tail; t < lastT; t += 86400) if (modelOffset(r, t) !== lookup(L.T, L.O, L.off0, t)) return false;
  return true;
};
const END_MIN = 1727, END_MAX = 2199;
const offRecs = new Map(); // key -> rec
const idOffKey = new Map();
let verifyN = 0, slivers = 0;
const rnd = (() => { let x = 0x9e3779b9; return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; }; })();
for (const id of ids) {
  const L = offsetTimeline(id);
  let rec;
  if (L.T.length === 0) rec = { off0: L.off0, T: [], O: [], end: END_MIN, tail: 0 };
  else {
    if (!validEnd(L, END_MAX)) throw new Error(id + ": no end year up to " + END_MAX + " reproduces the offsets");
    let lo = END_MIN, hi = END_MAX; // smallest valid E (validity is monotone: a later window is inside the regular tail)
    while (lo < hi) { const mid = (lo + hi) >> 1; if (validEnd(L, mid)) hi = mid; else lo = mid + 1; }
    // The window must hold every (leap-ness, Jan 1 weekday) class so any future year has an equivalent one:
    // a window straddling 2100 (a non-leap century year) lacks some, so move the end past it.
    const classes = (E) => { const s = new Set(); for (let c = E - 27; c <= E; c++) s.add((isLeapY(c) ? 7 : 0) + jan1Wd(c)); return s.size; };
    while (classes(lo) < 14) lo++;
    if (lo > END_MAX || !validEnd(L, lo)) throw new Error(id + ": no end year with a complete window");
    rec = mkRec(L, lo);
  }
  // verify against Node itself
  tzNow = id;
  process.env.TZ = id;
  const chk = (t) => {
    verifyN++;
    const got = modelOffset(rec, t), want = offSec(t * 1000);
    if (Number.isNaN(want)) return; // the local fields fall outside Date's range: nothing to compare
    if (got !== want) {
      // A one-second sliver between two transitions (tzdata's rule ordering leaves one in a few zones,
      // e.g. Africa/El_Aaiun 1976-04-14T01:00:00Z) is cache-order dependent inside V8 and not a place a
      // program can rely on: accept it only when both neighbours agree with the model.
      const nb = (x) => modelOffset(rec, x) === offSec(x * 1000);
      if (nb(t - 1) && nb(t + 1)) { slivers++; return; }
    }
    if (got !== want) throw new Error(`${id}: model ${got} != node ${want} at ${t} (${new Date(t * 1000).toISOString()}) end ${rec.end}`);
  };
  for (const t of L.T) { chk(t - 1); chk(t); }
  for (let t = UTC_MS(1700, 0, 1) / 1000 + 17; t < UTC_MS(3200, 0, 1) / 1000; t += 7 * 86400 + 5 * 3600 + 11) chk(t);
  for (let k = 0; k < 3000; k++) chk(Math.floor((rnd() * 2 - 1) * 8.639e15 / 1000));
  chk(-8.64e12); chk(8.64e12);
  const key = JSON.stringify([rec.off0, rec.end, rec.T, rec.O]);
  if (!offRecs.has(key)) offRecs.set(key, rec);
  idOffKey.set(id, key);
}
console.error(`offset model verified against node: ${verifyN} instants over ${ids.length} zones (${slivers} one-second slivers skipped)`);

// ───────────────────────── names (flag toggles in [0, 2^31)) ─────────────────────────
const records = new Map(); // key -> {n0,n1,toggles}
const zoneKey = new Map();
let sampled = 0;
for (const id of ids) {
  const tl = timeline(id);
  const key = JSON.stringify([tl.n0, tl.n1, tl.toggles]);
  if (!records.has(key)) records.set(key, { n0: tl.n0, n1: tl.n1, toggles: tl.toggles });
  zoneKey.set(id, key);
  sampled++;
}
const pool = [];
const poolIdx = new Map();
const nameId = (n) => { if (!poolIdx.has(n)) { poolIdx.set(n, pool.length); pool.push(n); } return poolIdx.get(n); };
const recList = [...records.entries()];
const allMinutes = recList.every(([, r]) => r.toggles.every((t) => t % 60 === 0));
const unit = 60;
if (!allMinutes) throw new Error('a toggle is not a whole minute: the codec assumes minutes');
const zz = (n) => (n < 0 ? -2 * n - 1 : 2 * n);
const unzz = (v) => (v % 2 === 1 ? -(v + 1) / 2 : v / 2);
const mkBlob = () => {
  const blob = [];
  const putVar = (v) => { while (v >= 128) { blob.push((v % 128) | 128); v = Math.floor(v / 128); } blob.push(v); };
  return { blob, putVar };
};
const getVar = (b, p) => { let v = 0, m = 1; while (b[p.i] >= 128) { v += (b[p.i++] - 128) * m; m *= 128; } v += b[p.i++] * m; return v; };
const nb = mkBlob();
const encodeRec = (r) => {
  const m = r.toggles.map((t) => t / unit);
  for (let i = 0; i < m.length; i++) {
    if (i < 2) { nb.putVar(m[i] - (i ? m[i - 1] : 0)); continue; }
    const d = m[i] - m[i - 2] - 525600;
    if (d % 1440 === 0) nb.putVar(zz(d / 1440) * 2); else nb.putVar(zz(d) * 2 + 1);
  }
};
const decodeRec = (b, off, cnt) => {
  const p = { i: off }, m = [];
  for (let i = 0; i < cnt; i++) {
    if (i < 2) { m.push(getVar(b, p) + (i ? m[i - 1] : 0)); continue; }
    const v = getVar(b, p), d = v % 2 === 0 ? unzz(v / 2) * 1440 : unzz((v - 1) / 2);
    m.push(m[i - 2] + 525600 + d);
  }
  return m.map((x) => x * unit);
};
const recOut = [];
for (const [, r] of recList) {
  const off = nb.blob.length;
  encodeRec(r);
  const back = decodeRec(nb.blob, off, r.toggles.length);
  if (JSON.stringify(back) !== JSON.stringify(r.toggles)) throw new Error("toggle codec round trip failed");
  recOut.push({ n0: nameId(r.n0), n1: nameId(r.n1), off, cnt: r.toggles.length });
}
const recIndex = new Map(recList.map(([k], i) => [k, i]));
const totalToggles = recList.reduce((a, [, r]) => a + r.toggles.length, 0);
const blob = nb.blob;

// ───────────────────────── offset blob ─────────────────────────
// Per record: varint noff, noff zigzag-varint offsets in seconds (index 0 is the initial one), then per
// transition i: varint (zz(residual) * 4 + unit * 2 + mm). The instant is predicted as T[i-1] (i = 1),
// 0 (i = 0) or T[i-2] + 365 days (i >= 2); the residual is in whole days when it is one (unit 1), else in
// seconds. mm = 1 when the new offset index differs from the one of transition i-2 (the alternation of a
// DST zone), and a byte with the index follows.
const ob = mkBlob();
const offRecList = [...offRecs.entries()];
const offRecOut = [];
const YEAR_S = 31536000;
const encodeOff = (rec) => {
  const offs = [rec.off0];
  for (const o of rec.O) if (!offs.includes(o)) offs.push(o);
  if (offs.length > 255) throw new Error("too many distinct offsets");
  ob.putVar(offs.length);
  for (const o of offs) ob.putVar(zz(o));
  const idx = rec.O.map((o) => offs.indexOf(o));
  for (let i = 0; i < rec.T.length; i++) {
    const pred = i === 0 ? 0 : i === 1 ? rec.T[0] : rec.T[i - 2] + YEAR_S;
    const res = rec.T[i] - pred;
    const days = res % 86400 === 0;
    const predIdx = i < 2 ? 0 : idx[i - 2];
    const mm = idx[i] !== predIdx ? 1 : 0;
    ob.putVar(zz(days ? res / 86400 : res) * 4 + (days ? 2 : 0) + mm);
    if (mm) ob.blob.push(idx[i]);
  }
};
const decodeOff = (b, off, cnt) => {
  const p = { i: off };
  const noff = getVar(b, p), offs = [];
  for (let i = 0; i < noff; i++) offs.push(unzz(getVar(b, p)));
  const T = [], idx = [];
  for (let i = 0; i < cnt; i++) {
    const v = getVar(b, p);
    const mm = v % 2, days = Math.floor(v / 2) % 2, z = Math.floor(v / 4);
    const res = unzz(z) * (days ? 86400 : 1);
    const pred = i === 0 ? 0 : i === 1 ? T[0] : T[i - 2] + YEAR_S;
    T.push(pred + res);
    idx.push(mm ? b[p.i++] : i < 2 ? 0 : idx[i - 2]);
  }
  return { off0: offs[0], T, O: idx.map((k) => offs[k]) };
};
for (const [, rec] of offRecList) {
  const off = ob.blob.length;
  encodeOff(rec);
  const back = decodeOff(ob.blob, off, rec.T.length);
  if (JSON.stringify([back.off0, back.T, back.O]) !== JSON.stringify([rec.off0, rec.T, rec.O])) throw new Error("offset codec round trip failed");
  offRecOut.push({ off0: rec.off0, cnt: rec.T.length, end: rec.end, off });
}
const offIndex = new Map(offRecList.map(([k], i) => [k, i]));
const totalTrans = offRecList.reduce((a, [, r]) => a + r.T.length, 0);
const sortedIds = [...zoneKey.keys()].sort();
let idBytes = 0;
for (const id of sortedIds) idBytes += id.length + 1;

const header = (what) =>
  `/* GENERATED by scripts/gen-date-zones.mjs -- do not edit by hand.\n` +
  ` * Source: node ${process.version}, icu ${process.versions.icu}, tz ${process.versions.tz}, cldr ${process.versions.cldr}.\n` + what;

let o = header(
  ` * ${recList.length} distinct name records, ${pool.length} names, ${totalToggles} flag toggles,\n` +
  ` * toggle unit ${unit}s, blob ${blob.length} bytes. Zone id -> (name0, name1, flag toggles in [0, 2^31) seconds):\n` +
  ` * see the generator for what these mean and scr_date_fmt.c for how they are read. The ids live in\n` +
  ` * scr_date_tzdb.c (scr_tz_id_nrec maps an id to its record here). */\n`);
o += `#include <stddef.h>\n#include <stdint.h>\n#include "scr_date_zones.h"\n\n`;
o += `const char scr_dz_names[] =\n`;
for (const n of pool) o += `  ${JSON.stringify(n)} "\\0"\n`;
o += `  ;\n`;
let off = 0;
o += `const uint16_t scr_dz_name_off[${pool.length}] = {`;
o += pool.map((n) => { const v = off; off += Buffer.byteLength(n) + 1; return v; }).join(",");
o += `};\n`;
o += `const uint8_t scr_dz_blob[${blob.length}] = {${blob.join(",")}};\n`;
o += `const scr_dz_rec scr_dz_recs[${recList.length}] = {\n`;
o += recOut.map((r) => `{${r.n0},${r.n1},${r.cnt},${r.off}}`).join(",") + `\n};\n`;
o += `const int64_t scr_dz_unit = ${unit};\n`;

let t = header(
  ` * ${sortedIds.length} zone ids, ${offRecList.length} distinct offset records, ${totalTrans} transitions,\n` +
  ` * blob ${ob.blob.length} bytes, id text ${idBytes} bytes. See the generator for the codec and the tail rule\n` +
  ` * and scr_date_tz.c for how they are read. */\n`);
t += `#include <stddef.h>\n#include <stdint.h>\n#include "scr_date_zones.h"\n\n`;
t += `const char scr_tz_ids[] =\n`;
for (const id of sortedIds) t += `  ${JSON.stringify(id)} "\\0"\n`;
t += `  ;\n`;
off = 0;
t += `const uint16_t scr_tz_id_off[${sortedIds.length}] = {`;
t += sortedIds.map((id) => { const v = off; off += id.length + 1; return v; }).join(",");
t += `};\n`;
t += `const uint16_t scr_tz_id_orec[${sortedIds.length}] = {${sortedIds.map((id) => offIndex.get(idOffKey.get(id))).join(",")}};\n`;
t += `const uint16_t scr_tz_id_nrec[${sortedIds.length}] = {${sortedIds.map((id) => recIndex.get(zoneKey.get(id))).join(",")}};\n`;
t += `const size_t scr_tz_nids = ${sortedIds.length};\n`;
t += `const uint8_t scr_tz_blob[${ob.blob.length}] = {${ob.blob.join(",")}};\n`;
t += `const scr_tz_rec scr_tz_recs[${offRecList.length}] = {\n`;
t += offRecOut.map((r) => `{${r.off0},${r.cnt},${r.end},${r.off}}`).join(",") + `\n};\n`;

// ───────────────────────── Windows zone key -> IANA id (CLDR windowsZones) ─────────────────────────
// Windows names its zone by registry key ("E. South America Standard Time"); Node/ICU names it by IANA id.
// The map is CLDR's supplemental windowsZones.xml, territory 001 (the zone's default id). The file is not in
// Node, so it is an input: pass --windows-zones FILE (CLDR release matching `process.versions.cldr`, e.g.
// https://raw.githubusercontent.com/unicode-org/cldr/release-48/common/supplemental/windowsZones.xml)
// and the header is regenerated; without the flag the checked-in header is left alone (and --check ignores it).
const winPath = args.includes("--windows-zones") ? args[args.indexOf("--windows-zones") + 1] : null;
const winOut = args.includes("--winzones-out") ? args[args.indexOf("--winzones-out") + 1] : new URL("../packages/runtime/src/scr_date_winzones.h", import.meta.url).pathname;
if (winPath !== null) {
  const xml = readFileSync(winPath, "utf8");
  const pairs = [];
  for (const m of xml.matchAll(/<mapZone other="([^"]+)" territory="001" type="([^"]+)"\/>/g)) {
    const first = m[2].split(" ")[0];
    if (!sortedIds.includes(first)) throw new Error(`windowsZones: ${m[1]} -> ${first} is not an id Node knows`);
    pairs.push([m[1], first]);
  }
  if (pairs.length < 100) throw new Error("windowsZones: too few 001 entries parsed");
  pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  let h = `/* GENERATED by scripts/gen-date-zones.mjs --windows-zones -- do not edit by hand.\n`;
  h += ` * CLDR windowsZones.xml territory 001 (cldr ${process.versions.cldr}): Windows registry zone key -> IANA id.\n`;
  h += ` * ${pairs.length} entries, sorted by key. Included by scr_date_tz.c on Windows only. */\n`;
  h += `#include <string.h>\n`;
  h += `static const struct { const char *win, *iana; } scr_win_zones[${pairs.length}] = {\n`;
  h += pairs.map(([w, i]) => `  {${JSON.stringify(w)}, ${JSON.stringify(i)}}`).join(",\n") + `\n};\n`;
  h += `static const char *scr_win_zone_to_iana(const char *key) {\n`;
  h += `  size_t lo = 0, hi = sizeof scr_win_zones / sizeof scr_win_zones[0];\n`;
  h += `  while (lo < hi) {\n    size_t mid = (lo + hi) / 2;\n    int c = strcmp(key, scr_win_zones[mid].win);\n`;
  h += `    if (c == 0) return scr_win_zones[mid].iana;\n    if (c < 0) hi = mid; else lo = mid + 1;\n  }\n  return NULL;\n}\n`;
  writeFileSync(winOut, h);
  console.log(`wrote ${winOut}: ${pairs.length} windows zones`);
}

if (args.includes("--check")) {
  const cur1 = existsSync(outPath) ? readFileSync(outPath, "utf8") : "";
  const cur2 = existsSync(tzdbPath) ? readFileSync(tzdbPath, "utf8") : "";
  if (cur1 !== o || cur2 !== t) { console.error("scr_date_zones.c / scr_date_tzdb.c is stale"); process.exit(1); }
  console.log("scr_date_zones.c and scr_date_tzdb.c are current");
} else {
  writeFileSync(outPath, o);
  writeFileSync(tzdbPath, t);
  console.log(`wrote ${outPath}: ${recList.length} name records, ${pool.length} names, ${totalToggles} toggles, blob ${blob.length}B`);
  console.log(`wrote ${tzdbPath}: ${sortedIds.length} ids, ${offRecList.length} offset records, ${totalTrans} transitions, blob ${ob.blob.length}B, ids ${idBytes}B`);
}
