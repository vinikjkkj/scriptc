// Object.freeze / seal / preventExtensions over checked-dynamic objects: the integrity level is a runtime fact of the dyn object, enforced on every write path.
// The first half runs sloppy (refused writes are ignored), the second half the same program strict (V8's TypeErrors).
function sloppyRun() {
  function mk(): any { return JSON.parse('{"a":1,"b":{"c":2}}'); }
  const o = mk();
  console.log(Object.isFrozen(o), Object.isSealed(o), Object.isExtensible(o));
  Object.freeze(o);
  console.log(Object.isFrozen(o), Object.isSealed(o), Object.isExtensible(o));
  const w = (f: () => void) => { try { f(); console.log("no throw"); } catch (e) { console.log((e as Error).message); } };
  w(() => { o.a = 2; });
  w(() => { o.z = 1; });
  w(() => { delete o.a; });
  w(() => { o.b.c = 5; });
  console.log(o);
  const p = mk(); Object.seal(p);
  console.log(Object.isFrozen(p), Object.isSealed(p), Object.isExtensible(p));
  w(() => { p.a = 5; });
  w(() => { p.z = 1; });
  w(() => { delete p.a; });
  w(() => { delete p.nope; });
  console.log(p);
  const q = mk(); Object.preventExtensions(q);
  console.log(Object.isFrozen(q), Object.isSealed(q), Object.isExtensible(q));
  w(() => { q.z = 1; });
  w(() => { q.a = 9; });
  w(() => { delete q.a; });
  console.log(q);
  const e: any = JSON.parse('{}'); Object.preventExtensions(e);
  console.log(Object.isFrozen(e), Object.isSealed(e), Object.isExtensible(e));
  w(() => { Object.assign(o, { a: 7 }); });
  w(() => { Object.assign(q, { b: 7 }); });
  w(() => { Object.assign(q, { zz: 7 }); });
  w(() => { Object.defineProperty(o, "n", { value: 1 }); });
  w(() => { Object.defineProperty(p, "n", { value: 1 }); });
  console.log({ ...o }, Object.keys(o), JSON.stringify(o), Object.entries(p));
  const cp: any = Object.assign({}, o); cp.a = 99; console.log(cp.a, Object.isFrozen(cp));
  const prim: any = 5; console.log(`${Object.freeze(prim)}`, Object.isFrozen(prim));
  const arr: any = JSON.parse("[1,2]"); Object.freeze(arr); console.log(Object.isFrozen(arr)); w(() => { arr.push(3); });

}
sloppyRun();
console.log("--- strict");
function strictRun() {
  "use strict";
  function mk(): any { return JSON.parse('{"a":1,"b":{"c":2}}'); }
  const o = mk();
  console.log(Object.isFrozen(o), Object.isSealed(o), Object.isExtensible(o));
  Object.freeze(o);
  console.log(Object.isFrozen(o), Object.isSealed(o), Object.isExtensible(o));
  const w = (f: () => void) => { try { f(); console.log("no throw"); } catch (e) { console.log((e as Error).message); } };
  w(() => { o.a = 2; });
  w(() => { o.z = 1; });
  w(() => { delete o.a; });
  w(() => { o.b.c = 5; });
  console.log(o);
  const p = mk(); Object.seal(p);
  console.log(Object.isFrozen(p), Object.isSealed(p), Object.isExtensible(p));
  w(() => { p.a = 5; });
  w(() => { p.z = 1; });
  w(() => { delete p.a; });
  w(() => { delete p.nope; });
  console.log(p);
  const q = mk(); Object.preventExtensions(q);
  console.log(Object.isFrozen(q), Object.isSealed(q), Object.isExtensible(q));
  w(() => { q.z = 1; });
  w(() => { q.a = 9; });
  w(() => { delete q.a; });
  console.log(q);
  const e: any = JSON.parse('{}'); Object.preventExtensions(e);
  console.log(Object.isFrozen(e), Object.isSealed(e), Object.isExtensible(e));
  w(() => { Object.assign(o, { a: 7 }); });
  w(() => { Object.assign(q, { b: 7 }); });
  w(() => { Object.assign(q, { zz: 7 }); });
  w(() => { Object.defineProperty(o, "n", { value: 1 }); });
  w(() => { Object.defineProperty(p, "n", { value: 1 }); });
  console.log({ ...o }, Object.keys(o), JSON.stringify(o), Object.entries(p));
  const cp: any = Object.assign({}, o); cp.a = 99; console.log(cp.a, Object.isFrozen(cp));
  const prim: any = 5; console.log(`${Object.freeze(prim)}`, Object.isFrozen(prim));
  const arr: any = JSON.parse("[1,2]"); Object.freeze(arr); console.log(Object.isFrozen(arr)); w(() => { arr.push(3); });

}
strictRun();
