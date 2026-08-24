/* The ambient CommonJS `require`, against Node v25.9.0, on both lanes.
 *
 * WHY THIS FILE EXISTS. `const x = require("./m")` at a module's top level
 * is an IMPORT and was always handled. EVERY OTHER POSITION — a require
 * inside a function, a require whose specifier is not a written literal, a
 * require whose value is consumed as a value — reached the callee-as-a-
 * value fence. In a JavaScript file that fence is DEFERRED into the
 * translation unit, so a program's own `try { require(x) } catch {}` — the
 * optional-dependency idiom, and protobufjs's `inquire()` verbatim —
 * swallowed a COMPILER REFUSAL and carried on with `null`, at exit 0, with
 * no diagnostic. Node's answer there is a module, or a throw. Never null.
 *
 * A 30-program matrix against Node v25.9.0 found ELEVEN cells answering
 * WRONG at exit 0 on both backends. This file pins the ones that close and
 * — just as important — the ones that do NOT, because the population that
 * is left is the price of the row and it must not be misread as absent.
 *
 * THREE-SIDED, because a one-sided version passes by accident:
 *
 *  1. RUNS — programs that must compile CLEAN (no best-effort) and print
 *     Node's bytes at Node's exit code. A compiler that turned every
 *     require into a throw would fail these.
 *  2. FENCED — the shapes that must STILL refuse, and refuse as the SAME
 *     tagged refusal at the SAME site. The module value they would have to
 *     answer is a module namespace object, which has no value
 *     representation in a compiled program (the SC1090 fence in
 *     lower-exprs). A compiler that answered MODULE_NOT_FOUND for these
 *     would pass side 1 and be silently, dangerously wrong: it would tell
 *     a program that an INSTALLED package is missing.
 *  3. NEIGHBOURS — the require shapes that already worked. The import
 *     statement, the builtin alias, evaluation order, a LOCAL binding
 *     named `require`, and an ES module (where Node defines no `require`
 *     at all, so `typeof require` is "undefined" and must stay that way).
 *
 * Every expected string here was measured by running the same source under
 * Node v25.9.0 and is re-derivable that way. Nothing prints an absolute
 * path: MODULE_NOT_FOUND's message carries the requiring file, so the
 * programs print `e.code` and a path-free slice of `e.message`.
 */
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { beforeAll, describe, expect, test } from "vitest";
import { compile } from "@scriptc/compiler";
import { exeName } from "./exe.js";

const LANES = ["c", "llvm"] as const;
type Lane = (typeof LANES)[number];

/** A module of the compiled program, required by the entries below. */
const M = "module.exports = { v: 42, tag: 'from-m' };\n";

/** An INSTALLED package the program never imports: present in
 * node_modules at build time, so Node resolves it — and so the compiler
 * must never answer MODULE_NOT_FOUND for it. */
const MYLIB_JS = "module.exports = { v: 42, tag: 'from-mylib' };\n";
const MYLIB_DTS = "declare const m: { v: number; tag: string };\nexport = m;\n";
const MYLIB_PKG = '{ "name": "mylib", "version": "1.0.0", "main": "index.js", "types": "index.d.ts" }\n';

/** LOOSE FILES in node_modules — a package root that is not a
 * DIRECTORY. Node's CJS loader tries LOAD_AS_FILE on
 * `node_modules/<root>` before LOAD_AS_DIRECTORY, and its extension
 * list is exactly ["", ".js", ".json", ".node"], so `filepkg.js`,
 * `jsonpkg.json` and `@s/sfile.js` all resolve while `dmjs.mjs` does
 * NOT. Measured against Node v25.9.0; `dmjs` is the over-fire
 * control. */
const LOOSE_JS = 'module.exports = { v: 42, tag: "loose-file" };\n';
const LOOSE_SCOPED_JS = 'module.exports = { v: 9, tag: "loose-scoped" };\n';
const LOOSE_JSON = '{ "v": 7 }\n';
const LOOSE_MJS = "export const v = 5;\n";

/** node_modules DIRECTORIES Node's LOAD_AS_DIRECTORY finds NOTHING in.
 * The bare directory name used to be enough to make the root set carry
 * them, and a name in that set fences — so each of these was a refusal
 * standing where Node throws its own catchable MODULE_NOT_FOUND.
 * `typesonly` is the `@types/*` shape verbatim. */
const TYPESONLY_PKG = '{ "name": "typesonly", "version": "1.0.0", "types": "index.d.ts" }\n';
const TYPESONLY_DTS = "export declare const v: number;\n";
const NOMAIN_PKG = '{ "name": "nomainnoidx", "version": "1.0.0", "main": "nope.js" }\n';

/** The two shapes that must STAY in the set. Node throws for both, and
 * for neither does it throw MODULE_NOT_FOUND, so the compiled answer has
 * to be the refusal rather than a wrong error. */
const EXPORTS_MISSING_PKG = '{ "name": "expmissing", "version": "1.0.0", "exports": "./gone.js" }\n';
const BROKEN_PKG = "{ this is not json\n";

interface Program {
  readonly name: string;
  /** The entry's extension: ".cjs" is a CommonJS module, ".mjs" an ES one. */
  readonly ext?: ".cjs" | ".mjs";
  /** The fixture's own package.json, when the program's answer depends on
   * it. A `#` specifier is resolved against the "imports" field of the
   * NEAREST enclosing package.json, and what Node answers when nothing
   * matches depends on whether that field EXISTS — MODULE_NOT_FOUND
   * without it, ERR_PACKAGE_IMPORT_NOT_DEFINED with it, even when it is
   * empty. Two different codes and two different classes for the same
   * specifier, so both trees have to be in this file. */
  readonly pkg?: string;
  readonly src: string;
  /** Node v25.9.0's stdout, byte for byte. */
  readonly stdout: string;
  /** Node v25.9.0's exit code. */
  readonly exit: number;
}

