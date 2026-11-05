"use strict";
// Untyped JavaScript: every function returns a promise the declaration file claims is a Promise<number>.
exports.fulfilled = (v) => new Promise((resolve) => resolve(v));
exports.rejected = (m) => new Promise((_, reject) => reject(new Error(m)));
exports.settled = (v) => Promise.resolve(v);
exports.timer = (v) => new Promise((resolve) => setTimeout(() => resolve(v), 5));
exports.again = async (p) => (await p) + 0;
exports.wrong = () => new Promise((resolve) => resolve(JSON.parse('"not a number"')));
