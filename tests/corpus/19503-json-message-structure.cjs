// JSON.parse SyntaxError text, one line per input (V8 json-parser.cc wording).
// Each input is parsed through the reviver-free path; the reviver rows follow.
const cases = [
  "{oops",
  "{'a':1}",
  "{1:2}",
  "{\"a\" 1}",
  "{\"a\"}",
  "{\"a\":1 \"b\":2}",
  "{\"a\":1,}",
  "{\"a\":1,\"b\"}",
  "{\"a\":1",
  "{\"a\":1,",
  "{\"a\"",
  "[1 2]",
  "[1",
  "[1 \"x\"]",
  "{\"a\":\"b\"",
  "{\"a\":1}}",
  "[1]]",
  "{\"a\":1,\"b\":2,\"c\":3,\"d\":4,\"e\":5,\"f\":6,\"g\":7,\"h\":8,\"i\":9,\"j\":10,\"k\":11,\"l\":12,\"m\":13,\"n\":14,\"o\":15,\"p\"!:1}",
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
