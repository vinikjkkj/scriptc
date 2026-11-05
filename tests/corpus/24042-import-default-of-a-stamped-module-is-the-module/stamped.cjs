"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * @param {Promise<number>} promise
 * @param {((err: Error | null, v?: number) => void) | undefined} nodeback
 * @returns {Promise<number>}
 */
function asCallback(promise, nodeback) {
  if (typeof nodeback === "function") promise.then((v) => nodeback(null, v));
  return promise;
}
exports.default = asCallback;
/** @param {number} x @returns {number} */
exports.twice = (x) => x * 2;
