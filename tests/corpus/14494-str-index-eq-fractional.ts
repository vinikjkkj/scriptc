// Fractional and NaN indices are not element keys: `s[1.5]` is undefined in
// JS, so it equals no string; an integer index is unchanged.
const s = "ab";
let f = 1.5;
let n = NaN;
let k = 1;
console.log(s[f] === "b", s[f] !== "b", s[n] === "a", s[n] !== "a", s[k] === "b", s[-1] === "a");
