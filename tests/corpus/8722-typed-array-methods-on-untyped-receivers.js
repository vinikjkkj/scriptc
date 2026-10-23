// The whole %TypedArray%.prototype surface through a receiver the compiler
// cannot type (an untyped parameter). `fill`, `join`, `indexOf`, `forEach`,
// `map`, `sort` and a dozen more used to build clean and throw "not
// supported yet" at run time where Node answers; `reduce`, `findLast`,
// `toSorted` and `with` were refused at build. Each answer below is
// compared with Node's, including the coercions and the error texts. A
// Buffer is a Uint8Array whose fill / indexOf / lastIndexOf / includes /
// slice are different methods, so it is exercised beside the plain array.
'use strict';

function id(v) { return v; }
function bytes(u) { const o = []; for (let i = 0; i < u.length; i++) o.push(u[i]); return o.join(","); }
function U(a) { return id(new Uint8Array(a)); }

function T(name, f) {
  try {
    const r = f();
    if (r instanceof Uint8Array) console.log(name, Buffer.isBuffer(r) ? "Buffer" : "Uint8Array", bytes(r));
    else console.log(name, typeof r, r !== null && typeof r === "object" ? JSON.stringify(r) : String(r));
  } catch (e) {
    console.log(name, "THROW", e.name, e.code === undefined ? "" : e.code, e.message);
  }
}
function mk() { return id(new Uint8Array([5, 3, 9, 1, 7, 3])); }
function mkb() { return id(Buffer.from([5, 3, 9, 1, 7, 3])); }

