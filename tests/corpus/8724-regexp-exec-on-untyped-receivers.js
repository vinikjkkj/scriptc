// RegExp.prototype.exec through a regex the compiler cannot type. It built
// clean and threw "'RegExp.prototype.exec' on a dynamic value is not
// supported yet", because its result is an array that also carries `index`,
// `input` and `groups` (and `indices` under /d) and a dynamic array had
// nowhere to keep a named property: `a.k = v` threw "Cannot create
// property" too. A dynamic array now carries its own named properties, and
// exec answers the real result: an unmatched capture is `undefined`, the
// `groups` object has no prototype, lastIndex is read and advanced for /g
// and /y, and the result prints, enumerates, clones and compares with its
// extras the way Node's does.
'use strict';

function T(name, f) {
  try {
    const r = f();
    console.log(name, typeof r, r !== null && typeof r === "object" ? JSON.stringify(r) : String(r));
  } catch (e) {
    console.log(name, "THROW", e.name, e.message);
  }
}
function id(v) { return v; }

function plain(re) {
  const m = re.exec("xx caab yy");
  T("result", () => m);
  T("m[0]", () => m[0]);
  T("length", () => m.length);
  T("index", () => m.index);
  T("input", () => m.input);
  T("groups", () => m.groups);
  T("isArray", () => Array.isArray(m));
  T("keys", () => Object.keys(m).join());
  T("entries", () => Object.entries(m).map((e) => e[0]).join());
  T("has index", () => "index" in m);
  T("own input", () => m.hasOwnProperty("input"));
  T("own missing", () => m.hasOwnProperty("nope"));
  T("typeof missing", () => typeof m.nope);
  T("slice is a plain array", () => Object.keys(m.slice(0)).join());
  T("map drops the extras", () => Object.keys(m.map((x) => x)).join());
  T("string", () => String(m));
  T("join", () => m.join("-"));
  T("miss", () => re.exec("zzz"));
  T("no argument searches 'undefined'", () => id(/und/).exec());
  T("number argument is ToString'd", () => id(/\d+/).exec(12345)[0]);
  T("symbol argument", () => id(/a/).exec(Symbol("s")));
}
plain(id(/a(a)?(b)?(x)?/));

// captures: a group that did not take part is undefined, not ""
function caps(re) {
  const m = re.exec("5b");
  T("captures", () => m);
  T("slot 1", () => m[1] === undefined);
  T("slot 2", () => m[2]);
  T("slot 3", () => m[3] === undefined);
  const [whole, a, b, c] = m;
  T("destructured", () => [whole, a === undefined, b, c === undefined].join("|"));
}
caps(id(/(\d)(x)?(b)?(y)?/));

// named groups: a prototype-less object, undefined for the unmatched
function named(re) {
  const m = re.exec("on 2020-05 only");
  T("named", () => m);
  T("groups.year", () => m.groups.year);
  T("groups.day", () => m.groups.day);
  T("groups keys", () => Object.keys(m.groups).join());
  const { year, month } = m.groups;
  T("destructured groups", () => year + "/" + month);
  T("groups optional", () => m.groups?.year);
}
named(id(/(?<year>\d{4})-(?<month>\d{2})(?:-(?<day>\d{2}))?/));
function dup(re) { T("duplicate names", () => re.exec("b").groups); }
dup(id(/(?:(?<x>a)|(?<x>b))/));

// /g and /y are stateful through lastIndex
function loop(re) {
  const out = [];
  let m;
  while ((m = re.exec("aa baa a")) !== null) out.push(m[0] + "@" + m.index + ":" + re.lastIndex);
  T("global loop", () => out.join(";"));
  T("lastIndex reset", () => re.lastIndex);
  re.lastIndex = 3;
  T("lastIndex honoured", () => re.exec("aa baa a").index);
  re.lastIndex = 99;
  T("lastIndex past the end", () => re.exec("aa") + "|" + re.lastIndex);
}
loop(id(/a+/g));
function sticky(re) {
  T("sticky at 0", () => re.exec("aab")[0]);
  T("sticky advanced", () => re.lastIndex);
  T("sticky miss", () => re.exec("aab") + "|" + re.lastIndex);
  re.lastIndex = 2;
  T("sticky from 2", () => re.exec("aab"));
}
sticky(id(/a+/y));
function nonglobal(re) {
  re.lastIndex = 5;
  T("lastIndex ignored without g/y", () => re.exec("aa")[0]);
  T("lastIndex untouched", () => re.lastIndex);
}
nonglobal(id(/a+/));

// flags: unicode, ignoreCase, multiline, dotAll
T("unicode", () => id(/./u).exec("\u{1F600}")[0].length);
T("non-unicode splits the pair", () => id(/./).exec("\u{1F600}")[0].length);
T("ignoreCase", () => id(/ABC/i).exec("xabcx").index);
T("multiline", () => id(/^b$/m).exec("a\nb\nc").index);
T("dotAll", () => id(/a.b/s).exec("a\nb")[0].length);
T("astral input index counts UTF-16 units", () => id(/b/).exec("\u{1F600}b").index);

// /d adds `indices`
function withIndices(re) {
  const m = re.exec("xx 2020-05");
  T("indices", () => m.indices);
  T("indices[1]", () => m.indices[1]);
  T("indices.groups", () => m.indices.groups);
  T("keys with d", () => Object.keys(m).join());
}
withIndices(id(new RegExp("(?<y>\\d+)-(?<m>\\d+)", "d")));
T("hasIndices", () => id(new RegExp("a", "d")).hasIndices + "," + id(/a/).hasIndices);
T("flags with d", () => id(new RegExp("a", "dgi")).flags);

// the properties, the surface, the agreement of read and call
function surface(re) {
  T("source", () => re.source);
  T("flags", () => re.flags);
  T("global", () => re.global);
  T("unicodeSets", () => re.unicodeSets);
  T("typeof exec", () => typeof re.exec);
  T("typeof test", () => typeof re.test);
  T("typeof compile", () => typeof re.compile);
  T("typeof nope", () => typeof re.nope);
  T("toString", () => re.toString());
  T("String", () => String(re));
  T("test", () => re.test("xaay"));
  T("a missing method", () => re.nope());
}
surface(id(/a+/g));
T("unicodeSets true", () => id(new RegExp("[\\p{L}--[a-z]]", "v")).unicodeSets);

// printing: the extras follow the elements
console.log(id(/(\d)(x)?/).exec("5"));
console.log(id(/(?<n>\d)(?<m>x)?/).exec("5"));
console.log([id(/b/).exec("abc")]);
console.log(id(/a/).exec("zzz"));
const holder = { m: id(/(\d)/).exec("7") };
console.log(holder);
const many = id(/(\d)(\d)(\d)(\d)(\d)(\d)(\d)(\d)/).exec("12345678");
console.log(many);
