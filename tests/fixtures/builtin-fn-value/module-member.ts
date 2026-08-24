/* A member of a node BUILTIN MODULE held as a VALUE.
 *
 * Every line is one cell, compared against Node v25.9.0's own answer for
 * the same line. The four things a value form can get wrong are all here
 * for every member:
 *
 *   typeof   "function", not "undefined" and not a token string
 *   ident    `v === member` — Node's true, and the first thing an
 *            ADAPTER breaks (an adapter is a fresh closure with a
 *            different pointer)
 *   nsid     `v === ns.member` — the named-import spelling and the
 *            namespace spelling must be ONE pointer, because they are one
 *            function in Node
 *   call     the value CALLED, on the arguments whose answers are the
 *            member's own semantics, edge cases included ("" and "/" and
 *            a dotfile), because a value that answers something other
 *            than the direct call is the silent wrong answer this whole
 *            surface exists to avoid
 *
 * Host-valued members (homedir, tmpdir, release, type, totalmem,
 * platform) print no answer — a home directory differs between machines.
 * They print `same`, which is the property that matters: the value form
 * and the direct call reach the SAME implementation.
 */
import * as pathNs from "node:path";
import { dirname, extname, isAbsolute, normalize, relative, toNamespacedPath } from "node:path";
import * as osNs from "node:os";
import { homedir, platform, release, tmpdir, totalmem, type as osType } from "node:os";
import * as qsNs from "node:querystring";
import { escape as qsEscape, unescape as qsUnescape } from "node:querystring";

const vDirname = dirname;
const vExtname = extname;
const vIsAbsolute = isAbsolute;
const vNormalize = normalize;
const vRelative = relative;
const vToNamespaced = toNamespacedPath;

console.log("path.dirname.typeof " + typeof vDirname);
console.log("path.dirname.ident " + String(vDirname === dirname));
console.log("path.dirname.nsid " + String(vDirname === pathNs.dirname));
console.log("path.dirname.a " + vDirname("/a/b/c.txt"));
console.log("path.dirname.b " + vDirname(""));
console.log("path.dirname.c " + vDirname("a"));
console.log("path.dirname.d " + vDirname("/"));

console.log("path.extname.typeof " + typeof vExtname);
console.log("path.extname.ident " + String(vExtname === extname));
console.log("path.extname.nsid " + String(vExtname === pathNs.extname));
console.log("path.extname.a " + vExtname("/a/b/c.txt"));
console.log("path.extname.b " + vExtname(".hidden"));
console.log("path.extname.c " + vExtname("noext"));
console.log("path.extname.d " + vExtname("a.b.c"));
console.log("path.extname.e " + vExtname(""));

console.log("path.isAbsolute.typeof " + typeof vIsAbsolute);
console.log("path.isAbsolute.ident " + String(vIsAbsolute === isAbsolute));
console.log("path.isAbsolute.nsid " + String(vIsAbsolute === pathNs.isAbsolute));
console.log("path.isAbsolute.a " + String(vIsAbsolute("/a")));
console.log("path.isAbsolute.b " + String(vIsAbsolute("a")));
console.log("path.isAbsolute.c " + String(vIsAbsolute("")));

console.log("path.normalize.typeof " + typeof vNormalize);
console.log("path.normalize.ident " + String(vNormalize === normalize));
console.log("path.normalize.nsid " + String(vNormalize === pathNs.normalize));
console.log("path.normalize.a " + vNormalize("/a//b/../c"));
console.log("path.normalize.b " + vNormalize(""));
console.log("path.normalize.c " + vNormalize("a/./b"));

console.log("path.relative.typeof " + typeof vRelative);
console.log("path.relative.ident " + String(vRelative === relative));
console.log("path.relative.nsid " + String(vRelative === pathNs.relative));
console.log("path.relative.a " + vRelative("/a/b", "/a/c"));
console.log("path.relative.b " + vRelative("", ""));

