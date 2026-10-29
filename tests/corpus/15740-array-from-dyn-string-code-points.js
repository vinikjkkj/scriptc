// Array.from(d) with NO mapper over an untyped (checked-dynamic) source that is
// a string at run time: the string iterator walks code POINTS, so an astral
// character (a surrogate pair in UTF-16) stays one element. This is the shape
// of whatwg-url's tr46 validateLabel, which splits its label with Array.from
// and reads the elements back with dyn equality and length.
function codePointsOf(label) {
  const codePoints = Array.from(label);
  return codePoints;
}
function hyphenPositions(label) {
  const codePoints = Array.from(label);
  if (codePoints[2] === "-" && codePoints[3] === "-") return "xn-like";
  return codePoints.length;
}
const astral = "a\u{1F600}b";
const cps = codePointsOf(astral);
console.log("len", cps.length, cps[0], cps[1], cps[2]);
console.log("json", JSON.stringify(cps));
console.log("ascii", JSON.stringify(codePointsOf("xyz")));
console.log("empty", JSON.stringify(codePointsOf("")));
console.log("hyphen", hyphenPositions("ab--c"));
console.log("hyphen-no", hyphenPositions("abcd"));
console.log("astral-count", hyphenPositions("\u{1F600}\u{1F601}\u{1F602}"));
let total = 0;
for (const ch of codePointsOf("\u{10FFFF}\u{10000}z")) total += ch.length;
console.log("total-units", total);