function plain(x, fresh) {
  T("length", () => x.length + "," + x.byteLength + "," + x.byteOffset + "," + x.BYTES_PER_ELEMENT);
  T("typeof fill", () => typeof x.fill);
  T("at", () => x.at(-1) + "," + x.at(0) + "," + x.at(9) + "," + x.at("1") + "," + x.at(-1.9));
  // fill: the value converts once, first; start/end are ToIntegerOrInfinity
  T("fill all", () => fresh().fill(7));
  T("fill range", () => fresh().fill(0, 1, 3));
  T("fill negative", () => fresh().fill(255, -2));
  T("fill clamps", () => fresh().fill(1, -100, 100));
  T("fill wraps", () => fresh().fill(257));
  T("fill negative value", () => fresh().fill(-1));
  T("fill fraction", () => fresh().fill(1.9));
  T("fill string value", () => fresh().fill("12"));
  T("fill undefined value", () => fresh().fill());
  T("fill coerced range", () => fresh().fill(4, "1", "3"));
  T("fill null start", () => fresh().fill(4, null, 2));
  T("fill empty range", () => fresh().fill(4, 3, 1));
  T("fill returns the receiver", () => { const y = fresh(); return y.fill(2) === y; });
  T("fill valueOf", () => fresh().fill({ valueOf() { return 9; } }));
  // search
  T("indexOf", () => x.indexOf(3));
  T("indexOf from", () => x.indexOf(3, 2));
  T("indexOf negative from", () => x.indexOf(3, -2));
  T("indexOf missing", () => x.indexOf(4));
  T("indexOf string needle is strict", () => x.indexOf("3"));
  T("indexOf NaN", () => x.indexOf(NaN));
  T("indexOf -0", () => fresh().fill(0).indexOf(-0));
  T("indexOf from past the end", () => x.indexOf(3, 99));
  T("indexOf from Infinity", () => x.indexOf(3, Infinity));
  T("indexOf from -Infinity", () => x.indexOf(3, -Infinity));
  T("lastIndexOf", () => x.lastIndexOf(3));
  T("lastIndexOf from", () => x.lastIndexOf(3, 4));
  T("lastIndexOf negative from", () => x.lastIndexOf(3, -3));
  T("lastIndexOf explicit undefined from is 0", () => x.lastIndexOf(5, undefined));
  T("lastIndexOf from -Infinity", () => x.lastIndexOf(5, -Infinity));
  T("lastIndexOf missing", () => x.lastIndexOf(8));
  T("includes", () => x.includes(9) + "," + x.includes(8) + "," + x.includes(3, 4) + "," + x.includes(NaN) + "," + x.includes("9"));
  T("includes from", () => x.includes(5, 1));
  // join
  T("join default", () => x.join());
  T("join sep", () => x.join("-"));
  T("join undefined sep", () => x.join(undefined));
  T("join number sep", () => x.join(0));
  T("join null sep", () => x.join(null));
  T("join empty", () => U(0).join("x") + "|");
  // the callback family
  T("forEach", () => { let s = 0; const idx = []; x.forEach((v, i, a) => { s += v; idx.push(i + ":" + (a === x)); }); return s + "|" + idx.join(","); });
  T("forEach thisArg", () => { const t = { k: 2 }; const o = []; x.forEach(function (v) { o.push(v * this.k); }, t); return o.join(); });
  T("forEach returns undefined", () => x.forEach(() => 1));
  T("map", () => x.map((v, i) => v * 2 + i));
  T("map wraps", () => x.map((v) => v * 100));
  T("map NaN", () => x.map(() => undefined));
  T("map string", () => x.map(() => "7"));
  T("map is a plain Uint8Array", () => x.map((v) => v) === x);
  T("filter", () => x.filter((v) => v > 4));
  T("filter none", () => x.filter(() => false));
  T("filter index", () => x.filter((v, i) => i % 2 === 0));
  T("some", () => x.some((v) => v > 8) + "," + x.some((v) => v > 9));
  T("every", () => x.every((v) => v > 0) + "," + x.every((v) => v > 3));
  T("find", () => x.find((v) => v > 5) + "," + x.find((v) => v > 50));
  T("findIndex", () => x.findIndex((v) => v > 5) + "," + x.findIndex((v) => v > 50));
  T("findLast", () => x.findLast((v) => v < 5) + "," + x.findLast((v) => v > 50));
  T("findLastIndex", () => x.findLastIndex((v) => v < 5) + "," + x.findLastIndex((v) => v > 50));
  T("empty callbacks", () => { const e = U(0); return [e.some(() => 1), e.every(() => 0), e.find(() => 1), e.findIndex(() => 1), e.findLast(() => 1), e.findLastIndex(() => 1), e.map(() => 1).length, e.filter(() => 1).length].join(); });
  T("callback not a function", () => x.forEach(5));
  T("callback undefined", () => x.map());
  T("callback is an object", () => x.some({}));
  T("callback is a string", () => x.every("f"));
  T("callback null", () => x.find(null));
  T("empty array still checks the callback", () => U(0).forEach(1));
  T("callback throws", () => x.forEach((v) => { if (v === 9) throw new RangeError("stop at " + v); }));
  T("reduce", () => x.reduce((a, b) => a + b, 0));
  T("reduce no init", () => x.reduce((a, b) => a + "," + b));
  T("reduce init undefined counts", () => x.reduce((a, b) => (a === undefined ? "u" : a) + b, undefined));
  T("reduceRight", () => x.reduceRight((a, b) => a + "," + b));
  T("reduceRight init", () => x.reduceRight((a, b, i) => a + i, ""));
  T("reduce empty with init", () => U(0).reduce((a, b) => a + b, 42));
  T("reduce empty", () => U(0).reduce((a, b) => a));
  T("reduceRight empty", () => U(0).reduceRight((a, b) => a));
  T("reduce bad callback", () => x.reduce(5));
  // order
  T("reverse", () => fresh().reverse());
  T("reverse returns the receiver", () => { const y = fresh(); return y.reverse() === y; });
  T("toReversed", () => x.toReversed());
  T("toReversed leaves the receiver", () => { const y = fresh(); y.toReversed(); return y; });
  T("sort", () => fresh().sort());
  T("sort comparator", () => fresh().sort((a, b) => b - a));
  T("sort is stable", () => fresh().sort((a, b) => (a % 2) - (b % 2)));
  T("sort NaN comparator", () => fresh().sort(() => NaN));
  T("sort bad comparator", () => fresh().sort("x"));
  T("sort object comparator", () => fresh().sort({}));
  T("sort null comparator", () => fresh().sort(null));
  T("sort empty bad comparator", () => U(0).sort(5));
  T("sort comparator throws leaves it alone", () => { const y = fresh(); try { y.sort(() => { throw new Error("x"); }); } catch (e) { return y; } });
  T("toSorted", () => x.toSorted());
  T("toSorted comparator", () => x.toSorted((a, b) => b - a));
  T("toSorted bad comparator", () => x.toSorted(5));
  T("toSorted leaves the receiver", () => { const y = fresh(); y.toSorted(); return y; });
  T("with", () => x.with(0, 99));
  T("with negative", () => x.with(-1, 99));
  T("with wraps", () => x.with(1, 300));
  T("with string index", () => x.with("2", 8));
  T("with out of range", () => x.with(6, 1));
  T("with negative out of range", () => x.with(-7, 1));
  T("with fraction", () => x.with(1.9, 4));
  T("with NaN index is 0", () => x.with(NaN, 4));
  T("with none", () => x.with());
  T("copyWithin", () => fresh().copyWithin(0, 3));
  T("copyWithin range", () => fresh().copyWithin(1, 0, 2));
  T("copyWithin overlap", () => fresh().copyWithin(2, 0));
  T("copyWithin negative", () => fresh().copyWithin(-2, 0, 2));
  T("copyWithin coerced", () => fresh().copyWithin("1", "0", "2"));
  // views, copies and bulk writes
  T("slice", () => x.slice(1, 3));
  T("slice negative", () => x.slice(-2));
  T("slice coerced", () => x.slice("1", "3"));
  T("slice copies", () => { const y = fresh(); const s = y.slice(1, 3); s[0] = 99; return y; });
  T("subarray", () => x.subarray(1, 3));
  T("subarray aliases", () => { const y = fresh(); const s = y.subarray(1, 3); s[0] = 99; return y; });
  T("subarray coerced", () => x.subarray("1", null));
  T("set array", () => { const y = fresh(); y.set([8, 8], 1); return y; });
  T("set typed array", () => { const y = fresh(); y.set(U([1, 2]), 3); return y; });
  T("set string", () => { const y = fresh(); y.set("12", 2); return y; });
  T("set array-like object", () => { const y = fresh(); y.set({ length: 2, 0: 7, 1: "8" }, 1); return y; });
  T("set array-like missing index", () => { const y = fresh(); y.set({ length: 2, 0: 7 }, 1); return y; });
  T("set number is empty", () => { const y = fresh(); y.set(5, 1); return y; });
  T("set string offset", () => { const y = fresh(); y.set([1], "2"); return y; });
  T("set overflow", () => fresh().set([1, 2, 3], 5));
  T("set negative offset", () => fresh().set([1], -1));
  T("set undefined", () => fresh().set(undefined));
  T("set null", () => fresh().set(null));
  T("toString", () => x.toString());
  T("toLocaleString", () => x.toLocaleString());
  T("toLocaleString en-US", () => x.toLocaleString("en-US"));
  T("toLocaleString empty", () => U(0).toLocaleString() + "|");
  // the read/call agreement
  T("typeof names", () => ["at", "fill", "join", "map", "reduce", "toSorted", "with", "nope"].map((n) => n + ":" + typeof x[n]).join(" "));
  T("a missing method", () => x.nope());
}

