#!/usr/bin/env node
// Builds packages/runtime/src/data/icu-78.2.bin: the ICU 78.2 locale data Node 24.15.0 formats with, taken from the
// ICU source tree itself (icu4c/source/data: locales, curr, unit, zone) which is the CLDR 48.0 data after the ICU
// conversion (draft filtering, alias handling and the per-currency format info all as ICU reads them).
//
//   git clone --depth 1 --filter=blob:none --no-checkout --branch release-78.2 https://github.com/unicode-org/icu.git src
//   (cd src && git sparse-checkout set icu4c/source/data/{locales,curr,unit,zone,misc} && git checkout)
//   node scripts/measure-icu-avail.mjs <src> avail.json          (with Node 24.15.0)
//   node scripts/gen-icu.mjs <src> <cldr-core package dir> <out.bin> [avail.json]
//
// The release tag release-78.2 is commit f1b3db8ecd39d5b3a6eff4d5641b176c7f914dfb (checked below); git itself
// verifies every object it fetches against its hash, which is the provenance of the files read here.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { parseIcuTxt } from "./icu-res.mjs";

const PINNED_COMMIT = "f1b3db8ecd39d5b3a6eff4d5641b176c7f914dfb";
const [src, coreDir, out, availFile] = process.argv.slice(2);
if (!src || !coreDir || !out) { console.error("usage: gen-icu.mjs <icu src> <cldr-core package dir> <out.bin> [avail.json]"); process.exit(2); }
const head = execFileSync("git", ["-C", src, "rev-parse", "HEAD"]).toString().trim();
if (head !== PINNED_COMMIT) throw new Error(`ICU checkout is ${head}, expected ${PINNED_COMMIT}`);
const dataDir = path.join(src, "icu4c/source/data");

// which top-level keys of each package's bundles are carried
const KEEP = {
  locales: (k) => k === "NumberElements" || k === "calendar" || k === "fields" || k === "%%Parent" || k === "%%ALIAS",
  curr: () => true,
  unit: (k) => ["units", "unitsShort", "unitsNarrow", "compoundUnits", "durationUnits", "%%Parent", "%%ALIAS"].includes(k),
  zone: () => true,
  misc: () => true,
  region: (k) => k === "Countries" || k === "%%Parent" || k === "%%ALIAS",
};
const PKGS = [["loc", "locales"], ["curr", "curr"], ["unit", "unit"], ["zone", "zone"], ["misc", "misc"], ["region", "region"]];
// the supplemental bundles date formatting reads (era starts, calendar preference, week rules, metazones, day periods)
const MISC_FILES = new Map([
  ["supplementalData", (k) => ["calendarData", "calendarPreferenceData", "weekData", "weekOfPreference", "timeData"].includes(k)],
  ["metaZones", () => true],
  ["dayPeriods", () => true],
  ["timezoneTypes", (k) => k === "typeAlias" || k === "typeMap"],
]);

function prune(pkgDir, node, fname) {
  if (node.t !== "t") return node;
  node.e = node.e.filter(([k]) => (pkgDir === "misc" ? MISC_FILES.get(fname)(k) : KEEP[pkgDir](k)));
  if (pkgDir === "misc" && fname === "timezoneTypes") {
    for (const [, v] of node.e) if (v.t === "t") v.e = v.e.filter(([k]) => k === "timezone");
  }
  if (pkgDir === "locales") {
    // "fields" serves DateTimePatternGenerator's append-item names only: keep each field's display name
    for (const [k, v] of node.e) {
      if (k === "fields" && v.t === "t") for (const [, f] of v.e) if (f.t === "t") f.e = f.e.filter(([fk]) => fk === "dn");
    }
  }
  if (pkgDir === "locales") {
    // intervalFormats serve formatRange only
    for (const [k, v] of node.e) {
      if (k === "calendar" && v.t === "t") for (const [, cal] of v.e) if (cal.t === "t") cal.e = cal.e.filter(([ck]) => ck !== "intervalFormats" && ck !== "intervalFormatsPre");
    }
  }
  return node;
}

