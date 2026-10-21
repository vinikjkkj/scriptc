// .index of exec/match/matchAll results through every binding form: module-level, field, array element, return value, closure.
const GLOBAL_M = /b+/.exec("aabbbcc");
console.log(GLOBAL_M ? GLOBAL_M.index : -1);
class Holder { m: RegExpExecArray | null = /(\d+)-(\d+)/.exec("id 42-17 end"); }
const h = new Holder();
console.log(h.m!.index, h.m![1], h.m!.index + 1);
function find(s: string, re: RegExp): RegExpExecArray | null { return re.exec(s); }
const r = find("xxyz", /y/);
console.log(r !== null ? r.index : -1, find("q", /y/) === null);
const arr: RegExpExecArray[] = [];
const g = /o/g;
let m: RegExpExecArray | null;
while ((m = g.exec("foo boo")) !== null) arr.push(m);
console.log(arr.map((x) => x.index).join(","), g.lastIndex);
const mm = "hello world".match(/wor/);
console.log(mm ? mm.index : -1, mm!.index);
const rows = Array.from("a1b22c333".matchAll(/\d+/g));
console.log(rows.map((x) => x.index).join(","));
const stash: { m: RegExpExecArray | null }[] = [{ m: /z/.exec("abz") }, { m: /a/.exec("abz") }];
console.log(stash[0]!.m!.index, stash[1]!.m!.index);
const inClosure = () => (GLOBAL_M as RegExpExecArray).index;
console.log(inClosure());
for (let i = 0; i < 20000; i++) { const t = /c/.exec("abc"); if (t!.index !== 2) throw new Error("bad"); }
console.log("done");
