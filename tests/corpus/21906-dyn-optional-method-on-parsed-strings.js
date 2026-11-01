// An optional method call on a value parsed from JSON: a string receiver runs
// its typed method (match), a nullish receiver short-circuits past the
// argument, a number receiver with a missing method is a checked TypeError.
const pkg = JSON.parse('{"name": "@acme/tool"}');
const scopeMatch = pkg.name?.match(/^@([^/]+)\//);
console.log(scopeMatch ? scopeMatch[1] : "none");
const none = JSON.parse('{"a": 1}');
let evals = 0;
const pattern = () => { evals++; return /x/; };
console.log(none.nope?.match(pattern()), "evals:", evals);
const n = JSON.parse('{"v": 5}');
try {
  n.v?.match(/x/);
  console.log("unreachable");
} catch (e) {
  console.log("mismatch:", e instanceof TypeError);
}
