// A JAVASCRIPT `new WeakMap()` / `new WeakSet()` has no weak container in
// the value model, but the CONSTRUCTION is not the fence: the value lowers
// as an opaque dyn object, so identity, truthiness and `typeof` are real
// and only a REACHED method call meets one. The escape that says so used to
// sit below the `Map || WeakMap` branch, which claims the symbol and never
// falls out of itself — so for WeakMap it was unreachable and this file
// refused to compile with `SC1090: Map keys of type 'WeakKey'`.
'use strict';

const wm = new WeakMap();
const ws = new WeakSet();
console.log('A', wm !== null, ws !== null);
console.log('B', typeof wm, typeof ws);

// Reference identity: an alias is the same value, a second construction is
// not, and the two flavors are not each other.
const alias = wm;
console.log('C', alias === wm, wm === new WeakMap(), wm === ws);

// Every object is truthy.
console.log('D', wm ? 1 : 0, ws ? 1 : 0);

// The shape the escape was written for: a module-level cache constructed
// unconditionally, whose methods sit on a path this program never takes.
// No deferred fence is needed for it — a method call on a dyn value is a
// runtime dispatch, so the statement COMPILES and answers at run time; the
// program stays 100% static (coverage.test.ts's corpus sweep).
const caches = { byNode: new WeakMap() };
function scale(n) {
  if (globalThis['__scriptc_absent__'] !== undefined) {
    return caches.byNode.get(n); // untaken: dynamic-global probes answer undefined
  }
  return n * 2;
}
console.log('E', scale(21), caches.byNode === caches.byNode);
