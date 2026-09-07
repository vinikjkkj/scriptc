/* Check the specific claims §5 makes, mechanically, against the records. */
import { readFileSync } from "node:fs";
const LAB = "<blocks>/pkgstatus3-lab/sites";
const rd = (n) => JSON.parse(readFileSync(`${LAB}/${n}.json`, "utf8"));
const blk = (r) => r.sites.filter((s) => s.section === "blocker");

console.log("-- 'extending classes not declared in the program' sites, per store package");
for (const p of ["store-sqlite", "store-mongo", "store-mysql", "store-postgres", "store-redis"]) {
  const b = blk(rd(p));
  const m = b.filter((s) => /extending classes not declared in the program/.test(s.message));
  const names = [...new Set(m.map((s) => /\('([^']+)'\)/.exec(s.message)?.[1]))];
  console.log(`   ${p.padEnd(16)} ${String(m.length).padStart(3)}  base=${JSON.stringify(names)}`);
}

console.log("\n-- driver-owned sites (napp/drivers/*), per store package");
for (const p of ["store-sqlite", "store-mongo", "store-mysql", "store-postgres", "store-redis", "wam"]) {
  const b = blk(rd(p));
  const d = b.filter((s) => /\/napp\/drivers\//.test(String(s.file).replace(/\\/g, "/")));
  console.log(`   ${p.padEnd(16)} ${String(d.length).padStart(3)}  (SC2004=${d.filter((s) => s.code === "SC2004").length})`);
}

console.log("\n-- are mysql/postgres/redis the same SHAPE? (code -> count)");
for (const p of ["store-mysql", "store-postgres", "store-redis"]) {
  const by = {};
  for (const s of blk(rd(p))) by[s.code] = (by[s.code] ?? 0) + 1;
  console.log(`   ${p.padEnd(16)} ${JSON.stringify(by)}`);
}
