// mysql2 parser_cache.js shape: a dyn array mapped through the String global.
function dateStringsKey(dateStrings) {
  if (Array.isArray(dateStrings)) {
    return dateStrings.map(String);
  }
  return Boolean(dateStrings);
}
console.log(JSON.stringify(dateStringsKey(['a', 1, true])), dateStringsKey(false));
console.log(JSON.stringify(dateStringsKey([null, undefined, 2.5])));
