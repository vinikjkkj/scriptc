/* The ranked refusal list, by MESSAGE, for one build log.
 *
 * Two rankings, because one alone lies in a different direction each way:
 *
 *  - by EXACT message: `Cannot find module '@store'` and `Cannot find
 *    module '@transport/types'` are two rows. True to the letter of "the
 *    message is the unit", and it fragments one defect into 15 rows.
 *  - by message SHAPE: the quoted operands are replaced by 'X'. One row,
 *    with the count of distinct operands beside it, so the row can still
 *    be taken apart.
 *
 * A site is (file, line, code, message). Owner is the tree the file is in.
 */
import { readFileSync } from "node:fs";

const log = readFileSync(process.argv[2], "utf8").replace(/\r/g, "");
const re = /^(.*?):(\d+):(\d+) - error (SC\d+): (.*)$/gm;
const rows = [];
let m;
while ((m = re.exec(log)) !== null) {
  rows.push({ f: m[1].split("\\").join("/"), l: +m[2], code: m[4], msg: m[5] });
}
const owner = (s) => {
  let mm;
  if (/\/packages\/fake-server\/bench[^/]*\//.test(s)) return "bench";
  if (/\/packages\/fake-server\/src\//.test(s)) return "fake-server/src";
  if ((mm = /\/provenance\/[0-9a-f]{40}\/packages\/(store-[a-z]+)\//.exec(s))) return "@zapo-js/" + mm[1];
  if (/\/provenance\/250f9af5/.test(s)) return "zapo-js@1.6.2(src)";
  if (/\/provenance\/ff43c244|\/provenance\/1c2d85b6/.test(s)) return "zapo v1.2.1/v1.3.0 checkout(src)";
  if (/\/provenance\/0fb2c132/.test(s)) return "mongodb@7.6.0(src)";
  if (/\/provenance\/9cd2e68c/.test(s)) return "bson@7.3.2(src)";
  if ((mm = /node_modules\/((?:@[^/]+\/)?[^/]+)/.exec(s))) return "npm:" + mm[1];
  return "other";
};
const shape = (s) => s.split(/'[^']*'/).join("'X'").split(/"[^"]*"/).join('"X"');
const operands = (s) => (s.match(/'[^']*'/g) ?? []).join(" ");

const seen = new Set();
const uniq = [];
for (const r of rows) {
  const k = r.f + ":" + r.l + ":" + r.code + ":" + r.msg;
  if (seen.has(k)) continue;
  seen.add(k);
  uniq.push(r);
}

const group = (keyOf) => {
  const t = new Map();
  for (const r of uniq) {
    const k = r.code + " :: " + keyOf(r);
    let c = t.get(k);
    if (!c) c = { code: r.code, key: keyOf(r), n: 0, ops: new Set(), owners: new Map(), sites: [] }, t.set(k, c);
    c.n++;
    c.ops.add(operands(r.msg));
    c.owners.set(owner(r.f), (c.owners.get(owner(r.f)) ?? 0) + 1);
    if (c.sites.length < 3) c.sites.push(r.f.split("/").slice(-2).join("/") + ":" + r.l);
  }
  return [...t.values()].sort((a, b) => b.n - a.n || a.key.localeCompare(b.key));
};

const byExact = group((r) => r.msg);
const byShape = group((r) => shape(r.msg));

console.log(`# ${process.argv[3] ?? process.argv[2]}`);
console.log(`unique sites ${uniq.length} · distinct messages ${byExact.length} · distinct message shapes ${byShape.length}`);
console.log(`\n## by owner`);
const ow = new Map();
for (const r of uniq) ow.set(owner(r.f), (ow.get(owner(r.f)) ?? 0) + 1);
for (const [k, v] of [...ow].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(v).padStart(4)}  ${k}`);
}
console.log(`\n## ranked by message SHAPE (${byShape.length} rows)`);
console.log(`| # | sites | operands | code | message shape | owners |`);
console.log(`|--:|--:|--:|---|---|---|`);
byShape.forEach((c, i) => {
  const ow2 = [...c.owners].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ");
  console.log(`| ${i + 1} | ${c.n} | ${c.ops.size} | ${c.code} | ${c.key.replace(/\|/g, "\\|").slice(0, 150)} | ${ow2} |`);
});
console.log(`\n## top 25 by EXACT message (${byExact.length} rows total)`);
byExact.slice(0, 25).forEach((c, i) => {
  console.log(`${String(i + 1).padStart(3)}. x${c.n} [${c.code}] ${c.key.slice(0, 160)}`);
  console.log(`      ${c.sites.join(" | ")}`);
});
