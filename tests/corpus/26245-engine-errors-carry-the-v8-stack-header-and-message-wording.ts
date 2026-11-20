// Errors the engine raises inside new Function text carry V8's header line and message wording: stack starts with `Name: message`, the
// engine's own TypeError/ReferenceError/RangeError/URIError messages read like Node's. (The frames after the header differ and are not compared.)
const snippets: string[] = [
  "null.x",
  "undefined.x",
  "null.x = 1",
  "undefined[0]",
  "({}).a.b",
  "undefinedVar",
  "\"use strict\"; const c = 1; c = 2;",
  "x; let x;",
  "[].reduce((a, b) => a)",
  "new Array(-1)",
  "\"abc\".repeat(-1)",
  "(1).toFixed(200)",
  "JSON.parse(\"{\")",
  "JSON.parse(\"\")",
  "Symbol() + \"\"",
  "decodeURIComponent(\"%\")",
  "function f() { f(); } f()",
  "({}) instanceof 5",
  "null instanceof null",
  "class A { constructor() { this.x; } } class B extends A { constructor() { this.y = 1; } } new B()",
  "structuredClone",
  "x = y + 1; let y;",
  "(function () { \"use strict\"; undefinedGlobal = 1; })()",
  "[].at.call(null)",
  "await1",
  "new Date(NaN).toISOString()",
  "\"x\".normalize(\"bad\")",
  "Array.from({length: -1}).length; new Array(2**32)"
];
for (const s of snippets) {
  console.log("--", s);
  const run: any = new Function(`try { (function () { ${s} })(); console.log("NOERR"); } catch (e) { console.log(e.name + ": " + e.message); console.log(String(e.stack).split("\\n")[0], /\\n    at /.test(e.stack) || !/\\n/.test(e.stack)); }`);
  run();
}
const mk: any = new Function(`return new Error("engine boom")`);
const mk2: any = new Function(`class Boom extends Error { constructor(m) { super(m); this.name = "Boom"; } } return new Boom("sub");`);
const mk3: any = new Function(`const e = new RangeError("r"); e.code = "E_X"; return e;`);
const mk4: any = new Function(`const e = new Error(""); return e;`);
const mk5: any = new Function(`const e = new Error("m"); e.name = ""; e.message = "later"; return [e.stack, new Error("n", { cause: "c" }).stack].map((s) => JSON.stringify(s.split("\\n")[0])).join(" | ");`);
const show = (e: any) => console.log(JSON.stringify(String(e.stack).split("\n")[0]), e.name, e.message, e instanceof Error);
show(mk()); show(mk2()); show(mk3()); show(mk4());
console.log(mk5());
