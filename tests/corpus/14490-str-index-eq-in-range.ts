// A string index read compared with a string literal: in range, the unit is
// compared; the answers are the ones strict equality gives for that unit.
const s = "hello";
console.log(s[0] === "h", s[4] === "o", s[1] === "h", s[0] !== "h", s[1] !== "e");
const t: string = "ab";
console.log(t[0] == "a", t[1] != "a", t[0] != "a");
