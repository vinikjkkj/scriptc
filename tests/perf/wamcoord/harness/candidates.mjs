// Pass 1 of the option-2 table. The authored-JavaScript probe is only REACHED
// for a package whose attested tree was located, so the first question for each
// of the 33 candidates is not "how many sites" but "can it move at all".
// Answered by resolution alone -- no build, no analyze -- which is cheap enough
// to do all 33.
//
// Every cell that has no artifact behind it says so. A package that cannot be
// resolved is UNMEASURED, never 0.
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { requirePins } from "./pins.mjs";
requirePins("candidates.mjs");
const WT = process.env["WT"] ?? `${process.env.BLOCKS_ROOT ?? "<blocks>"}/wamcoord`;
const LAB = process.env["LAB"] ?? `${process.env.BLOCKS_ROOT ?? "<blocks>"}/wamcoord-lab`;
const { resolveProvenanceSources } = await import("file:///" + WT + "/packages/compiler/dist/index.js");

const names = JSON.parse(readFileSync(join(LAB, "candidate-names.json"), "utf8"));
const dir = join(LAB, "napp", "cand");
mkdirSync(dir, { recursive: true });

const out = [];
for (const name of names) {
  const file = join(dir, "c-" + name.split("/").join("__") + ".ts");
  writeFileSync(file, "import * as m from '" + name + "'\nconsole.log('t=' + typeof m)\n");
  const row = { name, mappedDefault: null, mappedAll: null, note: null, error: null };
  for (const [key, env] of [["mappedDefault", undefined], ["mappedAll", "1"]]) {
    if (env === undefined) delete process.env["SCRIPTC_PROVENANCE_AUTHORED_JS"];
    else process.env["SCRIPTC_PROVENANCE_AUTHORED_JS"] = env;
    try {
      const p = await resolveProvenanceSources(file);
      row[key] = p.packages.some((x) => x.name === name);
      if (key === "mappedAll") {
        const mine = p.notes.filter((n) => n.startsWith(name + "@") || n.startsWith(name + ":"));
        row.note = mine.length > 0 ? mine[0] : (row.mappedAll ? "(mapped, no note)" : "(no note naming it)");
      }
    } catch (e) {
      row.error = e instanceof Error ? e.message : String(e);
    }
  }
  delete process.env["SCRIPTC_PROVENANCE_AUTHORED_JS"];
  const cls = row.error !== null ? "RESOLVE-THREW"
    : row.mappedAll === false ? (String(row.note).includes("no provenance attestation") ? "NOT-ATTESTED"
       : String(row.note).includes("no source mapping") ? "ATTESTED-BUT-UNMAPPABLE" : "NOT-REACHED")
    : row.mappedDefault === true ? "MAPS-ON-DEFAULT" : "MOVES-UNDER-ALL";
  row.cls = cls;
  out.push(row);
  console.log(cls.padEnd(24) + name.padEnd(28) + " default=" + row.mappedDefault + " all=" + row.mappedAll +
    (row.note ? "  " + String(row.note).slice(0, 110) : "") + (row.error ? "  ERR " + row.error.slice(0, 80) : ""));
}
writeFileSync(join(LAB, "sites", "candidates-pass1.json"), JSON.stringify(out, null, 1));
const tally = {};
for (const r of out) tally[r.cls] = (tally[r.cls] ?? 0) + 1;
console.log("\nTALLY " + JSON.stringify(tally));
console.log("candidates scanned = " + out.length);
