/* projcensus-projection.mjs — the MIXED-PROJECTION population.
 *
 * A class instance projected into a record shape becomes a record whose
 * method-named fields are closures bound to the LIVE instance and whose data
 * fields are a COPY taken at the projection. That is one value with two
 * identities, and it is observable exactly when a method reachable through
 * the projection WRITES a field the same projection copied.
 *
 * This walks a corpus (or any directory of entries), runs the frontend only
 * (analyze), and reads the compiler's own SCRIPTC_PROJ_CENSUS / _USE dials.
 * It then asks the SOURCE whether any non-constructor member of the projected
 * class assigns to one of the copied fields — the condition that makes the
 * projection a lie about itself.
 *
 * Usage: node projcensus-projection.mjs <dir-or-glob-root> [--repo=<root>] [--json=<path>]
 */
import { globSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const repo = process.argv.find((a) => a.startsWith("--repo="))?.slice(7) ?? "G:/scriptc-projection";
const require = createRequire(join(repo, "package.json"));
const ts = require("typescript");
const { analyze } = await import(pathToFileURL(join(repo, "packages/compiler/dist/index.js")).href);

const root = resolve(process.argv[2] ?? join(repo, "tests/corpus"));
const files = [
  ...globSync(join(root, "*.ts")), ...globSync(join(root, "*.js")),
  ...globSync(join(root, "*.mjs")), ...globSync(join(root, "*.cjs")),
  ...globSync(join(root, "*/main.ts")), ...globSync(join(root, "*/main.js")),
  ...globSync(join(root, "*/main.mjs")), ...globSync(join(root, "*/main.cjs")),
].sort();

process.env["SCRIPTC_PROJ_CENSUS"] = "1";
process.env["SCRIPTC_PROJ_USE"] = "1";

/** Every field name a non-constructor member of `cls` (or a base declared in
 * the same file set) ASSIGNS on `this`. Over-approximates on purpose: a
 * write anywhere in the class body counts, whether or not the projected
 * method is the one that reaches it. */
function mutatedFieldsOf(sourceFiles, className) {
  const out = new Set();
  const seen = new Set();
  const decls = [];
  const findClass = (name) => {
    for (const sf of sourceFiles) {
      let hit = null;
      const walk = (n) => {
        if (hit) return;
        if (ts.isClassDeclaration(n) && n.name && n.name.text === name) { hit = n; return; }
        ts.forEachChild(n, walk);
      };
      walk(sf);
      if (hit) return hit;
    }
    return null;
  };
  let name = className;
  while (name && !seen.has(name)) {
    seen.add(name);
    const c = findClass(name);
    if (!c) break;
    decls.push(c);
    const ext = (c.heritageClauses ?? []).find((h) => h.token === ts.SyntaxKind.ExtendsKeyword);
    const e = ext && ext.types[0] && ext.types[0].expression;
    name = e && ts.isIdentifier(e) ? e.text : null;
  }
  for (const c of decls) {
    for (const m of c.members) {
      if (ts.isConstructorDeclaration(m)) continue;
      const walk = (n) => {
        const isThisProp = (x) =>
          ts.isPropertyAccessExpression(x) && x.expression.kind === ts.SyntaxKind.ThisKeyword;
        if (ts.isBinaryExpression(n) && isThisProp(n.left)) {
          const op = n.operatorToken.kind;
          const assignish =
            op === ts.SyntaxKind.EqualsToken ||
            (op >= ts.SyntaxKind.FirstCompoundAssignment && op <= ts.SyntaxKind.LastCompoundAssignment);
          if (assignish) out.add(n.left.name.text);
        }
        if ((ts.isPostfixUnaryExpression(n) || ts.isPrefixUnaryExpression(n)) && isThisProp(n.operand)) {
          const op = n.operator;
          if (op === ts.SyntaxKind.PlusPlusToken || op === ts.SyntaxKind.MinusMinusToken) {
            out.add(n.operand.name.text);
          }
        }
        ts.forEachChild(n, walk);
      };
      walk(m);
    }
  }
  return out;
}

const rows = [];
const realErr = console.error;
for (const f of files) {
  const lines = [];
  console.error = (...a) => { lines.push(a.join(" ")); };
  try { analyze(f); } catch { /* a program the frontend refuses still counts its projections */ }
  console.error = realErr;
  const census = new Map(); // "class->shape" -> {methods,absent,lift,lifted[]}
  for (const l of lines) {
    const m = /^\[projcensus\] (\S+) -> (\S+) methods=(\d+) absent=(\d+) lift=(\d+)(?: \[(.*)\])?$/.exec(l);
    if (m) census.set(`${m[1]}->${m[2]}`, { methods: +m[3], absent: +m[4], lift: +m[5], lifted: m[6] ? m[6].split(",") : [] });
  }
  const uses = [];
  for (const l of lines) {
    const m = /^\[projuse\] (\S+)@(\d+) (\S+) -> (\S+) data=(\d+)(?: \[(.*)\])?$/.exec(l);
    if (m) uses.push({ site: `${m[1]}@${m[2]}`, cls: m[3], shape: m[4], data: +m[5], fields: m[6] ? m[6].split(",") : [] });
  }
  if (census.size === 0 && uses.length === 0) continue;
  let sfs = null;
  const sourcesFor = () => {
    if (sfs) return sfs;
    // The entry's OWN module set, never its directory's. A flat corpus entry
    // is one file; `**/*.ts` from its parent globbed the whole 1,529-program
    // corpus and the slice below then kept the first 40 ALPHABETICALLY, so
    // every entry past `1xxx` was analysed against somebody else's sources
    // and answered "no method writes this field" for all of them. It reported
    // 0 stale over the whole corpus and the number was meaningless. Caught by
    // hand-checking 3813, whose CellImpl.bump() is `this.n += 1`.
    const dir = join(f, "..");
    const set = /[\/]main\.(ts|js|mjs|cjs)$/.test(f)
      ? [...globSync(join(dir, "**/*.ts")), ...globSync(join(dir, "**/*.js"))]
      : [f];
    sfs = set.map((p) => { try { return ts.createSourceFile(p, readFileSync(p, "utf8"), ts.ScriptTarget.ESNext, true); } catch { return null; } }).filter(Boolean);
    return sfs;
  };
  for (const [k, c] of census) {
    const [cls, shape] = k.split("->");
    const mixed = c.methods > 0 && c.lift > 0;
    const mut = mixed ? mutatedFieldsOf(sourcesFor(), cls) : new Set();
    const stale = c.lifted.filter((n) => mut.has(n));
    rows.push({ file: f, cls, shape, ...c, mixed, stale, sites: uses.filter((u) => u.cls === cls && u.shape === shape).map((u) => u.site) });
  }
}

const mixed = rows.filter((r) => r.mixed);
const staleRows = mixed.filter((r) => r.stale.length > 0);
console.log(`entries scanned         ${files.length}`);
console.log(`interned projections    ${rows.length}`);
console.log(`  methods-only          ${rows.filter((r) => r.methods > 0 && r.lift === 0).length}`);
console.log(`  data-only             ${rows.filter((r) => r.methods === 0 && r.lift > 0).length}`);
console.log(`  MIXED (method+data)   ${mixed.length}`);
console.log(`  MIXED and a projected-class method WRITES a copied field  ${staleRows.length}`);
console.log(`programs with a mixed projection  ${new Set(mixed.map((r) => r.file)).size}`);
console.log(`programs with a STALE one         ${new Set(staleRows.map((r) => r.file)).size}`);
for (const r of mixed) {
  console.log(`  MIXED ${r.stale.length > 0 ? "STALE" : "     "} ${r.cls} -> ${r.shape} methods=${r.methods} lift=${r.lift} [${r.lifted.join(",")}]${r.stale.length ? ` stale=[${r.stale.join(",")}]` : ""}  ${r.file}`);
}
const json = process.argv.find((a) => a.startsWith("--json="))?.slice(7);
if (json) writeFileSync(json, JSON.stringify(rows, null, 1));
