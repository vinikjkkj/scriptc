// A keyed write whose key is a string literal stores the literal by pointer instead of copying its bytes; Object.assign, spread and structuredClone of an object
// whose keys are stored that way copy the pointer. Everything observable must stay what Node answers: key order, overwrite, delete and re-add (a deleted key
// re-added goes to the end), the empty key, keys equal to a literal but built at run time (still copied), JSON.parse keys, symbol-free enumeration, JSON.stringify,
// and the source and the copies staying independent after one of them changes or loses a key.
function setk(o, k, v) { o[k] = v; }
function getk(o, k) { return o[k]; }
function mk() { return JSON.parse("{}"); }
const a = mk();
setk(a, "type", "bool"); setk(a, "defaultValue", false); setk(a, "code", 7); setk(a, "", "empty"); setk(a, "type", "int");
console.log(JSON.stringify(a), Object.keys(a).join("|"));
const built = "ty" + "pe";
const b = mk();
setk(b, built, 1); setk(b, "defaultValue", 2); setk(b, "de" + "faultValue", 3);
console.log(JSON.stringify(b), Object.keys(b).join("|"), getk(b, "type"), getk(b, built));
const parsed = JSON.parse('{"type":"x","defaultValue":1,"code":2}');
console.log(JSON.stringify(parsed), getk(parsed, "code"));
// copies of an object with literal-stored keys
const sp = { ...a, extra: 1 };
const as = Object.assign({}, a);
const as2 = Object.assign(mk(), parsed, a);
const sc = structuredClone(a);
console.log(JSON.stringify(sp), JSON.stringify(as), JSON.stringify(as2), JSON.stringify(sc));
// the source and the copies are independent
setk(a, "code", 8);
delete a.type;
setk(a, "added", true);
setk(sp, "type", "changed");
console.log(JSON.stringify(a), JSON.stringify(sp), JSON.stringify(as), JSON.stringify(sc), Object.keys(a).join("|"));
// delete a literal-keyed member and re-add it: it moves to the end
const c = mk();
setk(c, "x", 1); setk(c, "y", 2); setk(c, "z", 3);
delete c.x;
setk(c, "x", 4);
console.log(JSON.stringify(c), Object.keys(c).join("|"));
// many objects sharing the same literal keys, each then edited
const many = [];
for (let i = 0; i < 300; i++) { const o = mk(); setk(o, "type", i); setk(o, "defaultValue", i % 2 === 0); setk(o, "code", i * 2); many.push(o); }
for (const o of many) { setk(o, "code", 1); delete o.defaultValue; }
let tsum = 0, ksum = 0;
for (const o of many) { tsum += o.type; ksum += Object.keys(o).length; }
console.log(tsum, ksum, JSON.stringify(many[299]), JSON.stringify(many[0]));
// a key read back through for-in and Object.entries
const ent = [];
for (const k in a) ent.push(k + "=" + a[k]);
console.log(ent.join(","), JSON.stringify(Object.entries(sc)));
