// The NECESSITY control, and it passes on both sides on purpose. It is
// not evidence for the rendering change; it is what stops the NEXT
// change to this encoding from buying a prettier util.inspect with a
// silently wrong isFile(), or with a slot that has quietly become a key
// because it acquired a name a program can spell.
//
// The rendering moved every internal slot's STORAGE KEY: fs.Dirent's
// cell now lives under `type` (Node's Symbol description) rather than
// under `%dtype`, because the runtime renders the key it finds and knows
// no shapes. Two things had to stay true across that move and both are
// asserted here — the converter and the dyn-to-record check must agree
// about the new key (or a round trip loses its state), and the slot
// table must remain outside every property protocol (or the description
// becomes a forgeable key, which is the misread the reserved-key change
// closed from the other side).
import * as fs from "node:fs";
import { StringDecoder } from "node:string_decoder";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = fs.mkdtempSync(join(tmpdir(), "scr-if-"));
fs.writeFileSync(join(dir, "a.txt"), "x");
fs.mkdirSync(join(dir, "sub"));
const rows = fs.readdirSync(dir, { withFileTypes: true });
const file = rows[0].name === "a.txt" ? rows[0] : rows[1];
const sub = rows[0].name === "a.txt" ? rows[1] : rows[0];

// the round trip keeps the entry kind, both directions, both rows
const uf: unknown = file;
const us: unknown = sub;
const bf = uf as fs.Dirent;
const bs = us as fs.Dirent;
console.log(bf.name, bf.isFile(), bf.isDirectory(), bf.isSymbolicLink());
console.log(bs.name, bs.isFile(), bs.isDirectory(), bs.isSymbolicLink());

// ...and a SECOND crossing does not lose it either
const again = (bf as unknown) as fs.Dirent;
console.log(again.name, again.isFile());

// the description is not a key on any surface
const o = uf as Record<string, unknown>;
console.log(JSON.stringify(Object.keys(o)));
console.log(JSON.stringify(Object.getOwnPropertyNames(o)));
const forin: string[] = [];
for (const k in o) forin.push(k);
console.log(JSON.stringify(forin));
console.log(JSON.stringify(Object.keys({ ...o })));
console.log(JSON.stringify(Object.entries(o).map((e) => e[0])));
console.log(JSON.stringify(Object.keys(structuredClone(o))));
console.log(String("type" in o), String("%dtype" in o));
console.log(JSON.stringify(o["type"]), JSON.stringify(o["%dtype"]));

// a FABRICATED row is still refused rather than believed, under the new
// spelling as well as the old one
let caught = 0;
try {
  const p = JSON.parse('{"name":"z","parentPath":"p","type":2}') as fs.Dirent;
  console.log("built", p.name, p.isDirectory());
} catch {
  caught++;
}
try {
  const q = JSON.parse('{"name":"z","parentPath":"p","%dtype":2}') as fs.Dirent;
  console.log("built", q.name, q.isDirectory());
} catch {
  caught++;
}
console.log("caught", caught);

// the decoder's packed cell survives its crossing too (its slot key did
// NOT move — the shape names no symbol for it)
const dec = new StringDecoder("utf8");
console.log(JSON.stringify(dec.write(Buffer.from([0xe2, 0x82]))));
const du: unknown = dec;
const dback = du as StringDecoder;
console.log(JSON.stringify(dback.write(Buffer.from([0xac]))), dback.encoding);

fs.rmSync(dir, { recursive: true, force: true });
