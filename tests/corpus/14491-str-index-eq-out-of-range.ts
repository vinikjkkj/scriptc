// An out-of-range string index is undefined in JS, and undefined equals no
// string: `=== ''` is false, `!== ''` is true (charAt would answer "").
function probe(s: string, i: number): string {
  return [s[i] === "", s[i] !== "", s[i] === "x", s[i] != "x", s[i] == ""].join(",");
}
console.log(probe("abc", 3));
console.log(probe("abc", 9));
console.log(probe("", 0));
console.log(probe("abc", 1));
const e = "";
console.log(e[0] === "", e[0] !== "");
