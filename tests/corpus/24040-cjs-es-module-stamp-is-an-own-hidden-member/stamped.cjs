"use strict";
// The shape every tsc-compiled CommonJS dependency has: the interop stamp first, then the exports.
Object.defineProperty(exports, "__esModule", { value: true });
function asCallback(promise, nodeback) {
  if (typeof nodeback === "function") promise.then((v) => nodeback(null, v));
  return promise;
}
exports.default = asCallback;
exports.twice = (x) => x * 2;
