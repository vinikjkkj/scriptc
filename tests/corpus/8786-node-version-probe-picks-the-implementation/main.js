"use strict";
// Packages that pick an implementation by the running Node's version (redis-errors,
// and the pattern is everywhere): the test is built from process.version alone, so
// it has one answer, and only the taken branch is a module of the program.
const impl = process.version.charCodeAt(1) < 55 && process.version.charCodeAt(2) === 46
  ? require('./legacy') // Node < 7
  : require('./modern');
console.log(impl.kind, typeof impl.Modern, new impl.Modern().describe());
const major = parseInt(process.versions.node.slice(0, 2), 10);
if (process.version.startsWith("v1") && process.version.length < 5) {
  require('./missing-on-purpose');
} else {
  console.log("else branch, major", major >= 20 ? "20+" : "old");
}
const label = process.versions.node.slice(0, 1) === "9" ? require('./missing-on-purpose') : "not nine";
console.log(label);
