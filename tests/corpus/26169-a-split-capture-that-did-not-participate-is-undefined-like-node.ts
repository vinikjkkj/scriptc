// A regex split's captures that did not participate are undefined: typeof, ??, +, ===, .length, in callbacks, for-of, arguments and destructuring.
const s: string = "a1b" + (process.argv.length > 50 ? "q" : "");
const parts = s.split(/(\d)|(x)/);
console.log(parts, parts.length);
console.log(parts.map((x) => typeof x));
console.log(parts.map((x) => x ?? "d"), parts.map((x) => "p" + x), parts.map((x) => x === ""), parts.map((x) => x !== ""));
for (const x of parts) console.log(typeof x, x ?? "d", `[${x}]`, x === "");
const f = (x: string) => "p" + x + (x === "" ? "E" : "N");
console.log(parts.map(f), f(parts[2]), f(parts[1]));
const probe = (x: string): string => {
  try {
    return String(x.length);
  } catch (e) {
    return (e as Error).name + ": " + (e as Error).message;
  }
};
console.log(parts.map(probe));
try { console.log(parts[2].length); } catch (e) { console.log((e as Error).message); }
const [p0, p1, p2, p3] = parts;
console.log(typeof p2, p2 ?? "dd", "p" + p2, p2 === "", typeof p3, p3 ?? "dd");
let acc = "";
for (const x of parts) acc += x;
console.log(acc);
// controls: no capture groups, and groups that always participate, hold strings
console.log("a,b".split(/,/).map((x) => typeof x), "a1b".split(/(\d)/).map((x) => x ?? "d"), ",a".split(/,/).map((x) => x === ""));
