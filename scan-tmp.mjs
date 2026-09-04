import { readdirSync, readFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { compile } from "./packages/compiler/dist/index.js";

const WT = process.env.WT;
const corpus = join(WT, "tests/corpus");
const outRoot = process.env.SCAN_OUT;
const NEEDLE = "scr_dyn_mark_static_copy";
const files = process.argv.slice(2).length
  ? process.argv.slice(2)
  : readdirSync(corpus).filter((f) => f.endsWith(".ts")).map((f) => join(corpus, f));

const hits = [];
let done = 0, errs = 0;
const CONC = 3;
let i = 0;
async function worker(w) {
  while (i < files.length) {
    const idx = i++;
    const f = files[idx];
    const stem = f.split(/[\/]/).pop().replace(/\.ts$/, "");
    const outDir = join(outRoot, "w" + w);
    mkdirSync(outDir, { recursive: true });
    try {
      await compile(f, { outPath: join(outDir, "program.exe"), outDir, backend: "c" });
    } catch (e) { errs++; }
    const c = join(outDir, stem + ".c");
    let text = "";
    try { text = readFileSync(c, "utf8"); } catch { }
    let extra = "";
    for (let k = 1; k <= 32; k++) {
      const p = join(outDir, `${stem}.part${k}.c`);
      if (!existsSync(p)) break;
      extra += readFileSync(p, "utf8");
    }
    const all = text + extra;
    if (all.includes(NEEDLE)) {
      const n = all.split(NEEDLE).length - 1;
      hits.push(`${stem}\t${n}`);
    }
    done++;
    if (done % 100 === 0) process.stderr.write(`${done}/${files.length} hits=${hits.length}\n`);
    try { rmSync(c, { force: true }); } catch { }
  }
}
await Promise.all(Array.from({ length: CONC }, (_, w) => worker(w)));
console.log(hits.sort().join("\n"));
console.error(`TOTAL ${files.length} programs, ${hits.length} emit ${NEEDLE}, ${errs} compile errors`);
