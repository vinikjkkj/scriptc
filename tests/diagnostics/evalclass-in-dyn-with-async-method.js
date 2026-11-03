// An evaluated class with an async method cannot state its prototype object exactly (the method has no dyn member row), so its
// class value keeps the compile-time refusal into dyn.
function anyv(x) { return x; }
const mk = () => class G { async load() { return 1; } sync() { return 2; } };
const h = {}; h.G = mk();
const G = anyv(h.G);
console.log(Object.getOwnPropertyNames(G.prototype), typeof G.prototype.load);
