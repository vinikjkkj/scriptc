// zb-scan.mjs — anchor a built binary before believing anything it prints.
//
//   node zb-scan.mjs <exe> [<exe> ...]
//
// Three things a `build exit=0` does NOT tell you, and this does:
//
//  1. SIZE.  A build has reported exit 0 with both byte-scan markers present
//     at 10.7 MB instead of 26.2 MB, and died at 77 ms.  The exe size is the
//     only exact instrument on this workload (0.0000% A/A), so it is the
//     anchor: an arm whose exe is half the size of its pair did not link the
//     same program, whatever its exit code said.
//
//  2. IS THE TRAP TRACE ACTUALLY IN THERE.  `SCTRAP lines(0)` on an UNTRACED
//     binary means DID-NOT-RUN, not "no traps fired": scr_error.c compiles
//     the marker out entirely without -DSCR_TRAP_TRACE, so a binary built
//     without SCRIPTC_TRAP_TRACE=1 can never print one.  The format string
//     `SCTRAP %s %.*s` is only in the image when the trace IS compiled in.
//
//  3. NEGATIVE CONTROL.  A scanner that answers "present" for everything is
//     worthless, so every run also scans for a string that must be ABSENT.
//
// Reports size, md5, and each marker's presence and file offset.

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const MARKERS = [
  { name: "SCTRAP format string", must: "present", s: "SCTRAP %s %.*s" },
  { name: "SCTRAP flood guard", must: "present", s: "SCTRAP TRUNCATED after 20000 fires" },
  { name: "scriptc: abort prefix", must: "present", s: "scriptc: " },
  { name: "NEGATIVE CONTROL (must be absent)", must: "absent", s: "ZAPOBENCH-MARKER-THAT-MUST-NOT-EXIST" },
];

let bad = 0;
for (const f of process.argv.slice(2)) {
  const buf = readFileSync(f);
  const md5 = createHash("md5").update(buf).digest("hex");
  console.log(`${f}`);
  console.log(`  size ${buf.length} bytes (${(buf.length / 1048576).toFixed(3)} MiB)   md5 ${md5}`);
  for (const m of MARKERS) {
    const off = buf.indexOf(Buffer.from(m.s, "latin1"));
    const present = off >= 0;
    const ok = present === (m.must === "present");
    if (!ok) bad++;
    console.log(`  [${ok ? "ok  " : "FAIL"}] ${m.name}: ${present ? "present @ 0x" + off.toString(16) : "absent"} (expected ${m.must})`);
  }
}
process.exit(bad ? 1 : 0);
