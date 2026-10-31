// JSON.parse SyntaxError text, one line per input (V8 json-parser.cc wording).
// Each input is parsed through the reviver-free path; the reviver rows follow.
const cases = [
  "t\"",
  "t1",
  "nul1",
  "tru\"",
  "f0",
  "n\"x",
  "truex",
  "true false",
  "null,",
  "[true,nul]",
  "{\"a\":fals}",
  "[nulx]",
  "-true",
  "tr ue",
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
