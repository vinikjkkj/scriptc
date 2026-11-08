import util from "node:util";
const mk = (s) => JSON.parse(s);
function withFn(base, tagger) { const o = mk(base); o.stylize = tagger; return o; }
const tag = (s, t) => "<" + t + ":" + s + ">";
const bracket = (s, t) => "[" + s + "]";
const nul = (s, t) => s;
class P { constructor() { this.a = 1; this.s = "x"; } }
function show(v) { for (const f of [tag, bracket, nul]) for (const b of ['{}', '{"depth":0}', '{"compact":true}', '{"showHidden":true}', '{"breakLength":30}', '{"colors":true}', '{"getters":true}']) console.log(util.inspect(v, withFn(b, f))); }
show({ a: 1, b: "two", c: [1, 2, null, undefined, true, 3n], d: { e: { f: { g: 1 } } }, "odd key": 1 });
show(new P());
show([new Date(0), /re/g, new Map([["k", 1]]), new Set([1]), Symbol("s")]);
show("a string with\nnewline that is long enough to be split across lines by the break length rule here");
show([1, , 3]);
show(Array.from({ length: 120 }, (_, i) => i));
/** @type {any} */ const o = { x: 1 };
o.self = o;
show(o);
show({ get g() { return 1; }, f() {}, k: () => 1 });
console.log(util.formatWithOptions(withFn('{}', tag), "%s|%d|%O", { a: 1 }, 5, { b: "c" }));
console.log(util.formatWithOptions(withFn('{}', tag), "%s %s %s %i %d", 5, "str", [1, "a"], 7n, 8n));
console.log(util.formatWithOptions(withFn('{}', tag), "%o", { a: [1] }));
class Cu { constructor() { this.v = 1; } }
const k = Symbol.for("nodejs.util.inspect.custom");
class C2 { [k](d, opts) { return opts.stylize("custom", "special") + typeof opts.stylize; } }
console.log(util.inspect(new C2(), withFn('{}', tag)), util.inspect(new C2(), withFn('{"colors":true}', tag)));
console.log(util.inspect({ n: new C2() }, withFn('{"showHidden":true,"getters":"get"}', bracket)));
console.log(util.inspect({ a: 1, b: ["x"] }, { stylize: tag }));
console.log(util.inspect({ a: 1, b: ["x"] }, { stylize: bracket, compact: true }));
console.log(util.inspect([1, 2], { stylize: (s, t) => s, colors: true }));
