// A class instance carrying the run-time property table (a run-time-keyed write in its class) holds symbol-keyed properties there: typed and untyped receivers, `in`, hasOwn, delete, getOwnPropertySymbols, spread and util.inspect.
"use strict";
const kExec = Symbol("exec");
const kCallbacks = Symbol("callbacks");
class Pipeline {
  constructor(name) { this.name = name; }
  define(key, v) { this[key] = v; }   // a run-time key: the class carries a property table
  exec() { return this.name; }
}
const pipeline = new Pipeline("p");
pipeline.define("x", 1);
pipeline[kExec] = false;
pipeline[kCallbacks] = [];
pipeline[kCallbacks].push(function (e, v) { return v; });
if (!pipeline[kExec]) { pipeline[kExec] = true; }
console.log(pipeline[kExec], pipeline[kCallbacks].length, pipeline.name, kExec in pipeline, Object.hasOwn(pipeline, kCallbacks));
function bind(owner) { owner[Symbol.for("bound")] = true; owner[kExec] = "again"; }
bind(pipeline);
console.log(pipeline[kExec], pipeline[Symbol.for("bound")]);
console.log(Object.getOwnPropertySymbols(pipeline).map((s) => s.toString()));
console.log(pipeline);
console.log(delete pipeline[kCallbacks], Object.getOwnPropertySymbols(pipeline).length);
const c = { ...pipeline };
console.log(Object.getOwnPropertySymbols(c).length);
const q = new Pipeline("q");
console.log(q[kExec], kExec in q);
