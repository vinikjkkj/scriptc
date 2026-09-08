// Identity-level diff for a substitution probe. Site COUNTS cannot tell "these
// shared a cause" from "these happened to move"; only (section, code, file,
// line) can.
//
// A probe tree is a COPY (voipB, voipC, ...), so its path segment has to be
// normalised back to the original before the keys will line up. That
// normalisation is the dangerous part of this script: when it silently failed
// to recognise `voipC` -- it only knew `voipB` -- every site read as both
// cleared and added, and the answer came out "55 cleared" for a probe that
// cleared 8. That was caught on plausibility, which is not a mechanism.
//
// So the normaliser now ASSERTS. Every path must reduce to a shape this script
// recognises, and an unrecognised one aborts with the offending path printed.
// A normaliser that passes an unknown shape through will do this again on a
// lane neither of us has thought of yet.
import { readFileSync } from "node:fs";

const BS = String.fromCharCode(92);

/** The shapes a site path is allowed to have, each with the marker that
 * identifies it and what the key keeps. Order matters: the first match wins. */
const SHAPES = [
  { name: "pkgsrc probe/source tree", marker: "/pkgsrc/" },
  { name: "provenance checkout", marker: "/packages/voip/src/" },
  { name: "provenance checkout", marker: "/packages/wam/src/" },
  { name: "napp driver", marker: "/napp/" },
  { name: "repo test tree", marker: "/tests/" },
];

const unknown = [];

const norm = (p) => {
  let s = String(p).split(BS).join("/");
  // A probe copy is <name><SingleUpperLetter>; fold it back to <name>.
  for (const base of ["voip", "wam", "store"]) {
    for (const L of "ABCDEFGHIJ") s = s.split("/" + base + L + "/").join("/" + base + "/");
  }
  // A provenance checkout: <cache>-prov/<40-hex commit>/<path>. Keep the path
  // under the commit, so the same file in two checkouts compares equal.
  const pv = s.indexOf("-prov/");
  if (pv >= 0) {
    const rest = s.slice(pv + 6);
    const slash = rest.indexOf("/");
    if (slash === 40) return rest.slice(slash + 1);
  }
  for (const shape of SHAPES) {
    const i = s.indexOf(shape.marker);
    if (i >= 0) return s.slice(i + 1);
  }
  unknown.push(s);
  return s;
};

const key = (s) => [s.section, s.code, norm(s.file), s.line].join("|");
const load = (f) => new Map(JSON.parse(readFileSync(f, "utf8")).sites.map((s) => [key(s), s]));

const A = load(process.argv[2]);
const B = load(process.argv[3]);

if (unknown.length > 0) {
  const uniq = [...new Set(unknown)];
  console.error("");
  console.error("REFUSING: " + uniq.length + " site path(s) match no known shape.");
  console.error("A path this script does not recognise is normalised to itself, which makes");
  console.error("the two sides disjoint and reports every site as both cleared and added.");
  for (const u of uniq.slice(0, 8)) console.error("  " + u);
  if (uniq.length > 8) console.error("  ... and " + (uniq.length - 8) + " more");
  console.error("Add its shape to SHAPES, or fix the path, before trusting any number below.");
  process.exit(2);
}

const gone = [...A].filter(([k]) => !B.has(k));
const added = [...B].filter(([k]) => !A.has(k));
const show = (label, rows) => {
  console.log(`  ${label}: ${rows.length}`);
  for (const [, s] of rows) {
    console.log(`    ${s.section.padEnd(11)}${s.code}  ${norm(s.file)}:${s.line}`);
    console.log(`        ${s.message.slice(0, 92)}`);
  }
};
console.log(`  baseline sites=${A.size}   probe sites=${B.size}`);
show("CLEARED by the substitution", gone);
show("NEWLY APPEARING", added);
