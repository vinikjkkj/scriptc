// The capture-group shapes a function replacement value may READ — the
// positive half of the participation decision — plus the UTF-16 index
// exactness the desugar depends on.
//
// A group is admitted at type `string` when the pattern proves it
// participates in every successful match: not quantified with a zero
// minimum, no ENCLOSING alternation or zero-minimum quantifier, no
// enclosing lookaround. An alternation inside the group's OWN level is
// harmless — some branch of it matched, so the group did. The refused
// shapes (`(a)?`, `(a)|(b)` read at group 1, `x(a)*`, a group inside a
// lookaround, a `{n,m}` quantifier the scan declines) keep the SC1120
// fence and are pinned in tests/diagnostics/regex-replacer.ts.

// Proved: a bare group, a `+`-quantified group, a group whose own body
// alternates, a nested pair with no alternation anywhere above them.
console.log("aab".replace(/(a+)/g, (m: string, g: string) => "" + g.length));
console.log("ab".replace(/(a|b)/g, (m: string, g: string) => g.toUpperCase()));
console.log("ab".replace(/((a)b)/g, (m: string, g1: string, g2: string) => g2 + g1));
console.log("xay".replace(/(?:x)(a)(?:y)/g, (m: string, g: string) => "[" + g + "]"));
console.log("2026-08-14".replace(/(\d{4})-(\d\d)-(\d\d)/g, (m: string, y: string, mo: string, d: string) => d + "/" + mo + "/" + y));

// Named groups number alongside numbered ones, and the replacer reads
// them positionally like any other capture.
console.log("ab".replace(/(?<x>a)(?<y>b)/g, (m: string, a: string, b: string) => b + a));
console.log("k=v".replace(/(?<k>\w+)=(?<v>\w+)/g, (m: string, k: string, v: string) => v + "=" + k));

// A group whose OWN level alternates while an inner one does not: only
// group 1 is proved, and reading just group 1 compiles.
console.log("ab".replace(/((a)|(?:b))/g, (m: string, g: string) => "<" + g + ">"));

// A participating-EMPTY group is "" in both worlds — that state is not
// the one the fence exists for.
console.log("ab".replace(/(a)(b*)/g, (m: string, g1: string, g2: string) => g1 + "/" + g2 + "/"));
console.log("a".replace(/(a)(b*)/g, (m: string, g1: string, g2: string) => g1 + "/" + g2 + "/"));

// Every index the desugar uses is UTF-16: the drain's match start, the
// slice bounds and .length. Astral subjects and matches must land
// exactly where Node puts them.
console.log("a\u{1f600}b".replace(/b/g, (m: string) => "[" + m + "]"));
console.log("\u{1f600}\u{1f600}".replace(/\u{1f600}/gu, (m: string) => "" + m.length));
console.log("\u{1f600}a\u{1f600}".replace(/a/g, () => "\u{1f602}"));
console.log("héllo wörld".replace(/(ö\w+)/gu, (m: string, w: string) => "«" + w + "»"));
console.log("é€x".replace(/(€)/g, (m: string, g: string) => "{" + g + "}"));

// Adjacent and overlapping-looking matches, and a match at each end.
console.log("aaa".replace(/(a)/g, (m: string, g: string) => g + g));
console.log("abcabc".replace(/(abc)/g, (m: string, g: string) => g.toUpperCase()));

// Many matches over a long subject — the gap copy has to stay exact.
{
  let s = "";
  for (let i = 0; i < 200; i = i + 1) s = s + "x" + i + ";";
  const out = s.replace(/x(\d+);/g, (m: string, d: string) => "[" + d + "]");
  console.log(out.length, out.slice(0, 24), out.slice(-10));
}

// zapo's own two spellings, end to end.
{
  const safeCodePoint = (cp: number): string => {
    if (!Number.isFinite(cp) || cp < 0 || cp > 0x10ffff) return "";
    return String.fromCodePoint(cp);
  };
  const decode = (s: string): string =>
    s
      .replace(/&lt;/g, "<")
      .replace(/&#(\d+);/g, (_, n: string) => safeCodePoint(Number(n)))
      .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => safeCodePoint(Number.parseInt(hex, 16)))
      .replace(/&amp;/g, "&");
  console.log(decode("&lt;b&gt;&#65;&#8364;&#x41;&#x20AC;&amp;&#xZZ;"));
  console.log(decode("no entities here"));
  console.log(decode("&#0;".length + "|" + decode("&#1114112;") + "|" + decode("&#x110000;")));
}