console.log("path.toNamespacedPath.typeof " + typeof vToNamespaced);
console.log("path.toNamespacedPath.ident " + String(vToNamespaced === toNamespacedPath));
console.log("path.toNamespacedPath.nsid " + String(vToNamespaced === pathNs.toNamespacedPath));
console.log("path.toNamespacedPath.a " + vToNamespaced(""));

/* THE VALUE PASSED, not just aliased: an argument, a record field, an
 * array element, a `??` default and a closure that outlives its frame —
 * the same five routes the offline half exercises for the globals, and
 * every one of them compared with `===` so an adapter minted on any of
 * them shows up as `false` rather than as a right-looking answer. */
function applyTo(f: (p: string) => string, arg: string): string {
  return f(arg);
}
/** Identity checked INSIDE the callee, on the value that crossed the
 * parameter: a parameter is the boundary where an adapter would be minted,
 * so this is where a fresh pointer would show up. */
function isDirname(f: (p: string) => string): boolean {
  return f === dirname;
}
console.log("route.arg " + applyTo(vDirname, "/x/y/z"));
console.log("route.arg-ident " + String(isDirname(dirname)) + " " + String(isDirname(extname)));

const rec: { d: (p: string) => string } = { d: dirname };
console.log("route.field " + rec.d("/p/q"));
console.log("route.field-ident " + String(rec.d === dirname));

const arr: ((p: string) => string)[] = [dirname, extname];
console.log("route.array " + arr[0]!("/p/q") + " " + arr[1]!("/p/q.md"));
console.log("route.array-ident " + String(arr[0] === dirname) + " " + String(arr[1] === extname));

function makeCounter(): () => string {
  const held = dirname;
  return () => held("/held/deep/file.txt");
}
const escaped = makeCounter();
console.log("route.closure " + escaped());

let slot: (p: string) => string = extname;
console.log("route.let-a " + String(slot === extname));
slot = dirname;
console.log("route.let-b " + String(slot === dirname) + " " + String(slot === extname));

/* os: host-valued, so the cell is `same` rather than the answer. */
const vHomedir = homedir;
const vTmpdir = tmpdir;
const vRelease = release;
const vTotalmem = totalmem;
const vOsType = osType;
const vPlatform = platform;
console.log("os.homedir.typeof " + typeof vHomedir);
console.log("os.homedir.ident " + String(vHomedir === homedir) + " " + String(vHomedir === osNs.homedir));
console.log("os.homedir.same " + String(vHomedir() === homedir()));
console.log("os.tmpdir.typeof " + typeof vTmpdir);
console.log("os.tmpdir.ident " + String(vTmpdir === tmpdir) + " " + String(vTmpdir === osNs.tmpdir));
console.log("os.tmpdir.same " + String(vTmpdir() === tmpdir()));
console.log("os.release.same " + String(vRelease() === release()));
console.log("os.totalmem.same " + String(vTotalmem() === totalmem()));
console.log("os.type.same " + String(vOsType() === osType()));
console.log("os.platform.same " + String(vPlatform() === platform()));

/* querystring: the legacy escaping pair, whose rules are NOT
 * encodeURIComponent's. */
const vEsc = qsEscape;
const vUnesc = qsUnescape;
console.log("qs.escape.typeof " + typeof vEsc);
console.log("qs.escape.ident " + String(vEsc === qsEscape) + " " + String(vEsc === qsNs.escape));
console.log("qs.escape.a " + vEsc("a b&c=d"));
console.log("qs.escape.b " + vEsc(""));
console.log("qs.escape.c " + vEsc("~-_."));
console.log("qs.unescape.ident " + String(vUnesc === qsUnescape) + " " + String(vUnesc === qsNs.unescape));
console.log("qs.unescape.a " + vUnesc("a%20b%26c"));
console.log("qs.unescape.b " + vUnesc("nopercent"));

console.log("END done");
