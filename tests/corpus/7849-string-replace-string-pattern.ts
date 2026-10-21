// s.replace / s.replaceAll with a STRING pattern and a STRING replacement:
// first versus every occurrence, the empty pattern, GetSubstitution's $ forms
// without captures, overlapping and multibyte matches, no-match.
const s = "2024-05-06T07:08:09";
console.log(s.replace("T", " "), s.replaceAll("-", "/"), s.replace("-", "/"), s.replace("zzz", "!"));
console.log("aaa".replace("a", "$&$&"), "aaa".replaceAll("a", "[$&]"), "x".replace("x", "$$"), "x".replace("x", "$"), "x".replace("x", "$1$<n>$0"));
console.log("abc".replace("b", "[$`|$']"), "abcabc".replaceAll("b", "<$`>"), "abcabc".replaceAll("c", "<$'>"));
console.log("abc".replace("", "-"), "abc".replaceAll("", "-"), "".replace("", "x"), "".replaceAll("", "x"));
console.log("héllo wörld é".replaceAll("é", "e"), "héllo".replace("llo", "LLO"), "日本語日本".replaceAll("日", "月"), "a😀b😀".replaceAll("😀", ":)"));
console.log("aaaa".replaceAll("aa", "b"), "aaaa".replace("aa", "b"), "abab".replaceAll("ab", ""), "a.b.c".replaceAll(".", "\\."));
console.log("it's".replaceAll("'", "\\'"), "x".replaceAll("x", ""), "xx".replaceAll("x", "$$$$"));
let evals = 0;
const t = (): string => {
  evals++;
  return "q-q";
};
console.log(t().replaceAll("q", "r"), evals);
const p = "-";
const r = "+";
console.log(s.replaceAll(p, r), s.replace(p, r));
