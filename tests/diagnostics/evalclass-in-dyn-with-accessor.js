// An evaluated class with an accessor cannot state its prototype object exactly (the getter would have to run on the prototype),
// so its class value keeps the compile-time refusal into dyn.
function anyv(x) { return x; }
const mk = () => class G { get v() { return 1; } };
const h = {}; h.G = mk();
console.log(typeof anyv(h.G));
