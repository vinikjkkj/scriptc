// A class instance boxed into a dyn slot: its members are read by name through the class's member table (keyed lookup, method call,
// getter), including an inherited one and a static.
class Base { id = 1; base(): string { return 'base' + this.id; } }
class Derived extends Base { label = 'd'; get shout(): string { return this.label.toUpperCase(); } twice(n: number): number { return n * 2; } }
const d: unknown = new Derived();
const o = d as Record<string, unknown>;
console.log(o['id'], o['label'], o['shout']);
console.log(typeof o['twice'], (o['twice'] as (n: number) => number).call(d, 21));
console.log(typeof o['base']);
console.log(Object.keys(o).join(','));
const holder: Record<string, unknown> = { inst: d, n: 1 };
console.log(Object.keys(holder['inst'] as object).join(','));
