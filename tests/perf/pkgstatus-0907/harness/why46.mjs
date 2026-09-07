/* Why do store-mysql, store-postgres and store-redis all land on exactly 46?
 * Decompose each package's 46 into (a) the shared zapo-js-core cluster,
 * (b) the package's own source, (c) the driver scaffold -- and show the
 * per-cause counts inside (b). If the three decompose identically, the number
 * is a shared SHAPE plus a shared SCAFFOLD, not a coincidence. */
import { readFileSync } from "node:fs";
const LAB = "<blocks>/pkgstatus3-lab/sites";
const norm = (f) => String(f).split(String.fromCharCode(92)).join("/");
for (const p of ["store-mysql", "store-postgres", "store-redis", "store-sqlite"]) {
  const r = JSON.parse(readFileSync(`${LAB}/${p}.json`, "utf8"));
  const b = r.sites.filter((s) => s.section === "blocker");
  const core = b.filter((s) => /9a49e1fffdec[0-9a-f]*\/src\//.test(norm(s.file)));
  const own = b.filter((s) => /9a49e1fffdec[0-9a-f]*\/packages\//.test(norm(s.file)));
  const drv = b.filter((s) => /\/napp\/drivers\//.test(norm(s.file)));
  const other = b.length - core.length - own.length - drv.length;
  const fam = {};
  for (const s of own) {
    const k = s.message
      .replace(/'[^']*'/g, "'X'")
      .slice(0, 62);
    fam[`${s.code} ${k}`] = (fam[`${s.code} ${k}`] ?? 0) + 1;
  }
  console.log(
    `${p.padEnd(15)} total=${String(b.length).padStart(3)}  = core ${core.length} + own ${own.length} + driver ${drv.length}` +
      (other ? ` + other ${other}` : ""),
  );
  for (const [k, n] of Object.entries(fam).sort((a, b2) => b2[1] - a[1])) {
    console.log(`${" ".repeat(20)}own ${String(n).padStart(2)}x  ${k}`);
  }
  const dcodes = {};
  for (const s of drv) dcodes[s.code] = (dcodes[s.code] ?? 0) + 1;
  console.log(`${" ".repeat(20)}driver ${JSON.stringify(dcodes)}`);
}
