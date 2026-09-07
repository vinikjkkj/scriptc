// Re-derive the node-types divergence for named corpus programs, exactly the
// way tests/harness/node-types-divergence.test.ts does: copy the program into
// a scratch subdir of tests/fixtures/node-types so the fixture's tsconfig.json
// and pinned @types/node resolve by the normal walk-up.
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
const BS = String.fromCharCode(92);
const WT = process.env.WT ?? "<blocks>/mediautils";
const { analyze } = await import(`file:///${WT}/packages/compiler/dist/index.js`);
const corpus = join(WT, "tests/corpus");
const nodeTypesDir = join(WT, "tests/fixtures/node-types");
const scratch = join(nodeTypesDir, ".divergence-probe");
rmSync(scratch, { recursive: true, force: true });
mkdirSync(scratch, { recursive: true });
try {
  for (const name of process.argv.slice(2)) {
    const dest = join(scratch, name);
    cpSync(join(corpus, name), dest);
    const r = analyze(dest.split(BS).join("/"), {});
    const ds = r.coverage.diagnostics ?? [];
    const codes = [...new Set(ds.map((d) => d.code))].sort();
    console.log(`=== ${name}  diagnostics=${ds.length}  codes=[${codes.join(",")}]`);
    const texts = r.sourceTexts ?? new Map();
    const lineOf = (file, start) => {
      const t = texts.get(file) ?? texts.get(file.split("/").join(BS)) ?? texts.get(file.split(BS).join("/"));
      if (t === undefined || typeof start !== "number") return 0;
      let n = 1;
      for (let i = 0; i < start && i < t.length; i++) if (t.charCodeAt(i) === 10) n++;
      return n;
    };
    for (const d of ds) {
      const ln = lineOf(d.loc?.file ?? "", d.loc?.start);
      console.log(`   L${String(ln).padStart(3)}  ${d.code}  ${d.message.slice(0, 160)}`);
    }
    console.log("");
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
