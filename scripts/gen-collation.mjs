#!/usr/bin/env node
// Builds packages/runtime/src/scr_collate_data.h: the CLDR root collation (the order Intl.Collator and
// String.prototype.localeCompare use in Node 24.15.0, ICU 78.2 / CLDR 48 / Unicode 17) as plain C tables, taken
// from the ICU source tree's FractionalUCA.txt (the root collation elements ICU compiles into ucadata.icu).
//
//   git init src && cd src && git remote add origin https://github.com/unicode-org/icu.git
//   git fetch --depth 1 --filter=blob:none origin f1b3db8ecd39d5b3a6eff4d5641b176c7f914dfb
//   git sparse-checkout set icu4c/source/data/unidata && git checkout FETCH_HEAD
//   $NODE_CI scripts/gen-collation.mjs <src> packages/runtime/src/scr_collate_data.h
//
// The pinned commit is release-78.2 (checked below). Only the ORDER of the weights is kept: a primary is a
// 32-bit left-aligned weight, a secondary and a tertiary 16-bit left-aligned weights, which compare exactly as
// the fractional byte strings do. Han (the radical-stroke order CLDR root uses) is the position in the file's
// [radical n=...] lists; Hangul syllables are algorithmic (jamo); every other unlisted code point is implicit
// (monotone in the code point, after every listed script and before the trailing weights), see scr_collate.c.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const PINNED_COMMIT = "f1b3db8ecd39d5b3a6eff4d5641b176c7f914dfb";
const [src, out] = process.argv.slice(2);
if (!src || !out) { console.error("usage: gen-collation.mjs <icu src> <out.h>"); process.exit(2); }
const head = execFileSync("git", ["-C", src, "rev-parse", "HEAD"]).toString().trim();
if (head !== PINNED_COMMIT) throw new Error(`ICU checkout is ${head}, expected ${PINNED_COMMIT}`);
const lines = fs.readFileSync(path.join(src, "icu4c/source/data/unidata/FractionalUCA.txt"), "utf8").split("\n");

