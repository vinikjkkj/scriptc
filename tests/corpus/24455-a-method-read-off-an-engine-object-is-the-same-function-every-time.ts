/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-implied-eval -- the row builds engine code at run time on purpose */
// A method read off an engine-held object through a typed record is the engine's function object: the same one on every read, in one
// callback and across callbacks (so it can be compared, stored, and removed by identity as in Node).
interface CastField { label: string; string(): string | null; }
const body = [
  "class Col { constructor(label) { this.label = label; } string() { return this.label + '!'; } }",
  "const a = new Col('a');",
  "const b = new Col('b');",
  "return [cb(a), cb(a), cb(b)];",
].join("\n");
const run = new Function("cb", body) as (cb: (field: CastField) => unknown) => unknown[];
const seen: unknown[] = [];
const out = run((field) => {
  seen.push(field.string);
  return [field.string === field.string, field.string()];
});
console.log(JSON.stringify(out), seen[0] === seen[1], seen[0] === seen[2], seen[1] === seen[2]);
