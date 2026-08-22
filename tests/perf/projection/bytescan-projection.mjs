/* bytescan-projection.mjs — byte-wise scan for NUL and other C0 controls, a
 * latin1-mangled em dash (0x14 is one of them), DEL, a lone CR, and invalid
 * UTF-8. Binary mode throughout; line endings are REPORTED, never changed.
 *
 * --selftest plants every case it claims to catch, plus clean controls, and
 * refuses to scan anything until all of them behave as planted. A scanner
 * that silently checks nothing PASSES.
 *
 * Usage: node bytescan-projection.mjs [--selftest] <file>...
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

/** Findings for one buffer. Returns [] for a clean file. */
export function scan(buf) {
  const bad = [];
  for (let i = 0; i < buf.length; i++) {
    const c = buf[i];
    if (c === 0) { bad.push(`NUL@${i}`); continue; }
    if (c === 0x7f) { bad.push(`DEL@${i}`); continue; }
    // C0 controls other than TAB(9) LF(10) FF(12) CR(13). VT(11) is included
    // as suspect: no source file this project writes needs one.
    if (c < 0x20 && c !== 9 && c !== 10 && c !== 12 && c !== 13) {
      bad.push(`C0-0x${c.toString(16).padStart(2, "0")}@${i}`);
      continue;
    }
    if (c === 13 && buf[i + 1] !== 10) bad.push(`loneCR@${i}`);
  }
  // UTF-8 validity, decided by re-encoding: a lossy decode inserts U+FFFD,
  // which round-trips to EF BF BD and changes the byte length.
  const round = Buffer.from(buf.toString("utf8"), "utf8");
  if (!round.equals(buf)) bad.push("badUTF8");
  return bad;
}

function counts(buf) {
  let cr = 0, lf = 0;
  for (const b of buf) { if (b === 13) cr++; if (b === 10) lf++; }
  return { cr, lf };
}

function selftest() {
  const d = join(process.env["PJ_TMP"] ?? tmpdir(), "scr-pj-bytescan-selftest");
  rmSync(d, { recursive: true, force: true });
  mkdirSync(d, { recursive: true });
  const w = (n, bytes) => { const p = join(d, n); writeFileSync(p, Buffer.from(bytes)); return p; };
  const asc = (s) => [...Buffer.from(s, "utf8")];
  const cases = [
    // DIRTY — every one must be caught
    ["nul",        [...asc("a"), 0, ...asc("b")],            true],
    ["mangled14",  [...asc("x "), 0x14, ...asc(" y")],       true],
    ["soh01",      [...asc("x"), 0x01],                      true],
    ["bel07",      [...asc("x"), 0x07],                      true],
    ["bs08",       [...asc("x"), 0x08],                      true],
    ["vt0b",       [...asc("x"), 0x0b],                      true],
    ["esc1b",      [...asc("x"), 0x1b, ...asc("[0m")],       true],
    ["del7f",      [...asc("x"), 0x7f],                      true],
    ["loneCR",     [...asc("a"), 13, ...asc("b")],           true],
    ["truncUTF8",  [...asc("a"), 0xe2, 0x80],                true],
    ["badCont",    [...asc("a"), 0xc3, 0x28],                true],
    ["loneSurr",   [...asc("a"), 0xed, 0xa0, 0x80],          true],
    // CLEAN — none may be flagged
    ["plainLF",    asc("a\nb\n"),                            false],
    ["plainCRLF",  asc("a\r\nb\r\n"),                        false],
    ["mixedEOL",   asc("a\r\nb\nc\r\n"),                     false],
    ["emdash",     asc("a \u2014 b\n"),                      false],
    ["emoji",      asc("q \u{1F600} z\n"),                   false],
    ["tabff",      [...asc("a"), 9, 12, ...asc("b\n")],      false],
  ];
  let ok = 0, bad = 0;
  for (const [n, bytes, dirty] of cases) {
    const found = scan(readFileSync(w(n, bytes)));
    const caught = found.length > 0;
    if (caught === dirty) ok++;
    else { bad++; console.log(`  SELFTEST MISS ${n}: expected ${dirty ? "dirty" : "clean"}, got ${JSON.stringify(found)}`); }
  }
  console.log(`SELFTEST ${ok}/${cases.length} cases behave as planted${bad ? ` — ${bad} WRONG` : ""}`);
  return bad === 0;
}

const files = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (!selftest()) { console.log("refusing to scan: the scanner failed its own self-test"); process.exit(1); }
if (files.length === 0) process.exit(0);
let dirty = 0;
for (const f of files) {
  const buf = readFileSync(f);
  const found = scan(buf);
  const { cr, lf } = counts(buf);
  const eol = cr === 0 ? "LF" : cr === lf ? "CRLF" : `MIXED(cr=${cr} lf=${lf})`;
  if (found.length) { dirty++; console.log(`DIRTY  ${String(buf.length).padStart(8)}  ${eol.padEnd(6)} ${f}  ${found.slice(0, 8).join(" ")}`); }
  else console.log(`clean  ${String(buf.length).padStart(8)}  ${eol.padEnd(6)} ${f}`);
}
console.log(`\n${files.length} files, ${dirty} dirty`);
if (dirty) process.exitCode = 1;