// The decimal digits (numeric collation) come from Node's own Unicode tables, which must be CLDR 48's (Unicode 17).
if (process.versions.unicode !== "17.0") throw new Error(`run with Node 24.15.0 (Unicode 17.0), this is ${process.versions.unicode}`);
const ndStarts = [];
{
  const nd = /^\p{Nd}$/u;
  for (let c = 0; c <= 0x10ffff; c++) {
    if (c >= 0xd800 && c <= 0xdfff) continue;
    if (nd.test(String.fromCodePoint(c))) {
      // every Nd block is ten consecutive digits starting at the zero
      if (ndStarts.length && c < ndStarts[ndStarts.length - 1] + 10) continue;
      ndStarts.push(c);
    }
  }
  for (const z of ndStarts) for (let k = 0; k < 10; k++) if (!nd.test(String.fromCodePoint(z + k))) throw new Error("irregular Nd block at " + z.toString(16));
}
// Canonical_Combining_Class ranges (the ccc section of ICU's nfc.txt): discontiguous contractions skip marks by class.
const cccRanges = [];
for (const ln of fs.readFileSync(path.join(src, "icu4c/source/data/unidata/norm2/nfc.txt"), "utf8").split("\n")) {
  const m = /^([0-9A-F]+)(?:\.\.([0-9A-F]+))?:(\d+)$/.exec(ln);
  if (m) cccRanges.push([parseInt(m[1], 16), parseInt(m[2] ?? m[1], 16), Number(m[3])]);
  else if (/^# Canonical decomposition/.test(ln)) break;
}
cccRanges.sort((a, b) => a[0] - b[0]);
const HAN_BASE = 0x81000000;
const hex = (s) => { const v = parseInt(s, 16); if (!/^[0-9A-Fa-f]+$/.test(s.trim()) || Number.isNaN(v)) throw new Error("bad hex " + s); return v; };
// Han: the order of the [radical n=...:list] characters.
const hanOrder = [];
for (const ln of lines) {
  const m = /^\[radical (\d+)=([^:]*):(.*)\]$/.exec(ln);
  if (!m) continue;
  const cps = Array.from(m[3]).map((c) => c.codePointAt(0));
  for (let i = 0; i < cps.length; i++) {
    if (i + 2 < cps.length && cps[i + 1] === 0x2d) { for (let c = cps[i]; c <= cps[i + 2]; c++) hanOrder.push(c); i += 2; }
    else hanOrder.push(cps[i]);
  }
}
const hanRank = new Map(hanOrder.map((c, i) => [c, i]));
if (hanRank.size !== hanOrder.length) throw new Error("duplicate Han in the radical lists");

const align = (bytes, width) => { // "7F 02" -> 0x7F02 for width 2; "2B" -> 0x2B000000 for width 4
  const b = bytes.trim() === "" ? [] : bytes.trim().split(/\s+/).map(hex);
  if (b.length > width) throw new Error("weight too long: " + bytes);
  let v = 0;
  for (let i = 0; i < width; i++) v = v * 256 + (b[i] ?? 0);
  return v;
};
const singles = new Map(); // cp -> raw CE strings
const contr = []; // { key: [cp...], ces }
const prefix = []; // { pre, cp, ces }
for (const ln of lines) {
  if (!ln || ln[0] === "#" || ln[0] === "[") continue;
  const m = /^([0-9A-F ]+(?: \| [0-9A-F]+)?);\s*((?:\[[^\]]*\])+)\s*(#.*)?$/.exec(ln);
  if (!m) throw new Error("unparsed: " + ln);
  const ces = [...m[2].matchAll(/\[([^\]]*)\]/g)].map((x) => x[1]);
  if (m[1].includes("|")) {
    const [a, b] = m[1].split("|").map((s) => s.trim());
    if (a.includes(" ") || b.includes(" ")) throw new Error("long prefix");
    prefix.push({ pre: hex(a), cp: hex(b), ces });
    continue;
  }
  const key = m[1].trim().split(/\s+/).map(hex);
  if (key[0] === 0xfdd0 || key[0] === 0xfdd1) continue; // the builder's own markers
  if (key.length === 1) { singles.set(key[0], ces); } else contr.push({ key, ces });
}
const primaryOfCp = (cp) => {
  if (hanRank.has(cp)) return HAN_BASE + hanRank.get(cp);
  const e = singles.get(cp);
  if (!e) throw new Error("U+ reference to an unlisted code point " + cp.toString(16));
  return parseCe(e[0], new Set([cp]))[0];
};
function parseCe(s, seen) {
  const u = /^U\+([0-9A-F]+)\s*((?:,\s*[0-9A-F ]*)*)$/.exec(s.trim());
  if (u) {
    const cp = hex(u[1]);
    const rest = u[2].split(",").slice(1).map((x) => x.trim()); // [U+X, T] is a tertiary, [U+X, S, T] a secondary and a tertiary
    if (rest.length > 2) throw new Error("bad CE " + s);
    const [sec, ter] = rest.length === 2 ? [align(rest[0], 2), align(rest[1], 2)] : [0x0500, rest.length === 1 ? align(rest[0], 2) : 0x0500];
    return [primaryOfCp(cp), sec, ter];
  }
  const f = s.split(",");
  if (f.length !== 3) throw new Error("bad CE " + s);
  return [align(f[0], 4), align(f[1], 2), align(f[2], 2)];
}
// CE pool (deduplicated sequences)
const pool = [];
const poolIdx = new Map();
const refOf = (ces) => {
  const parsed = ces.map((c) => parseCe(c));
  const key = parsed.map((c) => c.join(",")).join(";");
  let off = poolIdx.get(key);
  if (off === undefined) { off = pool.length; for (const c of parsed) pool.push(c); poolIdx.set(key, off); }
  if (parsed.length > 255 || off >= 1 << 24) throw new Error("ref overflow");
  return ((off << 8) | parsed.length) >>> 0;
};
const singleCps = [...singles.keys()].sort((a, b) => a - b);
const singleRef = singleCps.map((c) => refOf(singles.get(c)));
contr.sort((a, b) => { for (let i = 0; i < Math.max(a.key.length, b.key.length); i++) { const d = (a.key[i] ?? -1) - (b.key[i] ?? -1); if (d) return d; } return 0; });
const contrRef = contr.map((c) => refOf(c.ces));
prefix.sort((a, b) => a.cp - b.cp || a.pre - b.pre);
const prefixRef = prefix.map((c) => refOf(c.ces));
const maxKey = Math.max(...contr.map((c) => c.key.length));
// Han runs sorted by code point: [start, length, firstRank]
const byCp = [...hanRank.entries()].sort((a, b) => a[0] - b[0]);
const runs = [];
for (const [cp, r] of byCp) {
  const last = runs[runs.length - 1];
  if (last && last[0] + last[1] === cp && last[2] + last[1] === r) last[1]++; else runs.push([cp, 1, r]);
}
const fmt = (arr, perLine, f) => { const o = []; for (let i = 0; i < arr.length; i += perLine) o.push("  " + arr.slice(i, i + perLine).map(f).join(",") + ","); return o.join("\n"); };
const u32 = (v) => "0x" + (v >>> 0).toString(16).toUpperCase() + "u";
let h = `/* GENERATED by scripts/gen-collation.mjs from ICU ${PINNED_COMMIT.slice(0, 9)} (release-78.2) FractionalUCA.txt. Do not edit by hand.
 * Included ONLY by scr_collate.c (a link-gated unit). The CLDR root collation, Unicode 17: weights are left-aligned
 * (primary 32 bits, secondary and tertiary 16 bits), so unsigned comparison is the fractional byte-string order. */
#ifndef SCR_COLLATE_DATA_H
#define SCR_COLLATE_DATA_H
#include <stdint.h>
#define SCR_COLL_HAN_BASE ${u32(HAN_BASE)}
#define SCR_COLL_NCE ${pool.length}
#define SCR_COLL_NSINGLE ${singleCps.length}
#define SCR_COLL_NCONTR ${contr.length}
#define SCR_COLL_MAXKEY ${maxKey}
#define SCR_COLL_NPREFIX ${prefix.length}
#define SCR_COLL_NHANRUN ${runs.length}
typedef struct { uint32_t p; uint16_t s; uint16_t t; } ScrCollCe;
static const ScrCollCe scr_coll_ces[SCR_COLL_NCE] = {
${fmt(pool, 4, (c) => `{${u32(c[0])},0x${c[1].toString(16).toUpperCase()},0x${c[2].toString(16).toUpperCase()}}`)}
};
/* a ref is (offset in scr_coll_ces << 8) | count */
static const uint32_t scr_coll_single_cp[SCR_COLL_NSINGLE] = {
${fmt(singleCps, 12, (c) => "0x" + c.toString(16).toUpperCase())}
};
static const uint32_t scr_coll_single_ref[SCR_COLL_NSINGLE] = {
${fmt(singleRef, 8, u32)}
};
/* contractions: keys sorted lexicographically, zero-padded to SCR_COLL_MAXKEY */
static const uint32_t scr_coll_contr_key[SCR_COLL_NCONTR][SCR_COLL_MAXKEY] = {
${contr.map((c) => "  {" + Array.from({ length: maxKey }, (_, i) => "0x" + (c.key[i] ?? 0).toString(16).toUpperCase()).join(",") + "},").join("\n")}
};
static const uint32_t scr_coll_contr_ref[SCR_COLL_NCONTR] = {
${fmt(contrRef, 8, u32)}
};
/* prefix contexts: the entry for cp when it directly follows pre */
static const uint32_t scr_coll_prefix_pre[SCR_COLL_NPREFIX] = {${prefix.map((p) => "0x" + p.pre.toString(16).toUpperCase()).join(",")}};
static const uint32_t scr_coll_prefix_cp[SCR_COLL_NPREFIX] = {${prefix.map((p) => "0x" + p.cp.toString(16).toUpperCase()).join(",")}};
static const uint32_t scr_coll_prefix_ref[SCR_COLL_NPREFIX] = {${prefixRef.map(u32).join(",")}};
/* Han: runs of consecutive code points with consecutive ranks (the CLDR radical-stroke order), sorted by start */
static const uint32_t scr_coll_han_start[SCR_COLL_NHANRUN] = {
${fmt(runs, 12, (r) => "0x" + r[0].toString(16).toUpperCase())}
};
static const uint16_t scr_coll_han_len[SCR_COLL_NHANRUN] = {
${fmt(runs, 16, (r) => String(r[1]))}
};
static const uint32_t scr_coll_han_rank[SCR_COLL_NHANRUN] = {
${fmt(runs, 12, (r) => String(r[2]))}
};
/* the first code point (the zero) of each run of ten decimal digits (general category Nd) */
#define SCR_COLL_NND ${ndStarts.length}
static const uint32_t scr_coll_nd_start[SCR_COLL_NND] = {${ndStarts.map((c) => "0x" + c.toString(16).toUpperCase()).join(",")}};
/* Canonical_Combining_Class of every code point with a nonzero class: [start, end] ranges sorted by start */
#define SCR_COLL_NCCC ${cccRanges.length}
static const uint32_t scr_coll_ccc_start[SCR_COLL_NCCC] = {${cccRanges.map((r) => "0x" + r[0].toString(16).toUpperCase()).join(",")}};
static const uint32_t scr_coll_ccc_end[SCR_COLL_NCCC] = {${cccRanges.map((r) => "0x" + r[1].toString(16).toUpperCase()).join(",")}};
static const uint8_t scr_coll_ccc_val[SCR_COLL_NCCC] = {${cccRanges.map((r) => r[2]).join(",")}};
#endif
`;
fs.writeFileSync(out, h);
console.error(`ccc ranges ${cccRanges.length}; singles ${singleCps.length} contractions ${contr.length} (max key ${maxKey}) prefixes ${prefix.length} CEs ${pool.length} han ${hanOrder.length} in ${runs.length} runs; ${h.length} bytes`);
