#!/usr/bin/env node
// Generates packages/runtime/src/scr_date_zones.c: the ICU long zone names
// Date.prototype.toString prints, for every IANA zone id Node knows.
//
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

// name pool
const pool = [];
const poolIdx = new Map();
const nameId = (n) => { if (!poolIdx.has(n)) { poolIdx.set(n, pool.length); pool.push(n); } return poolIdx.get(n); };
const recList = [...records.entries()];
// toggles: varints of the deltas in SECONDS/unit; unit = 60 when every toggle in the whole table is a whole minute
const allMinutes = recList.every(([, r]) => r.toggles.every((t) => t % 60 === 0));
const unit = 60;
if (!allMinutes) throw new Error('a toggle is not a whole minute: the codec assumes minutes');
const blob = [];
const zz = (n) => (n < 0 ? -2 * n - 1 : 2 * n);
const unzz = (v) => (v % 2 === 1 ? -(v + 1) / 2 : v / 2);
const putVar = (v) => { while (v >= 128) { blob.push((v % 128) | 128); v = Math.floor(v / 128); } blob.push(v); };
const getVar = (b, p) => { let v = 0, m = 1; while (b[p.i] >= 128) { v += (b[p.i++] - 128) * m; m *= 128; } v += b[p.i++] * m; return v; };
// Toggle i (i >= 2) is predicted by toggle i-2 plus one year (525600 minutes); the residual is
// zigzagged, in whole days when it is one (tag bit 0) or in minutes (tag bit 1).
const encodeRec = (r) => {
  const m = r.toggles.map((t) => t / unit);
  for (let i = 0; i < m.length; i++) {
    if (i < 2) { putVar(m[i] - (i ? m[i - 1] : 0)); continue; }
    const d = m[i] - m[i - 2] - 525600;
    if (d % 1440 === 0) putVar(zz(d / 1440) * 2); else putVar(zz(d) * 2 + 1);
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
  const off = blob.length;
  encodeRec(r);
  const back = decodeRec(blob, off, r.toggles.length);
  if (JSON.stringify(back) !== JSON.stringify(r.toggles)) throw new Error("toggle codec round trip failed");
  recOut.push({ n0: nameId(r.n0), n1: nameId(r.n1), off, cnt: r.toggles.length });
}
const recIndex = new Map(recList.map(([k], i) => [k, i]));
const sortedIds = [...zoneKey.keys()].sort();
let idBytes = 0;
for (const id of sortedIds) idBytes += id.length + 1;
const totalToggles = recList.reduce((a, [, r]) => a + r.toggles.length, 0);

let o = "";
o += `/* GENERATED by scripts/gen-date-zones.mjs -- do not edit by hand.\n`;
o += ` * Source: node ${process.version}, icu ${process.versions.icu}, tz ${process.versions.tz}, cldr ${process.versions.cldr}.\n`;
o += ` * ${sortedIds.length} zone ids, ${recList.length} distinct records, ${pool.length} names, ${totalToggles} toggles,\n`;
o += ` * toggle unit ${unit}s, blob ${blob.length} bytes, id text ${idBytes} bytes.\n`;
o += ` * Zone id -> (name0, name1, flag toggles in [0, 2^31) seconds). See the generator for what\n`;
o += ` * these mean and scr_date.c's scr_date_zone_long_name for how they are read. */\n`;
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
o += `const char scr_dz_ids[] =\n`;
for (const id of sortedIds) o += `  ${JSON.stringify(id)} "\\0"\n`;
o += `  ;\n`;
off = 0;
o += `const uint16_t scr_dz_id_off[${sortedIds.length}] = {`;
o += sortedIds.map((id) => { const v = off; off += id.length + 1; return v; }).join(",");
o += `};\n`;
o += `const uint16_t scr_dz_id_rec[${sortedIds.length}] = {${sortedIds.map((id) => recIndex.get(zoneKey.get(id))).join(",")}};\n`;
o += `const size_t scr_dz_nids = ${sortedIds.length};\n`;
o += `const int64_t scr_dz_unit = ${unit};\n`;
if (args.includes("--check")) {
  const cur = existsSync(outPath) ? readFileSync(outPath, "utf8") : "";
  if (cur !== o) { console.error("scr_date_zones.c is stale"); process.exit(1); }
  console.log("scr_date_zones.c is current");
} else {
  writeFileSync(outPath, o);
  console.log(`wrote ${outPath}: ${sortedIds.length} ids, ${recList.length} records, ${pool.length} names, ${totalToggles} toggles, blob ${blob.length}B, ids ${idBytes}B, unit ${unit}`);
}
