// A fs.Dirent that crosses into `unknown` must answer Node's OWN KEYS and
// nothing else. The row carries a third field the compiler needs — the
// libuv entry kind isFile/isDirectory read — which `declaredOrder` omits
// and which the STATIC surfaces already hid. The record-to-dyn converter
// appended it back as an ordinary member, so `entries` carried it, and
// `entries` IS Object.keys / getOwnPropertyNames / for-in / spread /
// Object.assign / Object.entries / JSON.stringify / structuredClone /
// util.inspect / `in` / the keyed read, all at once. Ten of the surfaces
// below answered with the internal key on base; the two `in`/keyed-read
// lines answered true and 1 where Node answers false and undefined.
//
// Node's own answer for the hidden cell is a SYMBOL (util.inspect prints
// `Symbol(type): 1`), which is exactly why no string key reaches it there
// — and why the fix is an out-of-band table rather than a filter.
//
// The scratch directory is mkdtempSync's (1541's rule: its name never
// reaches stdout), and it holds ONE entry so rows[0] is deterministic
// without a sort.
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = fs.mkdtempSync(join(tmpdir(), "scr-dl-"));
fs.writeFileSync(join(dir, "a.txt"), "x");
const rows = fs.readdirSync(dir, { withFileTypes: true });
const u: unknown = rows[0];
const o = u as Record<string, unknown>;

console.log(JSON.stringify(Object.keys(o)));
console.log(JSON.stringify(Object.getOwnPropertyNames(o)));
const forin: string[] = [];
for (const k in o) forin.push(k);
console.log(JSON.stringify(forin));
console.log(JSON.stringify(Object.keys({ ...o })));
console.log(JSON.stringify(Object.keys(Object.assign({}, o))));
console.log(JSON.stringify(Object.entries(o).map((e) => e[0])));
console.log(JSON.stringify(Object.keys(structuredClone(o))));
// JSON.stringify's own key set, without the scratch path in it (the
// path is JSON-escaped, so a plain replace over `dir` never matched).
console.log(JSON.stringify(Object.keys(JSON.parse(JSON.stringify(u)) as Record<string, unknown>)));
console.log(String("%dtype" in o));
console.log(JSON.stringify(o["%dtype"]));
console.log(JSON.stringify(new Map(Object.entries(o)).size));

fs.rmSync(dir, { recursive: true, force: true });
