import { readFileSync, writeFileSync } from "node:fs";
const p = "<blocks>/pkgstatus3-lab/sect6.md";
let s = readFileSync(p, "utf8");
// The python heredoc ate \b and \a into control bytes 0x08 / 0x07.
s = s.replace(
  /`mongoredecl` recorded, for `[^`]*`\nwith `--provenance-sources`:/,
  "`mongoredecl` recorded, for\n`<blocks>/mongoredecl-lab/app/drivers/drv-mongo.ts` with\n`--provenance-sources`:",
);
s = s.replace(/through `[^`]*`'s compiler:/, "through `<blocks>/pkgstatus`'s compiler:");
// Belt and braces: no control byte may survive anywhere in the file.
let bad = 0;
s = [...s].map((c) => {
  const n = c.codePointAt(0);
  if (n < 0x09 || (n > 0x0d && n < 0x20)) { bad++; return ""; }
  return c;
}).join("");
writeFileSync(p, s);
const b = readFileSync(p);
let ctrl = 0;
for (const x of b) if (x < 0x09 || (x > 0x0d && x < 0x20)) ctrl++;
console.log(`stripped=${bad}  remaining control bytes=${ctrl}  bytes=${b.length}`);
