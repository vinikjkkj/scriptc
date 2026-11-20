// A replace of plain text by a replacement without a $ directive is a byte swap: overlapping candidates, adjacent matches, a replacement that holds the pattern,
// non-ASCII replacements and subjects, the empty replacement, the first-only form, and the chain the REST app's base64url decode runs.
const subs = ["aaaa", "aaa", "aa", "a", "", "abab", "ababab", "a-a-a", "-a-", "--", "x-y_z-w_v", "héé-é", "日-本-語", "😀-😀-😀", "a".repeat(200), ("ab".repeat(100)) + "-"];
const once: RegExp[] = [/aa/, /-/, /ab/, /é/, /aaaaa/];
const many: RegExp[] = [/aa/g, /a/g, /ab/g, /-/g, /_/g, /é/g, /abab/g, /a-/g, /-a/g, /aaaa/g, /aaaaa/g];
const reps = ["", "-", "XYZ", "é", "日本", "😀", "aa", "ab-", "a\nb", "\u0000"];
const show = (a: string): string => {
  if (a.length <= 50) return JSON.stringify(a);
  let h = 0;
  for (let i = 0; i < a.length; i++) h = (h * 31 + a.charCodeAt(i)) >>> 0;
  return a.length + ":" + h;
};
let n = 0;
for (const s of subs) for (const r of reps) {
  for (const p of once) console.log(n++, show(s.replace(p, r)));
  for (const p of many) console.log(n++, show(s.replace(p, r)), show(s.replaceAll(p, r)));
}
let acc = "";
for (let i = 0; i < 40; i++) {
  const v = ("k" + i + "-_").repeat(1 + (i % 5)) + "Zz-9_".slice(0, i % 6);
  const d = v.replace(/-/g, "+").replace(/_/g, "/");
  acc += d.length + ":" + d.slice(0, 10) + ";";
}
console.log(acc);
// the original is untouched by the swap and the result is a fresh, independent string
const o = "a-b-c";
const r1 = o.replace(/-/g, "+");
const r2 = r1 + "!";
console.log(o, r1, r2, o === "a-b-c", r1 === "a+b+c");
