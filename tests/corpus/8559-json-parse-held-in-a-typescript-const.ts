// `const parseRef = JSON.parse` (tests/diagnostics/json-dyn.ts line 42) used to be
// SC1090 "JSON methods as values". It is a function value now: held, called, passed.
const parseRef = JSON.parse;
const parsed: unknown = parseRef('{"a":[1,2,{"b":null}],"c":"x"}');
console.log(JSON.stringify(parsed), typeof parseRef, parseRef === JSON.parse);
const texts = ['1', '"s"', 'true', '[3]'];
console.log(texts.map((t) => JSON.stringify(parseRef(t))).join(' '));
try {
  parseRef('{bad');
} catch (e) {
  console.log((e as Error).name);
}
