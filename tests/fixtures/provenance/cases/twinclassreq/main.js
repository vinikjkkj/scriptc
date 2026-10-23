// A CommonJS consumer of a package that ships a declaration file beside its
// compiled twin: `const rs = require("twinpkg")` and a member read off the
// binding. Before, the binding was refused as "the default import of a
// CommonJS module as a value" (SC1013), and where it was not, the twin's
// module init never ran: the constant read 0 where Node reads 7 and the next
// call crashed.
const rs = require("twinpkg");

console.log("limit=" + String(rs.LIMIT));
console.log("twice=" + String(rs.twice(21)));
const { LIMIT, twice } = require("twinpkg");
console.log("destructured=" + String(LIMIT) + " " + String(twice(2)));
