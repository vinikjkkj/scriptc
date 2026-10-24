// Element reads on a string value whose receiver is untyped (`line.trim()[i]`): in range it answers the one-unit string, out of range undefined.
// Keyed reads on an UNTYPED receiver whose value is a string at run time (`line.trim()[0]`).
function firstChar(line) {
  return line.trim()[0];
}
function nth(line, i) {
  return line.trim()[i];
}
console.log(firstChar('  hello'), firstChar(''), firstChar('x'));
console.log(nth('  abc ', 0), nth('  abc ', 2), nth('  abc ', 3) === undefined);
console.log(nth('ab', 1), nth('ab', 5) === undefined, typeof nth('ab', 1));
var rows = ['xy', 'z'];
for (var r = 0; r < rows.length; r++) console.log(firstChar(rows[r]), nth(rows[r], 1) === undefined);
