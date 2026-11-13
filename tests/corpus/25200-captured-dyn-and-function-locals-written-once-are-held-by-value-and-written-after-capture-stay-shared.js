// A captured local written once by its declaration is held by value; one written after a closure captured it stays a shared cell.
// Every shape below is checked against Node and, in the san lanes, against the RC audit (a by-value slot that is released twice or never shows there).

// capture-before-assign: the closure is created while the local is still uninitialized, then it is assigned -> must see the new value
function beforeAssign() {
  let late;
  const get = () => late;
  late = { tag: "set-after" };
  return get().tag;
}

// assign-after-capture: a counter written through the closure -> shared cell, both sides see every write
function sharedCounter() {
  let c = { n: 0 };
  const inc = () => { c = { n: c.n + 1 }; return c.n; };
  const peek = () => c.n;
  inc(); inc();
  return [peek(), c.n, inc()];
}

// written once, captured by several closures, one of them forwarded through an intermediate closure
function byValue(a, b) {
  const k = { n: a.length };
  const helper = (x) => x + 1;
  const mid = () => () => helper(k.n) + b.length;
  return [() => k.n, mid(), helper];
}

// per-iteration bindings: each iteration's closure keeps ITS iteration's value
function perIteration() {
  const fs = [];
  for (let i = 0; i < 4; i++) {
    const o = { v: i * 10 };
    const f = () => o.v + i;
    fs.push(f);
  }
  const gs = [];
  for (const item of [{ x: 1 }, { x: 2 }, { x: 3 }]) gs.push(() => item.x * 2);
  return fs.map((f) => f()).concat(gs.map((g) => g()));
}

// a declaration inside a loop body, the closure created in an inner block of the same iteration
function loopInner() {
  const out = [];
  let n = 0;
  while (n < 3) {
    const d = { id: n };
    if (n % 2 === 0) { out.push(() => "even" + d.id); } else { out.push(() => "odd" + d.id); }
    n++;
  }
  return out.map((f) => f());
}

// parameters: one never written (by value), one reassigned before capture (stays shared), one reassigned after
function params(p, q, r) {
  q = { z: q.z + 1 };
  const f = () => p.z + q.z + r.z;
  r = { z: 100 };
  return f();
}

// closures stored in objects and released in different orders; a ring through a by-value capture is collected
function rings() {
  let made = 0;
  for (let i = 0; i < 200; i++) {
    const holder = { id: i };
    const fn = () => holder.id;
    holder.fn = fn;                 // holder -> fn -> holder (by-value cap): a cycle
    made += holder.fn();
  }
  return made;
}

// async functions and promise executors capturing by value, across awaits
async function asyncCaptures(tag) {
  const cfg = { tag };
  const done = (v) => cfg.tag + ":" + v;
  const results = [];
  for (let i = 0; i < 3; i++) {
    const item = { i };
    results.push(await new Promise((resolve) => setTimeout(() => resolve(done(item.i)), 1)));
  }
  return results.join(",");
}

// the same function value captured by closures that outlive the declaring function
function escapes() {
  const shared = { hits: 0 };
  const bump = () => ++shared.hits;
  const a = () => bump();
  const b = () => bump() + shared.hits;
  return [a, b];
}

console.log(beforeAssign());
console.log(JSON.stringify(sharedCounter()));
const [g1, g2, g3] = byValue("abc", "de");
console.log(g1(), g2(), g3(41));
console.log(JSON.stringify(perIteration()));
console.log(JSON.stringify(loopInner()));
console.log(params({ z: 1 }, { z: 5 }, { z: 7 }));
console.log(rings());
const [ea, eb] = escapes();
console.log(ea(), eb(), ea());
asyncCaptures("T").then((s) => console.log(s));
