// A replace whose pattern is plain text: absent, present once, present many times, at both ends, with replacement directives, with case folding and sticky
// flags (which must NOT take a byte search), over non-ASCII subjects.
const subs = ["", "a", "abc", "-", "_", "a-b_c", "--__", "AbC abc", "héllo-wörld", "日本-語_x", "😀-😀", "xx=yy", "a/b/c", "tab\there", "x".repeat(300), "x".repeat(299) + "-"];
const once: RegExp[] = [/-/, /abc/, /abc/y, /ABC/i, /é/, /q/, /zzzz/, /a b/, /xx/s, /-/m];
const many: RegExp[] = [/-/g, /_/g, /abc/g, /=/g, /\//g, /ab/g, /-_/g, /a/gi, /-/gy, /x-/g, /é/g, /llo-w/g, /--/g, /xx/g, /\t/g, /a b/g, /q/g, /zzzz/g, /-/gm];
const reps = ["+", "", "$&$&", "[$`]", "$$", "$1"];
const show = (a: string): string => JSON.stringify(a.length > 40 ? a.length + ":" + a.slice(0, 12) : a);
let n = 0;
for (const s of subs) {
  for (const r of reps) {
    for (const p of once) console.log(n++, show(s.replace(p, r)));
    for (const p of many) console.log(n++, show(s.replace(p, r)), show(s.replaceAll(p, r)));
  }
}
// the string comes back equal, and a later write to a copy does not disturb the original
const orig = "plain-text";
const same = orig.replace(/zz/g, "!");
console.log(same === orig, same.length, (same + "!").length, orig);
// base64url as the REST app decodes it
function b64(v: string): string { return v.replace(/-/g, "+").replace(/_/g, "/"); }
console.log(b64("abcdef"), b64("ab-cd_ef"), b64("--__"), b64(""));
