const m = new Map<string | number, number>([["a", 1], [1, 2], ["1", 3], [NaN, 4]]);
console.log([...m].map(([k, v]) => typeof k + ":" + String(k) + "=" + v).join(" "));
console.log([...m.entries()].length, [...m.keys()].length, [...m.values()].join(","));
const s = new Map<string, number>([["x", 9]]);
console.log([...s].map(([k, v]) => k + v).join(" "));
