// A string-typed binding that holds an absent capture (a match/exec/matchAll group that did not participate) is undefined: typeof, ??, +, ===, .length.
const s: string = "Wx" + (process.argv.length > 50 ? "q" : "");
const m = s.match(/(W)(y)?/)!;
console.log(m.map((x) => typeof x));
for (const x of m) console.log(x === m[2] ? (x ?? "d") : x);
const f = (x: string) => "p" + x;
console.log(f(m[2]), f(m[1]));
console.log(m.map((x) => x === ""), m.map((x) => x !== ""), m.map((x) => x === "W"));
console.log(m.map((x) => (x ?? "dflt")), m.map((x) => x || "falsy"));
console.log(m.map((x) => `[${x}]`), m.map((x) => x + "!"), m.map((x) => "<" + x + ">" + x));
const probe = (x: string, tag: string): string => {
  try {
    return tag + ":" + x.length;
  } catch (e) {
    return tag + ":" + (e as Error).name + ": " + (e as Error).message;
  }
};
console.log(probe(m[1], "len1"), probe(m[2], "len2"));
try { console.log(m[2].length); } catch (e) { console.log((e as Error).name + ": " + (e as Error).message); }
try { console.log(m[2].trim()); } catch (e) { console.log((e as Error).name + ": " + (e as Error).message); }
const probeM = (x: string, tag: string): string => {
  try {
    return tag + ":" + x.trim().toUpperCase();
  } catch (e) {
    return tag + ":" + (e as Error).name + ": " + (e as Error).message;
  }
};
console.log(probeM(m[1], "trim1"), probeM(m[2], "trim2"));
console.log(m.map((x) => probe(x, "cb")));
const [all, a, b] = m;
console.log(typeof b, b ?? "dd", "p" + b, b === "", typeof a, a ?? "dd", "p" + a, a === "");
function g(p: string, q: string, r: string) { return [typeof p, typeof q, typeof r, q === "", r ?? "z", p + q + r + p]; }
console.log(g(m[0], m[1], m[2]));
let acc = "";
for (const x of m) acc += x;
console.log(acc);
const e = /(a)(b)?(c)?/.exec("xac")!;
console.log(e.map((x) => typeof x), e.map((x) => x ?? "-"), e.map((x) => "p" + x), e.map((x) => x === ""));
for (const r of "a1b22".matchAll(/(\d)(x)?/g)) {
  const q: string = r[2];
  console.log(typeof q, q ?? "none", "p" + q, q === "", r.map((x) => typeof x));
}
const named = "ab12".match(/(?<l>[a-z]+)(?<d>\d+)?(?<z>q)?/)!;
const z: string = named.groups!.z;
console.log(typeof named.groups!.z, named.groups!.z ?? "nz", "p" + z, z === "");
// controls: a capture that DID participate, and an empty one, are strings
const full = "Wy".match(/(W)(y)?/)!;
console.log(full.map((x) => typeof x), full.map((x) => x ?? "d"), full.map((x) => "p" + x), full.map((x) => x === ""));
const empt = "W".match(/(W)(y*)/)!;
console.log(empt.map((x) => typeof x), empt.map((x) => x ?? "d"), empt.map((x) => "p" + x), empt.map((x) => x === ""), empt.map((x) => x.length));
// relational, switch, regex subject and member calls on the same values
console.log(m.map((x) => x < "a"), m.map((x) => x > "a"), m.map((x) => x <= "W"), m.map((x) => x >= "W"));
console.log(m.map((x) => { switch (x) { case "": return "empty"; case "W": return "W"; default: return "dflt"; } }));
console.log(m.map((x) => /undefined/.test(x)), m.map((x) => /^$/.test(x)));
console.log(m.map((x) => { try { return String(x.search(/W/)); } catch (er) { return (er as Error).message; } }));
console.log(m.map((x) => { try { return x.startsWith("W"); } catch (er) { return (er as Error).message; } }));