const RUNS: readonly Program[] = [
  {
    // 'node:' serves BUILTINS ONLY, and that makes it the one refusing
    // class whose whole answer is a NAME TABLE: no filesystem, no module
    // value. A name Node's own builtinModules carries is a module and
    // still fences (below); every other name is this error, whose
    // message is the WHOLE specifier and which carries NO require stack.
    // Bare 'node:' is in here because the prefix test and the name test
    // are two different tests and only this spelling separates them.
    name: "a run-time 'node:' name Node has no builtin for is ERR_UNKNOWN_BUILTIN_MODULE",
    src:
      "function g(s) { try { require(s); return 'GOT' } catch (e) { return e.code + '|' + e.message } }\n" +
      "console.log(g('node:nosuchmod'));\n" +
      "console.log(g('node:fs/nosuch'));\n" +
      "console.log(g('node:'));\n",
    stdout:
      "ERR_UNKNOWN_BUILTIN_MODULE|No such built-in module: node:nosuchmod\n" +
      "ERR_UNKNOWN_BUILTIN_MODULE|No such built-in module: node:fs/nosuch\n" +
      "ERR_UNKNOWN_BUILTIN_MODULE|No such built-in module: node:\n",
    exit: 0,
  },
  {
    // A colon does NOT make a specifier a path. Node's CJS resolver walks
    // node_modules for every one of these and answers MODULE_NOT_FOUND;
    // a blanket ':' test fenced all four to catch the one shape that
    // really is a path, a DRIVE letter, which is spelled out instead.
    // 'mylib:sub' is the sharp one: `mylib` IS installed here, and the
    // root Node looks for is the whole 'mylib:sub'.
    name: "a colon does not make a specifier a path",
    src:
      "function g(s) { try { require(s); return 'GOT' } catch (e) { return e.code } }\n" +
      "console.log(g('file:///nothing-xyz'), g('http://example.com/x'));\n" +
      "console.log(g('data:text/js,1'), g('mylib:sub'));\n",
    stdout: "MODULE_NOT_FOUND MODULE_NOT_FOUND\nMODULE_NOT_FOUND MODULE_NOT_FOUND\n",
    exit: 0,
  },
  {
    // A '#' import in a scope with NO "imports" field. Every shape,
    // malformed ones included, is MODULE_NOT_FOUND here — measured.
    name: "a '#' import with no imports map anywhere is MODULE_NOT_FOUND",
    src:
      "function g(s) { try { require(s); return 'GOT' } catch (e) { return e.code + '|' + String(e.message).split('\\n')[0] } }\n" +
      "console.log(g('#ok'));\n" +
      "console.log(g('#nope'));\n" +
      "console.log(g('#/x'));\n",
    stdout:
      "MODULE_NOT_FOUND|Cannot find module '#ok'\n" +
      "MODULE_NOT_FOUND|Cannot find module '#nope'\n" +
      "MODULE_NOT_FOUND|Cannot find module '#/x'\n",
    exit: 0,
  },
  {
    // The SAME specifier in a scope that HAS an imports map is a
    // different error with a different code AND a different class — a
    // TypeError, not an Error. The optional-dependency idiom reads
    // e.code, so a program asking "was it just not installed?" got the
    // wrong branch. The message names two absolute paths, so this cell
    // prints the code and the class instead.
    name: "a '#' import an imports map does not define is ERR_PACKAGE_IMPORT_NOT_DEFINED",
    pkg: '{ "name": "require-parity-probe", "version": "0.0.0", "imports": { "#ok": "./m.cjs", "#pat/*": "./*.cjs" } }\n',
    src:
      "function g(s) { try { require(s); return 'GOT' } catch (e) { return e.code + ' ' + (e instanceof TypeError) } }\n" +
      "console.log(g('#nope'));\n" +
      "console.log(g('#other/deep'));\n",
    stdout: "ERR_PACKAGE_IMPORT_NOT_DEFINED true\nERR_PACKAGE_IMPORT_NOT_DEFINED true\n",
    exit: 0,
  },
  {
    // An EMPTY imports map is still an imports map, which is the cell
    // that separates "does the field exist" from "does it have keys".
    name: "an EMPTY imports map is still an imports map",
    pkg: '{ "name": "require-parity-probe", "version": "0.0.0", "imports": {} }\n',
    src:
      "function g(s) { try { require(s); return 'GOT' } catch (e) { return e.code } }\n" +
      "console.log(g('#ok'));\n",
    stdout: "ERR_PACKAGE_IMPORT_NOT_DEFINED\n",
    exit: 0,
  },
  {
    // A relative specifier that resolves to NOTHING. The binary proves
    // that by asking the filesystem the same question Node asks, and by
    // never reading a byte of any file — a path that IS there still
    // fences (see FENCED below), because handing it back means the
    // module's exports as a value.
    name: "a relative specifier that resolves to nothing is MODULE_NOT_FOUND",
    src:
      "function g(s) { try { require(s); return 'GOT' } catch (e) { return e.code + '|' + String(e.message).split('\\n')[0] } }\n" +
      "console.log(g('./missing.cjs'));\n" +
      "console.log(g('./missing'));\n" +
      "console.log(g('../nothing-here-xyz'));\n",
    stdout:
      "MODULE_NOT_FOUND|Cannot find module './missing.cjs'\n" +
      "MODULE_NOT_FOUND|Cannot find module './missing'\n" +
      "MODULE_NOT_FOUND|Cannot find module '../nothing-here-xyz'\n",
    exit: 0,
  },
  {
    // The absolute spelling of the same question. The message carries the
    // absolute path, so this prints the code alone.
    name: "an absolute specifier that resolves to nothing is MODULE_NOT_FOUND",
    src:
      "var path = require('path');\n" +
      "function g(s) { try { require(s); return 'GOT' } catch (e) { return e.code } }\n" +
      "console.log(g(path.resolve(__dirname, 'nope-xyz.cjs')));\n",
    stdout: "MODULE_NOT_FOUND\n",
    exit: 0,
  },
  {
    // The optional-dependency idiom, whole. Node cannot resolve the
    // specifier, throws MODULE_NOT_FOUND at the require, the program's own
    // catch swallows it and answers null. Before this file the compiled
    // program also answered null — by swallowing an SC2011 of its own,
    // which is the same answer for a reason that would have been wrong the
    // moment the module existed.
    name: "a literal specifier nothing installed resolves throws Node's MODULE_NOT_FOUND",
    src:
      "try { var m = require('no-such-pkg-xyz'); console.log('GOT') }\n" +
      "catch (e) { console.log('code', e.code, '|', String(e.message).split('\\n')[0]) }\n" +
      "console.log('after')\n",
    stdout: "code MODULE_NOT_FOUND | Cannot find module 'no-such-pkg-xyz'\nafter\n",
    exit: 0,
  },
  {
    // A constant ONE BINDING AWAY is the same require — the cell the
    // handover called out by name: it used to reach a different emitter
    // than the written literal and answer null.
    //
    // The TWO SPELLINGS reach the answer by different roads and both are
    // here because only one of them is the constant fold. `const` gives
    // the checker a string LITERAL type, so the specifier is known at
    // compile time and the verdict is decided there. `var` WIDENS to
    // `string`, so nothing is known at compile time and the same answer
    // comes out of the RUN-TIME verdict instead. Testing only `const`
    // would leave the run-time road unproven; only `var`, the fold.
    name: "a constant one binding away is the literal, both spellings",
    src:
      "const CN = 'no-such-pkg-xyz';\n" +
      "var VN = 'no-such-pkg-xyz';\n" +
      "try { var a = require(CN); console.log('GOT') }\n" +
      "catch (e) { console.log('const', e.code, '|', String(e.message).split('\\n')[0]) }\n" +
      "try { var b = require(VN); console.log('GOT') }\n" +
      "catch (e) { console.log('var  ', e.code, '|', String(e.message).split('\\n')[0]) }\n",
    stdout:
      "const MODULE_NOT_FOUND | Cannot find module 'no-such-pkg-xyz'\n" +
      "var   MODULE_NOT_FOUND | Cannot find module 'no-such-pkg-xyz'\n",
    exit: 0,
  },
  {
    // The program the NODE_PATH control below re-runs with NODE_PATH set.
    // Here, with it unset, its answer is Node's own — which is the half
    // of that control that keeps "fence whenever anything is uncertain"
    // from passing it.
    name: "the bare specifier the NODE_PATH control reuses",
    src:
      "function g(s) { try { require(s); return 'GOT' } catch (e) { return e.code } }\n" +
      "console.log(g('np-only-xyz'));\n",
    stdout: "MODULE_NOT_FOUND\n",
    exit: 0,
  },
  {
    // A genuine RUN-TIME specifier — the zapo row's own shape. The build
    // cannot know the string, so the verdict is decided at run time
    // against the set of bare specifier roots the build could resolve.
    name: "a run-time specifier nothing installed resolves throws MODULE_NOT_FOUND",
    src:
      "function g(s) { try { return require(s) } catch (e) { return e.code + '|' + String(e.message).split('\\n')[0] } }\n" +
      "console.log(g('no-such-pkg-xyz'));\n" +
      "console.log(g('@nope/nothing'));\n" +
      "console.log(g('@nope/nothing/sub'));\n",
    stdout:
      "MODULE_NOT_FOUND|Cannot find module 'no-such-pkg-xyz'\n" +
      "MODULE_NOT_FOUND|Cannot find module '@nope/nothing'\n" +
      "MODULE_NOT_FOUND|Cannot find module '@nope/nothing/sub'\n",
    exit: 0,
  },
  {
    // protobufjs's inquire(), verbatim (the `typeof require` guard
    // included — it must fold to "function", because this IS a CommonJS
    // module), over a specifier nothing resolves. zapo's own site.
    name: "protobufjs inquire() over an absent optional dependency answers null",
    src:
      "function inquire(moduleName) {\n" +
      "  try {\n" +
      "    if (typeof require !== 'function') return null;\n" +
      "    var mod = require(moduleName);\n" +
      "    return mod && (mod.length || Object.keys(mod).length) ? mod : null;\n" +
      "  } catch (e) {}\n" +
      "  return null;\n" +
      "}\n" +
      "console.log('long ->', String(inquire('long')));\n" +
      "console.log('done');\n",
    stdout: "long -> null\ndone\n",
    exit: 0,
  },
  {
    // A name that is a PREFIX of an installed one, and one the installed
    // name is a prefix of. Both are MODULE_NOT_FOUND: the membership test
    // requires BOTH delimiters, so "myli" and "mylibx" cannot match
    // "mylib". Without that the set would answer for names nothing
    // installs — the loud direction, but wrong all the same.
    name: "a prefix of an installed package name is not that package",
    src:
      "function g(s) { try { require(s); return 'GOT' } catch (e) { return e.code } }\n" +
      "console.log(g('myli'), g('mylibx'));\n",
    stdout: "MODULE_NOT_FOUND MODULE_NOT_FOUND\n",
    exit: 0,
  },
  {
    // Node validates the id BEFORE it resolves anything, and the
    // "Received" tail is rendered from the value.
    name: "Node's own argument errors, literal and run-time",
    src:
      "function g(x) { try { require(x); return 'GOT' } catch (e) { return e.code + '/' + e.message } }\n" +
      "console.log(g(42));\n" +
      "console.log(g(null));\n" +
      "console.log(g(undefined));\n" +
      "console.log(g(''));\n",
    stdout:
      'ERR_INVALID_ARG_TYPE/The "id" argument must be of type string. Received type number (42)\n' +
      'ERR_INVALID_ARG_TYPE/The "id" argument must be of type string. Received null\n' +
      'ERR_INVALID_ARG_TYPE/The "id" argument must be of type string. Received undefined\n' +
      "ERR_INVALID_ARG_VALUE/The argument 'id' must be a non-empty string. Received ''\n",
    exit: 0,
  },
  {
    // The WRITTEN empty specifier, which is a different road to the
    // same answer than the entry above: a literal is knowable at
    // compile time, so it never reaches scr_require_verdict, and the
    // static arm walked node_modules for it instead -- where
    // join(dir, "node_modules", "") IS the node_modules directory, so
    // the probe answered "resolvable" and the site refused SC1090
    // where Node throws a coded TypeError. Both spellings are here
    // because a test of either alone passes for a compiler that gets
    // the other wrong.
    name: "the WRITTEN empty specifier is Node's argument error, not a refusal",
    src:
      "try { require('') } catch (e) { console.log(e.code, e instanceof TypeError, e.message) }\n" +
      "var s = '';\n" +
      "try { require(s) } catch (e) { console.log(e.code) }\n" +
      "function f() { return '' }\n" +
      "try { require(f()) } catch (e) { console.log(e.code) }\n",
    stdout:
      "ERR_INVALID_ARG_VALUE true The argument 'id' must be a non-empty string. Received ''\n" +
      "ERR_INVALID_ARG_VALUE\n" +
      "ERR_INVALID_ARG_VALUE\n",
    exit: 0,
  },
  {
    // The specifier EXPRESSION evaluates before the resolution fails —
    // the throw must not be hoisted over the argument's side effects.
    name: "the specifier expression runs before the resolution fails",
    src:
      "function spec() { console.log('spec ran'); return 'no-such-pkg-xyz' }\n" +
      "try { require(spec()) } catch (e) { console.log('code', e.code) }\n",
    stdout: "spec ran\ncode MODULE_NOT_FOUND\n",
    exit: 0,
  },
  {
    // The bare side-effect form. Its message was already right; its
    // `code` was `undefined`, which is the property the idiom reads.
    name: "the side-effect form carries the code, not only the message",
    src:
      "try { require('no-such-pkg-xyz') } catch (e) { console.log('code', e.code) }\n" +
      "console.log('after');\n",
    stdout: "code MODULE_NOT_FOUND\nafter\n",
    exit: 0,
  },
  {
    // `require` NOT called. In a JavaScript source every stdlib global
    // taken as a bare value became the interned identity TOKEN
    // `"[builtin require]"`, so all four of these printed "string"
    // against Node's "function" — and the last line is protobufjs's own
    // guard one binding away: `inquire()` reads
    // `if ("function" != typeof require) return null`, and an alias of
    // it answered "absent" for a require that works.
    name: "require as a VALUE is a function in every value position",
    src:
      "const r = require;\n" +
      "const a = [require];\n" +
      "const o = { q: require };\n" +
      "console.log(typeof require, typeof r, typeof a[0], typeof o.q);\n" +
      "console.log('function' === typeof r ? 'usable' : 'absent');\n" +
      "console.log(require === r);\n",
    stdout: "function function function function\nusable\ntrue\n",
    exit: 0,
  },
  {
    // Calling THROUGH the value is the same require: the lifted body IS
    // the run-time-specifier arm the direct call lowers to, so a
    // specifier the build ruled out reaches Node's MODULE_NOT_FOUND here
    // exactly as it does at a call site. It used to be a TypeError on a
    // string.
    name: "a call through the alias is the same require: Node's MODULE_NOT_FOUND",
    src:
      "const r = require;\n" +
      "try { r('no-such-pkg-xyz'); console.log('no throw') } " +
      "catch (e) { console.log(e.code, /Cannot find module 'no-such-pkg-xyz'/.test(e.message)) }\n",
    stdout: "MODULE_NOT_FOUND true\n",
    exit: 0,
  },
  {
    // Node checks the ARGUMENT before it resolves anything, so the value
    // form has to as well — which is why the lifted parameter is dyn and
    // not string: a string parameter would make r(42) a compile-time type
    // error the direct call form does not have.
    name: "a call through the alias checks Node's argument types first",
    src:
      "const r = require;\n" +
      "try { r(42) } catch (e) { console.log(e.code) }\n" +
      "try { r('') } catch (e) { console.log(e.code) }\n",
    stdout: "ERR_INVALID_ARG_TYPE\nERR_INVALID_ARG_VALUE\n",
    exit: 0,
  },
  {
    name: "require PASSED to a function and called there",
    src:
      "function use(f) { try { return f('no-such-pkg-xyz') } catch (e) { return 'caught ' + e.code } }\n" +
      "console.log(use(require));\n",
    stdout: "caught MODULE_NOT_FOUND\n",
    exit: 0,
  },
  {
    // THE OVER-FIRE CONTROL for the loose-file roots. Node's LOAD_AS_FILE
    // list is exactly ["", ".js", ".json", ".node"] — `.mjs` is NOT in it,
    // measured against Node v25.9.0 — so `node_modules/dmjs.mjs` leaves
    // `require("dmjs")` throwing MODULE_NOT_FOUND. A fix that simply
    // stripped every extension off every entry would answer the refusal
    // here instead, and this cell is what catches that.
    name: "a loose .mjs in node_modules spells NO bare root",
    src:
      "function g(s) { try { return 'GOT ' + require(s) } catch (e) { return 'threw ' + e.code } }\n" +
      "console.log(g('dmjs'));\n",
    stdout: "threw MODULE_NOT_FOUND\n",
    exit: 0,
  },
  /* ── the neighbours ────────────────────────────────────────────────── */
  {
    name: "NEIGHBOUR: a literal relative require still imports its module",
    src: "var m = require('./m.cjs');\nconsole.log(m.v, m.tag);\n",
    stdout: "42 from-m\n",
    exit: 0,
  },
  {
    name: "NEIGHBOUR: a literal builtin require still binds the namespace",
    src: "var p = require('node:path');\nconsole.log(p.join('a', 'b') === 'a' + require('node:path').sep + 'b');\n",
    stdout: "true\n",
    exit: 0,
  },
  {
    name: "NEIGHBOUR: the required module's body runs at the require, once",
    src:
      "console.log('before');\n" +
      "var s = require('./side.cjs');\n" +
      "console.log('after', s.n);\n",
    stdout: "before\nside body\nafter 7\n",
    exit: 0,
  },
  {
    // A LOCAL binding named `require` is not the module global, and must
    // keep whatever the program gave it.
    name: "NEIGHBOUR: a local binding named require is not the module global",
    src:
      "function require(x) { return 'local:' + x }\n" +
      "console.log(require('no-such-pkg-xyz'));\n",
    stdout: "local:no-such-pkg-xyz\n",
    exit: 0,
  },
  {
    // Node defines no `require` in an ES module at all, so the CommonJS
    // sniff every vendored bundle opens with must answer "undefined".
    name: "NEIGHBOUR: an ES module has no require",
    ext: ".mjs",
    src: "console.log(typeof require);\n",
    stdout: "undefined\n",
    exit: 0,
  },
  {
    // A node_modules DIRECTORY is not a package root: `require` still has
    // to find a module INSIDE it. The set carried every directory name
    // the walk saw, so each of these four fenced a specifier Node answers
    // with its own catchable MODULE_NOT_FOUND — and the first of them,
    // the `@types/*` shape, is in almost every node_modules tree there
    // is. Measured against Node v25.9.0 over 26 package shapes; the four
    // here are the ones with no manifest at all, a manifest with no
    // "main", a directory whose only index is `index.mjs` (NOT in Node's
    // LOAD_INDEX list), and a "main" that resolves to nothing with no
    // index to fall back to.
    name: "a node_modules directory Node cannot load is MODULE_NOT_FOUND, not a fence",
    src:
      "function g(s) { try { require(s); return 'GOT' } catch (e) { return e.code } }\n" +
      "console.log(g('typesonly'), g('emptydir'), g('mjsonly'), g('nomainnoidx'));\n",
    stdout: "MODULE_NOT_FOUND MODULE_NOT_FOUND MODULE_NOT_FOUND MODULE_NOT_FOUND\n",
    exit: 0,
  },
  {
    // The WRITTEN spelling of the same question. It is a different road —
    // probeNodeRequireRefusal rather than the baked root set — through
    // the same predicate, and a fix that moved only one of the two would
    // leave the other answering differently for the same specifier.
    name: "a WRITTEN specifier naming a directory Node cannot load is MODULE_NOT_FOUND",
    src: "try { require('typesonly'); console.log('GOT') } catch (e) { console.log(e.code) }\n",
    stdout: "MODULE_NOT_FOUND\n",
    exit: 0,
  },
  {
    // The no-over-fire control for the require-property fence below, and
    // the load-bearing half of it. An ARBITRARY property of `require` is
    // `undefined` in JavaScript and Node agrees — `require` has a real
    // function value here — so only the four names Node actually defines
    // may refuse. `require.main.filename` keeps its exact answer: that
    // chain is claimed whole, ahead of the fence.
    name: "an arbitrary property of require stays undefined, and require.main.filename stays exact",
    src: "console.log(require.zzz === undefined, typeof require.main.filename, typeof require);\n",
    stdout: "true string function\n",
    exit: 0,
  },
];

