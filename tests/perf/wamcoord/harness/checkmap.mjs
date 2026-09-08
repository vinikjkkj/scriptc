// Does a package that maps on the DEFAULT map through the authored-JS path
// (which would mean the whitelist leaks) or through the ordinary TypeScript
// path (which means it never needed the rule)? The mapped entry's extension is
// the answer: `.d.ts` is the authored path, `.ts` is the ordinary one.
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { requirePins } from "./pins.mjs";
requirePins("checkmap.mjs");
const WT = `${process.env.BLOCKS_ROOT ?? "<blocks>"}/wamcoord`;
const LAB = `${process.env.BLOCKS_ROOT ?? "<blocks>"}/wamcoord-lab`;
const { resolveProvenanceSources } = await import("file:///" + WT + "/packages/compiler/dist/index.js");
const dir = join(LAB, "napp", "cand");
mkdirSync(dir, { recursive: true });
delete process.env["SCRIPTC_PROVENANCE_AUTHORED_JS"];
for (const name of ["@sec-ant/readable-stream", "aws-ssl-profiles", "lru.min", "sql-escaper", "@vinikjkkj/wa-wam"]) {
  const file = join(dir, "c-" + name.split("/").join("__") + ".ts");
  writeFileSync(file, "import * as m from '" + name + "'\nconsole.log('t=' + typeof m)\n");
  const p = await resolveProvenanceSources(file);
  const pkg = p.packages.find((x) => x.name === name);
  if (pkg === undefined) { console.log("  " + name.padEnd(26) + " NOT MAPPED"); continue; }
  for (const [spec, src] of Object.entries(pkg.entries)) {
    const s = String(src).split("\\").join("/");
    const kind = s.endsWith(".d.ts") || s.endsWith(".d.mts") || s.endsWith(".d.cts")
      ? "AUTHORED-JS PATH (.d.ts)  <-- would mean the whitelist leaked"
      : "ordinary TypeScript path";
    console.log("  " + name.padEnd(26) + " " + spec.padEnd(26) + " -> ..." + s.slice(-46).padEnd(48) + kind);
  }
}
