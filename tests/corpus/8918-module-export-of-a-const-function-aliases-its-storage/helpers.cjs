'use strict';
// `exports.name = name` over an immutable const holding a function: the export and the const are one binding.
const fe = (f) => '[' + f + ']';
exports.fe = fe;
const twice = (x) => x * 2;
exports.twice = twice;
const list = [1, 2];
exports.list = list;
