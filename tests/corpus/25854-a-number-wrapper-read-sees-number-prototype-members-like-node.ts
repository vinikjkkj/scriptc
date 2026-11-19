// Object(n) is a Number wrapper: Number.prototype's names read as functions, String.prototype's do not.
const n: any = Object(3.14159);
const names = ["toString", "valueOf", "toLocaleString", "hasOwnProperty", "isPrototypeOf", "propertyIsEnumerable", "toFixed", "toPrecision",
  "toExponential", "toUpperCase", "trim", "charAt", "length", "0", "nope"];
const row: string[] = [];
for (const k of names) row.push(k + ":" + typeof n[k] + (k in n ? "+" : "-"));
console.log(row.join(" "));
console.log(typeof n.toFixed, typeof n.valueOf, typeof n.toString);
console.log(n.toFixed(2), n.toString(), n.valueOf() + 1, n.toString(2));
const z: any = Object(0);
console.log(typeof z.toFixed, z.toFixed(1), z.valueOf());
n.extra = "e";
console.log(typeof n.toFixed, n.extra, "extra" in n, Object.keys(n).join());