// ── read all bundles ───────────────────────────────────────────────────────────────────────────────────────────
const locales = new Map(); // name -> {pkgName -> node}
const keys = new Map(); // pkg -> Set
let nodeCount = 0;
for (const [pkg, dir] of PKGS) {
  const d = path.join(dataDir, dir);
  keys.set(pkg, new Set());
  for (const f of fs.readdirSync(d)) {
    if (!f.endsWith(".txt") || f === "pool.txt" || f === "res_index.txt") continue;
    const name = f.slice(0, -4);
    if (dir === "misc" ? !MISC_FILES.has(name) : name === "supplementalData") continue;
    const { node } = parseIcuTxt(fs.readFileSync(path.join(d, f), "utf8"), f);
    prune(dir, node, name);
    if (!locales.has(name)) locales.set(name, {});
    locales.get(name)[pkg] = node;
  }
}

// ── zoneinfo64: the time zone rules as a misc bundle (Names, Regions, Rules and the zones' transition tables) ─────────
function zoneinfoNode() {
  const lines = fs.readFileSync(path.join(dataDir, "misc/zoneinfo64.txt"), "utf8").split("\n");
  const nums = (t) => t.split(",").map((x) => x.trim()).filter((x) => x !== "").map(Number);
  const names = [], regions = [], rules = [], zones = [];
  let mode = "", buf = "", cur = null;
  let version = "";
  for (const l of lines) {
    let m;
    if ((m = l.match(/TZVersion \{ "([^"]*)" \}/))) version = m[1];
    if (/^ Names \{/.test(l)) { mode = "names"; continue; }
    if (/^ Rules \{/.test(l)) { mode = "rules"; continue; }
    if (/^ Regions:array/.test(l)) { mode = "regions"; continue; }
    if (/^ Zones:array/.test(l)) { mode = "zones"; continue; }
    if (mode === "names") { buf += l.replace(/\/\/.*$/, "") + " "; if (/^ \}/.test(l)) { mode = ""; for (const x of buf.matchAll(/"([^"]*)"/g)) names.push(x[1]); } continue; }
    if (mode === "regions") { if ((m = l.match(/^\s*"([^"]*)",?\s*\/\/Z#(\d+)/))) regions[+m[2]] = m[1]; if (/^ \}/.test(l)) mode = ""; continue; }
    if (mode === "rules") {
      if ((m = l.match(/^\s*(\S+):intvector \{$/))) cur = { name: m[1], v: [] };
      else if (cur && (m = l.match(/^\s*([-0-9, ]+)$/))) cur.v = nums(m[1]);
      else if (cur && /^\s*\} \/\/_#/.test(l)) { rules.push(cur); cur = null; }
      if (/^ \}/.test(l)) mode = "";
      continue;
    }
    if (mode === "zones") {
      if ((m = l.match(/^\s*\/\* (\S+) \*\/ :int \{ (\d+) \}/))) { zones.push({ link: +m[2] }); continue; }
      if (/^\s*\/\* (\S+) \*\/ :table \{/.test(l)) { cur = {}; zones.push(cur); continue; }
      if (cur) {
        if ((m = l.match(/^\s*(trans|transPre32|transPost32|typeOffsets):intvector \{(.*)\}/))) cur[m[1]] = nums(m[2]);
        else if ((m = l.match(/^\s*typeMap:bin \{ "([0-9a-f]*)" \}/))) cur.typeMap = m[1].match(/../g)?.map((h) => parseInt(h, 16)) ?? [];
        else if ((m = l.match(/^\s*finalRule \{ "([^"]*)" \}/))) cur.finalRule = m[1];
        else if ((m = l.match(/^\s*finalRaw:int \{ (-?\d+) \}/))) cur.finalRaw = +m[1];
        else if ((m = l.match(/^\s*finalYear:int \{ (-?\d+) \}/))) cur.finalYear = +m[1];
        else if (/^\s*\} \/\/Z#/.test(l)) cur = null;
      }
      if (/^ \}/.test(l)) mode = "";
    }
  }
  const S = (v) => ({ t: "s", v });
  const IV = (v) => ({ t: "iv", v });
  const I = (v) => ({ t: "i", v });
  const zn = zones.map((z) => {
    if (z.link !== undefined) return I(z.link);
    const e = [];
    for (const k of ["trans", "transPre32", "transPost32", "typeOffsets"]) if (z[k]) e.push([k, IV(z[k])]);
    if (z.typeMap) e.push(["typeMap", IV(z.typeMap)]);
    if (z.finalRule) { e.push(["finalRule", S(z.finalRule)], ["finalRaw", I(z.finalRaw)], ["finalYear", I(z.finalYear)]); }
    return { t: "t", e };
  });
  return {
    t: "t",
    e: [
      ["TZVersion", S(version)],
      ["Zones", { t: "a", e: zn }],
      ["Names", { t: "a", e: names.map(S) }],
      ["Regions", { t: "a", e: regions.map(S) }],
      ["Rules", { t: "t", e: rules.map((r) => [r.name, IV(r.v)]) }],
    ],
  };
}
{
  if (!locales.has("zoneinfo64")) locales.set("zoneinfo64", {});
  locales.get("zoneinfo64").misc = zoneinfoNode();
}

// ── binary encoding ────────────────────────────────────────────────────────────────────────────────────────────
const enc = new TextEncoder();
const varint = (n, a) => { while (n >= 0x80) { a.push((n & 0x7f) | 0x80); n = Math.floor(n / 128); } a.push(n); };
const zig = (n) => (n < 0 ? -2 * n - 1 : 2 * n);
function encodeNode(pkg, node, dict) {
  const body = [];
  let tag;
  switch (node.t) {
    case "s": { tag = 0; const b = enc.encode(node.v); for (const c of b) body.push(c); break; }
    case "al": { tag = 3; const b = enc.encode(node.v); for (const c of b) body.push(c); break; }
    case "i": { tag = 4; varint(zig(node.v), body); break; }
    case "iv": { tag = 5; varint(node.v.length, body); for (const v of node.v) varint(zig(v), body); break; }
    case "b": { tag = 6; const b = enc.encode(node.v); for (const c of b) body.push(c); break; }
    case "a": { tag = 2; varint(node.e.length, body); for (const e of node.e) for (const c of encodeNode(pkg, e, dict)) body.push(c); break; }
    case "t": {
      tag = 1;
      const es = node.e.map(([k, v]) => [dict.get(k), v]).sort((a, b) => a[0] - b[0]);
      varint(es.length, body);
      for (const [id, v] of es) { varint(id, body); for (const c of encodeNode(pkg, v, dict)) body.push(c); }
      break;
    }
    default: throw new Error("node kind " + node.t);
  }
  const head = [tag];
  varint(body.length, head);
  return head.concat(body);
}
function collectKeys(set, node) {
  if (node.t === "t") for (const [k, v] of node.e) { set.add(k); collectKeys(set, v); }
  else if (node.t === "a") for (const e of node.e) collectKeys(set, e);
}
const dicts = new Map();
for (const [pkg] of PKGS) {
  const set = new Set();
  for (const bundles of locales.values()) if (bundles[pkg]) collectKeys(set, bundles[pkg]);
  const arr = [...set].sort();
  dicts.set(pkg, new Map(arr.map((k, i) => [k, i])));
}

// ── the global records (CLDR core JSON, plus plural rules in ICU's table order) ───────────────────────────────────
const J = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
const core = {};
let likelySubtags;
{
  const sup = (f) => J(`${coreDir}/supplemental/${f}.json`).supplemental;
  const ns = sup("numberingSystems").numberingSystems;
  for (const k in ns) core[`ns/${k}`] = ns[k]._type === "numeric" ? ns[k]._digits : `alg:${ns[k]._rules}`;
  const fr = sup("currencyData").currencyData.fractions;
  for (const c in fr) core[`curfrac/${c}`] = [fr[c]._digits, fr[c]._rounding, fr[c]._cashDigits ?? fr[c]._digits, fr[c]._cashRounding ?? fr[c]._rounding].join(",");
  const rg = sup("currencyData").currencyData.region;
  for (const reg in rg) {
    const list = rg[reg].map((e) => ({ code: Object.keys(e)[0], tender: e[Object.keys(e)[0]]._tender !== "false" }));
    const pick = list.find((e) => e.tender) ?? list[0];
    if (pick) core[`curregion/${reg}`] = pick.code;
  }
  const al = sup("aliases").metadata.alias;
  for (const kind of ["languageAlias", "territoryAlias"])
    for (const k in al[kind]) if (al[kind][k]._replacement !== undefined) core[`${kind}/${k}`] = al[kind][k]._replacement;
  likelySubtags = sup("likelySubtags").likelySubtags;
  const td = sup("timeData").timeData;
  for (const k in td) core[`timedata/${k}`] = `${td[k]._preferred}|${td[k]._allowed}`;
  // plural rules from ICU's plurals.txt: rules in the table's key order (few, many, one, two, zero)
  const pl = parseIcuTxt(fs.readFileSync(path.join(dataDir, "misc/plurals.txt"), "utf8"), "plurals.txt").node;
  const loc = pl.e.find(([k]) => k === "locales")[1];
  const rules = pl.e.find(([k]) => k === "rules")[1];
  const setOf = new Map(rules.e.map(([k, v]) => [k, v]));
  for (const [lang, v] of loc.e) {
    const set = setOf.get(v.v);
    if (!set) continue;
    for (const [kw, r] of set.e) core[`plural/${lang}/${kw}`] = (r.v ?? "").split("@")[0].trim();
  }
  // ICU's fallback tables for bundles that do not exist (common/localefallback_data.h): the parent locale
  // table and the default script of language / language_region
  {
    const hf = fs.readFileSync(path.join(src, "icu4c/source/common/localefallback_data.h"), "utf8");
    const strs = (name) => {
      const m = hf.match(new RegExp(`const char ${name}\\[\\] =\\s*((?:"[^"]*"\\s*)+);`));
      if (!m) throw new Error("no " + name);
      return [...m[1].matchAll(/"([^"]*)"/g)].map((x) => x[1]).join("").replace(/\\0/g, "\0");
    };
    const ints = (name) => {
      const m = hf.match(new RegExp(`const int32_t ${name}\\[\\] = \\{([^}]*)\\};`));
      if (!m) throw new Error("no " + name);
      return m[1].replace(/\/\/[^\n]*/g, "").split(",").map((x) => x.trim()).filter((x) => x !== "").map(Number);
    };
    const at = (lit, off) => lit.slice(off, lit.indexOf("\0", off));
    const scripts = strs("scriptCodeChars"), keys = strs("dsLocaleIDChars"), pstr = strs("parentLocaleChars");
    const dst = ints("defaultScriptTable"), plt = ints("parentLocaleTable");
    for (let i = 0; i + 1 < dst.length; i += 2) core[`dscript/${at(keys, dst[i])}`] = at(scripts, dst[i + 1]);
    for (let i = 0; i + 1 < plt.length; i += 2) core[`parentloc/${at(pstr, plt[i])}`] = at(pstr, plt[i + 1]);
  }
  // RBNF rule sets behind the algorithmic numbering systems date patterns can name (hebr, romanlow, hanidays, jpanyear):
  // each group is the concatenated rule text of the sets reachable from the named one
  {
    const rbnf = (loc) => parseIcuTxt(fs.readFileSync(path.join(dataDir, "rbnf", loc + ".txt"), "utf8"), loc + ".txt").node;
    const group = (node, name) => {
      const rules = node.e.find(([k]) => k === "RBNFRules")[1].e.find(([k]) => k === name)[1];
      return rules.e.map((x) => x.v).join("");
    };
    const split = (text) => {
      const sets = new Map();
      const re = /(?:^|;)(%%?[A-Za-z0-9-]+):/g;
      const marks = [];
      let m;
      while ((m = re.exec(text))) marks.push({ name: m[1], start: m.index + (m[0].startsWith(";") ? 1 : 0), after: m.index + m[0].length });
      marks.forEach((mk, i) => sets.set(mk.name, text.slice(mk.start, i + 1 < marks.length ? marks[i + 1].start : text.length)));
      return sets;
    };
    const closure = (text, roots) => {
      const sets = split(text);
      const seen = new Set();
      const todo = [...roots];
      while (todo.length) {
        const n = todo.pop();
        if (seen.has(n)) continue;
        if (!sets.has(n)) throw new Error("rbnf: no rule set " + n);
        seen.add(n);
        for (const r of sets.get(n).matchAll(/%%?[A-Za-z0-9-]+/g)) if (r[0] !== n || true) { if (sets.has(r[0])) todo.push(r[0]); }
      }
      return [...sets.keys()].filter((k) => seen.has(k)).map((k) => sets.get(k)).join("");
    };
    core["rbnf/root/NumberingSystemRules"] = closure(group(rbnf("root"), "NumberingSystemRules"), ["%hebrew", "%roman-lower"]);
    core["rbnf/zh/SpelloutRules"] = closure(group(rbnf("zh"), "SpelloutRules"), ["%spellout-numbering-days"]);
    core["rbnf/ja/SpelloutRules"] = closure(group(rbnf("ja"), "SpelloutRules"), ["%spellout-numbering-year-latn"]);
  }
  if (availFile) {
    const av = J(availFile);
    core["avail/nf"] = av.nf.join(" ");
    core["avail/dtf"] = av.dtf.join(" ");
    // the likely-subtags expansion of each locale a DateTimeFormat can resolve to (what DateTimePatternGenerator and the
    // calendar / hour preferences read when the tag names no region)
    for (const tag of av.dtf) {
      const m = tag.split("-");
      const lang = m[0];
      let script = "", region = "";
      for (const p of m.slice(1)) { if (p.length === 4 && /^[A-Za-z]+$/.test(p)) script = p; else if (/^([A-Za-z]{2}|\d{3})$/.test(p)) region = p; }
      const tries = [`${lang}-${script}-${region}`, `${lang}-${region}`, `${lang}-${script}`, lang, `und-${script}`];
      let hit;
      for (const t of tries) { const k = t.replace(/-+/g, "-").replace(/-$/, ""); if (likelySubtags[k] !== undefined && !(k.includes("--"))) { hit = likelySubtags[k]; break; } }
      if (hit) core[`likely/${tag}`] = hit;
    }
    core["avail/source"] = av.version;
  }
  core["icu/source"] = `icu4c release-78.2 ${PINNED_COMMIT}`;
}

// ── write ────────────────────────────────────────────────────────────────────────────────────────────────────────
const parts = [];
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); parts.push(b); };
const str = (s) => { const b = Buffer.from(s, "utf8"); u32(b.length); parts.push(b); };
parts.push(Buffer.from("SICU\x01\x00\x00\x00"));
str("ICU 78.2 / CLDR 48.0");
u32(PKGS.length);
for (const [pkg] of PKGS) { str(pkg); const d = [...dicts.get(pkg).keys()]; u32(d.length); for (const k of d) str(k); }
const names = [...locales.keys()].sort();
u32(names.length);
for (const n of names) str(n);
let nblocks = 0;
const blocks = [];
names.forEach((n, li) => {
  PKGS.forEach(([pkg], pi) => {
    const node = locales.get(n)[pkg];
    if (!node) return;
    blocks.push({ pi, li, bytes: Buffer.from(encodeNode(pkg, node, dicts.get(pkg))) });
  });
});
u32(blocks.length);
let total = 0;
const perPkg = {};
for (const b of blocks) { u32(b.pi); u32(b.li); u32(b.bytes.length); parts.push(b.bytes); total += b.bytes.length; perPkg[PKGS[b.pi][0]] = (perPkg[PKGS[b.pi][0]] ?? 0) + b.bytes.length; }
// core records: sorted dictionary then entries
{
  const ks = Object.keys(core).sort();
  u32(ks.length);
  for (const k of ks) { str(k); str(core[k]); }
}
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, Buffer.concat(parts));
console.error(`wrote ${out}: ${fs.statSync(out).size} bytes; blocks ${blocks.length}; per package`, perPkg);
