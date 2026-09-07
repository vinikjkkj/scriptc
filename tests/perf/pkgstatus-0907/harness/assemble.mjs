/* Assemble the status document from its sections and the GENERATED tables, so
 * no number in it is hand-transcribed. Re-runnable: it rebuilds §5-§8 from
 * sect5.md..sect8.md and the live records every time. */
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const LAB = "<blocks>/pkgstatus3-lab";
const DOC = "<blocks>/pkgstatus/tests/perf/pkgstatus-0907/README.md";
const HEAD_END = "<!--SECTIONS-BELOW-->";

const run = (args) => execFileSync(process.execPath, args, { encoding: "utf8", maxBuffer: 1 << 28 });

const tableA = run([
  `${LAB}/table.mjs`, "store-memory", "store-sqlite", "store-mongo", "store-mysql",
  "store-postgres", "store-redis", "media-utils", "wam", "voip",
]).split("\n### provenance")[0];
const tableF = run([`${LAB}/table.mjs`, "src-store-sqlite", "src-store-redis", "src-media-utils", "src-voip", "src-wam"])
  .split("\n### provenance")[0];

let body = "";
for (const n of [5, "5c", 6, 7, 8]) body += readFileSync(`${LAB}/sect${n}.md`, "utf8") + String.fromCharCode(10);
body = body.replace("<!--TABLE-A-->", tableA.trim());
body = body.replace("<!--TABLE-F-->", tableF.trim());
body = body.replace("<!--LANE-E-PUNCHLINE-->", readFileSync(`${LAB}/lane-e.md`, "utf8").trim());
body = body.replace("<!--LANE-FG-NARRATIVE-->", readFileSync(`${LAB}/sect5b-narrative.md`, "utf8").trim());
body = body.replace("<!--LANE-VOIP-->", readFileSync(`${LAB}/sect5b-voip.md`, "utf8").trim());
body = body.replace("<!--LANE-G-STORES-->", readFileSync(`${LAB}/lane-g-stores.md`, "utf8").trim());
body = body.replace("<!--AB-RESULT-->", readFileSync(`${LAB}/ab-result.md`, "utf8").trim());

// No placeholder may survive into the published document.
const left = body.match(/<!--[A-Z0-9-]+-->/g);
if (left) throw new Error(`assemble: unfilled placeholders: ${[...new Set(left)].join(" ")}`);

// A shell heredoc eats \b and \a out of a Windows path and leaves control
// bytes 0x08 / 0x07 in the text; they survive into the repo and every gate
// stays green. Refuse to assemble a document that carries any.
{
  const bytes = Buffer.from(body, "utf8");
  const bad = [];
  for (let i = 0; i < bytes.length; i++) {
    const c = bytes[i];
    if (c < 0x09 || (c > 0x0d && c < 0x20)) bad.push(`0x${c.toString(16)}@${i}`);
  }
  if (bad.length > 0) throw new Error(`assemble: ${bad.length} control byte(s) in the body: ${bad.slice(0, 8).join(" ")}`);
}

const doc = readFileSync(DOC, "utf8");
const i = doc.indexOf(HEAD_END);
if (i < 0) throw new Error(`assemble: ${HEAD_END} marker missing from the document head`);
writeFileSync(DOC, doc.slice(0, i + HEAD_END.length) + "\n\n" + body);
console.log(`assembled: head ${i + HEAD_END.length} bytes + body ${body.length} bytes`);
