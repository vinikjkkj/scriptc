// A JS-twin subclass whose overrides differ from the base declaration: area
// adds an untyped trailing parameter (absent through the base: undefined), and label declares one parameter the
// base does not have. Calls through the base type reach the overrides with
// JavaScript argument semantics. Statics are written through the name.
import Square, { Shape } from "./lib.js";

Square.made = Square.made + 3;
Square.made = Square.made * 2;
const s = new Square(4);
const sh: Shape = s;
console.log(Square.made, sh.area(2), sh.label(), s.area(1), sh.area(3));
