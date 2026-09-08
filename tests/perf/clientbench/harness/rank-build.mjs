import { readFileSync } from "node:fs";
const log = readFileSync(process.argv[2], "utf8").replace(/\r/g, "");
const re = /^(.*?):(\d+):(\d+) - error (SC\d+): (.*)$/gm;
const sites = [];
let m;
while ((m = re.exec(log)) !== null) {
  sites.push({ file: m[1], line: +m[2], col: +m[3], code: m[4], message: m[5] });
}
const norm = (f) => f.split("\\").join("/");
const owner = (f) => {
  const s = norm(f);
  let mm;
  if (/\/packages\/fake-server\/bench\//.test(s)) return "bench";
  if (/\/packages\/fake-server\/src\//.test(s)) return "fake-server/src";
  if ((mm = /\/provenance\/[0-9a-f]{40}\/packages\/(store-[a-z]+|wam|voip|media-utils)\//.exec(s))) return "@zapo-js/" + mm[1];
  if (/\/provenance\/250f9af5[0-9a-f]*\//.test(s)) return "zapo-js(src)";
  if (/\/provenance\/0fb2c132[0-9a-f]*\//.test(s)) return "npm:mongodb(src)";
  if (/\/provenance\/9cd2e68c[0-9a-f]*\//.test(s)) return "npm:bson(src)";
  if ((mm = /node_modules\/((?:@[^/]+\/)?[^/]+)/.exec(s))) return "npm:" + mm[1];
  return "other";
};
const seen = new Set();
const uniq = [];
for (const s of sites) {
  const k = norm(s.file) + ":" + s.line + ":" + s.code + ":" + s.message;
  if (seen.has(k)) continue;
  seen.add(k);
  uniq.push(s);
}
const byMsg = new Map();
for (const s of uniq) {
  const k = s.code + " :: " + s.message;
  let c = byMsg.get(k);
  if (!c) { c = { code: s.code, message: s.message, sites: [], owners: new Map() }; byMsg.set(k, c); }
  c.sites.push(norm(s.file).split("/").slice(-2).join("/") + ":" + s.line);
  c.owners.set(owner(s.file), (c.owners.get(owner(s.file)) ?? 0) + 1);
}
const list = [...byMsg.values()].sort((a, b) => b.sites.length - a.sites.length || a.message.localeCompare(b.message));
console.log("RAW diagnostics: " + sites.length + "   UNIQUE sites: " + uniq.length + "   DISTINCT messages: " + list.length);
console.log("\n=== by owner (unique sites) ===");
const ow = new Map();
for (const s of uniq) ow.set(owner(s.file), (ow.get(owner(s.file)) ?? 0) + 1);
for (const [k, v] of [...ow].sort((a, b) => b[1] - a[1])) console.log("  " + String(v).padStart(4) + "  " + k);
console.log("\n=== distinct messages, ranked ===");
list.forEach((c, i) => {
  const tops = [...c.owners].sort((a, b) => b[1] - a[1]).map(([k, v]) => k + " " + v).join(", ");
  console.log(String(i + 1).padStart(3) + ". [" + c.code + "] x" + c.sites.length + "  {" + tops + "}");
  console.log("     " + c.message);
  console.log("     sites: " + c.sites.slice(0, 4).join(" | ") + (c.sites.length > 4 ? " | +" + (c.sites.length - 4) : ""));
});
