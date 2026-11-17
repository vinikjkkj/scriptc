// @ts-nocheck
"use strict";
// getOwnPropertyDescriptor over accessors: fresh objects, key order, flags, redefinition, delete.
function show(label, v) { console.log(label + ": " + JSON.stringify(v)); }
const o = {};
const g = function () { return "g:" + this.base; };
const s = function (v) { this.base = v; };
Object.defineProperty(o, "plain", { get: g });
Object.defineProperty(o, "both", { get: g, set: s, configurable: true });
Object.defineProperty(o, "shown", { get: g, enumerable: true, configurable: true });
o.base = "b0";
const d1 = /** @type {any} */ (Object.getOwnPropertyDescriptor(o, "plain"));
const d2 = /** @type {any} */ (Object.getOwnPropertyDescriptor(o, "plain"));
show("keys-plain", Object.keys(d1));
show("flags-plain", [d1.enumerable, d1.configurable, d1.set === undefined, typeof d1.get]);
show("fresh", d1 !== d2);
d1.get = undefined;
show("fresh-after-mutation", typeof /** @type {any} */ (Object.getOwnPropertyDescriptor(o, "plain")).get);
const db = /** @type {any} */ (Object.getOwnPropertyDescriptor(o, "both"));
show("keys-both", Object.keys(db));
show("flags-both", [db.enumerable, db.configurable, typeof db.get, typeof db.set]);
const ds = /** @type {any} */ (Object.getOwnPropertyDescriptor(o, "shown"));
show("flags-shown", [ds.enumerable, ds.configurable]);
show("same-getter", db.get === g);
o.both = "set-through";
show("read-after-set", [o.both, o.base]);
// redefinition of a configurable accessor keeps working, a non-configurable one refuses
Object.defineProperty(o, "both", { get: function () { return "again:" + this.base; } });
show("redefined", [o.both, Object.keys(/** @type {any} */ (Object.getOwnPropertyDescriptor(o, "both")))]);
let refused = "no";
try { Object.defineProperty(o, "plain", { get: function () { return 0; } }); } catch (e) { refused = e.name; }
show("sealed-redefine", refused);
let dres = "no-throw";
try { delete o.plain; } catch (e) { dres = e.name; }
show("delete-sealed", dres);
show("still-there", o.plain);
show("delete-configurable", delete o.shown);
show("gone", [String(o.shown), /** @type {any} */ (Object.getOwnPropertyDescriptor(o, "shown")) === undefined]);
