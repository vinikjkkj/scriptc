// compare.mjs — diff the compiled binary's answers against the Node oracle,
// case by case, split by the oracle-derived MATCH/MISMATCH label.
//
// A MATCH case that the binary refuses is a DIVERGENCE: the value genuinely
// satisfies the target under JS semantics and Node answers, so a thrown
// dyn check there is the validator being wrong, not the program lying.
// A MISMATCH case that the binary refuses is the checked-cast stance.
import { readFileSync, existsSync } from "node:fs";

const labels = new Map();
for (const l of readFileSync("LABELS.txt", "utf8").split("\n")) {
  if (!l.trim()) continue;
  const [k, v] = l.split("\t");
  labels.set(k, v);
}

const files = process.argv.slice(2);
const rows = [];
let missing = 0;
for (const f of files) {
  const nodeF = `${f}.node.txt`, scF = `${f}.sc.txt`;
  if (!existsSync(nodeF) || !existsSync(scF)) { console.error(`SKIP ${f}: missing output`); missing++; continue; }
  const parse = (p) => {
    const m = new Map();
    for (const l of readFileSync(p, "utf8").split("\n")) {
      const i = l.indexOf(" = ");
      const j = l.indexOf(" ! ");
      if (i > 0 && (j < 0 || i < j)) m.set(l.slice(0, i), { ok: true, v: l.slice(i + 3) });
      else if (j > 0) m.set(l.slice(0, j), { ok: false, v: l.slice(j + 3) });
    }
    return m;
  };
  const N = parse(nodeF), S = parse(scF);
  for (const [k, nv] of N) {
    const sv = S.get(k);
    rows.push({ k, label: labels.get(k) ?? "?", node: nv, sc: sv ?? null });
  }
  for (const k of S.keys()) if (!N.has(k)) rows.push({ k, label: labels.get(k) ?? "?", node: null, sc: S.get(k) });
}

const bucket = new Map();
const add = (b, r) => { let a = bucket.get(b); if (!a) bucket.set(b, (a = [])); a.push(r); };
for (const r of rows) {
  if (r.sc === null) { add("ABSENT-from-compiled", r); continue; }
  if (r.node === null) { add("ABSENT-from-node", r); continue; }
  if (r.node.ok === r.sc.ok && r.node.v === r.sc.v) { add(`SAME/${r.label}`, r); continue; }
  if (r.node.ok && !r.sc.ok) { add(`NODE-OK-SC-THREW/${r.label}`, r); continue; }
  if (!r.node.ok && r.sc.ok) { add(`NODE-THREW-SC-OK/${r.label}`, r); continue; }
  if (!r.node.ok && !r.sc.ok) { add(`BOTH-THREW-DIFFERENT-MESSAGE/${r.label}`, r); continue; }
  add(`DIFFERENT-VALUE/${r.label}`, r);
}

console.log(`cases ${rows.length}   files ${files.length}   missing-output ${missing}`);
for (const [b, a] of [...bucket].sort((x, y) => y[1].length - x[1].length)) {
  console.log(`  ${b.padEnd(42)} ${String(a.length).padStart(5)}`);
}
console.log("");
const interesting = [...bucket].filter(([b]) => b.startsWith("NODE-OK-SC-THREW/MATCH") || b.startsWith("DIFFERENT-VALUE/MATCH") || b.startsWith("NODE-THREW-SC-OK") || b.startsWith("DIFFERENT-VALUE"));
for (const [b, a] of interesting) {
  console.log(`### ${b}  (${a.length})`);
  for (const r of a.slice(0, 60)) {
    console.log(`  ${r.k}`);
    console.log(`      node: ${r.node.ok ? "= " : "! "}${r.node.v}`);
    console.log(`      sc  : ${r.sc.ok ? "= " : "! "}${r.sc.v}`);
  }
  if (a.length > 60) console.log(`  ... ${a.length - 60} more`);
  console.log("");
}
