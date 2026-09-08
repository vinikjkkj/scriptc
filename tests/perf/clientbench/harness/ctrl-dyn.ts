// Positive control for engine.mjs: a two-line program built --dynamic must
// read quickjs>0 / ScrDyn>0, or the scanner's zero on the bench binary means
// nothing.
const x: unknown = JSON.parse('{"a":1}')
console.log(String((x as Record<string, number>).a))
