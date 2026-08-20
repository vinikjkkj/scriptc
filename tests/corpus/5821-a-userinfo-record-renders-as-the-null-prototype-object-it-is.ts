// node_os.cc builds os.userInfo()'s result with Object.create(null), so
// Node renders it `[Object: null prototype] { uid: ..., ... }` and
// assert.deepStrictEqual against a structurally identical plain literal
// FAILS on the prototype. On base the record printed as a plain object
// and compared EQUAL to the literal — a silently passing assertion,
// which is the worse of the two wrong answers.
//
// `ScrDyn.null_proto` already existed (it is Object.create(null)'s flag)
// and deepStrictEqual's prototype gate already read it; the record
// converter simply never raised it, and the per-shape inspect helper had
// no way to know. IrRecordShape.builtin.nullProto is that way.
//
// uid/gid/username/homedir/shell are machine-dependent, so nothing here
// prints a VALUE: the rendering is reduced to its prefix and the key
// list, and the comparison prints only whether it threw.
import * as assert from "node:assert";
import * as os from "node:os";
import * as util from "node:util";

const ui = os.userInfo();

// the static surface
const s = util.inspect(ui);
console.log(String(s.startsWith("[Object: null prototype] {")));
// the dyn surface, the same value through `unknown`
const u: unknown = ui;
const t = util.inspect(u);
console.log(String(t.startsWith("[Object: null prototype] {")));
console.log(String(s === t));

// past the depth budget the marker IS the placeholder (where a plain
// object says [Object])
console.log(util.inspect({ a: { b: { c: ui } } }));

// the keys are unchanged — a prototype is not a key
console.log(JSON.stringify(Object.keys(ui)));
console.log(JSON.stringify(Object.keys(u as Record<string, unknown>)));

// ...and the prototype gate answers
const plain: unknown = {
  uid: ui.uid,
  gid: ui.gid,
  username: ui.username,
  homedir: ui.homedir,
  shell: ui.shell,
};
let threw = false;
try {
  assert.deepStrictEqual(u, plain);
} catch {
  threw = true;
}
console.log("prototype gate", threw);

// A plain literal is still a plain literal: the flag rides the SHAPE,
// and this one is a different shape.
console.log(util.inspect({ uid: 1, gid: 2 }));
