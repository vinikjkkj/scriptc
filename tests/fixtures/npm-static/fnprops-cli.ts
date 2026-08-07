// npm-static pilot: own properties on a FUNCTION VALUE reached through
// the checked-dynamic path.
//
// The package hands a function through an untyped identity, so the value
// is a dyn function box and `f.k = v` is the dyn keyed write. That write
// used to THROW ("Cannot create property 'kind' on function") while the
// matching READ already answered from the closure's property table — the
// two halves of one table disagreed. Every observable the package prints
// is a Node answer this file pins byte for byte, including the one that
// decides where the table lives: a SECOND box of the same function value
// sees the same properties, because JS has one function object per
// closure, not one per boundary crossing.
import lib from "fnprops";

console.log(lib.run());
