// import.meta.dirname / import.meta.filename in an ES module: the ESM
// spelling of "where is this module", lowered to compile-time constants of
// the source file's own location -- the choice already shipped for
// __dirname / __filename.
//
// Everything printed here is derived, never the absolute path itself, so
// the comparison is host-independent. The absolute value IS the divergence
// from Node (Node derives it at RUN time; a compiled binary bakes the
// BUILD-TIME source directory), and tests/harness/import-meta-dirname.test.ts
// pins that by MOVING a binary and watching the answer stay put -- which is
// a thing a corpus program cannot express, because a corpus program that
// matches Node by construction cannot demonstrate a divergence.
import { basename, join, sep } from "node:path";

console.log("dir base", basename(import.meta.dirname));
console.log("file base", basename(import.meta.filename));
console.log("filename ends with main.ts", import.meta.filename.endsWith("main.ts"));
console.log("dirname is a prefix", import.meta.filename.startsWith(import.meta.dirname));
console.log("join round-trips", join(import.meta.dirname, basename(import.meta.filename)) === import.meta.filename);
console.log("dirname has no trailing sep", !import.meta.dirname.endsWith(sep));
// Both spellings are plain strings, not URLs.
console.log("not a url", !import.meta.dirname.startsWith("file:"), !import.meta.filename.startsWith("file:"));
console.log("typeof", typeof import.meta.dirname, typeof import.meta.filename);
