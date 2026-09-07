// Set difference of two analyze() dumps by (section, code, file, line).
// A count delta cannot tell "new wall" from "same wall, deeper message";
// only the identity of each site can.
import { readFileSync, statSync } from "node:fs";
const [a, b] = process.argv.slice(2);
const load = (f) => {
  const j = JSON.parse(readFileSync(f, "utf8"));
  const m = new Map();
  for (const s of j.sites) m.set(`${s.section}|${s.code}|${s.file}|${s.line}`, s);
  return { j, m, bytes: statSync(f).size };
};
const A = load(a), B = load(b);
console.log(`A ${a} bytes=${A.bytes} sites=${A.m.size}`);
console.log(`B ${b} bytes=${B.bytes} sites=${B.m.size}`);
const owner = (p) => {
  const s = String(p).split("\\").join("/");
  if (/wamcoord-prov\/[0-9a-f]{40}\/lib\//.test(s) || /mysql2/.test(s)) return "mysql2";
  if (/wamcoord-prov\/[0-9a-f]{40}\/(src|spec)\//.test(s)) return "zapo-js";
  if (/packages\/store-mysql/.test(s)) return "store-mysql";
  if (/napp\/drivers/.test(s)) return "driver";
  return "other:" + s;
};
const shorten = (p) => String(p).split("\\").join("/").replace(/^.*[0-9a-f]{40}\//, "<prov>/").replace(/^.*napp\//, "napp/");
for (const [label, X, Y] of [["ONLY IN A (closed by the flag)", A, B], ["ONLY IN B (uncovered by the flag)", B, A]]) {
  const rows = [...X.m].filter(([k]) => !Y.m.has(k));
  console.log(`\n=== ${label}: ${rows.length}`);
  const byOwner = new Map();
  for (const [, s] of rows) byOwner.set(owner(s.file), (byOwner.get(owner(s.file)) ?? 0) + 1);
  console.log("  by owner: " + [...byOwner].map(([k, v]) => `${k}=${v}`).join("  "));
  for (const [, s] of rows) {
    console.log(`  ${s.section.padEnd(12)} ${s.code}  ${owner(s.file).padEnd(11)} ${shorten(s.file)}:${s.line}`);
    console.log(`      ${s.message.slice(0, 130)}`);
  }
}
const same = [...A.m].filter(([k]) => B.m.has(k));
console.log(`\n=== IN BOTH, identical (section,code,file,line): ${same.length}`);
