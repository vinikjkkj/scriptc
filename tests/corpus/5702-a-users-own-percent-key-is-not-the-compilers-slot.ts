// The control that says a SPELLING filter would be wrong, and the control
// that says the internal set has to be part of a shape's IDENTITY.
//
// `%` is a legal first character of a JavaScript property name. A user's
// own `{ "%dtype": 7, name: "n" }` is an ordinary object with an ordinary
// key on every surface, and "skip fields whose name starts with %" would
// break it to fix fs.Dirent. `declaredOrder` is the distinction that
// exists — per SHAPE, not per spelling.
//
// The second half is the one that bites. `declaredOrder` is first-seen
// metadata, not identity, so a user object STRUCTURALLY EQUAL to a Dirent
// row shared its shape and inherited whichever order was interned first.
// On base, with the Dirent mapped first, the user's own "%dtype" vanished
// from JSON.stringify of their own literal; with the literal first, a REAL
// Dirent listed "%dtype" from Object.keys. Two silently wrong programs in
// opposite directions, from one shared cell. The internal field SET is now
// part of the interned key, so the two shapes are two shapes.
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const a = { "%dtype": 7, name: "n" };
const ua: unknown = a;
console.log(JSON.stringify(Object.keys(a)) + " " + JSON.stringify(a));
console.log(JSON.stringify(Object.keys(ua as Record<string, unknown>)) + " " + JSON.stringify(ua));

const b = { "%enc": "utf8", "%pending": 3, z: 1 };
const ub: unknown = b;
console.log(JSON.stringify(Object.keys(ub as Record<string, unknown>)) + " " + JSON.stringify(ub));

const c = { "%x": 1, y: 2 };
const uc: unknown = c;
console.log(JSON.stringify(Object.keys(uc as Record<string, unknown>)) + " " + JSON.stringify(uc));

// Structurally a Dirent row, and mapped BEFORE the real one.
const twin = { name: "z", parentPath: "p", "%dtype": 2 };
const utwin: unknown = twin;
console.log(JSON.stringify(Object.keys(twin)) + " " + JSON.stringify(twin));
console.log(JSON.stringify(Object.keys(utwin as Record<string, unknown>)) + " " + JSON.stringify(utwin));

const dir = fs.mkdtempSync(join(tmpdir(), "scr-dl-"));
fs.writeFileSync(join(dir, "a.txt"), "x");
const rows = fs.readdirSync(dir, { withFileTypes: true });
const real: unknown = rows[0];
console.log(JSON.stringify(Object.keys(rows[0]!)));
console.log(JSON.stringify(Object.keys(real as Record<string, unknown>)));
fs.rmSync(dir, { recursive: true, force: true });
