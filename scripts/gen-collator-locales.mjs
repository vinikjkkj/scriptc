// Run with Node 24.15 (CI's pin): `node scripts/gen-collator-locales.mjs > out.json`, then regenerate packages/compiler/src/frontend/lowering/collator-locales.ts from it.
// Classifies which BCP47 language tags collate differently from root in this Node's ICU (probe: every BMP scalar, sampled astral planes).
const probe = [];
for (let c = 0x20; c <= 0xffff; c++) if (c < 0xd800 || c > 0xdfff) probe.push(String.fromCodePoint(c));
for (let c = 0x10000; c <= 0x1ffff; c += 3) probe.push(String.fromCodePoint(c));
for (let c = 0x20000; c <= 0x2ffff; c += 37) probe.push(String.fromCodePoint(c));
// multi-character tailorings (contractions such as Spanish ch, Catalan l\u00b7l, Welsh ll, Hungarian cs/dzs, Slovak ch) need sequences too
const S = []; for (let c = 0x20; c < 0x7f; c++) S.push(String.fromCodePoint(c)); for (let c = 0xa0; c <= 0x17f; c++) S.push(String.fromCodePoint(c)); S.push("\u00b7", "\u0140", "\u013f", "\u02bb", "\u02bc", "\u0300", "\u0301", "\u0308");
for (const a of S) for (const b of S) probe.push(a + b);
const T = [..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789\u00b7"];
for (const a of T) for (const b of T) for (const c of T) if (/[a-z\u00b7]/i.test(a + b + c) && (b === "\u00b7" || a === "\u00b7" || (a === b && c === a) || "cdlnrsgtzjhk".includes(a.toLowerCase()))) probe.push(a + b + c);
const order = (tag) => { const col = new Intl.Collator(tag); return probe.slice().sort(col.compare).join(""); };
const root = order("en");
const same = (tag) => order(tag) === root;
const L = "abcdefghijklmnopqrstuvwxyz";
const langs = new Set();
for (const a of L) for (const b of L) { const t = a + b; if (Intl.Collator.supportedLocalesOf([t]).length) langs.add(t); }
for (const a of L) for (const b of L) for (const c of L) { const t = a + b + c; if (Intl.Collator.supportedLocalesOf([t]).length) langs.add(t); }
const resolved = (tag) => new Intl.Collator(tag).resolvedOptions().locale;
// a language that no ICU collation locale answers falls back to the default locale, which is root-equivalent
const tailored = [], rootLike = [];
for (const l of [...langs].sort()) { const r = resolved(l); if (r === "en" && l !== "en" || r === "en-US") { rootLike.push(l); continue; } (same(l) ? rootLike : tailored).push(l); }
console.error("languages", langs.size, "tailored", tailored.length);
// region / script variants of root-like languages whose data differ from the bare language
const regions = []; for (const a of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") for (const b of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") regions.push(a + b);
for (const n of ["001", "419", "150", "142", "143", "053", "029", "013", "021", "005", "011", "014", "015", "017", "018", "030", "034", "035", "039", "145", "151", "154", "155", "202", "002", "003", "009", "019"]) regions.push(n);
const scripts = ["Adlm", "Latn", "Cyrl", "Arab", "Hans", "Hant", "Grek", "Hebr", "Deva", "Thai", "Jpan", "Kore", "Armn", "Geor", "Ethi", "Beng", "Taml", "Telu", "Knda", "Mlym", "Gujr", "Guru", "Sinh", "Khmr", "Laoo", "Mymr", "Tibt", "Mong", "Orya"];
const variants = [];
for (const l of rootLike) {
  const base = resolved(l);
  for (const r of regions) { const t = l + "-" + r; if (resolved(t) !== base && !(resolved(t) === l + "-" + r && same(t))) { if (!same(t)) variants.push(t); } }
  for (const s of scripts) { const t = l + "-" + s; if (resolved(t) !== base && !same(t)) variants.push(t); else if (resolved(t) === base) {} }
}
// ICU's own data adds ff-Adlm (coll/ff_Adlm.txt: contraction-only, invisible to the probe above); append it by hand when regenerating.
console.log(JSON.stringify({ node: process.version, icu: process.versions.icu, unicode: process.versions.unicode, tailored, variants }));
