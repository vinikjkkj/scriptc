import util from "node:util";
const NC = JSON.parse('{"customInspect":false}');
const NCU = JSON.parse('{"customInspect":null}');
const YC = JSON.parse('{"customInspect":true}');
const k = Symbol.for("nodejs.util.inspect.custom");
class Secret { constructor() { this.v = 1; } [k](depth, opts, inspect) { return "<hidden>"; } }
class Plain { constructor() { this.v = 2; this.s = new Secret(); } }
function show(v) { for (const o of [NC, NCU, YC]) console.log(util.inspect(v, o)); console.log(util.inspect(v)); }
show(new Secret());
show(new Plain());
show([new Secret(), { inner: new Secret() }]);
console.log(util.formatWithOptions(NC, "%O %s %j", new Secret(), new Secret(), { a: 1 }));
