// A typed function parameter that boxes inside the callee answered the
// PARAMETER's name (`[Function: f]`) for every function passed in. JS names
// the function where it was created, so the caller's function keeps its name.
function g1(): number { return 1; }
const g2 = (): number => 2;
function take(f: () => number): any { return f; }
function take2(f: any): any { return f; }
console.log(take(g1));
console.log(take(g2));
console.log(take(() => 3));
console.log(take2(g2));
console.log(take(g1).name, take(g2).name);
