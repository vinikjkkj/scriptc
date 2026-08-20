/* bytescan-keyorder.mjs — scan files for NUL and other C0 control bytes, and
 * for invalid UTF-8, before they are committed.
 *
 * A raw NUL in a source file passes every gate this project has, and blocks
 * before this one shipped two real NULs and two real 0x08 bytes their own
 * scripts had planted. So the scanner SELF-TESTS on planted cases first and
 * refuses to report anything until it has caught all of them: a scanner that
 * silently finds nothing looks exactly like a clean tree.
 *
 * TAB (0x09), LF (0x0A) and CR (0x0D) are the only C0 bytes allowed.
 *
 * Usage: node bytescan-keyorder.mjs <file|dir> [...]
 */
import { readFileSync, readdirSync, statSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ALLOWED = new Set([0x09, 0x0a, 0x0d]);

export function scanBuffer(buf) {
  const hits = [];
  let line = 1;
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    if (b === 0x0a) line++;
    if (b < 0x20 && !ALLOWED.has(b)) hits.push({ kind: "c0", byte: b, offset: i, line });
    if (b === 0x7f) hits.push({ kind: "del", byte: b, offset: i, line });
  }
  // UTF-8 validity: a round trip through the decoder loses nothing when the
  // bytes are valid, and plants U+FFFD when they are not.
  const decoded = buf.toString("utf8");
  if (!Buffer.from(decoded, "utf8").equals(buf)) hits.push({ kind: "utf8", byte: -1, offset: -1, line: -1 });
  return hits;
}

function selfTest() {
  const dir = mkdtempSync(join(tmpdir(), "keyorder-bytescan-"));
  const cases = [
    ["clean-ascii", Buffer.from("const a = 1;\nconst b = 2;\n", "utf8"), 0],
    ["clean-crlf", Buffer.from("const a = 1;\r\nconst b = 2;\r\n", "utf8"), 0],
    ["clean-tab", Buffer.from("\tconst a = 1;\n", "utf8"), 0],
    ["clean-emdash", Buffer.from("// a — b\n", "utf8"), 0],
    ["clean-accents", Buffer.from("// ordenação de chaves\n", "utf8"), 0],
    ["clean-empty", Buffer.alloc(0), 0],
    ["planted-nul-head", Buffer.concat([Buffer.from([0x00]), Buffer.from("x\n", "utf8")]), 1],
    ["planted-nul-mid", Buffer.concat([Buffer.from("ab", "utf8"), Buffer.from([0x00]), Buffer.from("cd\n", "utf8")]), 1],
    ["planted-nul-tail", Buffer.concat([Buffer.from("ab\n", "utf8"), Buffer.from([0x00])]), 1],
    ["planted-backspace", Buffer.concat([Buffer.from("a", "utf8"), Buffer.from([0x08]), Buffer.from("b\n", "utf8")]), 1],
    ["planted-vtab", Buffer.concat([Buffer.from("a", "utf8"), Buffer.from([0x0b]), Buffer.from("b\n", "utf8")]), 1],
    ["planted-formfeed", Buffer.concat([Buffer.from("a", "utf8"), Buffer.from([0x0c]), Buffer.from("b\n", "utf8")]), 1],
    ["planted-esc", Buffer.concat([Buffer.from("a", "utf8"), Buffer.from([0x1b]), Buffer.from("b\n", "utf8")]), 1],
    ["planted-dc4", Buffer.concat([Buffer.from("a", "utf8"), Buffer.from([0x14]), Buffer.from("b\n", "utf8")]), 1],
    ["planted-del", Buffer.concat([Buffer.from("a", "utf8"), Buffer.from([0x7f]), Buffer.from("b\n", "utf8")]), 1],
    ["planted-two", Buffer.concat([Buffer.from([0x00]), Buffer.from("a", "utf8"), Buffer.from([0x08])]), 2],
    // The latin1 mangling this project has been bitten by: bytes read as
    // latin1 and written straight back as latin1 round-trip exactly, so
    // they carry no C0 byte and no UTF-8 error. This case pins that the
    // scanner does NOT claim to catch that - a scanner that reported a hit
    // here would be lying about its own reach, and the real defence against
    // latin1 patching is not patching as latin1.
    ["planted-latin1-roundtrip", Buffer.from(Buffer.from("// a — b\n", "utf8").toString("latin1"), "latin1"), 0],
    ["planted-bad-utf8", Buffer.from([0x2f, 0x2f, 0x20, 0xc3, 0x28, 0x0a]), 1],
  ];
  const failures = [];
  for (const [name, buf, want] of cases) {
    writeFileSync(join(dir, name), buf);
    const got = scanBuffer(readFileSync(join(dir, name))).length;
    if (got !== want) failures.push(`${name}: want ${want} hit(s), got ${got}`);
  }
  return { cases: cases.length, failures };
}

function walk(p, out) {
  const st = statSync(p);
  if (st.isDirectory()) {
    for (const n of readdirSync(p)) {
      if (n === "node_modules" || n === ".git" || n === "dist") continue;
      walk(join(p, n), out);
    }
    return;
  }
  out.push(p);
}

const st = selfTest();
console.log(`[selftest] ${st.cases} planted cases, ${st.failures.length} failure(s)`);
for (const f of st.failures) console.log("  " + f);
if (st.failures.length > 0) {
  console.error("SELF-TEST FAILED: the scanner cannot see what it claims to scan for. Aborting.");
  process.exit(3);
}

const targets = process.argv.slice(2);
if (targets.length === 0) {
  console.log("(no targets given; self-test only)");
  process.exit(0);
}
const files = [];
for (const t of targets) walk(t, files);
let bad = 0;
for (const f of files) {
  const hits = scanBuffer(readFileSync(f));
  if (hits.length === 0) continue;
  bad++;
  console.log(`${f}: ${hits.length} hit(s)`);
  for (const h of hits.slice(0, 8)) {
    console.log(`   ${h.kind} 0x${h.byte < 0 ? "--" : h.byte.toString(16).padStart(2, "0")} at offset ${h.offset} line ${h.line}`);
  }
}
console.log(`${files.length} file(s) scanned, ${bad} with hits`);
process.exit(bad === 0 ? 0 : 1);
