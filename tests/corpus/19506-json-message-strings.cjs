// JSON.parse SyntaxError text, one line per input (V8 json-parser.cc wording).
// Each input is parsed through the reviver-free path; the reviver rows follow.
const cases = [
  "\"abc",
  "\"abc\\",
  "\"a\u0001\"",
  "\"\\x\"",
  "\"\\u12G4\"",
  "\"\\u12",
  "\"\\u1G\"",
  "\"\\u1\"",
  "\"\\uZZZZ\"",
  "\"ctrl \n\"",
  "[\"a\u0001\"]",
  "\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\u0002\"",
  "\"cccccccccccccccccccccccccccccccccccccccc",
  "\"bad \\q\"",
  "[\"\\ud800\\u",
  "\"\\u0041\\u00e9\" x",
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
