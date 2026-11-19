// UTF-16 code-unit order: U+E000..U+FFFF (3-byte UTF-8) sorts AFTER a supplementary character (4-byte UTF-8, surrogate pair) although its bytes sort before it. The default sort over strings must agree with Node at every position of the first difference, in prefixes, and after long equal runs (word-wise scan).
const pad = "0123456789abcdef0123456789abcdef";
const words: string[] = [
  "a", "ab", "abc", "b", "", "￿", "\u{10000}", "\u{1F600}", "\u{10FFFF}", "é", "ࠀ", "퟿",
  "x", "x\u{10000}", "x￿", "x\u{1F600}y", "xy",
  pad + "", pad + "\u{10000}", pad + "￾", pad + "\u{1F600}", pad + pad + "a", pad + pad + "b", pad + pad,
  pad + "a", pad, "", "\u0000", "\u007f", "\u0080", "߿",
];
const sorted = [...words].sort();
console.log(sorted.map((w) => JSON.stringify(w)).join("|"));
const ids: string[] = [];
for (let i = 0; i < 300; i++) ids.push((i * 7919 % 1000) + (i % 3 === 0 ? "@s.whatsapp.net" : i % 3 === 1 ? "@lid" : "@g.us"));
console.log(ids.sort().slice(0, 6).join(","), ids.sort()[299]);
