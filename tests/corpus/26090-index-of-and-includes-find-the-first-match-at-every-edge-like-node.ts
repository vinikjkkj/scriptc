// String indexOf / includes / lastIndexOf-free search edges over the byte search the runtime uses: a one-byte needle, a first byte that repeats everywhere,
// a match at the very last position, a needle as long as the haystack, a needle longer than the haystack, a second occurrence after a false start, a
// fromIndex that skips the first match, and UTF-16 index translation over multi-byte and astral text.
const cases: [string, string, number | undefined][] = [
  ["abcabc", "c", undefined], ["abcabc", "c", 3], ["abcabc", "abc", 1], ["abcabc", "bca", undefined], ["abcabc", "cabc", undefined],
  ["abcabc", "abcabc", undefined], ["abcabc", "abcabcx", undefined], ["abcabc", "x", undefined], ["abcabc", "", 4], ["abcabc", "", 99],
  ["aaaaaaaaab", "aab", undefined], ["aaaaaaaaab", "aaaab", 2], ["aaaaaaaaaa", "ab", undefined], ["aaaaaaaaab", "b", undefined],
  ["xxabxxxabxx", "abx", 3], ["xxabxxxabxx", "xx", 1], ["xxabxxxabxx", "xx", 9], ["xxabxxxabxx", "xx", 10], ["ab", "ab", undefined], ["ab", "b", 1],
  ["ab", "b", 2], ["", "a", undefined], ["", "", undefined], ["a", "a", -5], ["abc", "c", -1], ["abc", "c", 1e9],
  ["héllo wörld", "ör", undefined], ["héllo wörld", "o", undefined], ["héllo wörld", "o", 5], ["€100 €200", "€2", undefined],
  ["😀 a 😀 b", "😀 b", undefined], ["😀 a 😀 b", "b", undefined], ["😀 a 😀 b", "a", 2],
  ["😀😀", "😀", 1], ["😀😀", "😀", 2], ["key: value: more", ": ", 5], ["key: value: more", ":", undefined],
];
let out = "";
for (const [h, n, from] of cases) {
  const i = from === undefined ? h.indexOf(n) : h.indexOf(n, from);
  const inc = from === undefined ? h.includes(n) : h.includes(n, from);
  out += i + (inc ? "t" : "f") + " ";
}
console.log(out);
// a long haystack with the needle only at the very end, and at every length near the haystack's
let big = "";
for (let i = 0; i < 300; i++) big += "ab" + (i % 7);
console.log(big.indexOf("ab6ab0"), big.indexOf(big.slice(-5)), big.indexOf(big.slice(-5) + "x"), big.includes(big), big.indexOf(big.slice(1)));
let all = 0;
for (let k = 0; k <= big.length; k++) all += big.indexOf(big.slice(k, k + 4)) + (big.includes(big.slice(k)) ? 1 : 0);
console.log(all);