function buf(x, fresh) {
  T("slice aliases", () => { const y = fresh(); const s = y.slice(1, 3); s[0] = 99; return y; });
  T("slice is a Buffer", () => x.slice(1, 3));
  T("subarray is a Buffer", () => x.subarray(1, 3));
  T("map is a Buffer", () => x.map((v) => v + 1));
  T("filter is a Buffer", () => x.filter((v) => v > 4));
  T("toReversed is a plain Uint8Array", () => x.toReversed());
  T("toSorted is a plain Uint8Array", () => x.toSorted());
  T("with is a plain Uint8Array", () => x.with(0, 1));
  T("reverse keeps the Buffer", () => fresh().reverse());
  T("join", () => x.join("-"));
  T("toString hex", () => x.toString("hex"));
  T("toLocaleString is toString", () => id(Buffer.from("héllo")).toLocaleString());
  // Buffer.prototype.fill: encodings, patterns, number validation
  T("fill number", () => fresh().fill(7));
  T("fill number wraps", () => fresh().fill(257));
  T("fill string", () => fresh().fill("ab"));
  T("fill string encoding", () => fresh().fill("0102", "hex"));
  T("fill string offset encoding", () => fresh().fill("zz", 1, "latin1"));
  T("fill string range encoding", () => fresh().fill("ab", 1, 4, "utf8"));
  T("fill string offset end", () => fresh().fill("ab", 2, 5));
  T("fill empty string", () => fresh().fill(""));
  T("fill bytes", () => fresh().fill(U([1, 2])));
  T("fill buffer pattern", () => fresh().fill(id(Buffer.from("xyz")), 1));
  T("fill empty bytes", () => fresh().fill(U(0)));
  T("fill bool", () => fresh().fill(true));
  T("fill undefined", () => fresh().fill(undefined));
  T("fill null", () => fresh().fill(null));
  T("fill object", () => fresh().fill({}));
  T("fill range", () => fresh().fill(7, 1, 3));
  T("fill end past the length", () => fresh().fill(7, 1, 9));
  T("fill negative offset", () => fresh().fill(7, -1));
  T("fill string offset", () => fresh().fill(7, "1"));
  T("fill unknown encoding", () => fresh().fill("a", "nope"));
  T("fill returns the receiver", () => { const y = fresh(); return y.fill(1) === y; });
  // Buffer.prototype.indexOf / lastIndexOf / includes
  T("indexOf string", () => id(Buffer.from("abcabc")).indexOf("c"));
  T("indexOf string from", () => id(Buffer.from("abcabc")).indexOf("c", 3));
  T("indexOf string encoding", () => id(Buffer.from("abcabc")).indexOf("63", "hex"));
  T("indexOf string offset encoding", () => id(Buffer.from("abcabc")).indexOf("c", 3, "utf8"));
  T("indexOf number wraps", () => id(Buffer.from("abc")).indexOf(98 + 256));
  T("indexOf buffer", () => id(Buffer.from("abcabc")).indexOf(id(Buffer.from("ca"))));
  T("indexOf bytes", () => id(Buffer.from("abcabc")).indexOf(U([99])));
  T("indexOf empty string", () => id(Buffer.from("abc")).indexOf(""));
  T("indexOf NaN offset searches everything", () => id(Buffer.from("abcabc")).indexOf("b", NaN));
  T("indexOf string offset is the encoding", () => id(Buffer.from("abc")).indexOf("b", "utf8"));
  T("indexOf negative offset", () => id(Buffer.from("abcabc")).indexOf("c", -2));
  T("indexOf null offset", () => id(Buffer.from("abcabc")).indexOf("c", null));
  T("indexOf bad value", () => id(Buffer.from("abc")).indexOf({}));
  T("indexOf undefined value", () => id(Buffer.from("abc")).indexOf());
  T("indexOf unknown encoding", () => id(Buffer.from("abc")).indexOf("a", 0, "nope"));
  T("indexOf unknown encoding with bytes", () => id(Buffer.from("abc")).indexOf(id(Buffer.from("b")), 0, "nope"));
  T("lastIndexOf string", () => id(Buffer.from("abcabc")).lastIndexOf("b"));
  T("lastIndexOf string from", () => id(Buffer.from("abcabc")).lastIndexOf("b", 3));
  T("lastIndexOf number", () => id(Buffer.from("abcabc")).lastIndexOf(99));
  T("lastIndexOf negative from", () => id(Buffer.from("abcabc")).lastIndexOf("b", -3));
  T("lastIndexOf NaN from searches everything", () => id(Buffer.from("abcabc")).lastIndexOf("b", NaN));
  T("includes string", () => id(Buffer.from("abcabc")).includes("ca"));
  T("includes number", () => id(Buffer.from("abc")).includes(98) + "," + id(Buffer.from("abc")).includes(7));
  T("includes from", () => id(Buffer.from("abcabc")).includes("a", 4) + "," + id(Buffer.from("abcabc")).includes("a", 5));
  T("includes encoding", () => id(Buffer.from("abc")).includes("6263", "hex"));
}

plain(mk(), mk);
buf(mkb(), mkb);
// a plain Uint8Array and a Buffer are told apart by their methods, and a plain array of numbers is not either
function kind(x) { return typeof x.includes + ":" + (x.indexOf("c") === -1 ? "strict" : "string"); }
console.log(kind(mk()), kind(id(Buffer.from("abc"))));
