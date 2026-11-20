// s.search(str) and s.match(str) on a typed string take the string as RegExp(pattern): a row with index/input/groups, search's index, Node's SyntaxError.
const s: string = "Hello World 42" + (process.argv.length > 50 ? "q" : "");
const p: string = "o W" + (process.argv.length > 50 ? "q" : "");
const re = new RegExp(p);
console.log(s.match(re), s.search(re));
console.log(s.search(p), s.match(p), s.match("l+"), s.match("(?<d>\\d)(x)?"), s.match("zzz"));
console.log(s.search("(?:)"), "a.b".search("."), "x".match("(y)?"), "a+b".search("\\+"));
const m = s.match("(W)(z)?")!;
console.log(m[2] === undefined, m.index, m.input);
for (const bad of ["(", "[", "a{2,1}", "*"]) { try { s.match(bad); } catch (e) { console.log(JSON.stringify(bad), (e as Error).name, (e as Error).message); } }
try { s.search("("); } catch (e) { console.log((e as Error).name, (e as Error).message); }
