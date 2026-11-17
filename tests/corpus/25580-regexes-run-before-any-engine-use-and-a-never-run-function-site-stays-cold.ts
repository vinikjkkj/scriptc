// A Function site that never runs (the guard is a run-time value), and regexes that must work with the engine cold.
const body: string = process.argv.length > 40 ? String(process.argv[40]) : "";
function show(label: string, v: unknown): void { console.log(label + ": " + JSON.stringify(v)); }

const words = "alpha, beta;gamma  delta".split(/[,;\s]+/);
show("split", words);
show("match", "a1b22c333".match(/\d+/g));
show("replace", "2024-05-17".replace(/(\d+)-(\d+)-(\d+)/, "$3/$2/$1"));
const re = /o/g;
const seen: number[] = [];
let m: RegExpExecArray | null;
while ((m = re.exec("foo boo")) !== null) seen.push(m.index);
show("exec-loop", seen);
show("lastIndex-after", re.lastIndex);
const st = /ab/y;
st.lastIndex = 2;
show("sticky-hit", st.test("xxab"));
show("sticky-lastIndex", st.lastIndex);
st.lastIndex = 1;
show("sticky-miss", st.test("xxab"));
show("sticky-reset", st.lastIndex);
show("unicode-dot", /^.$/u.test("\u{1F600}"));
show("nonunicode-dot", /^.$/.test("\u{1F600}"));
show("unicode-class", "café über".match(/\p{L}+/gu));
show("named-replace", "on 2031-07 ok".replace(/(?<year>\d{4})-(?<month>\d{2})/, "$<month>/$<year>"));
show("flags", /a/gimsuy.flags);
show("source", /a\/b/.source);
if (body !== "") {
  const f = new Function("x", body);
  console.log("never printed in the default run", f(1));
}
console.log("done");
