// The same regex-heavy work after an engine use: bytecode compiled before and after the boot must free cleanly and agree.
function show(label: string, v: unknown): void { console.log(label + ": " + JSON.stringify(v)); }
const text = "alpha=1; beta=22; gamma=333";
const pre = /(\w+)=(\d+)/g;
const before = [...text.matchAll(pre)].map((m) => m[1] + ":" + m[2]);
show("before", before);
const code: string = process.argv.length > 0 ? "return Array.from({length: n}, (_, i) => i * i)" : "";
show("engine", new Function("n", code)(5));
const after = [...text.matchAll(pre)].map((m) => m[1] + ":" + m[2]);
show("after-same", after);
const fresh = text.replace(/(?<k>[a-z]+)=(?<v>\d+)/g, "$<v>->$<k>");
show("fresh", fresh);
show("engine-again", new Function("s", "return s.split(';').length")(text));
show("replace", text.replace(/\d+/g, (d) => String(d.length)));
show("compiled-before-reused", text.match(pre)!.length);
