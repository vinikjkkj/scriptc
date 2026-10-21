#!/usr/bin/env node
// MEASURES, with the host Node (use the CI pin 24.15.0 = ICU 78.2), which locale tags its ICU ships formatter data
// for: a tag is available for a service when `new Intl.<Service>(tag).resolvedOptions().locale === tag`. The
// candidates are the names of the ICU locale bundles (icu4c/source/data/locales/*.txt, '_' spelt '-').
//   node scripts/measure-icu-avail.mjs <icu src dir> <out.json>
import fs from "node:fs";
const [src, out] = process.argv.slice(2);
const names = fs.readdirSync(`${src}/icu4c/source/data/locales`).filter((f) => f.endsWith(".txt")).map((f) => f.slice(0, -4).replace(/_/g, "-"));
const all = [...new Set([...names, "zh-TW", "zh-HK", "sr-RS", "pt-AO", "en-US", "en-GB", "und"])].filter((t) => t !== "root");
const res = (C, t) => { try { return new Intl[C](t).resolvedOptions().locale; } catch { return ""; } };
const rec = {
  version: `${process.versions.node} icu ${process.versions.icu} cldr ${process.versions.cldr}`,
  nf: all.filter((t) => res("NumberFormat", t) === t).sort(),
  dtf: all.filter((t) => res("DateTimeFormat", t) === t).sort(),
};
fs.writeFileSync(out, JSON.stringify(rec));
console.error(rec.version, rec.nf.length, rec.dtf.length);