/** The shapes that must STILL refuse — every one of them because the
 * value they would have to answer is a module namespace object, which has
 * no value representation in a compiled program.
 *
 * They are checked by RUNNING the built program (a JS file's fence is
 * deferred into the translation unit, so the build succeeds) and reading
 * the SC code back off the thrown error. `caught` says whether the
 * program's own catch swallows the fence: under the deferred-fence stance
 * a refusal inside a `try` IS catchable, and that is the lane zapo builds
 * in — recorded, not hidden. */
const FENCED: readonly {
  readonly name: string;
  readonly src: string;
  /** The fixture's own package.json, when the answer depends on it. */
  readonly pkg?: string;
  readonly code: string;
  /** What Node v25.9.0 answers — the distance still to go, written down. */
  readonly nodeSays: string;
  readonly stdout: string;
}[] = [
  {
    // The other half of the 'node:' class, and the reason the name table
    // alone does not close the row: a name Node DOES serve is a module,
    // and a module is a value this compiler has no representation for.
    name: "a run-time 'node:' name Node DOES serve still refuses",
    src:
      "function g(s) { try { return 'GOT ' + typeof require(s) } catch (e) { return 'threw ' + e.code } }\n" +
      "console.log(g('node:fs'), g('node:fs/promises'));\n",
    code: "SC2020",
    nodeSays: "GOT object GOT object",
    stdout: "threw SC2020 threw SC2020\n",
  },
  {
    // A '#' key that MATCHES. The imports map is read at build time and
    // the match is decided at run time, and both roads end at the same
    // wall as everything else here.
    name: "a '#' import key that MATCHES still refuses",
    pkg: '{ "name": "require-parity-probe", "version": "0.0.0", "imports": { "#ok": "./m.cjs", "#pat/*": "./*.cjs" } }\n',
    src:
      "function g(s) { try { return 'GOT ' + require(s).v } catch (e) { return 'threw ' + e.code } }\n" +
      "console.log(g('#ok'), g('#pat/m'));\n",
    code: "SC2020",
    nodeSays: "GOT 42 GOT 42",
    stdout: "threw SC2020 threw SC2020\n",
  },
  {
    // The boundary of the filesystem arm, from the other side: the path
    // is THERE, so nothing is proven and the refusal stands. This is the
    // entry that fails if somebody ever makes the absence probe answer
    // for presence too — which would be reading a file, and would be the
    // embedded engine this objective excludes.
    name: "an ABSOLUTE specifier that DOES resolve still refuses",
    src:
      "var path = require('path');\n" +
      "function g(s) { try { return 'GOT ' + require(s).v } catch (e) { return 'threw ' + e.code } }\n" +
      "console.log(g(path.resolve(__dirname, 'm.cjs')));\n",
    code: "SC2020",
    nodeSays: "GOT 42",
    stdout: "threw SC2020\n",
  },
  {
    name: "a run-time specifier naming an INSTALLED package",
    src:
      "function g(s) { try { var m = require(s); return 'GOT ' + m.v } catch (e) { return 'threw ' + e.code } }\n" +
      "console.log(g('mylib'));\n",
    code: "SC2020",
    nodeSays: "GOT 42",
    stdout: "threw SC2020\n",
  },
  {
    name: "a run-time specifier naming a builtin",
    src:
      "function g(s) { try { var m = require(s); return 'GOT ' + typeof m } catch (e) { return 'threw ' + e.code } }\n" +
      "console.log(g('node:path'), g('vm'));\n",
    code: "SC2020",
    nodeSays: "GOT object GOT object",
    stdout: "threw SC2020 threw SC2020\n",
  },
  {
    name: "a run-time RELATIVE specifier naming a program module",
    src:
      "function g(s) { try { var m = require(s); return 'GOT ' + m.v } catch (e) { return 'threw ' + e.code } }\n" +
      "console.log(g('./m.cjs'));\n",
    code: "SC2020",
    nodeSays: "GOT 42",
    stdout: "threw SC2020\n",
  },
  {
    // The BOUNDARY this branch created, recorded rather than hidden. The
    // identity-token spelling made this cell pass by accident — two
    // mentions of one interned string compare equal — and a container
    // slot in a JavaScript source is checked-dynamic, so comparing the
    // real closure against the dyn it was boxed into fences. The alias
    // form (`require === r`) answers Node's `true` and is in RUNS above;
    // this is the one cell that went the other way, from a right answer
    // for a wrong reason to a refusal.
    name: "identity through a CONTAINER slot, the cell this branch moved backwards",
    src:
      "const a = [require];\n" +
      "try { console.log('GOT', require === a[0]) } catch (e) { console.log('threw', e.code) }\n",
    code: "SC1100",
    nodeSays: "GOT true",
    stdout: "threw SC1100\n",
  },
  {
    name: "a call through the alias naming a program module",
    src:
      "const r = require;\n" +
      "try { console.log('GOT', r('./m.cjs').v) } catch (e) { console.log('threw', e.code) }\n",
    code: "SC2020",
    nodeSays: "GOT 42",
    stdout: "threw SC2020\n",
  },
  {
    name: "a call through the alias naming an INSTALLED package",
    src:
      "const r = require;\n" +
      "try { console.log('GOT', r('mylib').v) } catch (e) { console.log('threw', e.code) }\n",
    code: "SC2020",
    nodeSays: "GOT 42",
    stdout: "threw SC2020\n",
  },
  {
    // A package ROOT need not be a DIRECTORY. Node tries LOAD_AS_FILE on
    // `node_modules/filepkg` before LOAD_AS_DIRECTORY, so the loose
    // `filepkg.js` resolves and hands back a module. Both halves of the
    // require machinery asked only isDirectory, "proved" nothing
    // installed resolved it, and compiled this to Node's catchable
    // MODULE_NOT_FOUND — a THROW where Node returns a module, and the
    // program's own catch swallows it. It refuses now, which is the loud
    // direction; what it would take to MATCH is the module value.
    name: "a LITERAL specifier a loose node_modules FILE resolves",
    src: "try { console.log('GOT', require('filepkg').v) } catch (e) { console.log('threw', e.code) }\n",
    code: "SC2013",
    nodeSays: "GOT 42",
    stdout: "threw SC2013\n",
  },
  {
    // The same three roots reached through a RUN-TIME specifier, where
    // the verdict is decided at run time against the baked root set. All
    // three used to answer MODULE_NOT_FOUND.
    name: "RUN-TIME specifiers a loose node_modules FILE resolves",
    src:
      "function g(s) { try { return 'GOT ' + require(s).v } catch (e) { return 'threw ' + e.code } }\n" +
      "console.log(g('filepkg'), g('jsonpkg'), g('@s/sfile'));\n",
    code: "SC2020",
    nodeSays: "GOT 42 GOT 7 GOT 9",
    stdout: "threw SC2020 threw SC2020 threw SC2020\n",
  },
  {
    // The wall, named: a required module used AS A VALUE. Everything in
    // this list needs it, and it is the reason a run-time specifier that
    // DOES resolve cannot be served.
    name: "a literal relative require used as a value",
    src:
      "var m = require('./m.cjs');\n" +
      "try { console.log('GOT', Object.keys(m).length) } catch (e) { console.log('threw', e.code) }\n",
    code: "SC1090",
    nodeSays: "GOT 2",
    stdout: "threw SC1090\n",
  },
  {
    // The four properties Node DEFINES on the CommonJS `require`
    // function: `Object.keys(require)` in Node v25.9.0 is exactly
    // `resolve,main,extensions,cache`. Every one of them answered
    // `undefined` on BOTH backends at exit 0 with no diagnostic, so
    // `if (require.main === module)` — the canonical CommonJS
    // entry-point test — took the WRONG BRANCH through the first of
    // them. They refuse now, which is the loud direction.
    //
    // `resolve` is the one of the four that is servable in principle:
    // its answer is a PATH STRING, not a module value, so the
    // module-namespace wall the rest of this file is about does not
    // stand in front of it. Nothing serves it yet, and this entry is
    // where that shows.
    name: "the four properties Node defines on require refuse instead of answering undefined",
    src:
      "try { console.log('main ' + (require.main === undefined)) } catch (e) { console.log('main threw ' + e.code) }\n" +
      "try { console.log('cache ' + (require.cache === undefined)) } catch (e) { console.log('cache threw ' + e.code) }\n" +
      "try { console.log('ext ' + (require.extensions === undefined)) } catch (e) { console.log('ext threw ' + e.code) }\n" +
      "try { console.log('resolve ' + (typeof require.resolve)) } catch (e) { console.log('resolve threw ' + e.code) }\n",
    code: "SC1090",
    nodeSays: "main false / cache false / ext false / resolve function",
    stdout: "main threw SC1090\ncache threw SC1090\next threw SC1090\nresolve threw SC1090\n",
  },
  {
    // THE CELL NOBODY HAD SCORED, and it is the one that decides what
    // "close the first two groups" could ever mean. Every other relative
    // and absolute entry in this file names a file the build NEVER
    // COMPILED, so serving it would need a run-time JavaScript loader —
    // the embedded engine this objective exists to exclude. Here the same
    // `m.cjs` is IN the compiled program, pulled in by the top-level
    // require above, so the module value is the one population the build
    // can enumerate completely.
    //
    // It still refuses, and the second half says why the refusal is not
    // one step away from an answer: Node hands the SAME object back to
    // both roads (`identity=true`), and a compiled module's exports are
    // C globals with no object anywhere — so an object built for this
    // would be a SNAPSHOT, and a write through either binding would
    // vanish from the other.
    name: "a relative specifier naming a module the build COMPILED still refuses",
    src:
      "var mm = require('./m.cjs');\n" +
      "function g(s) { try { var m = require(s); return 'GOT ' + m.v } catch (e) { return 'threw ' + e.code } }\n" +
      "var same = 'n/a';\n" +
      "try { same = String(require('./m.cjs') === mm) } catch (e) { same = 'threw ' + e.code }\n" +
      "console.log(g('./m.cjs') + ' identity=' + same);\n",
    code: "SC2020",
    nodeSays: "GOT 42 identity=true",
    stdout: "threw SC2020 identity=threw SC1090\n",
  },
  {
    // The CONSERVATIVE half of the package-root predicate, pinned from
    // the side that would break first. An "exports" field of any shape
    // keeps its root — the map is not modelled — and so does a manifest
    // that will not parse. Node throws for both, and for NEITHER does it
    // throw MODULE_NOT_FOUND (it answers MODULE_NOT_FOUND for the first
    // only because the target is missing, and ERR_INVALID_PACKAGE_CONFIG
    // for the second), so compiling either to MODULE_NOT_FOUND would be a
    // wrong error rather than a refusal. This fails the day somebody
    // makes the predicate answer for an exports map.
    name: "a package root with an exports map, or an unreadable manifest, keeps its refusal",
    src:
      "function g(s) { try { require(s); return 'GOT' } catch (e) { return e.code } }\n" +
      "console.log(g('expmissing'), g('badjson'));\n",
    code: "SC2020",
    nodeSays: "MODULE_NOT_FOUND ERR_INVALID_PACKAGE_CONFIG",
    stdout: "SC2020 SC2020\n",
  },
  {
    // THE FENCE IS ALREADY NOT LOUD HERE, and this row exists to keep that
    // written down, because it is the cell that decides whether SC2020 may
    // be replaced by a run-time MODULE_NOT_FOUND.
    //
    // The argument for replacing it goes: a miss should throw Node's own
    // MODULE_NOT_FOUND, and protobufjs's inquire() catches, so the program
    // sees exactly what it sees on a host where the module is absent. That
    // is true for a specifier NOTHING resolves — 'long' — and the row above
    // and corpus 5970 both prove it, byte for byte.
    //
    // It is false for a specifier Node DOES serve, and 'buffer' is one of
    // the two protobufjs itself inquires for. Measured on both lanes: Node
    // answers the module, the compiled program answers null, at exit 0,
    // with nothing printed — because the SC2020 is thrown INTO the
    // program's own catch and swallowed there. So the refusal is already
    // silent at exactly the population a MODULE_NOT_FOUND would be silent
    // at, and replacing it would not trade a loud answer for a quiet one:
    // it would trade an attributable wrong answer for one that reads
    // exactly like Node's, for a builtin that is never actually absent.
    //
    // The uncaught spelling is the control: there the code is still visible,
    // and that visibility is the only thing the tag is still buying.
    name: "the refusal is SWALLOWED whole by the idiom, for a specifier Node DOES serve",
    src:
      "function inquire(moduleName) {\n" +
      "  try {\n" +
      "    if (typeof require !== 'function') return null\n" +
      "    var mod = require(moduleName)\n" +
      "    return mod && (mod.length || Object.keys(mod).length) ? mod : null\n" +
      "  } catch (e) { /* protobufjs swallows it, whatever it is */ }\n" +
      "  return null\n" +
      "}\n" +
      "function raw(s) { try { require(s); return 'GOT' } catch (e) { return e.code } }\n" +
      "console.log('caught', String(inquire('buffer') === null ? 'null' : 'MODULE'))\n" +
      "console.log('uncaught', raw('buffer'))\n",
    code: "SC2020",
    nodeSays: "caught MODULE / uncaught GOT",
    stdout: "caught null\nuncaught SC2020\n",
  },
];

