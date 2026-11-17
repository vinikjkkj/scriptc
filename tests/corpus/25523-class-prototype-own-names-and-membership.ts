// The prototype's own names in definition order, own-property membership, and the prototype chain between them.
class Shape { area(): number { return 0; } perimeter(): number { return 0; } }
class Square extends Shape { area(): number { return 4; } side(): number { return 2; } }
console.log(Object.getOwnPropertyNames(Shape.prototype).join(","), Object.getOwnPropertyNames(Square.prototype).join(","));
console.log(Shape.prototype.hasOwnProperty("area"), Square.prototype.hasOwnProperty("perimeter"), Square.prototype.hasOwnProperty("side"), Square.prototype.hasOwnProperty("constructor"));
console.log(Shape.prototype.isPrototypeOf(Square.prototype), Square.prototype.isPrototypeOf(Shape.prototype));
