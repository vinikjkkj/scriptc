"use strict";
// The shape of tr46 5.x: a CommonJS package whose require() of the npm package
// `punycode` is spelled with a trailing slash. Node resolves `punycode/` to
// node_modules/punycode, not to the deprecated builtin.
const punycode = require("punycode/");
exports.toAscii = function (s) { return punycode.toASCII(s); };
exports.fromAscii = function (s) { return punycode.decode(s); };
exports.version = "0.0.1";
