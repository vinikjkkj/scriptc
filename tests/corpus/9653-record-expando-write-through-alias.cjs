'use strict';
// An expando on a function holds a record (an empty object literal); a write through a plain alias of that expando lands on the record, and a later call through the function sees it.
const createDebug = function (ns) { return ns.length; };
createDebug.formatters = {};
const formatters = createDebug.formatters;
formatters.o = function (v) { return 'obj:' + v; };
console.log(formatters.o(1), createDebug('abc'));
