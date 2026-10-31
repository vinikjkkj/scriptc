// JSON.parse SyntaxError text, one line per input (V8 json-parser.cc wording).
// Each input is parsed through the reviver-free path; the reviver rows follow.
const cases: string[] = [
  "{\n  \"a\": 1,\n  x\n}",
  "{\r\n  \"a\": 1,\r\n  x\r\n}",
  "{\r  \"a\": 1,\r  x\r}",
  "[\n1,\n2\n\n  q]",
  "{\n\n\n\"a\":\n1\n\n\"b\" 2}",
  "[1,\r\n\r\n@]",
  "\n\n@",
  "\r\r\rnope",
  "{\"a\":1}\r\n\r\nnope",
  "{\r\"a\": 1,\r\"b\": 2 @}",
  "[\r\n[\r\n[\r\n1 2]]]",
  "\"line1\nline2\" x",
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
