import { readFileSync } from "node:fs";
const A = JSON.parse(readFileSync(process.argv[2], "utf8"));
const B = JSON.parse(readFileSync(process.argv[3], "utf8"));
const norm = (f) => f.split("\\").join("/");
const short = (f) => norm(f).replace(/^.*\/[0-9a-f]{40}\//, "").replace(/^.*\/napp\//, "napp/");
const key = (s) => [s.code, s.message, short(s.file), s.line].join("|");
const bl = (j) => j.sites.filter((s) => s.section === "blocker");
const a = bl(A), b = bl(B);
console.log(`${process.argv[2]}: ${a.length} blockers`);
console.log(`${process.argv[3]}: ${b.length} blockers`);
const ka = new Map(), kb = new Map();
for (const s of a) ka.set(key(s), s);
for (const s of b) kb.set(key(s), s);
const added = [...kb.keys()].filter((k) => !ka.has(k));
const removed = [...ka.keys()].filter((k) => !kb.has(k));
console.log(`\nADDED in second: ${added.length}   REMOVED: ${removed.length}`);
const grp = (keys) => {
  const m = new Map();
  for (const k of keys) {
    const s = kb.get(k) ?? ka.get(k);
    const g = s.code + " " + s.message;
    if (!m.has(g)) m.set(g, []);
    m.get(g).push(short(s.file) + ":" + s.line);
  }
  return [...m.entries()].sort((x, y) => y[1].length - x[1].length);
};
if (added.length) {
  console.log("\n=== ADDED, grouped by message ===");
  for (const [g, fs] of grp(added)) {
    console.log(`\n[${fs.length}] ${g.slice(0, 200)}`);
    for (const f of fs) console.log("      ", f);
  }
}
if (removed.length) {
  console.log("\n=== REMOVED, grouped by message ===");
  for (const [g, fs] of grp(removed)) {
    console.log(`\n[${fs.length}] ${g.slice(0, 200)}`);
    for (const f of fs.slice(0, 30)) console.log("      ", f);
  }
}
