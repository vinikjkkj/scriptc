"use strict";
// JSON.parse(text, reviver): bottom-up calls with (key, value, context), this = the holder,
// undefined deletes, and (Node >= 22) context.source carries the token text of a primitive.
const log = [];
const r = JSON.parse('{"a":1,"b":[1,2,{"c":"x"}],"d":null,"e":true,"big":12345678901234567890}', function (k, v) {
  if (typeof v === "number") return v + 1;
  if (k === "c") return v.toUpperCase();
  return v;
});
console.log(JSON.stringify(r));
JSON.parse('{"a":{"b":1},"c":[true],"d":"s"}', (k, v) => { log.push(k); return v; });
console.log(log.join("|"));
console.log(JSON.stringify(JSON.parse("[1,2,3]", (k, v) => (k === "1" ? undefined : v))));
console.log(JSON.stringify(JSON.parse('{"a":1,"b":2,"c":3}', (k, v) => (k === "b" ? undefined : v))));
// the source text of primitives, and nothing for containers
const seen = [];
JSON.parse('{"n":1.50,"big":12345678901234567890,"s":"a\\u0041b","t":true,"z":null,"arr":[0.1e1],"o":{}}', (k, v, ctx) => {
  seen.push(k + "=" + (typeof ctx.source === "string" ? ctx.source : "-") + ":" + Object.keys(ctx).join());
  return v;
});
console.log(seen.join("\n"));
// a number that lost precision comes back as its exact digits (mysql2's supportBigNumbers reviver)
function bigReviver(key, value, context) {
  if (typeof value === "number" && !Number.isSafeInteger(value) && context !== undefined && /^-?\d+$/.test(context.source)) return context.source;
  return value;
}
console.log(JSON.stringify(JSON.parse('{"id":12345678901234567890,"n":5,"f":1.5,"neg":-9007199254740993}', bigReviver)));
// this is the holder; the root holder is {"": value}
const holders = [];
JSON.parse('{"x":[7]}', function (k, v) { holders.push(JSON.stringify(this)); return v; });
console.log(holders.join(" ; "));
// the reviver's result is the result, even at the root
console.log(JSON.parse("[1,2]", () => "root"), JSON.parse("3", (k, v) => v * 2));
// not callable: ignored
console.log(JSON.stringify(JSON.parse('{"a":1}', null)), JSON.stringify(JSON.parse('{"a":1}', undefined)));
// errors: the parse fails before any reviver call, and the reviver's own throw propagates
try { JSON.parse('{"a":1}', () => { throw new RangeError("from reviver"); }); } catch (e) { console.log(e.name, e.message); }
try { JSON.parse("", (k, v) => v); } catch (e) { console.log(e.name, e.message); }
