// `Object(x)` over a primitive answers its wrapper object: typeof "object", always truthy (a Boolean wrapper of false
// included), `valueOf` and `toString` give the primitive back, a String wrapper reads `length`, its indices and its string
// methods, ToPrimitive unwraps it in `+`, loose equality, String() and Number(), util.inspect prints `[String: 'ab']`,
// JSON.stringify writes the primitive, Object.keys lists a string's indices, and every call makes a distinct wrapper.
function mk(v) { return Object(v); }
const s = mk("ab"), n = mk(5), b = mk(false), z = mk(0), big = mk(10n);
console.log(typeof s, typeof n, typeof b, typeof big, !!b, !!z, !!s);
console.log(s.length, s[0], s[1], s[2], s + "c", n + 1, "x" + b, s.toUpperCase(), s.slice(1), s.indexOf("b"));
console.log(s.valueOf(), n.valueOf(), b.valueOf(), n.toFixed(2), n.toString(), s.toString(), b.toString());
console.log(s, n, b, big, [s], { w: b, v: n });
console.log(JSON.stringify([s, n, b]), JSON.stringify({ k: s }), Object.keys(s).join(), Object.keys(n).length);
console.log(s == "ab", n == 5, b == false, s === "ab", String(s), Number(n) + 1, Boolean(b), `${s}${n}`);
const once = mk("q");
console.log(once === once, mk("q") === mk("q"), mk(5) === 5);
const o = { a: 1 };
console.log(mk(o) === o, mk(null) !== null, typeof mk(undefined));
