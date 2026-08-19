/**
 * armtab.mjs - the twin-lab arm table.
 *
 * Reads the PE section table of every arm binary the two-arm lab produced
 * at two sizes and prints the per-message-type SLOPE, which removes every
 * fixed cost (the runtime, the CRT, the entry) exactly. The slope, not the
 * total, is what a per-procedure price may be quoted from.
 *
 * The arms (twin-lab.mjs and twin-lab-jsdoc.mjs build them):
 *
 *   A  minified generated JS + its .d.ts twin   -- zapo's waproto shape
 *   P  the SAME JS, pretty-printed              -- the INTERNAL CONTROL
 *   C  P plus JSDoc carrying the .d.ts's types  -- the declaration CEILING
 *   B  the same logic as typed TypeScript       -- the source-typed floor
 *
 * P exists because a measurement that reformats a body and moves .text is
 * measuring formatting. On the tree this was written for, A and P are
 * .text-identical to the byte at both sizes.
 *
 * Usage:
 *   node armtab.mjs --lo 8 --hi 120 \
 *     --A <dir>/L8/A/case/al8,<dir>/L120/A/case/al120 \
 *     --P ... --C ... --B ...
 * Each --<arm> value is "<lo binary stem>,<hi binary stem>" (no extension:
 * the .exe and the sibling main.c are both read).
 */
import { statSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { peSections } from "../imagesize/attrib.mjs";

const ARM_ORDER = ["A", "P", "C", "B"];
const ARM_LABEL = {
  A: "A minified JS  + .d.ts twin",
  P: "P pretty JS    + .d.ts twin",
  C: "C pretty+JSDoc + .d.ts twin",
  B: "B typed TypeScript source  ",
};

function parseArgs(argv) {
  const out = { lo: 8, hi: 120, arms: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--lo") { out.lo = Number(argv[++i]); continue; }
    if (a === "--hi") { out.hi = Number(argv[++i]); continue; }
    const m = /^--([APCB])$/.exec(a);
    if (m) { out.arms[m[1]] = String(argv[++i]).split(","); continue; }
  }
  return out;
}

export function armRow(stem) {
  const exe = stem + ".exe";
  const secs = peSections(exe);
  const by = Object.fromEntries(secs.sections.map((s) => [s.name, s]));
  let csrc = 0;
  try { csrc = statSync(join(dirname(stem), "main.c")).size; } catch { csrc = 0; }
  return {
    file: statSync(exe).size,
    text: by[".text"].vsize,
    rdata: by[".rdata"].vsize,
    pdata: by[".pdata"].vsize,
    csrc,
  };
}

function main(argv) {
  const { lo, hi, arms } = parseArgs(argv);
  const present = ARM_ORDER.filter((a) => arms[a] !== undefined);
  if (present.length === 0) {
    process.stderr.write("armtab: no arms given (see the header)\n");
    process.exitCode = 2;
    return;
  }
  const pad = (s, w) => String(s).padStart(w);
  const rows = {};
  for (const a of present) rows[a] = arms[a].map(armRow);

  console.log("arm                            N         file        .text       .rdata     emitted C");
  for (const a of present) {
    for (const [i, n] of [lo, hi].entries()) {
      const r = rows[a][i];
      if (!r) continue;
      console.log(ARM_LABEL[a], pad(n, 4), pad(r.file.toLocaleString("en-US"), 12),
        pad(r.text.toLocaleString("en-US"), 12), pad(r.rdata.toLocaleString("en-US"), 12),
        pad(r.csrc.toLocaleString("en-US"), 13));
    }
  }
  const span = hi - lo;
  const slope = {};
  for (const a of present) {
    const [l, h] = rows[a];
    slope[a] = { file: (h.file - l.file) / span, text: (h.text - l.text) / span,
      csrc: (h.csrc - l.csrc) / span };
  }
  console.log("");
  console.log(`SLOPE per message type (N=${lo} -> N=${hi}, ${span} types):`);
  const base = slope["B"];
  console.log("arm                              file/type  .text/type    C/type" +
    (base ? "   .text x B   C x B" : ""));
  for (const a of present) {
    const s = slope[a];
    console.log(ARM_LABEL[a], pad(Math.round(s.file), 10), pad(Math.round(s.text), 11),
      pad(Math.round(s.csrc), 9),
      base ? pad((s.text / base.text).toFixed(3), 11) + pad((s.csrc / base.csrc).toFixed(3), 8) : "");
  }
  if (slope["A"] && slope["B"]) {
    const gapAB = slope["A"].text - slope["B"].text;
    console.log("");
    console.log("gap A->B (minified dyn -> typed source)  " + Math.round(gapAB) + " .text bytes per type");
    if (slope["C"]) {
      const gapAC = slope["A"].text - slope["C"].text;
      console.log("of it, PERFECT declaration types close  " + Math.round(gapAC) +
        " = " + ((gapAC / gapAB) * 100).toFixed(1) + "%");
    }
  }
  if (slope["A"] && slope["P"]) {
    const d = slope["P"].text - slope["A"].text;
    console.log("CONTROL, reformat only (A->P)           " + Math.round(d) +
      " .text bytes per type = " + ((d / slope["A"].text) * 100).toFixed(2) + "%");
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main(process.argv.slice(2));
