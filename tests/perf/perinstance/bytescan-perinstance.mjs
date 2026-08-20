/* bytescan-perinstance.mjs -- byte-wise scan of the files a block changed.
 *
 * A raw NUL passes every gate this project has, and so do 0x08 and 0x14 --
 * blocks have planted each of those by accident with their own scripts. So
 * the scan is byte-wise, it covers every C0 control except the three that
 * legitimately appear in source (TAB, LF, CR), and it SELF-TESTS on planted
 * cases before it looks at a real file: a scanner that cannot report a fault
 * it was shown cannot be believed when it reports none.
 *
 * It also reports the per-file line-ending shape, because this repository is
 * per-file mixed CRLF/LF and a scripted edit that rewrites a whole file's
 * endings is invisible in a diff that normalises them.
 *
 * The planted bytes are written as NUMBERS, never as literals: a scanner
 * whose own source carries a NUL is the joke writing itself. For the same
 * reason no non-ASCII character appears in this file as itself.
 *
 * usage: node bytescan-perinstance.mjs <file|dir> [...]
 */
import { readFileSync, writeFileSync, mkdtempSync, statSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

/** Every C0 byte that is not TAB/LF/CR, plus DEL. */
const BAD = new Set([...Array(32).keys()].filter((b) => b !== 9 && b !== 10 && b !== 13).concat([127]));

export function scanBytes(buf) {
  const hits = [];
  for (let i = 0; i < buf.length; i++) if (BAD.has(buf[i])) hits.push({ at: i, byte: buf[i] });
  let crlf = 0, lf = 0;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 10) { lf++; if (i > 0 && buf[i - 1] === 13) crlf++; }
  }
  // UTF-8 validity: the decode-encode round trip is byte-exact only for
  // well-formed input (a lone continuation byte becomes U+FFFD).
  const utf8ok = Buffer.from(buf.toString("utf8"), "utf8").equals(buf);
  const eol = lf === 0 ? "none" : crlf === lf ? "CRLF" : crlf === 0 ? "LF" : "MIXED";
  return { hits, lf, crlf, eol, utf8ok, bytes: buf.length };
}

const A = 0x61, B = 0x62, NL = 0x0a, CR = 0x0d;

/** Runs first, always. Each planted case must be SEEN. */
export function selfTest() {
  const dir = mkdtempSync(join(process.env["TMPDIR"] ?? tmpdir(), "pi-bytescan-"));
  const cases = [
    ["nul",   Buffer.from([A, 0x00, B, NL]), (r) => r.hits.length === 1 && r.hits[0].byte === 0x00],
    ["bs08",  Buffer.from([A, 0x08, B, NL]), (r) => r.hits.length === 1 && r.hits[0].byte === 0x08],
    ["dc4",   Buffer.from([A, 0x14, B, NL]), (r) => r.hits.length === 1 && r.hits[0].byte === 0x14],
    ["del",   Buffer.from([A, 0x7f, B, NL]), (r) => r.hits.length === 1 && r.hits[0].byte === 0x7f],
    ["clean", Buffer.from("plain ascii\ttab\n", "utf8"), (r) => r.hits.length === 0 && r.eol === "LF"],
    ["crlf",  Buffer.from([A, CR, NL, B, CR, NL]), (r) => r.hits.length === 0 && r.eol === "CRLF"],
    ["mixed", Buffer.from([A, CR, NL, B, NL]), (r) => r.eol === "MIXED"],
    ["emdash", Buffer.from("an em dash — here\n", "utf8"), (r) => r.hits.length === 0 && r.utf8ok],
    // The latin1 mangling that has shipped control bytes into dist before,
    // and the reason it slips past every gate: writing U+2014 through latin1
    // keeps only the LOW byte, 0x14 -- a C0 control, and PERFECTLY VALID
    // UTF-8. Only the byte-wise C0 scan sees it; an "is this UTF-8?" check
    // answers yes. This case is here because the first version of it
    // asserted `!utf8ok` and was WRONG.
    ["latin1mangle", Buffer.from("an em dash — here\n", "latin1"),
      (r) => r.utf8ok === true && r.hits.length === 1 && r.hits[0].byte === 0x14],
    // A genuinely malformed sequence, so the UTF-8 check itself is armed:
    // a lone continuation byte carries no C0 at all.
    ["badutf8", Buffer.from([A, 0x80, B, NL]), (r) => r.utf8ok === false && r.hits.length === 0],
  ];
  const rows = [];
  for (const [name, buf, want] of cases) {
    const p = join(dir, name + ".txt");
    writeFileSync(p, buf);
    const r = scanBytes(readFileSync(p));
    rows.push({ name, ok: want(r) === true, got: { hits: r.hits.length, eol: r.eol, utf8ok: r.utf8ok } });
  }
  return rows;
}

function filesUnder(p) {
  const st = statSync(p);
  if (!st.isDirectory()) return [p];
  return readdirSync(p, { withFileTypes: true })
    .flatMap((d) => (d.name === "node_modules" || d.name === ".git" ? [] : filesUnder(join(p, d.name))));
}

if (process.argv[1] && import.meta.url === (await import("node:url")).pathToFileURL(process.argv[1]).href) {
  const st = selfTest();
  for (const r of st) console.log(`[selftest] ${r.name} ${r.ok ? "ok" : "*** BROKEN ***"} ${JSON.stringify(r.got)}`);
  if (st.some((r) => !r.ok)) { console.error("SELF-TEST FAILED: this scanner cannot see what it claims to. Aborting."); process.exit(3); }
  let bad = 0;
  for (const arg of process.argv.slice(2)) {
    for (const f of filesUnder(arg)) {
      const r = scanBytes(readFileSync(f));
      const flag = r.hits.length > 0 || !r.utf8ok;
      if (flag) bad++;
      console.log(`${flag ? "FAIL" : "ok  "} ${f} bytes=${r.bytes} eol=${r.eol} lf=${r.lf} crlf=${r.crlf} utf8=${r.utf8ok} c0=${r.hits.length}${r.hits.length ? " " + JSON.stringify(r.hits.slice(0, 5)) : ""}`);
    }
  }
  console.log(bad === 0 ? "CLEAN" : `${bad} FILE(S) FAILED`);
  process.exit(bad === 0 ? 0 : 1);
}
