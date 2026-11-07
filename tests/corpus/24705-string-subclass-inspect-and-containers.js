import util from "node:util";
class V extends String { constructor(f, s) { super(s); this.format = f; } }
const v = new V("txt", "hello");
console.log([v], { v }, util.inspect(v), util.inspect(v, { depth: 0 }), util.format("%s|%o", v, 1));
const e = new V("e", "");
console.log(e, e.length, !!e, e == "", JSON.stringify([e]), String(e) === "");
class U extends String { constructor(s) { super(s + "!"); } }
console.log(new U("a").toString(), new U("a") + "b", new U("xy").length);
console.log([new U("q")].join(","), `${[new V("a", "b")]}`);
const m = new Map([[v.toString(), v]]);
console.log(m.get("hello") === v, new Set([v]).has(v), [v].includes(v), [v].indexOf("hello"));
console.log(Object.entries(v).length, Object.assign({}, v));
console.log(v.split("l"), v.padStart(8, "*"), v.startsWith("he"));
