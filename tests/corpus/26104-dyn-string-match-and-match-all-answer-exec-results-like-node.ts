// match without /g, matchAll and the string forms of search / match / matchAll on a dyn receiver answer exec-shaped results like Node.
const s: any = JSON.parse('"Hello, World 42 foo bar"');
const m = s.match(/(W)(x)?(?<n>or)/);
console.log(m, m.index, m.input, m.groups, m[2], m.length, m.groups.n);
console.log(s.match("[0-9]+"), s.match("(o)(z)?"), s.match("zzz"), s.search("W"), s.search("[0-9]"), s.search("zzz"), s.search(undefined));
console.log(s.match(/o/g), s.match(/zzz/g), s.match(/(?<d>\d)(\d)/).groups);
const all = [...s.matchAll(/o(?<x>.)?/g)];
console.log(all.length, all[0], all[0].index, all[1].groups, all[0][1], all[2][1], all[2].index);
console.log([...s.matchAll("o")].length, [...s.matchAll("(?<a>[A-Z])(\\w)")].map((x: any) => x.index + x[0]).join("|"), [...s.matchAll(/zzz/g)].length);
for (const x of s.matchAll(/(\d)(\d)?/g)) console.log(x[0], x[1], x[2], x.index);
try { s.matchAll(/o/); } catch (e) { console.log((e as Error).name, (e as Error).message); }
try { s.match("("); } catch (e) { console.log((e as Error).name); }
const u: any = JSON.parse('"\\ud83d\\ude00 a\\u00e9b"');
console.log(u.match(/./u).index, u.match(/(?<c>.)/u).groups.c, [...u.matchAll(/\p{L}/gu)].map((x: any) => x.index).join());
