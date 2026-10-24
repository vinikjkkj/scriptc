// A rest-parameter function used as a VALUE (a const, a parameter, a stored
// element) and called with a spread: the spread fills the rest slot, copied,
// exactly as the named call does. Empty and multi-part spreads included.
function wrap(...parts: string[]): string {
  return parts.join("+");
}
const g = wrap;
const xs: string[] = ["a", "b"];
console.log(g(...xs));
const none: string[] = [];
const one: string[] = ["c"];
console.log(g(...none, ...xs, ...one));

function callWith(f: (...p: string[]) => string, args: string[]): string {
  return f(...args);
}
console.log(callWith(wrap, ["c", "d"]));
console.log(callWith(wrap, []));

const table: Array<(...p: string[]) => string> = [wrap];
console.log(table[0]!(...xs));

const copy = xs.slice();
const aliased = (...rest: string[]): number => {
  rest.push("z");
  return rest.length;
};
console.log(aliased(...copy), copy.length);
