/* The LLVM refusal inventory — every `LlvmUnsupportedError` site, and the
 * lib-function surface the two table-driven ones stand for.
 *
 * WHY A SCRIPT AND NOT A GREP. Only 5 of the 42 construction sites carry a
 * literal kind string (`weakmap:new`, `weakmap:intrinsic`, `callValue:arity`,
 * `recordKeyGet:dyn`, `censusDownstreamOnly`); the other 37 build the kind
 * from a template over a type kind, a statement kind or a function name. A
 * scan for kind STRINGS therefore finds 5 of 42 and reads as a small problem.
 * Worse, two of the sites (`libCall:${e.fn}`, emitter.ts) are table-driven:
 * their kind space is every IrLibFn name with no LLVM lowering, which no
 * pattern over the throw sites can see at all.
 *
 * SELF-TEST. Run with --check. The controls are facts established off
 * ARTIFACTS, not off this script:
 *   - `wrtc.newPeer` MUST report missing   (a WebRTC build emits .c, no .ll)
 *   - `dgram.*`      MUST report 0 missing (dgram-connected2 emits .ll, no .c)
 *   - a fabricated name MUST NOT appear as covered
 * A harness whose only control is a case it is wrong about is not a control,
 * so both directions are asserted and the fabricated name catches a matcher
 * that has started matching everything.
 *
 * Usage:  node tests/perf/llvmparity/refusal-inventory.mjs [--check] [--json]
 */
import fs from "node:fs";
import path from "node:path";

const REPO = path.resolve(import.meta.dirname, "../../..");
const R = (p) => fs.readFileSync(path.join(REPO, p), "utf8").split(/\r?\n/);

const NODES = "packages/compiler/src/ir/nodes.ts";
const EMITTER = "packages/compiler/src/backend/llvm/emitter.ts";
const LLVM_DIR = "packages/compiler/src/backend/llvm";

