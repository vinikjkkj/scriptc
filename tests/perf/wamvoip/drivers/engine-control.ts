// The ARMED CONTROL for the engine-free scan: a program that CERTAINLY
// embeds the dynamic engine. A marker that reads zero here cannot
// discriminate, and must not be quoted as evidence about any other binary.
const o: Record<string, unknown> = JSON.parse('{"a":1}')
console.log(String(o['a']))
