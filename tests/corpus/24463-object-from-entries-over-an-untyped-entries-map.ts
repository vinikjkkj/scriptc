// Object.fromEntries(Object.entries(o).map(...)) over an untyped receiver: the map is the dyn tree's own, so the argument reached the
// helper as a dyn (an internal compiler error). It crosses the checked exit like any typed consumer: string rows build the record.
const d = JSON.parse('{"a":"x","b":"two","c":"3"}') as Record<string, unknown>;
const o: object = d;
const o2 = Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v]));
console.log(JSON.stringify(o2), Object.keys(o2).join(","));
const o3 = Object.fromEntries(Object.entries(o).map(([k, v]) => [k.toUpperCase(), String(v) + "!"]));
console.log(JSON.stringify(o3));
const o4 = Object.fromEntries(Object.entries(o).filter(([k]) => k !== "b").map(([k, v]) => [k, String(v)]));
console.log(JSON.stringify(o4));
