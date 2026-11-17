// Regex-heavy; the Function site below never runs.
const guard: string = process.argv.length > 40 ? String(process.argv[40]) : "";
const text = "The Quick brown fox, jumps over 13 lazy dogs! Emails: a.b@x.org, c_d@y.com. Dates 2020-01-02 and 1999-12-31.";
function show(label: string, v: unknown): void { console.log(label + ": " + JSON.stringify(v)); }
show("words", text.match(/\b[A-Za-z]+\b/g)!.length);
show("emails", text.match(/[\w.]+@[\w.]+\.\w+/g));
show("dates", [...text.matchAll(/(\d{4})-(\d\d)-(\d\d)/g)].map((m) => [m[1], m[2], m[3], m.index]));
show("replace-fn", text.replace(/\d+/g, (d) => "<" + (Number(d) + 1) + ">"));
show("replace-named", "2020-01-02".replace(/(?<y>\d+)-(?<m>\d+)-(?<d>\d+)/, "$<d>.$<m>.$<y>"));
show("lookahead", "price: 10USD 20EUR 30USD".match(/\d+(?=USD)/g));
show("lookbehind", "price: 10USD 20EUR 30USD".match(/(?<=\s)\d+(?=EUR)/g));
show("neg-lookahead", "a1 b2 c3".match(/[a-z](?!1)\d/g));
show("backref", "abcabc xyzxyz abab".match(/(\w+)\1/g));
show("case", "Hello HELLO hello".match(/hello/gi));
show("multiline", "l1\nl2\nl3".match(/^l\d$/gm));
show("dotall", "a\nb".match(/a.b/s) !== null);
show("split-capture", "a1b2c3".split(/(\d)/));
show("test-global", (() => { const r = /a/g; const out: boolean[] = []; for (let i = 0; i < 4; i++) out.push(r.test("aa")); return out; })());
show("unicode-prop", "αβγ abc Б".match(/\p{Script=Greek}+/u));
show("astral", Array.from("a\u{1F600}b".matchAll(/./gu)).map((m) => m[0].length));
show("search", "hello world".search(/o w/));
show("lazy", "<a><b>".match(/<.+?>/g));
show("alternation", "cat dog bird".match(/cat|bird/g));
show("escape", /[.*+?^${}()|[\]\\]/g.test("a.b"));
if (guard !== "") console.log(new Function("return 1")());
