// util.inspect of an fs.Dirent is `Dirent { name: 'a.txt', parentPath:
// '<dir>', Symbol(type): 1 }` in Node v25.9.0 — a CONSTRUCTOR prefix and
// a SYMBOL line, neither of which a converted record carried. On base
// both surfaces printed `{ name: 'a.txt', parentPath: '<dir>' }`: the
// dyn encoding of a record left `cname` NULL, and the internal slot the
// reserved-key change moved out of `entries` had nowhere to be shown.
//
// Both halves already existed one layer down. `ScrDyn.v.obj.cname` is
// the field `new F()` fills and scr_insp_dyn already prints as the
// `F { ... }` prefix; the slot table is where the internal field already
// lives. What was missing was the shape SAYING which name and which
// symbol description (IrRecordShape.builtin).
//
// The value reaches TWO renderers and this pins both: `console.log(d)`
// over the static record type goes through the per-shape helper
// (lower-inspect.ts), and `console.log(d as unknown)` goes through the
// dyn walk (scr_inspect.c). One object with two spellings inside one
// process is exactly what a fix to only one of them would have shipped.
//
// The scratch directory is mkdtempSync's (1541's rule: its name never
// reaches stdout), so the rendering is compared with the path replaced
// by a constant — escaped the way inspect escapes it, backslashes
// doubled, or the replace never matches on Windows.
import * as fs from "node:fs";
import * as util from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = fs.mkdtempSync(join(tmpdir(), "scr-if-"));
fs.writeFileSync(join(dir, "a.txt"), "x");
const rows = fs.readdirSync(dir, { withFileTypes: true });
const d = rows[0];
const esc = dir.split("\\").join("\\\\");
const hide = (s: string): string => s.split(esc).join("<D>");

// the static surface (the per-shape helper)
console.log(hide(util.inspect(d)));
console.log(hide(util.inspect([d])));
console.log(hide(util.inspect({ w: d })));
// past the depth budget Node says [Dirent] where a plain object says
// [Object] — the placeholder carries the constructor name too
console.log(hide(util.inspect({ a: { b: { c: d } } })));

// the dyn surface (the same value through `unknown`)
const u: unknown = d;
console.log(hide(util.inspect(u)));
console.log(hide(util.inspect([u])));
console.log(hide(util.inspect({ w: u })));

// ...and the two spellings are one spelling
console.log(String(hide(util.inspect(d)) === hide(util.inspect(u))));

// the symbol line is a RENDERING, not a key: every key surface still
// answers Node's two own keys, and the cell is not readable by its
// description either.
const o = u as Record<string, unknown>;
console.log(JSON.stringify(Object.keys(o)));
console.log(String("type" in o), JSON.stringify(o["type"]));
console.log(String("%dtype" in o), JSON.stringify(o["%dtype"]));

fs.rmSync(dir, { recursive: true, force: true });
