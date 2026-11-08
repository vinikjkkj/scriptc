// A class that grafted EventEmitter onto itself (EventEmitter.call(this) + applyMixin): its own symbol keys print with the symbol style and a boolean value.
import { EventEmitter } from "events";
import util from "node:util";
function applyMixin(d, m) {
  Object.getOwnPropertyNames(m.prototype).forEach((name) => { Object.defineProperty(d.prototype, name, Object.getOwnPropertyDescriptor(m.prototype, name)); });
}
class Base { constructor() { this.tag = "base"; } }
class R extends Base { constructor() { super(); EventEmitter.call(this); this.n = 2; } }
applyMixin(R, EventEmitter);
const r = new R();
const show = (v, o) => util.inspect(v, o);
const on = JSON.parse('{"colors":true}');
const off = JSON.parse('{"colors":false}');
console.log(show(r, off));
console.log(show(r, on));
console.log(show({ nested: r, k: 1 }, on));
console.log(show({ nested: r }, JSON.parse('{"colors":true,"depth":0}')));
