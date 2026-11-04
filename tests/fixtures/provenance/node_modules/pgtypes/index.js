var textParsers = require("./lib/textParsers");
var arrayParser = require("./lib/arrayParser");

exports.getTypeParser = getTypeParser;
exports.arrayParser = arrayParser;
exports.splitAll = splitAll;
exports.parseIntArray = textParsers.parseIntArray;

function noParse(val) {
  return String(val);
}

function getTypeParser(oid, format) {
  if (oid === 23) return function (v) { return parseInt(v, 10); };
  return noParse;
}

// A TRUE function twin whose declaration spells `any` positions and an `any[]` return.
function splitAll(source, transform) {
  return source.split(",").map(function (entry) {
    return transform(entry);
  });
}