let lab = "";
interface Built {
  ok: boolean;
  diags: { code: string; message: string }[];
  binaryPath?: string;
}
const BUILT = new Map<string, Built>();

async function build(name: string, p: { src: string; ext?: string; pkg?: string }, backend: Lane): Promise<Built> {
  const dir = join(lab, `${name.replace(/[^a-z0-9]+/gi, "-").slice(0, 60)}-${backend}`);
  await mkdir(join(dir, "node_modules", "mylib"), { recursive: true });
  await mkdir(join(dir, "node_modules", "@s"), { recursive: true });
  for (const d of ["typesonly", "emptydir", "mjsonly", "nomainnoidx", "expmissing", "badjson"]) {
    await mkdir(join(dir, "node_modules", d), { recursive: true });
  }
  await writeFile(
    join(dir, "package.json"),
    p.pkg ?? '{ "name": "require-parity-probe", "version": "0.0.0" }\n',
    "utf8",
  );
  await writeFile(join(dir, "m.cjs"), M, "utf8");
  await writeFile(join(dir, "side.cjs"), "console.log('side body');\nmodule.exports = { n: 7 };\n", "utf8");
  await writeFile(join(dir, "node_modules", "mylib", "package.json"), MYLIB_PKG, "utf8");
  await writeFile(join(dir, "node_modules", "mylib", "index.js"), MYLIB_JS, "utf8");
  await writeFile(join(dir, "node_modules", "mylib", "index.d.ts"), MYLIB_DTS, "utf8");
  await writeFile(join(dir, "node_modules", "filepkg.js"), LOOSE_JS, "utf8");
  await writeFile(join(dir, "node_modules", "filepkg.d.ts"), MYLIB_DTS, "utf8");
  await writeFile(join(dir, "node_modules", "jsonpkg.json"), LOOSE_JSON, "utf8");
  await writeFile(join(dir, "node_modules", "@s", "sfile.js"), LOOSE_SCOPED_JS, "utf8");
  await writeFile(join(dir, "node_modules", "dmjs.mjs"), LOOSE_MJS, "utf8");
  // DIRECTORIES Node's own LOAD_AS_DIRECTORY comes up EMPTY in. The root
  // set used to carry every directory name it saw, so every one of these
  // FENCED a specifier Node answers with its catchable MODULE_NOT_FOUND.
  // `typesonly` is the `@types/*` shape — a manifest with "types", no
  // "main", and a .d.ts beside it — and it is why the class matters at
  // all: it sits in almost every node_modules tree there is.
  await writeFile(join(dir, "node_modules", "typesonly", "package.json"), TYPESONLY_PKG, "utf8");
  await writeFile(join(dir, "node_modules", "typesonly", "index.d.ts"), TYPESONLY_DTS, "utf8");
  await writeFile(join(dir, "node_modules", "mjsonly", "index.mjs"), LOOSE_MJS, "utf8");
  await writeFile(join(dir, "node_modules", "nomainnoidx", "package.json"), NOMAIN_PKG, "utf8");
  // The CONSERVATIVE half, from the other side. An "exports" field of any
  // shape and a manifest that will not parse both KEEP their root, so
  // both keep the refusal: Node throws for each of them, and it throws
  // something OTHER than MODULE_NOT_FOUND (this pair answers
  // MODULE_NOT_FOUND and ERR_INVALID_PACKAGE_CONFIG). A fence is never a
  // value where Node throws; these fail if anyone ever makes the
  // predicate answer for an exports map or an unreadable manifest.
  await writeFile(join(dir, "node_modules", "expmissing", "package.json"), EXPORTS_MISSING_PKG, "utf8");
  await writeFile(join(dir, "node_modules", "badjson", "package.json"), BROKEN_PKG, "utf8");
  const file = join(dir, `entry${p.ext ?? ".cjs"}`);
  await writeFile(file, p.src, "utf8");
  const res = await compile(file, {
    outPath: join(dir, exeName("program")),
    outDir: dir,
    backend,
  });
  return {
    ok: res.ok,
    diags: (res.diagnostics ?? []).map((d) => ({ code: d.code, message: d.message })),
    binaryPath: res.ok ? res.binaryPath : undefined,
  };
}

