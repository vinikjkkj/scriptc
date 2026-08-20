// 5823's other interning order, which is a different program and not a
// different assertion: the real fs.Dirent is mapped FIRST here, and the
// user's structural twin comes after. On base (before the reserved-key
// change) this order made the user's own `%dtype` VANISH from their own
// JSON.stringify; the rendering is the same cell one layer up, and this
// pins that the twin still prints as the plain object it is after a real
// Dirent has claimed the field list.
//
// A decoder twin rides along for the same reason: `{ encoding, "%pending" }`
// is StringDecoder's field list exactly, and it must keep both keys and
// print with no constructor name.
import * as fs from "node:fs";
import { StringDecoder } from "node:string_decoder";
import * as util from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = fs.mkdtempSync(join(tmpdir(), "scr-if-"));
fs.writeFileSync(join(dir, "a.txt"), "x");
const d = fs.readdirSync(dir, { withFileTypes: true })[0];
const esc = dir.split("\\").join("\\\\");
console.log(util.inspect(d).split(esc).join("<D>"));

const real = new StringDecoder("utf8");
console.log(String(util.inspect(real).startsWith("StringDecoder {")));

// ...and only NOW the twins
const twin = { name: "z", parentPath: "p", "%dtype": 2 };
console.log(util.inspect(twin));
console.log(JSON.stringify(twin));
console.log(JSON.stringify(Object.keys(twin)));

const decTwin = { encoding: "utf8", "%pending": 0 };
console.log(util.inspect(decTwin));
console.log(JSON.stringify(decTwin));
console.log(JSON.stringify(Object.keys(decTwin)));

// a plain record with no relation to either still prints plain, on both
// surfaces
const plain = { a: 1, b: "x" };
console.log(util.inspect(plain));
const pu: unknown = plain;
console.log(util.inspect(pu));

fs.rmSync(dir, { recursive: true, force: true });
