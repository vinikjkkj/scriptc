// path.posix's cwd on a WINDOWS target. Node keeps the posix namespace
// usable on Windows by rewriting the process cwd before posix.resolve ever
// sees it — lib/path.js's `posixCwd()`:
//
//     const cwd = process.cwd().replace(/\\/g, '/');
//     return cwd.slice(cwd.indexOf('/'));
//
// backslashes become slashes and the DRIVE INDICATOR is dropped, so
// posix.resolve("a") answers "/a" under a cwd of "G:\" exactly as it does
// under "/". The bare `path` module binds the win32 family on a win32
// target, but `path/posix` binds the posix family on EVERY target — so the
// posix arm is live here and has to follow that rule. Without it the cwd
// went in verbatim, posix.resolve("a") came back "G:\/a", and nothing the
// posix namespace resolved was absolute any more.
//
// Every line below is cwd-INDEPENDENT on purpose. The differential runs
// Node and the binary in the same directory, so a program that just
// printed the cwd would agree with Node while saying nothing about the
// rule; these print the SHAPE the rule guarantees instead.
import * as posix from "node:path/posix";

const abs = posix.resolve("a");
console.log("A1", posix.isAbsolute(abs));
console.log("A2", abs.startsWith("/"));
console.log("A3", abs.includes("\\"));
console.log("A4", abs.endsWith("/a"));
console.log("A5", abs.indexOf(":"));

// The no-argument and "." forms take Node's current-directory fast path.
const here = posix.resolve();
console.log("B1", posix.isAbsolute(here));
console.log("B2", here === posix.resolve("."));
console.log("B3", here.includes("\\"));
console.log("B4", posix.resolve("a") === posix.join(here === "/" ? "" : here, "a"));

// An absolute argument short-circuits the cwd entirely: these are the
// same bytes on every host.
console.log("C1", posix.resolve("/x", "y"));
console.log("C2", posix.resolve("/x", "../y"));
console.log("C3", posix.resolve("/x", "/y", "z"));

// relative() resolves BOTH sides, so it consults the cwd twice and the two
// consultations must cancel.
console.log("D1", posix.relative("a", "a/b"));
console.log("D2", posix.relative("a/b", "a"));
console.log("D3", posix.relative("a", "b"));
console.log("D4", posix.relative(abs, posix.resolve("a", "c")));

// Idempotence: resolving an already-resolved path changes nothing, and
// posix.toNamespacedPath is the identity.
console.log("E1", posix.resolve(abs) === abs);
console.log("E2", posix.toNamespacedPath(abs) === abs);
console.log("E3", posix.dirname(abs) === here || posix.dirname(abs) + "/" === here);
console.log("E4", posix.resolve("a", "..", "b").endsWith("/b"));
