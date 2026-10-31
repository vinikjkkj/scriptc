// JSON.parse SyntaxError text, one line per input (V8 json-parser.cc wording).
// Each input is parsed through the reviver-free path; the reviver rows follow.
const cases: string[] = [
  "1 2",
  "\"a\" \"b\"",
  "{}x",
  "[1]]",
  "1e5 x",
  "true false",
  "null null",
  "\"s\"\"t\"",
  "[1]\u00e9",
  "{\"a\":1}\n{\"b\":2}",
];
let idx = 0;
for (const s of cases) {
  idx++;
  try {
    JSON.parse(s);
    console.log(idx, "OK", s.length);
  } catch (e: any) {
    console.log(idx, e.name, e instanceof SyntaxError, e.message.length, e.message);
  }
}
try {
  JSON.parse("{\"a\":nope}", (k: any, v: any) => v);
} catch (e: any) {
  console.log("reviver", e.name, e.message);
}
