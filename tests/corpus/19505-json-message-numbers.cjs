// JSON.parse SyntaxError text, one line per input (V8 json-parser.cc wording).
// Each input is parsed through the reviver-free path; the reviver rows follow.
const cases = [
  "-",
  "-a",
  "1.",
  "1.x",
  "1e",
  "1e+",
  "1ex",
  "01",
  "-01",
  "1.5e3.2",
  "[01]",
  "00",
  "1 2",
  "-Infinity",
  "{\"a\":-}",
  "[1.e5]",
  "[1e+]",
  "1e5e5",
];
let idx = 0;
for (const s of cases) {
  idx++;
  try {
    JSON.parse(s);
    console.log(idx, "OK", s.length);
  } catch (e) {
    console.log(idx, e.name, e instanceof SyntaxError, e.message.length, e.message);
  }
}
