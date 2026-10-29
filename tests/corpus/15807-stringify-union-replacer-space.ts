// The replacer and space arrive as unions, the shape the EJSON serializer
// passes through: an array list, a function, or null, with an optional space.
function pick(r: (number | string)[] | ((k: string, v: unknown) => unknown) | null, space: string | number | undefined): void {
  console.log(JSON.stringify({ q: 1, w: { q: 2 } }, r as any, space));
}
console.log(pick(["q"], undefined));
console.log(pick((k: string, v: unknown) => v, 3));
console.log(pick(null, "xy"));
console.log(pick(["w", "q"], 1));
