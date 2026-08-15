// `s.replace(re, fn)` / `s.replaceAll(re, fn)` with a FUNCTION replacement
// value: the replacer is called once per match with the whole match and
// the prefix of capture groups it declares, and its string result is
// spliced in. The desugar is matchAll's companion-index drain plus a
// slice/concat loop — the spec's own shape (RegExp.prototype[@@replace]
// collects every match FIRST, then calls the replacer).
//
// The capture-group DECISION this pins: a group's parameter is admitted
// at type `string` only where the pattern proves the group participates
// in every successful match. Node hands a nonparticipating group
// `undefined` (distinct from a participating-empty `""`), so the
// unprovable shapes keep the compile-time fence instead of quietly
// answering "" the way divergence 51 does for match/matchAll/$1.

// Arity: the replacer sees exactly the prefix it declares.
console.log("abcabc".replace(/b/g, () => "!"));
console.log("abcabc".replace(/b/g, (m: string) => "[" + m + "]"));
console.log("a1b2".replace(/([a-z])(\d)/g, (m: string, g1: string) => m + g1 + g1));
console.log("a1b2".replace(/([a-z])(\d)/g, (m: string, g1: string, g2: string) => g2 + g1 + m));

// A NON-global regex replaces the first match only; a global one every
// match; replaceAll matches replace's global answer. No match copies.
console.log("abcabc".replace(/b/, (m: string) => "<" + m + ">"));
console.log("abcabc".replace(/b/g, (m: string) => "<" + m + ">"));
console.log("abcabc".replaceAll(/b/g, (m: string) => "<" + m + ">"));
console.log("xxx".replace(/y/, (m: string) => "?" + m), "xxx".replace(/y/g, (m: string) => "?" + m));

// Zero-length matches advance one position (AdvanceStringIndex).
console.log("ab".replace(/z?/g, () => "-"), "".replace(/z?/g, () => "-"), "aaa".replace(/(?:)/g, () => "."));

// Flags: i, m, s, y all reach the drain unchanged.
console.log("AbAb".replace(/a/gi, (m: string) => "(" + m + ")"));
console.log("l1\nl2".replace(/^l/gm, (m: string) => m.toUpperCase()));
console.log("a\nb".replace(/a.b/gs, (m: string) => "" + m.length));
console.log("abc".replace(/^/g, () => ">"), "abc".replace(/$/g, () => "<"));
console.log("aXbXc".replace(/x/giy, () => "!"));

// The result is NOT rescanned for $-directives — a function replacer's
// return value is spliced literally, unlike a template.
console.log("abc".replace(/b/g, () => "$&"), "abc".replace(/b/g, () => "$1$$$`"));
console.log("abc".replace(/b/g, () => ""));

// Call order, count and side effects: left to right, once per match.
{
  let n = 0;
  const seen: string[] = [];
  const out = "a1b2c3".replace(/([a-z])(\d)/g, (m: string, l: string, d: string) => {
    n = n + 1;
    seen.push(m + ":" + l + ":" + d);
    return d + l;
  });
  console.log(out, n, seen.join(","));
}

// A replacer that closes over mutable state, one bound to a name, and a
// replacer that itself calls replace.
{
  let k = 0;
  const bump = (): string => { k = k + 1; return "" + k; };
  console.log("aaa".replace(/a/g, bump), k);
  console.log("aa".replace(/a/g, (m: string) => m.replace(/a/g, () => "b")));
  console.log("x-y".replace(/-/g, () => "_").replace(/_/g, (m: string) => "=" + m + "="));
}

// A throw from inside the replacer unwinds the whole replace, catchably,
// and the partial result is discarded.
try {
  console.log("abc".replace(/([abc])/g, (m: string, g: string): string => {
    if (g === "b") throw new Error("boom " + m);
    return g.toUpperCase();
  }));
} catch (e) {
  console.log("caught", (e as Error).message);
}
console.log("after");

// A const-bound regex literal and a `new RegExp` over string literals
// both reach the participation proof.
{
  const RE = /(\d+)/g;
  console.log("a12b34".replace(RE, (m: string, d: string) => "" + Number(d) * 2));
  const RE2 = new RegExp("(\\w)", "g");
  console.log("ab".replace(RE2, (m: string, w: string) => w.toUpperCase()));
}
