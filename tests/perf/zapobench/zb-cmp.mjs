// zb-cmp.mjs — compare two paired zapo runs' captured stanzas.
//
//   node zb-cmp.mjs <a.stanzas.txt> <b.stanzas.txt> [--verbose]
//   node zb-cmp.mjs --selftest <any.stanzas.txt>
//
// WHY THIS IS NOT `diff`.  Two runs of the SAME binary against the same fake
// server differ, and they differ a lot: 32 of 76 lines on the A/A pair taken
// for this report.  Three independent sources:
//
//   * `sid` — the usync session id is `<random>.<random>-<n>`, a fresh random
//     pair per PROCESS.  Every usync iq differs on it and on nothing else.
//   * `<enc>` payload length — a Signal ciphertext is 114 bytes on a fresh
//     session and 146 once a device-list / pkmsg round has happened, and
//     which one a given message gets depends on how the retry raced the
//     window.
//   * ORDER — the stages are driven on fixed time windows, so two stanzas
//     from different stages swap places run to run.
//
// So: normalise those two fields, compare as a MULTISET (sort the lines), and
// report the tag histogram separately.  `stanza.count` is NOT an invariant —
// the same binary has answered 75 and 76 — so a count difference is reported
// as a fact, not as a failure.
//
// Nothing else is normalised.  In particular the message BODIES, the jids,
// the xmlns, the iq types and the attribute sets are compared byte for byte
// after the two substitutions above.  The driver has already masked `id`,
// `t`, `notify` and `offline`, and has already reduced every byte payload to
// `bytes:<length>`, so no key material reaches this file.

import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const SELFTEST = args.includes("--selftest");
const VERBOSE = args.includes("--verbose");
const files = args.filter((a) => !a.startsWith("--"));

// The two normalisations, each one line, each named in the output.
function normalise(line) {
  return line
    // sid: "<rand>.<rand>-<n>"  ->  "<sid>-<n>", keeping the sequence number,
    // which IS deterministic and IS worth comparing.
    .replace(/"sid":"\d+\.\d+-(\d+)"/g, '"sid":"<sid>-$1"')
    // an <enc> node's payload length. Only inside a node whose tag is "enc".
    .replace(/"content":"bytes:\d+","tag":"enc"/g, '"content":"bytes:<enc>","tag":"enc"');
}

function tagOf(line) {
  const m = /"tag":"([a-z_]+)"\}$/.exec(line.trim());
  return m ? m[1] : "?";
}

function load(path) {
  const raw = readFileSync(path, "utf8").split("\n").filter((l) => l.trim().length);
  return { raw, norm: raw.map(normalise) };
}

function histogram(lines) {
  const h = new Map();
  for (const l of lines) h.set(tagOf(l), (h.get(tagOf(l)) ?? 0) + 1);
  return new Map([...h.entries()].sort());
}

function multisetDiff(a, b) {
  const count = (xs) => {
    const m = new Map();
    for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
    return m;
  };
  const ma = count(a), mb = count(b);
  const onlyA = [], onlyB = [];
  for (const [k, v] of ma) { const d = v - (mb.get(k) ?? 0); for (let i = 0; i < d; i++) onlyA.push(k); }
  for (const [k, v] of mb) { const d = v - (ma.get(k) ?? 0); for (let i = 0; i < d; i++) onlyB.push(k); }
  return { onlyA, onlyB };
}

function compare(labelA, A, labelB, B, quiet) {
  const hA = histogram(A.raw), hB = histogram(B.raw);
  const tagsEqual = JSON.stringify([...hA]) === JSON.stringify([...hB]);

  const rawD = multisetDiff(A.raw, B.raw);
  const normD = multisetDiff(A.norm, B.norm);
  const same = tagsEqual && normD.onlyA.length === 0 && normD.onlyB.length === 0;

  if (!quiet) {
    console.log(`A = ${labelA}   ${A.raw.length} stanzas`);
    console.log(`B = ${labelB}   ${B.raw.length} stanzas`);
    console.log(`tag multiset A: ${JSON.stringify(Object.fromEntries(hA))}`);
    console.log(`tag multiset B: ${JSON.stringify(Object.fromEntries(hB))}`);
    console.log(`TAG MULTISET:   ${tagsEqual ? "IDENTICAL" : "DIFFERENT"}`);
    console.log(`stanza.count:   ${A.raw.length === B.raw.length ? "equal at " + A.raw.length : `${A.raw.length} vs ${B.raw.length} (NOT an invariant)`}`);
    console.log(`unnormalised multiset: ${rawD.onlyA.length} only in A, ${rawD.onlyB.length} only in B`);
    console.log(`normalised   multiset: ${normD.onlyA.length} only in A, ${normD.onlyB.length} only in B` +
      (same ? "   <= NO DIFFERENCE" : ""));
    console.log(`normalised fields: sid (random per process), <enc> payload length (114 vs 146 by retry race)`);
    if (VERBOSE || !same) {
      for (const l of normD.onlyA.slice(0, 20)) console.log("  A-only " + l.slice(0, 240));
      for (const l of normD.onlyB.slice(0, 20)) console.log("  B-only " + l.slice(0, 240));
    }
  }
  return same;
}

