/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-implied-eval -- the row builds engine code at run time on purpose */
// `field.string()` calls the engine's method on field; `const f = field.string; f()` is a call with no receiver, and the engine's class
// method throws its TypeError there, exactly as Node does.
interface CastField { label: string; string(): string | null; }
const body = [
  "class Col { constructor() { this.label = 'col'; } string() { return this.label + '!'; } }",
  "const field = new Col();",
  "return [cb(field), cb(field)];",
].join("\n");
const run = new Function("cb", body) as (cb: (field: CastField) => unknown) => unknown[];
const out = run((field) => {
  const f = field.string;
  let detached: string;
  try {
    detached = String(f());
  } catch (e) {
    detached = (e as Error).constructor.name;
  }
  return [field.string(), detached, typeof f];
});
console.log(JSON.stringify(out));