/* ── every construction site, per file ─────────────────────────────────── */
function sites() {
  const out = [];
  for (const f of fs.readdirSync(path.join(REPO, LLVM_DIR)).filter((n) => n.endsWith(".ts"))) {
    const rel = `${LLVM_DIR}/${f}`;
    R(rel).forEach((line, i) => {
      const m = line.match(/new LlvmUnsupportedError\(\s*(`[^`]*`|"[^"]*")/);
      if (!m) return;
      const raw = m[1];
      out.push({
        file: rel,
        line: i + 1,
        kind: raw.slice(1, -1),
        /* a literal kind string vs one interpolated at run time */
        literal: raw.startsWith('"') || !raw.includes("${"),
      });
    });
  }
  return out;
}

/* ── the IrLibFn union ─────────────────────────────────────────────────── */
function declaredLibFns() {
  const L = R(NODES);
  const start = L.findIndex((l) => l.startsWith("export type IrLibFn ="));
  if (start < 0) throw new Error("IrLibFn union not found — nodes.ts moved");
  const names = [];
  for (let j = start + 1; j < L.length; j++) {
    const l = L[j];
    const m = l.match(/^\s*\|\s*"([^"]+)"\s*;?\s*$/);
    if (m) {
      names.push(m[1]);
      if (l.trimEnd().endsWith(";")) break;
      continue;
    }
    if (/^\s*$/.test(l) || /^\s*(\/\*|\*|\/\/)/.test(l)) continue;
    break;
  }
  return names;
}

/* ── what the LLVM emitter can actually lower ──────────────────────────── */
function llvmCovered() {
  const L = R(EMITTER);
  /* the generic table */
  const ts = L.findIndex((l) => l.includes("const LIB_FN_SYMS"));
  const syms = [];
  let depth = 0;
  for (let j = ts; j < L.length; j++) {
    for (const ch of L[j]) { if (ch === "{") depth++; else if (ch === "}") depth--; }
    if (j > ts) { const m = L[j].match(/^\s*"([^"]+)"\s*:/); if (m) syms.push(m[1]); }
    if (depth === 0 && j > ts) break;
  }
  /* plus everything special-cased inside emitLibCall, bounded to that
   * function so a `fn === "x"` in a neighbour cannot inflate coverage */
  const fs_ = L.findIndex((l) => l.includes("private emitLibCall("));
  let fe = fs_;
  for (let j = fs_ + 1; j < L.length; j++) if (/^  \}\s*$/.test(L[j])) { fe = j; break; }
  const body = L.slice(fs_, fe + 1).join("\n");
  const special = new Set();
  for (const m of body.matchAll(/(?:e\.)?fn\s*===\s*"([^"]+)"/g)) special.add(m[1]);
  return { syms: new Set(syms), special, span: [fs_ + 1, fe + 1] };
}

const declared = declaredLibFns();
const { syms, special, span } = llvmCovered();
const covered = new Set([...syms, ...special]);
const missing = declared.filter((f) => !covered.has(f));

const byNs = {};
for (const f of missing) (byNs[f.split(".")[0] ??= f] ||= []).push(f);
const declaredByNs = {};
for (const f of declared) declaredByNs[f.split(".")[0]] = (declaredByNs[f.split(".")[0]] || 0) + 1;

/* ── self-test ─────────────────────────────────────────────────────────── */
if (process.argv.includes("--check")) {
  const miss = new Set(missing);
  const fails = [];
  const ok = (cond, msg) => { console.log(`${cond ? "ok  " : "FAIL"}  ${msg}`); if (!cond) fails.push(msg); };

  ok(miss.has("wrtc.newPeer"),
     "POSITIVE: wrtc.newPeer reported missing (artifact: .c, no .ll)");
  ok(declared.filter((f) => f.startsWith("dgram.")).length === 20,
     "dgram surface is the expected 20 declared names");
  ok(missing.filter((f) => f.startsWith("dgram.")).length === 0,
     "NEGATIVE: 0 dgram names missing (artifact: dgram-connected2 emits .ll, no .c)");
  ok(!covered.has("zz.fabricated") && !miss.has("zz.fabricated"),
     "a fabricated name appears in neither set (the matcher is not matching everything)");
  ok([...special].every((n) => declared.includes(n)),
     "every emitLibCall special-case name is a real IrLibFn spelling (no regex noise)");
  ok(declared.length > 900 && missing.length > 0 && missing.length < declared.length,
     `counts are in range (declared ${declared.length}, missing ${missing.length})`);

  const all = sites();
  ok(all.length === 42, `42 LlvmUnsupportedError construction sites (found ${all.length})`);
  ok(all.filter((s) => s.literal).length === 5,
     `only 5 carry a literal kind string (found ${all.filter((s) => s.literal).length}) — why a grep undercounts`);

  console.log(fails.length ? `\n${fails.length} CHECK(S) FAILED` : "\nall checks passed");
  process.exit(fails.length ? 1 : 0);
}

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ declared, covered: [...covered], missing, sites: sites() }, null, 1));
  process.exit(0);
}

const all = sites();
console.log(`LlvmUnsupportedError construction sites: ${all.length}`);
for (const [f, n] of Object.entries(all.reduce((a, s) => ((a[s.file] = (a[s.file] || 0) + 1), a), {})))
  console.log(`  ${String(n).padStart(3)}  ${f}`);
console.log(`  literal kind strings: ${all.filter((s) => s.literal).length} — the rest are built at run time\n`);
console.log(`emitLibCall spans lines ${span[0]}..${span[1]}`);
console.log(`IrLibFn declared ${declared.length} | LIB_FN_SYMS ${syms.size} | special-cased ${special.size} | covered ${covered.size}`);
console.log(`MISSING on the LLVM tier: ${missing.length}\n`);
console.log("  missing/declared  namespace");
for (const [ns, v] of Object.entries(byNs).sort((a, b) => b[1].length - a[1].length))
  console.log(`  ${String(v.length).padStart(4)}/${String(declaredByNs[ns]).padEnd(6)} ${ns}`);
