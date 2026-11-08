// `F.prototype = []` makes the prototype an array, which has no [[Prototype]] link to rewrite: refused where the program is built.
function F() {}
F.prototype = [];
Object.setPrototypeOf(F.prototype, { m() { return 1; } });
console.log(typeof F.prototype);
