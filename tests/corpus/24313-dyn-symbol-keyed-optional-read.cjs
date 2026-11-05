// recv?.[symbol] reads: a nullish receiver answers undefined, a present one its symbol-keyed property.
const k = Symbol("k");
function rd(o) { return o?.[k]; }
function rd2(o) { return o?.a[k]; }
const x = JSON.parse('{"a":{}}');
x.a[k] = 5;
console.log(rd(undefined), rd(null), rd(x.a), rd2(undefined), rd2(x));
