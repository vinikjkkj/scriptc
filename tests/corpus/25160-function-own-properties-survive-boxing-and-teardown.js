// Own properties written on a FUNCTION value live in the closure's lazy ext block. One function object, many boxes: every boundary
// crossing sees the same table, a closure that never gets a property pays nothing, and teardown (refcount path, collector path) frees the
// block exactly once. Function declarations are NESTED in a factory, the shape the route is gated on.
"use strict";

function mk(i) {
  const k = i * 2;
  function f() { return k + i; }
  if (i % 3 === 0) {
    f.id = i;
    f.label = "f" + i;
    Object.defineProperty(f, "secret", { value: i * 10, writable: true, enumerable: true });
  }
  return f;
}
let sum = 0;
for (let r = 0; r < 200; r++) {
  const keep = [];
  for (let i = 0; i < 50; i++) keep.push(mk(i));
  for (let i = 0; i < 50; i++) {
    const f = keep[i];
    sum += f();
    if (i % 3 === 0) sum += f.id + f.secret + f.label.length;
    else if (f.id !== undefined) sum += 1000000;
  }
}
console.log("sum", sum);
console.log(mk(3).secret, mk(4).secret, mk(3).label, mk(4).label);

// the same closure seen through two array slots shares ONE table
function shared() { const c = 5; function g() { return c; } g.n = 1; return g; }
const g1 = shared();
const holder = [g1, g1];
holder[0].n = 7;
console.log(holder[1].n, g1.n);
console.log(shared().n, shared() === shared());

// a function that stores itself in its own table: a ring the collector must find and free
function ring(i) {
  function h() { return i; }
  h.self = h;
  h.peer = function () { return h; };
  return h.self === h && h.peer() === h;
}
let ok = 0;
for (let i = 0; i < 300; i++) if (ring(i)) ok++;
console.log("ring", ok);
const d = shared();
console.log(typeof d.missing, d.n);
