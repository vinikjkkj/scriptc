// WHERE an accessor key lands among the data keys, and what `this` means in
// the bodies that keep it.
//
// Both halves of one key ride a single scr_dyn_obj_define_accessor call, so
// the pair is emitted at the position of the member that CREATES the key --
// the FIRST half, whichever half that is. Splitting the pair with a data
// member in between is the shape that shows it: JS creates the key when it
// first sees it and a later half redefines in place, so the key order below
// is the first half's, not the second's. Creating a closure evaluates
// nothing, so hoisting the later half to the earlier position is
// unobservable.
'use strict';
function take(o) { return o; }

// Getter first, then a data member, then the SETTER for the same key.
let v1 = 1;
const getFirst = take({ get b() { return v1; }, a: 10, set b(/** @type {number} */ n) { v1 = n + 100; } });
console.log(JSON.stringify(Object.keys(getFirst)));
console.log(String(getFirst.b));
getFirst.b = 5;
console.log(String(getFirst.b));
console.log(JSON.stringify(getFirst));

// Setter first, and a data member before it as well: the key is created at
// the SETTER, and the getter that arrives later redefines in place.
let v2 = 1;
const setFirst = take({ z: 0, set b(/** @type {number} */ n) { v2 = n + 100; }, a: 10, get b() { return v2; } });
console.log(JSON.stringify(Object.keys(setFirst)));
console.log(String(setFirst.b));
setFirst.b = 5;
console.log(String(setFirst.b));

// A getter returning the receiver itself: `this` is the object the property
// was read through, and it is the SAME object, not a copy.
const ident = take({ a: 1, get self() { return this; } });
console.log(String(ident.self === ident));
console.log(String(ident.self.a));

// The shape zapo's own createStore returns (dist/store/createStore.js): data
// members carried in from locals, then a run of GETTERS over shared closure
// state, read through every enumeration surface.
function createStore(id) {
  const caches = { retry: { n: 1 }, groupMetadata: { n: 2 }, contacts: { n: 3 } };
  return take({
    auth: { kind: 'auth', id },
    signal: { kind: 'signal', id },
    appState: { kind: 'appState', id },
    get retry() { return caches.retry; },
    get groupMetadata() { return caches.groupMetadata; },
    get contacts() { return caches.contacts; },
  });
}
const store = createStore('sess-1');
console.log(JSON.stringify(Object.keys(store)));
console.log(store.auth.kind + ' ' + store.appState.kind);
console.log(String(store.retry.n) + ' ' + String(store.groupMetadata.n) + ' ' + String(store.contacts.n));
console.log(String(Object.values(store).length));
console.log(JSON.stringify(store));
