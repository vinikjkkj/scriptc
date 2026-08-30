// THE SPREAD BOUNDARY, all three positions in one program, so the line
// between them is visible rather than argued.
//
// A spread fills a slot whose ARITY may be a runtime fact. There are three
// such slots and one that is not:
//
//   a typed REST parameter      -- supported (completeArgs packs it)
//   a DYN rest parameter        -- supported (the pack IS the arity)
//   a variadic CONSOLE tail     -- supported (one dyn pack, joined at run time)
//   a FIXED parameter position  -- REFUSED, and correctly so
//
// The fixed position is refused because completing that call needs the
// array's LENGTH at compile time: every call lowers to exactly the callee's
// full ABI parameter list (the one-signature contract), so there is no home
// for a count nobody knows until the array exists. Widening it would mean
// runtime arity machinery in every call, which is the thing the contract
// exists to avoid.
//
// This fixture is the record of that decision. Three of the four lines
// below compile; the snapshot shows that exactly ONE diagnostic comes out
// of it, at the fixed position, naming the rule.

function fixed(a: number, b: number): number {
  return a + b;
}
function typedRest(tag: string, ...xs: number[]): number {
  return tag.length + xs.length;
}
function dynRest(...args: unknown[]): number {
  return args.length;
}

const two: number[] = [1, 2];
const anys: unknown[] = [1, "x"];

// Supported: a typed rest slot takes a same-element array spread.
console.log(typedRest("t", ...two));

// Supported: a dyn rest slot -- the one parameter slot whose arity is
// allowed to be a runtime fact.
console.log(dynRest(...anys));

// Supported: the console tail, fixed arguments and then a spread. Node's
// formatter is total over the whole list, so the fixed arguments are just
// its first entries.
console.log("tag", ...two);

// REFUSED: a spread landing on FIXED parameter positions. The cast is what
// makes tsc admit the call at all -- without it the arity is unknown to the
// checker too, and the refusal below would be hidden behind a type error
// rather than stated as the rule it is.
console.log(fixed(...(two as [number, number])));
