// provmap.mjs <entry.ts> <out.json>
// Dumps ONLY what resolveProvenanceSources decides: which packages mapped,
// which specifier mapped to which source file, and every note. This is the
// exact surface mapEntryToSource affects, so a before/after diff of it IS the
// blast radius -- no analyze(), no lowering, seconds instead of minutes.
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const slash = (s) => s.split("\\").join("/");

const WT = process.env.WT ?? "G:/blocks/wamfix";
const { resolveProvenanceSources } = await import(`file:///${WT}/packages/compiler/dist/index.js`);
const entry = resolve(process.argv[2]);
const out = resolve(process.argv[3]);
const p = await resolveProvenanceSources(entry);
const rec = {
  entry: slash(entry),
  packages: p.packages.map((k) => ({
    name: k.name,
    version: k.version,
    sourceVersion: k.sourceVersion ?? null,
    commit: k.commit,
    dir: slash(k.dir),
    entries: Object.fromEntries(
      Object.entries(k.entries)
        .map(([s, f]) => [s, slash(f)])
        .sort(),
    ),
    entryCount: Object.keys(k.entries).length,
  })),
  notes: p.notes,
};
writeFileSync(out, JSON.stringify(rec, null, 1));
console.log(
  `packages=${rec.packages.length} mapped-entries=${rec.packages.reduce((a, k) => a + k.entryCount, 0)} notes=${rec.notes.length}`,
);
