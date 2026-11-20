// el upper-casing: U+03F5 (the lunate epsilon symbol) takes the vowel rule, so an accent on it before iota or upsilon adds the dialytika. Found by a wide-mark-pool fuzz.
const hx = (s: string): string => Array.from(s).map((c) => (c.codePointAt(0) as number).toString(16)).join(" ");
const cases = ["ϵ́ι", "ϵ́υ", "ιϵ́ι", "ϵ̑ῐ", "ϵ́̈ι", "ϵ̈", "ϵͅ", "έι", "ϵ͂ι"];
for (const c of cases) console.log(hx(c), "->", hx(c.toLocaleUpperCase("el")), hx(c.toLocaleUpperCase(["el"])), hx(c.toLocaleUpperCase()));
