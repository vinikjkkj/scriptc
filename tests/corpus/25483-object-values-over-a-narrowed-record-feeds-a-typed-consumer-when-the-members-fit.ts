// A narrowed record whose hidden members are all strings: the typed consumer over the answer works as in Node.
interface Wide { id: string; a: string; b: string }
interface Narrow { readonly id: string }
function narrow(w: Wide): Narrow { const n: Narrow = w; return n; }
const r = narrow({ id: "i", a: "x", b: "yy" });
const vals = Object.values(r);
console.log(vals.length, vals.join("|"));
const es = Object.entries(r);
console.log(es.map(([k, v]) => k + "=" + v).join(","));
