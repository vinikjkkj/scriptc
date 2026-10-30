// Two pushed types (number, then string): the element type is the union
// tsc evolves to; reads after both pushes see (string | number)[].
const a = [];
a.push(1);
a.push("x");
console.log(a.length, a[0], a[1]);