if (SELFTEST) {
  const f = files[0];
  const X = load(f);
  let pass = 0, fail = 0;
  const check = (name, ok) => {
    if (ok) { pass++; console.log(`  ok   ${name}`); } else { fail++; console.log(`  FAIL ${name}`); }
  };
  console.log("zb-cmp self-test on " + f);

  // 1. POSITIVE CONTROL: a file against itself must say NO DIFFERENCE.
  check("identity reports NO DIFFERENCE", compare(f, X, f, load(f), true));

  // 2. NEGATIVE CONTROL: one changed stanza must be SEEN.
  const Y = { raw: X.raw.slice(), norm: X.norm.slice() };
  Y.raw[0] = Y.raw[0].replace('"tag":"iq"', '"tag":"ZZZ"');
  Y.norm[0] = normalise(Y.raw[0]);
  check("the mutation for test 2 actually changed a line", Y.raw[0] !== X.raw[0]);
  check("one mutated stanza IS reported", compare(f, X, "mutated", Y, true) === false);

  // 3. a normalised field must NOT be seen ...
  const hadSid = X.raw.some((l) => /"sid":"\d+\.\d+-/.test(l));
  check("the fixture contains a sid (else test 3 is vacuous)", hadSid);
  const Z = { raw: X.raw.map((l) => l.replace(/"sid":"\d+\.\d+-/g, '"sid":"99999.11111-')), norm: [] };
  Z.norm = Z.raw.map(normalise);
  check("a sid-only change is normalised away", compare(f, X, "sid-rewritten", Z, true));

  // 4. ... but a field NEXT TO it still must be.
  const W = { raw: Z.raw.slice(), norm: [] };
  const i = W.raw.findIndex((l) => l.includes('"sid"') && l.includes('"mode":"query"'));
  check("found a sid-bearing line to mutate for test 4", i >= 0);
  if (i >= 0) W.raw[i] = W.raw[i].replace('"mode":"query"', '"mode":"QUERY"');
  W.norm = W.raw.map(normalise);
  check("a real change BESIDE a normalised one is still reported", compare(f, X, "sid+mode", W, true) === false);

  // 5. <enc> length is normalised; another bytes: length is NOT.
  const hadEnc = X.raw.some((l) => /"content":"bytes:\d+","tag":"enc"/.test(l));
  check("the fixture contains an <enc> (else test 5 is vacuous)", hadEnc);
  const E = { raw: X.raw.map((l) => l.replace(/"content":"bytes:\d+","tag":"enc"/g, '"content":"bytes:9999","tag":"enc"')), norm: [] };
  E.norm = E.raw.map(normalise);
  check("an <enc>-length-only change is normalised away", compare(f, X, "enc-rewritten", E, true));

  const hadDI = X.raw.some((l) => /"content":"bytes:\d+","tag":"device-identity"/.test(l));
  check("the fixture contains a non-enc bytes: node (else test 5b is vacuous)", hadDI);
  const N = { raw: X.raw.map((l) => l.replace(/"content":"bytes:\d+","tag":"device-identity"/g, '"content":"bytes:9999","tag":"device-identity"')), norm: [] };
  N.norm = N.raw.map(normalise);
  check("a NON-enc bytes: length change is NOT normalised away", compare(f, X, "di-rewritten", N, true) === false);

  // 6. order must not matter.
  const R = { raw: X.raw.slice().reverse(), norm: X.norm.slice().reverse() };
  check("a reordering is not a difference", compare(f, X, "reversed", R, true));

  // 7. a missing stanza must be seen.
  const M = { raw: X.raw.slice(1), norm: X.norm.slice(1) };
  check("a DROPPED stanza is reported", compare(f, X, "one-dropped", M, true) === false);

  console.log(`\nSELFTEST: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

if (files.length !== 2) {
  console.error("usage: zb-cmp.mjs <a.stanzas.txt> <b.stanzas.txt>   |   --selftest <f>");
  process.exit(2);
}
const ok = compare(files[0], load(files[0]), files[1], load(files[1]), false);
console.log(ok ? "\nRESULT: NO DIFFERENCE" : "\nRESULT: DIFFERENT");
process.exit(ok ? 0 : 1);
