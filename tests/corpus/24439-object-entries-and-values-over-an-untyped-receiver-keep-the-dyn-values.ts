// The checker types Object.entries / Object.values over an `object` receiver as [string, never][] / never[] (no value type to infer), but
// the values are whatever the receiver holds: numbers, strings, booleans, null, undefined, nested objects.
const d = JSON.parse('{"a":1,"b":"two","c":true,"n":null,"o":{"k":[1,2]}}') as Record<string, unknown>;
d.u = undefined;
const o: object = d;

const es = Object.entries(o);
console.log(es.length);
console.log(es.map(([k, v]) => k + "=" + String(v)).join(";"));
console.log(Object.values(o).map((v) => String(v)).join(","));
for (const [k, v] of Object.entries(o)) console.log(k, typeof v);
Object.entries(o).forEach(([k, v]) => console.log(k, v === undefined, v === null));
console.log(Object.entries(o).filter(([, v]) => typeof v === "string").map(([k]) => k).join(","));

// an array receiver and a nested object
const arr: object = ["x", 2, false];
console.log(Object.entries(arr).map(([k, v]) => k + ":" + String(v)).join(","));
console.log(Object.values(arr).length);
const nested = (d as { o: object }).o;
console.log(Object.entries(nested).map(([k, v]) => k + "=" + JSON.stringify(v)).join(";"));

// an empty receiver
const none: object = JSON.parse("{}");
console.log(Object.entries(none).length, Object.values(none).length);
