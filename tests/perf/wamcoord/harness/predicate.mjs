// Which installed packages would take the authored-JavaScript path at all, and
// what do the two candidate predicates select?
//   P1  the mapped entry imports nothing        (my option-3 guess)
//   P2  the mapped entry exports no function taking parameters
//       (the failure mode I actually measured: a twin parameter is `unknown`)
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
const NM = process.argv[2];
const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };
const pkgs = [];
for (const e of readdirSync(NM)) {
  if (e.startsWith(".")) continue;
  if (e.startsWith("@")) { for (const s of readdirSync(join(NM, e))) pkgs.push(`${e}/${s}`); }
  else pkgs.push(e);
}
const BUILD = /^(dist|lib|build|out|output|dist-node|dist-src)\//;
const rows = [];
for (const name of pkgs) {
  const dir = join(NM, name);
  let pj; try { pj = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")); } catch { continue; }
  // publishedTargetOf, root subpath, "import" condition -- the compiler's rule.
  let target = null;
  const ex = pj.exports;
  if (ex !== undefined) {
    const pick = (v) => typeof v === "string" ? v : (v && typeof v === "object" ? (pick(v.import) ?? pick(v.default) ?? pick(v.require) ?? pick(v.types)) : null);
    target = typeof ex === "string" ? ex : pick(ex?.["."] ?? ex);
  } else {
    for (const f of ["module", "main", "types"]) if (typeof pj[f] === "string" && pj[f] !== "") { target = pj[f]; break; }
    if (target === null) target = "index.js";
  }
  if (typeof target !== "string") continue;
  const rel = target.replace(/^\.\//, "");
  const base = rel.replace(/\.d\.(ts|mts|cts)$/, "").replace(/\.(js|mjs|cjs)$/, "");
  // A TypeScript twin anywhere the mapper looks means it never needs the
  // authored-JS path.
  const tails = [rel]; if (BUILD.test(rel)) tails.push(rel.replace(BUILD, ""));
  let hasTs = false;
  for (const t of [...tails, ...tails.map((x) => `src/${x}`)]) {
    const b = t.replace(/\.d\.(ts|mts|cts)$/, "").replace(/\.(js|mjs|cjs)$/, "");
    for (const c of [`${b}.ts`, `${b}.mts`, `${b}.cts`, `${b}.tsx`, join(b, "index.ts")]) if (isFile(join(dir, c))) hasTs = true;
  }
  if (hasTs) continue;
  const dts = join(dir, `${base}.d.ts`);
  const impls = [".js", ".mjs", ".cjs"].map((x) => join(dir, `${base}${x}`)).filter(isFile);
  if (!isFile(dts) || impls.length === 0) continue;      // authoredJsEntry's own test
  const impl = impls[0];
  const src = readFileSync(impl, "utf8");
  const bare = new Set();
  for (const m of src.matchAll(/\brequire\(\s*['"]([^'".][^'"]*)['"]\s*\)/g)) bare.add(m[1]);
  for (const m of src.matchAll(/\bfrom\s*['"]([^'".][^'"]*)['"]/g)) bare.add(m[1]);
  const d = readFileSync(dts, "utf8");
  const fnDecl = [...d.matchAll(/export\s+declare\s+function\s+\w+\s*\(([^)]*)\)/g)];
  const fnWithParams = fnDecl.filter((m) => m[1].trim() !== "").length;
  rows.push({ name, target: rel, implBytes: statSync(impl).size, dtsBytes: statSync(dts).size,
              imports: bare.size, importList: [...bare].slice(0, 6), fnDecl: fnDecl.length, fnWithParams });
}
console.log(`scanned ${pkgs.length} installed packages under ${NM}`);
console.log(`AUTHORED-JS CANDIDATES: ${rows.length}\n`);
for (const r of rows) {
  console.log(`  ${r.name}  target=${r.target}  impl=${r.implBytes}B  d.ts=${r.dtsBytes}B`);
  console.log(`      P1 imports=${r.imports} ${r.imports ? JSON.stringify(r.importList) : "(none)"}`);
  console.log(`      P2 exported declare-functions=${r.fnDecl}, of which take parameters=${r.fnWithParams}`);
}
