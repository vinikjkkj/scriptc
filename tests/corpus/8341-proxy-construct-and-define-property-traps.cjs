function Point(x, y) { this.x = x; this.y = y; }
const P = new Proxy(Point, {
  construct(t, args, nt) { return { made: args.length, first: args[0] }; },
  apply(t, th, args) { return "called:" + args.join("+"); },
});
console.log(new P(1, 2, 3), P(4, 5));

const log = [];
const target = { a: 1 };
const p = new Proxy(target, {
  defineProperty(t, k, d) { log.push("define " + String(k) + ":" + d.value); return Reflect.defineProperty(t, k, d); },
});
Object.defineProperty(p, "b", { value: 2, enumerable: true, configurable: true, writable: true });
console.log(target.b, log.join(","), Reflect.defineProperty(p, "c", { value: 3, enumerable: true, configurable: true, writable: true }), target.c, log.length);
const deny = new Proxy({}, { defineProperty() { return false; }, set() { return false; }, deleteProperty() { return false; } });
console.log(Reflect.defineProperty(deny, "x", { value: 1 }), Reflect.set(deny, "y", 1), Reflect.deleteProperty(deny, "z"));
try { Object.defineProperty(deny, "x", { value: 1 }); } catch (e) { console.log(e.name, e.message); }
