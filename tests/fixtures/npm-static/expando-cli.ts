// npm-static pilot: instance members written from outside the class,
// `.length` of an untyped local inside a monomorphized body, and a required
// table used as a value.
import expando from "expando";

console.log(expando.expandoRun());
console.log(expando.fraction(7, 3), expando.fraction(7, 0), expando.fraction(1234567, 4));
console.log(expando.typeName(0), expando.typeName(1), expando.typeName("TINY"), expando.typeName("SHORT"));
console.log(expando.typeNames());
