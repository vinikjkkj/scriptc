// The exporter half: a top-level function declaration carrying statics,
// reached from another module through the export table AND through an
// alias off it. Both spellings must end at the one storage.
"use strict";

function parse(s) {
  return s.length;
}
parse.VERSION = "1.2.3";
parse.hits = 0;

module.exports = { parse: parse };
