// A static exec/match/matchAll row: a capture that did not participate is undefined (not ""), the row prints with index, input and groups, m.input reads.
const s: string = "Wx" + (process.argv.length > 50 ? "q" : "");
const m = s.match(/(W)(y)?/)!;
console.log(m);
console.log(m[2], m.index, m.input, m.groups);
const n = "ab12".match(/(?<l>[a-z]+)(?<d>\d+)?(?<z>q)?/)!;
console.log(n, n.groups!.l, n.groups!.z, n.groups!.z === undefined);
const e = /(a)(b)?/.exec("xa")!;
console.log(e, e.index, e[2] === undefined, e[2] ?? "dflt", typeof e[2], `${e[2]}`, "p" + e[2], !!e[2]);
console.log("a1b2".match(/\d/g), "zz".match(/q/));
for (const x of "a1b22".matchAll(/(\d)(x)?/g)) console.log(x, x.index, x.input);
const rows = [..."a1b2".matchAll(/(\d)(x)?/g)];
console.log(rows.map((r) => r[2] ?? "none"), rows.map((r) => r.index), rows);
// binding forms of the absent capture
const [all, a, b = "dd", c = "ee"] = s.match(/(W)(y)?(?<n>x)?/)!;
console.log(all, a, b, c);
const mm = s.match(/(W)(y)?(?<n>x)?/)!;
console.log(mm.join("|"), String(mm), JSON.stringify(mm), mm.length, mm.groups!.n);
for (const x of mm) console.log(x === undefined, x, x == null);
console.log(mm.map((x) => (x === undefined ? "U" : x)), mm.filter((x) => x !== undefined));
const z = mm[2];
console.log(z === undefined, z);
function f(x: string) { return x === undefined ? "UNDEF" : "str:" + x; }
console.log(f(mm[2]), f(mm[1]));
const dd = /(a)|(b)/.exec("b")!;
console.log(dd, dd[1], dd.index);
