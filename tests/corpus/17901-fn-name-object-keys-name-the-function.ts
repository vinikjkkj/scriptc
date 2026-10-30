// A function value in an object literal takes the property's key as its
// name, whatever shape the key has: a quoted key, a numeric key, a computed
// key whose value is a constant string. An alias keeps the name it was
// created with, not the property it was read from.
function f1(): number { return 1; }
const k = "dyn";
const o: any = {
  h: f1,
  arrow: (): number => 2,
  [k]: (): number => 4,
  "quoted key": (): number => 5,
  42: (): number => 6,
  p: function (): number { return 7; },
};
console.log(o.h.name, o.arrow.name, o[k].name, o["quoted key"].name, o[42].name, o.p.name);
console.log(o.h, o.arrow, o[k]);
console.log(o);
const alias = { fromHolder: f1 };
console.log(alias.fromHolder.name, alias);
