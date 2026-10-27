// Increment, decrement and assignment operands of a unit comparison.
let x = 0;
let y: number;
console.log((x++) !== undefined, x);
console.log((++x) === undefined, x);
console.log((y = 3) !== undefined, y);
console.log((x += 2) == null, x);
console.log((x--) === null, x);
