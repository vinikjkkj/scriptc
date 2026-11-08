import util from "node:util";
Error.stackTraceLimit = 0;
const H = JSON.parse('{"showHidden":true}');
const HC = JSON.parse('{"showHidden":true,"colors":true}');
const HD = JSON.parse('{"showHidden":true,"depth":0}');
function show(e) { for (const o of [H, HC, HD]) console.log(util.inspect(e, o)); console.log(util.inspect(e)); }
const e1 = new Error("boom");
const e2 = new TypeError("t");
const e3 = new Error("c", { cause: "z" });
show(e1); show(e2); show(e3);
show({ nested: e1, arr: [e2] });
