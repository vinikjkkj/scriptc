// JSON.parse SyntaxError text, one line per input (V8 json-parser.cc wording).
// Each input is parsed through the reviver-free path; the reviver rows follow.
const cases = [
  "",
  " ",
  "\n\t",
  "[",
  "[1,",
  "{",
  "{\"a\":",
  "\"abc\\",
  "\"x\\u00",
  "tru",
  "nul",
  "fals",
  "[[",
  "{\"a\":[1,",
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
