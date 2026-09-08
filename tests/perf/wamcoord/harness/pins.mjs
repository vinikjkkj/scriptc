// pins.mjs -- REFUSE TO RUN unless every path pin is set and points at G:.
//
// Why this exists, precisely. On 2026-09-07 I ran `node checkmap.mjs` from a
// shell that had not sourced env.sh. checkmap.mjs resolves provenance for five
// packages; provenance.ts's cache directory is
//
//     process.env["SCRIPTC_PROVENANCE_CACHE"] ?? join(homedir(), ".cache", "scriptc", "provenance")
//
// with no warning and no error, so all five extracted to the USER'S C: DRIVE:
// <home>\.cache\scriptc\provenance, 254 files, 10,904,581 bytes.
// The fingerprint is exact -- the same five trees in my own G: cache are 254
// files and 10,904,581 bytes.
//
// Every OTHER entry point of mine was pinned, because every one of them sources
// env.sh. That is the failure mode this guard is aimed at: the convention was
// correct 33 times out of 34, and being right 33 times is not a mechanism. A
// script that can write to the user's drive must not depend on how it was
// launched.
//
// USERPROFILE is deliberately NOT required to be on G: -- it is legitimately
// <home> (scr_os_homedir traps without it). That is exactly why
// every cache must be pinned explicitly: they are the things that would
// otherwise be DERIVED from it.
import { homedir } from "node:os";

/** The pins, and what each one stops from landing on the user's drive. */
const PINS = [
  ["TMP", "compiler and zig scratch"],
  ["TEMP", "compiler and zig scratch"],
  ["TMPDIR", "compiler and zig scratch"],
  ["SCRIPTC_CACHE_DIR", "the compiler's build cache"],
  ["SCRIPTC_PROVENANCE_CACHE", "attested source checkouts -- THE ONE THAT ESCAPED"],
  ["npm_config_cache", "npm/pnpm tarball cache"],
  ["ZIG_LOCAL_CACHE_DIR", "zig's per-project cache"],
  ["ZIG_GLOBAL_CACHE_DIR", "zig's global cache"],
];

const BS = String.fromCharCode(92);
const onG = (v) => v.split(BS).join("/").toLowerCase().startsWith("g:/");

export function requirePins(who) {
  const bad = [];
  for (const [name, why] of PINS) {
    const v = process.env[name];
    if (v === undefined || v === "") bad.push(`  ${name} is UNSET  (${why})`);
    else if (!onG(v)) bad.push(`  ${name} = ${v}  is NOT on G:  (${why})`);
  }
  if (bad.length === 0) return;
  const lines = [
    "",
    `REFUSING TO RUN: ${who} can write outside G: with the environment it was given.`,
    ...bad,
    "",
    `  homedir() is ${homedir()} -- an unpinned cache extracts THERE, silently.`,
    "",
    "  Fix: source the block env before running.",
    `      . ${process.env.BLOCKS_ROOT ?? "<blocks>"}/wamcoord-lab/env.sh && node <script>`,
    "",
  ];
  process.stderr.write(lines.join("\n") + "\n");
  process.exit(2);
}
