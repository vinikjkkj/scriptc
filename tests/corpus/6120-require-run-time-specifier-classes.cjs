// The run-time-specifier `require`, one line per specifier CLASS, against
// Node's own answers. A compiled binary reads no node_modules, so every
// one of these used to be the same tagged refusal; three of them are name
// tables the BUILD can bake, and two are a filesystem question the binary
// can ask without reading a byte of any file.
//
// Everything printed here is PATH-FREE on purpose: MODULE_NOT_FOUND's
// message carries the requiring file and ERR_PACKAGE_IMPORT_NOT_DEFINED
// carries two absolute paths, so the cells print `e.code` and, where the
// CLASS is the thing that differs, whether it is a TypeError.
//
// SELF-TESTED against the compiler that fenced these: at main it builds
// (a JavaScript source defers its refusals into the translation unit) and
// prints `SC2020` for lines 1 through 5, where Node prints the codes
// below.
function g(s) {
  try {
    require(s);
    return "GOT";
  } catch (e) {
    return String(e.code) + (e instanceof TypeError ? "/TypeError" : "");
  }
}

// The 'node:' prefix serves BUILTINS ONLY, and the whole answer is Node's
// own builtinModules table. 'node:fs/promises' is a builtin and would be
// a module; these two are not, and bare 'node:' is here because the
// PREFIX test and the NAME test are two different tests.
console.log("1", g("node:nosuchmod"), g("node:fs/nosuch"), g("node:"));

// A colon does not make a specifier a path. Node walks node_modules for
// every one of these.
console.log("2", g("file:///nothing-xyz"), g("data:text/js,1"), g("zzz:sub"));

// A '#' import with no "imports" field anywhere above this file. Every
// shape, the malformed ones included, is MODULE_NOT_FOUND here — the
// ERR_PACKAGE_IMPORT_NOT_DEFINED answer needs the field to EXIST.
console.log("3", g("#ok"), g("#/x"), g("#nope"));

// Relative, resolving to nothing. The binary proves that by asking the
// filesystem the same question Node asks, and by never reading a byte:
// a path that IS there still refuses.
console.log("4", g("./nothing-here-xyz.cjs"), g("./nothing-here-xyz"));
console.log("5", g("../nothing-here-xyz"));

// The neighbours that must not have moved: a bare specifier nothing
// installs, and Node's two argument errors, which happen BEFORE any
// resolution.
console.log("6", g("no-such-pkg-xyz"), g(""), g(42));
console.log("done");