function run(
  binary: string,
  extraEnv?: Record<string, string>,
): { stdout: string; stderr: string; status: number | null } {
  // `extraEnv` exists for one thing and it is not a convenience: NODE_PATH
  // changes what Node's own require RESOLVES, so it is the only way to
  // reach the resolution road the build cannot see.
  const env = extraEnv === undefined ? process.env : { ...process.env, ...extraEnv };
  try {
    const stdout = execFileSync(binary, [], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env });
    return { stdout, stderr: "", status: 0 };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { stdout: err.stdout ?? "", stderr: err.stderr ?? "", status: err.status ?? null };
  }
}

beforeAll(async () => {
  lab = await mkdtemp(join(tmpdir(), "scriptc-require-parity-"));
  for (const backend of LANES) {
    for (const p of RUNS) BUILT.set(`R:${p.name}:${backend}`, await build(p.name, p, backend));
    for (const p of FENCED) BUILT.set(`F:${p.name}:${backend}`, await build(p.name, p, backend));
  }
}, 1_800_000);

describe("the ambient CommonJS require, against Node v25.9.0", () => {
  test.for(RUNS.map((p) => [p.name, p] as const))("%s", ([, p]) => {
    for (const backend of LANES) {
      const b = BUILT.get(`R:${p.name}:${backend}`)!;
      // NO best-effort: these must compile clean. A deferred fence
      // anywhere in them would show up as a run-time [SCxxxx] below, so
      // both halves of "it compiled" are checked.
      expect(
        b.ok,
        `${p.name} (${backend}) did not compile. Diagnostics: ` +
          b.diags.map((d) => `${d.code} ${d.message.slice(0, 160)}`).join(" | "),
      ).toBe(true);
      const r = run(b.binaryPath!);
      expect(
        /\[SC\d{4}\b/.test(r.stdout + r.stderr),
        `${p.name} (${backend}) carried a deferred compile fence into the RUN: ${(r.stdout + r.stderr).slice(0, 300)}`,
      ).toBe(false);
      expect(r.stdout, `${p.name} (${backend}) stdout`).toBe(p.stdout);
      expect(r.status, `${p.name} (${backend}) exit code`).toBe(p.exit);
    }
  });

  test.for(FENCED.map((p) => [p.name, p] as const))("still refuses: %s", ([, p]) => {
    for (const backend of LANES) {
      const b = BUILT.get(`F:${p.name}:${backend}`)!;
      expect(
        b.ok,
        `${p.name} (${backend}) did not build at all; the fence is deferred, so it should. ` +
          b.diags.map((d) => `${d.code} ${d.message.slice(0, 160)}`).join(" | "),
      ).toBe(true);
      const r = run(b.binaryPath!);
      const all = r.stdout + r.stderr;
      expect(
        all.includes(p.code),
        `${p.name} (${backend}) no longer carries ${p.code}. Node v25.9.0 answers "${p.nodeSays}"; ` +
          `if this shape now answers it too, MOVE THIS ENTRY to RUNS. If it answers something ELSE, ` +
          `that is a silent wrong answer where an installed module exists. Saw: ${all.slice(0, 400)}`,
      ).toBe(true);
      expect(r.stdout, `${p.name} (${backend}) stdout`).toBe(p.stdout);
    }
  });

  test("NODE_PATH is a resolution road the BUILD cannot see", async () => {
    // `require("x")` does not stop at the node_modules chain. Module's
    // globalPaths — every NODE_PATH entry, plus $HOME/.node_modules and
    // $HOME/.node_libraries — are searched after it, and a NODE_PATH
    // entry acts as a node_modules directory. Measured against Node
    // v25.9.0: with NODE_PATH naming a directory that holds the package,
    // `require` hands the module over from a program whose whole
    // node_modules chain has never heard of it.
    //
    // The BUILD cannot see any of that: NODE_PATH is a RUN-TIME
    // environment variable. So the arm that compiles "nothing installed
    // resolves this" to Node's catchable MODULE_NOT_FOUND was answering
    // MODULE_NOT_FOUND for a module Node hands over — on both backends —
    // and `try { require(x) } catch` swallowed it. That is the silent
    // direction, arriving through the front door of the arm built to
    // remove it.
    //
    // TWO halves, and the second is why the first is not enough alone:
    // with NODE_PATH unset the answer must STILL be Node's
    // MODULE_NOT_FOUND, or a compiler that refused everything would pass.
    const root = join(lab, "node-path-ext");
    const ext = join(root, "np-only-xyz");
    await mkdir(ext, { recursive: true });
    await writeFile(join(ext, "package.json"), '{ "name": "np-only-xyz", "main": "index.js" }\n', "utf8");
    await writeFile(join(ext, "index.js"), "module.exports = { v: 99 };\n", "utf8");
    for (const backend of LANES) {
      const b = BUILT.get(`R:the bare specifier the NODE_PATH control reuses:${backend}`)!;
      const bare = run(b.binaryPath!);
      expect(
        bare.stdout,
        `${backend}: with NODE_PATH unset this must still be Node's MODULE_NOT_FOUND`,
      ).toBe("MODULE_NOT_FOUND\n");
      const withPath = run(b.binaryPath!, { NODE_PATH: root });
      const all = withPath.stdout + withPath.stderr;
      // The program prints `e.code`, so the refusal arrives as the bare
      // SCxxxx rather than the bracketed "[SCxxxx at file:line]" tag.
      expect(
        /\bSC\d{4}\b/.test(all),
        `${backend}: NODE_PATH names a directory holding 'np-only-xyz', so Node hands the module over. ` +
          `The binary must refuse, not answer MODULE_NOT_FOUND. Saw: ${all.slice(0, 300)}`,
      ).toBe(true);
      expect(
        all.includes("MODULE_NOT_FOUND"),
        `${backend}: answered MODULE_NOT_FOUND for a module Node hands over. Saw: ${all.slice(0, 300)}`,
      ).toBe(false);
    }
  });

  test("a binary away from its sources keeps the refusal", async () => {
    // The guard the filesystem arm stands on, as its own test.
    //
    // A relative specifier's answer is a filesystem question — Node's own
    // answer differs between two machines — so the compiled binary asks
    // the same question. That is only honest while the program's SOURCES
    // are where the build recorded them. A binary shipped away from them
    // would otherwise prove "nothing is there" for a module the binary
    // CONTAINS and answer MODULE_NOT_FOUND: a fence traded for a silent
    // wrong answer, swallowed by the very try/catch this row is about.
    //
    // So the requiring file's own presence gates the whole arm, and this
    // renames it out from under an already-built binary to prove the gate
    // fires. Both lanes, because the two emitters call the runtime
    // separately.
    for (const backend of LANES) {
      const b = BUILT.get(`R:a relative specifier that resolves to nothing is MODULE_NOT_FOUND:${backend}`)!;
      const entry = join(dirname(b.binaryPath!), "entry.cjs");
      await rename(entry, `${entry}.hidden`);
      try {
        const r = run(b.binaryPath!);
        const all = r.stdout + r.stderr;
        expect(
          /\[SC2020\b/.test(all),
          `${backend}: a binary whose sources are gone proved nothing and should have refused. Saw: ${all.slice(0, 300)}`,
        ).toBe(true);
        expect(
          all.includes("MODULE_NOT_FOUND"),
          `${backend}: a binary whose sources are gone answered MODULE_NOT_FOUND — for a module it may CONTAIN. Saw: ${all.slice(0, 300)}`,
        ).toBe(false);
      } finally {
        await rename(`${entry}.hidden`, entry);
      }
    }
  });

  test("the fence never fires where the build PROVED nothing resolves", () => {
    // The one-line statement of the whole contract, as a distinct test so
    // a failure names it: a specifier the build ruled out must reach
    // Node's MODULE_NOT_FOUND and never the refusal, on either lane.
    for (const backend of LANES) {
      for (const name of [
        "a literal specifier nothing installed resolves throws Node's MODULE_NOT_FOUND",
        "a constant one binding away is the literal, both spellings",
        "a run-time specifier nothing installed resolves throws MODULE_NOT_FOUND",
        "protobufjs inquire() over an absent optional dependency answers null",
      ]) {
        const b = BUILT.get(`R:${name}:${backend}`)!;
        const r = run(b.binaryPath!);
        expect(
          /\[SC\d{4}\b/.test(r.stdout + r.stderr),
          `${name} (${backend}) fenced where Node throws MODULE_NOT_FOUND`,
        ).toBe(false);
      }
    }
  });
});
