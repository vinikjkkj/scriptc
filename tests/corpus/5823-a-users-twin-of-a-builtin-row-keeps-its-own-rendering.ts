// A user's own `{ name, parentPath, "%dtype" }` is STRUCTURALLY EQUAL to
// an fs.Dirent row, so before the reserved-key change the two shared one
// interned shape and whichever the program mapped FIRST decided, for
// both, whether `%dtype` was a key. The internal field SET joined the
// shape's identity to separate them.
//
// The builtin RENDERING is the second thing that would have leaked
// across that cell, and in the same two directions: a user literal must
// not print `Dirent { ... Symbol(type): 1 }`, and a real Dirent must not
// stop printing it because a twin was interned first. This file is the
// LITERAL-FIRST order; 5824 is the other one, because the order is a
// property of the program and one file can only have one.
//
// It also carries the twin that spells the SYMBOL description rather
// than the reserved field name (`type`), which is the newer of the two
// collisions: `type` is now a slot storage key, and a user object that
// merely spells it is still a plain object with an ordinary key.
import * as fs from "node:fs";
import * as util from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";

// the twins FIRST
const twinPct = { name: "z", parentPath: "p", "%dtype": 2 };
console.log(util.inspect(twinPct));
console.log(JSON.stringify(twinPct));
console.log(JSON.stringify(Object.keys(twinPct)));

const twinSym = { name: "z", parentPath: "p", type: 2 };
console.log(util.inspect(twinSym));
console.log(JSON.stringify(Object.keys(twinSym)));
const tu: unknown = twinSym;
console.log(String("type" in (tu as object)), JSON.stringify((tu as Record<string, unknown>)["type"]));

// ...and only NOW a real one
const dir = fs.mkdtempSync(join(tmpdir(), "scr-if-"));
fs.writeFileSync(join(dir, "a.txt"), "x");
const d = fs.readdirSync(dir, { withFileTypes: true })[0];
const esc = dir.split("\\").join("\\\\");
console.log(util.inspect(d).split(esc).join("<D>"));
console.log(JSON.stringify(Object.keys(d as unknown as Record<string, unknown>)));
console.log(d.name, d.isFile(), d.isDirectory());

fs.rmSync(dir, { recursive: true, force: true });
